package app.melodious.protocol.catalog

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

class CatalogOAuthTest {

    @Test
    fun `PKCE pair generates 48-byte verifier, S256 challenge, and 24-byte state`() {
        val pair = pkcePair()
        assertTrue(pair.verifier.matches(Regex("^[A-Za-z0-9_-]{64}$")))
        assertTrue(pair.challenge.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        assertTrue(pair.state.matches(Regex("^[A-Za-z0-9_-]{32}$")))
        val recomputed = base64Url(
            MessageDigest.getInstance("SHA-256").digest(pair.verifier.toByteArray(Charsets.US_ASCII))
        )
        assertEquals(recomputed, pair.challenge)
    }

    @Test
    fun `authorizeUrl builds the Logitech OAuth2 URL`() {
        val url = authorizeUrl(DEFAULT_CLIENT_ID, "ch_test_123", "st_test_456").toHttpUrl()
        assertEquals(OAUTH_AUTHORIZE_URL, "${url.scheme}://${url.host}${url.encodedPath}")
        assertEquals(DEFAULT_CLIENT_ID, url.queryParameter("client_id"))
        assertEquals("code", url.queryParameter("response_type"))
        assertEquals("S256", url.queryParameter("code_challenge_method"))
        assertEquals("ch_test_123", url.queryParameter("code_challenge"))
        assertEquals("st_test_456", url.queryParameter("state"))
        assertEquals(OAUTH_REDIRECT_URI, url.queryParameter("redirect_uri"))
        assertEquals("openid", url.queryParameter("scope"))
    }

    @Test
    fun `parseCallback accepts only the strict callback`() {
        assertEquals(
            "auth_code_99",
            parseCallback(
                "com.logitech.harmony://lidsoauth?code=auth_code_99&state=expected_state_1",
                "expected_state_1",
            ),
        )
        assertEquals(
            "auth_code_99",
            parseCallback("?code=auth_code_99&state=expected_state_1", "expected_state_1"),
        )
        for (bad in listOf(
            "com.logitech.harmony://other?code=x&state=s",
            "com.logitech.harmony://lidsoauth/path?code=x&state=s",
            "com.logitech.harmony://lidsoauth?code=x&state=s&error=",
            "com.logitech.harmony://lidsoauth?code=x&code=y&state=s",
            "com.logitech.harmony://lidsoauth?code=x&state=s&state=s",
            "com.logitech.harmony://lidsoauth?code=x&state=other",
            "com.logitech.harmony://lidsoauth?code=x",
            "com.logitech.harmony://lidsoauth?state=s",
            "bare_nonce_123456",
            "https://id.logi.com/launch.html?nonce=abc123",
            "https://accounts.logi.com/identity/oauth2/authorize/redirect/abc123",
            "",
        )) {
            assertThrows("expected rejection: $bad", CatalogError::class.java) {
                parseCallback(bad, "s")
            }
        }
        val refused = assertThrows(CatalogError::class.java) {
            parseCallback(
                "com.logitech.harmony://lidsoauth?error=access_denied&state=s", "s"
            )
        }
        assertTrue(refused.message!!.contains("Logitech refused the sign-in"))
    }

    @Test
    fun `exchange and refresh forms and token parsing`(): Unit = runBlocking {
        assertEquals(
            linkedMapOf(
                "grant_type" to "authorization_code",
                "client_id" to "cid-1",
                "code_verifier" to "ver-3",
                "redirect_uri" to OAUTH_REDIRECT_URI,
                "code" to "code-2",
            ),
            buildExchangeForm("cid-1", "code-2", "ver-3"),
        )
        assertEquals(
            linkedMapOf(
                "grant_type" to "refresh_token",
                "client_id" to "cid-1",
                "refresh_token" to "ref-4",
            ),
            buildRefreshForm("cid-1", "ref-4"),
        )

        val http = RecordingHttp { url, fields ->
            assertEquals(OAUTH_TOKEN_URL, url)
            if (fields["grant_type"] == "authorization_code") {
                CatalogHttpResponse(200, buildJsonObject {
                    put("access_token", "acc-new"); put("id_token", "id-new"); put("refresh_token", "ref-new")
                })
            } else {
                CatalogHttpResponse(200, buildJsonObject {
                    put("access_token", "acc-refreshed"); put("id_token", "id-refreshed")
                })
            }
        }
        val exchanged = oauthExchange(http, "cid-1", "code-2", "ver-3")
        assertEquals("acc-new", exchanged.accessToken)
        assertEquals("ref-new", exchanged.refreshToken)
        val refreshed = oauthRefresh(http, exchanged, "cid-1")
        assertEquals("acc-refreshed", refreshed.accessToken)
        // A refresh answer without a rotated refresh token keeps the old one.
        assertEquals("ref-new", refreshed.refreshToken)
        assertEquals(2, http.formCalls.size)
    }

    @Test
    fun `client id override is validated like the desktop app`() {
        assertEquals("", normalizeClientId("  "))
        assertEquals("cid-1", normalizeClientId(" cid-1 "))
        assertEquals(DEFAULT_CLIENT_ID, effectiveClientId(""))
        assertEquals("cid-1", effectiveClientId("cid-1"))
        assertThrows(CatalogError::class.java) { normalizeClientId("bad id") }
        assertThrows(CatalogError::class.java) { normalizeClientId("x".repeat(129)) }
    }
}

/** Records form posts; JSON posts are not expected in these tests. */
internal class RecordingHttp(
    private val onForm: (String, Map<String, String>) -> CatalogHttpResponse,
) : CatalogHttp {
    val formCalls = mutableListOf<Pair<String, Map<String, String>>>()

    override suspend fun get(url: String): CatalogHttpResponse =
        throw AssertionError("unexpected GET $url")

    override suspend fun postJson(
        url: String,
        payload: kotlinx.serialization.json.JsonElement,
        bearer: String?,
        extraHeaders: Map<String, String>,
    ): CatalogHttpResponse = throw AssertionError("unexpected POST $url")

    override suspend fun postForm(url: String, fields: Map<String, String>): CatalogHttpResponse {
        formCalls.add(url to fields)
        return onForm(url, fields)
    }

    override fun clearCookies() = Unit
}
