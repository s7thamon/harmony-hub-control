package app.melodious.protocol.catalog

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeTokenStore(var stored: CatalogTokens? = null) : TokenStore {
    override fun load(): CatalogTokens? = stored
    override fun save(tokens: CatalogTokens) { stored = tokens }
    override fun clear() { stored = null }
}

/**
 * Signin succeeds only for [accepted] bearer tokens; the token endpoint
 * answers refresh and exchange grants with fixed tokens.
 */
private class FakeHttp(
    private val accepted: Set<String>,
    private val refreshStatus: Int = 200,
    val order: MutableList<String> = mutableListOf(),
) : CatalogHttp {
    var signinCalls = 0
    var refreshCalls = 0
    var exchangeCalls = 0

    override suspend fun get(url: String): CatalogHttpResponse =
        throw AssertionError("unexpected GET $url")

    override suspend fun postJson(
        url: String,
        payload: JsonElement,
        bearer: String?,
        extraHeaders: Map<String, String>,
    ): CatalogHttpResponse {
        assertEquals(HARMONY_SIGNIN_URL, url)
        signinCalls++
        order.add("signin:$bearer")
        return if (bearer in accepted) {
            CatalogHttpResponse(200, buildJsonObject { put("AccountId", "fixture-account") })
        } else {
            CatalogHttpResponse(401, buildJsonObject { })
        }
    }

    override suspend fun postForm(url: String, fields: Map<String, String>): CatalogHttpResponse {
        assertEquals(OAUTH_TOKEN_URL, url)
        return when (fields["grant_type"]) {
            "refresh_token" -> {
                refreshCalls++
                order.add("refresh:${fields["refresh_token"]}")
                if (refreshStatus != 200) {
                    CatalogHttpResponse(refreshStatus, buildJsonObject { put("error", "invalid_grant") })
                } else {
                    CatalogHttpResponse(200, buildJsonObject {
                        put("access_token", "refreshed-acc")
                        put("id_token", "refreshed-id")
                        put("refresh_token", "refreshed-ref")
                    })
                }
            }
            else -> {
                exchangeCalls++
                order.add("exchange")
                CatalogHttpResponse(200, buildJsonObject {
                    put("access_token", "prompt-acc")
                    put("id_token", "prompt-id")
                    put("refresh_token", "prompt-ref")
                })
            }
        }
    }

    override fun clearCookies() { order.add("clearCookies") }
}

private fun callbackLauncher(order: MutableList<String>): SignInLauncher =
    object : SignInLauncher {
        override suspend fun launch(authorizeUrl: String): SignInLaunchResult {
            order.add("prompt")
            val state = authorizeUrl.toHttpUrl().queryParameter("state")
            return SignInLaunchResult.Returned(
                "com.logitech.harmony://lidsoauth?code=prompt-code&state=$state"
            )
        }
    }

class CatalogServiceTest {

    @Test
    fun `saved tokens sign in without refresh or prompt, and status never networks`(): Unit = runBlocking {
        val http = FakeHttp(accepted = setOf("saved-acc"))
        val store = FakeTokenStore(CatalogTokens("saved-acc", "saved-id", "saved-ref"))
        val service = CatalogService(http, store, callbackLauncher(http.order))
        assertTrue(service.signIn().signedIn)
        assertEquals(listOf("signin:saved-acc"), http.order)
        http.order.clear()
        assertTrue(service.status().signedIn)
        assertEquals(emptyList<String>(), http.order)
    }

    @Test
    fun `saved failure refreshes once, saves, and signs in without prompting`(): Unit = runBlocking {
        val http = FakeHttp(accepted = setOf("refreshed-acc"))
        val store = FakeTokenStore(CatalogTokens("stale-acc", "stale-id", "stale-ref"))
        val service = CatalogService(http, store, callbackLauncher(http.order))
        assertTrue(service.signIn().signedIn)
        assertEquals(
            listOf("signin:stale-acc", "refresh:stale-ref", "signin:refreshed-acc"),
            http.order,
        )
        assertEquals("refreshed-acc", store.stored?.accessToken)
        assertEquals(1, http.refreshCalls)
    }

    @Test
    fun `failed refresh prompts once and a refused prompt sign-in never loops`(): Unit = runBlocking {
        val http = FakeHttp(accepted = emptySet(), refreshStatus = 400)
        val store = FakeTokenStore(CatalogTokens("dead-acc", "dead-id", "dead-ref"))
        val service = CatalogService(http, store, callbackLauncher(http.order))
        val error = assertThrows(CatalogError::class.java) {
            runBlocking { service.signIn() }
        }
        assertTrue(error.message!!.contains("Harmony rejected the bootstrap"))
        assertEquals(
            listOf("signin:dead-acc", "refresh:dead-ref", "prompt", "exchange", "signin:prompt-acc", "clearCookies"),
            http.order,
        )
        assertEquals(1, http.refreshCalls)
        assertEquals(1, http.exchangeCalls)
        assertFalse(service.status().signedIn)
    }

    @Test
    fun `cancelled sign-in leaves the user signed out with no error`(): Unit = runBlocking {
        val http = FakeHttp(accepted = emptySet())
        val service = CatalogService(http, FakeTokenStore(), object : SignInLauncher {
            override suspend fun launch(authorizeUrl: String): SignInLaunchResult =
                SignInLaunchResult.Cancelled
        })
        assertFalse(service.signIn().signedIn)
        assertFalse(service.status().signedIn)
        assertEquals(0, http.signinCalls)
    }

    @Test
    fun `concurrent sign-ins coalesce and sign-out after an in-flight sign-in wins`(): Unit = runBlocking {
        val http = FakeHttp(accepted = setOf("saved-acc", "prompt-acc"))
        val store = FakeTokenStore(CatalogTokens("saved-acc", "saved-id", "saved-ref"))
        val service = CatalogService(http, store, callbackLauncher(http.order))
        val results = listOf(async { service.signIn() }, async { service.signIn() }, async { service.signIn() })
            .awaitAll()
        assertTrue(results.all { it.signedIn })
        assertEquals(1, http.signinCalls)

        // Sign-out queued behind an in-flight interactive sign-in clears it.
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val http2 = FakeHttp(accepted = setOf("prompt-acc"))
        val store2 = FakeTokenStore()
        val slow = object : SignInLauncher {
            override suspend fun launch(authorizeUrl: String): SignInLaunchResult {
                val state = authorizeUrl.toHttpUrl().queryParameter("state")
                entered.complete(Unit)
                release.await()
                return SignInLaunchResult.Returned(
                    "com.logitech.harmony://lidsoauth?code=c&state=$state"
                )
            }
        }
        val service2 = CatalogService(http2, store2, slow)
        val pending = async { service2.signIn() }
        withTimeout(5_000) { entered.await() }
        val signOut = async { service2.signOut() }
        release.complete(Unit)
        assertTrue(withTimeout(5_000) { pending.await() }.signedIn)
        withTimeout(5_000) { signOut.await() }
        assertFalse(service2.status().signedIn)
    }
}
