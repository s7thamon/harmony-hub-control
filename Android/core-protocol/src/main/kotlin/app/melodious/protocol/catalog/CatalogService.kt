package app.melodious.protocol.catalog

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive

data class CatalogSession(val accountId: String, val tokens: CatalogTokens)

data class CatalogStatus(val signedIn: Boolean)

suspend fun harmonySignin(http: CatalogHttp, tokens: CatalogTokens): CatalogSession {
    val body = buildJsonObject {
        put("access_token", JsonPrimitive(tokens.accessToken))
        put("id_token", JsonPrimitive(tokens.idToken))
    }
    val (status, payload) = http.postJson(HARMONY_SIGNIN_URL, body, bearer = tokens.accessToken)
    if (status != 200) {
        throw CatalogError(rejectedMessage("Harmony rejected the bootstrap", status, browserHint = true))
    }
    val obj = payload as? JsonObject
        ?: throw CatalogError("Harmony's signin did not return an object")
    val inner = (obj["SigninResult"] as? JsonObject) ?: obj
    val accountId = ((inner["AccountId"] ?: obj["AccountId"]) as? JsonPrimitive)
        ?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }
        ?: throw CatalogError("Harmony's signin did not return an AccountId")
    val locked = (inner["IsLockedOut"] as? JsonPrimitive)?.booleanOrNull == true ||
        (obj["IsLockedOut"] as? JsonPrimitive)?.booleanOrNull == true
    if (locked) throw CatalogError("the Harmony account is locked")
    return CatalogSession(accountId, tokens)
}

/**
 * The signed-in catalog session, ported from the desktop app's catalog
 * service: saved tokens first, one silent refresh, then one browser
 * sign-in. Every call is serialized; status is local and never networks.
 */
class CatalogService(
    private val http: CatalogHttp,
    private val tokenStore: TokenStore,
    private val signInLauncher: SignInLauncher? = null,
    private val clientIdProvider: () -> String = { DEFAULT_CLIENT_ID },
) {
    private val mutex = Mutex()
    private var inMemoryTokens: CatalogTokens? = null
    private var currentSession: CatalogSession? = null

    fun status(): CatalogStatus =
        CatalogStatus(currentSession != null || loadStoredTokens() != null)

    suspend fun signIn(): CatalogStatus = mutex.withLock {
        try {
            ensureActiveSessionLocked()
            CatalogStatus(true)
        } catch (e: CatalogError) {
            if (e.message == "Sign in to Logitech first") CatalogStatus(false) else throw e
        }
    }

    suspend fun signOut(): CatalogStatus = mutex.withLock {
        clearStoredLocked()
        CatalogStatus(false)
    }

    internal suspend fun ensureSession(): CatalogSession = mutex.withLock {
        ensureActiveSessionLocked()
    }

    private suspend fun ensureActiveSessionLocked(): CatalogSession {
        currentSession?.let { return it }
        try {
            val session = ensureSessionLocked()
            currentSession = session
            return session
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            clearStoredLocked()
            throw e
        }
    }

    private suspend fun ensureSessionLocked(): CatalogSession {
        var tokens = loadStoredTokens()
        if (tokens != null) {
            try {
                return harmonySignin(http, tokens)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Saved access_token rejected; try one silent refresh next.
            }
            try {
                val refreshed = oauthRefresh(http, tokens, clientIdProvider())
                saveStoredTokens(refreshed)
                tokens = refreshed
                return harmonySignin(http, refreshed)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Silent refresh failed; fall through to interactive sign-in once.
            }
        }

        val launcher = signInLauncher ?: throw CatalogError("Sign in to Logitech first")
        val pair = pkcePair()
        val clientId = clientIdProvider()
        val url = authorizeUrl(clientId, pair.challenge, pair.state)
        val freshTokens = when (val result = launcher.launch(url)) {
            SignInLaunchResult.Cancelled -> throw CatalogError("Sign in to Logitech first")
            is SignInLaunchResult.Returned -> {
                val code = parseCallback(result.callbackUrl, pair.state)
                oauthExchange(http, clientId, code, pair.verifier)
            }
        }
        saveStoredTokens(freshTokens)
        return harmonySignin(http, freshTokens)
    }

    private fun loadStoredTokens(): CatalogTokens? {
        inMemoryTokens?.let { return it }
        val stored = runCatching { tokenStore.load() }.getOrNull()
        if (stored != null) inMemoryTokens = stored
        return stored
    }

    private fun saveStoredTokens(tokens: CatalogTokens) {
        inMemoryTokens = tokens
        runCatching { tokenStore.save(tokens) }
    }

    private fun clearStoredLocked() {
        inMemoryTokens = null
        currentSession = null
        runCatching { tokenStore.clear() }
        runCatching { http.clearCookies() }
    }
}
