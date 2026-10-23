package app.melodious.protocol.catalog

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

class CatalogError(message: String) : Exception(message)

const val DEFAULT_CLIENT_ID = "9d88df5e-7edf-4288-8634-26721cbe7add"
const val OAUTH_AUTHORIZE_URL = "https://accounts.logi.com/identity/oauth2/authorize"
const val OAUTH_TOKEN_URL = "https://accounts.logi.com/identity/oauth2/token"
const val OAUTH_REDIRECT_URI = "com.logitech.harmony://lidsoauth"
const val OAUTH_SCHEME = "com.logitech.harmony"

data class CatalogTokens(
    val accessToken: String,
    val idToken: String,
    val refreshToken: String? = null,
)

data class PkcePair(val verifier: String, val challenge: String, val state: String)

fun base64Url(bytes: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

fun pkcePair(random: SecureRandom = SecureRandom()): PkcePair {
    val verifierBytes = ByteArray(48).also(random::nextBytes)
    val verifier = base64Url(verifierBytes)
    val challenge = base64Url(
        MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
    )
    val state = base64Url(ByteArray(24).also(random::nextBytes))
    return PkcePair(verifier, challenge, state)
}

fun normalizeClientId(value: String?): String {
    val clean = value?.trim().orEmpty()
    if (clean.isEmpty()) return ""
    if (clean.length > 128 || clean.any { it <= ' ' || it == '\u007F' }) {
        throw CatalogError("Invalid client_id")
    }
    return clean
}

fun effectiveClientId(override: String?): String =
    normalizeClientId(override).ifEmpty { DEFAULT_CLIENT_ID }

fun authorizeUrl(clientId: String?, challenge: String, state: String): String {
    if (challenge.isBlank() || state.isBlank()) {
        throw CatalogError("PKCE challenge and state are required")
    }
    return OAUTH_AUTHORIZE_URL.toHttpUrl().newBuilder()
        .addQueryParameter("client_id", effectiveClientId(clientId))
        .addQueryParameter("response_type", "code")
        .addQueryParameter("code_challenge_method", "S256")
        .addQueryParameter("code_challenge", challenge)
        .addQueryParameter("state", state)
        .addQueryParameter("redirect_uri", OAUTH_REDIRECT_URI)
        .addQueryParameter("scope", "openid")
        .build()
        .toString()
}

fun parseCallback(text: String?, expectedState: String?): String {
    val candidate = text?.trim().orEmpty()
    if (candidate.isEmpty()) {
        throw CatalogError("nothing was pasted; paste the callback address from your browser")
    }
    val lower = candidate.lowercase()
    if (lower.startsWith("id.logi.com/") || lower.startsWith("accounts.logi.com/")) {
        throw CatalogError(
            "that is Logitech's own page, not the callback. It hands your browser a " +
                "com.logitech.harmony://lidsoauth?code=... address"
        )
    }

    var scheme = ""
    var query = candidate
    if (candidate.contains("://")) {
        val uri = try {
            URI(candidate)
        } catch (_: Exception) {
            throw CatalogError(
                "that is not the callback address: it should start with " +
                    "com.logitech.harmony://lidsoauth and carry code= and state="
            )
        }
        val host = uri.host?.lowercase().orEmpty()
        if (host.endsWith("logi.com")) {
            throw CatalogError(
                "that is Logitech's own page, not the callback. It hands your browser a " +
                    "com.logitech.harmony://lidsoauth?code=... address"
            )
        }
        scheme = uri.scheme?.lowercase().orEmpty()
        query = uri.rawQuery.orEmpty()
        if (scheme.isNotEmpty() && scheme != OAUTH_SCHEME) {
            throw CatalogError(
                "that is not the callback address: it should start with " +
                    "com.logitech.harmony://lidsoauth and carry code= and state="
            )
        }
        if (scheme.isNotEmpty()) {
            if (host != "lidsoauth" || !uri.rawPath.isNullOrEmpty() || uri.rawFragment != null ||
                uri.rawUserInfo != null || uri.port != -1
            ) {
                throw CatalogError("Invalid Logitech callback address")
            }
        }
    } else if (candidate.startsWith("?")) {
        query = candidate.drop(1)
    }

    val params = parseQueryParams(query)
    if (params.containsKey("error")) {
        throw CatalogError("Logitech refused the sign-in; sign in again")
    }
    val codes = params["code"].orEmpty()
    val code = codes.firstOrNull()?.trim().orEmpty()
    if (code.isEmpty()) {
        throw CatalogError(
            "that is not the callback address: it should start with " +
                "com.logitech.harmony://lidsoauth and carry code= and state="
        )
    }
    val states = params["state"].orEmpty()
    val state = states.firstOrNull()?.trim().orEmpty()
    if (state.isEmpty() || expectedState.isNullOrEmpty() || state != expectedState ||
        states.size != 1 || codes.size != 1
    ) {
        throw CatalogError(
            "that callback belongs to a different sign-in attempt; sign in again from the tab this run opened"
        )
    }
    return code
}

private fun parseQueryParams(query: String): Map<String, List<String>> {
    val out = LinkedHashMap<String, MutableList<String>>()
    if (query.isEmpty()) return out
    for (part in query.split('&')) {
        if (part.isEmpty()) continue
        val eq = part.indexOf('=')
        val rawName = if (eq >= 0) part.substring(0, eq) else part
        val rawValue = if (eq >= 0) part.substring(eq + 1) else ""
        val name = runCatching { URLDecoder.decode(rawName, "UTF-8") }.getOrDefault(rawName)
        val value = runCatching { URLDecoder.decode(rawValue, "UTF-8") }.getOrDefault(rawValue)
        out.getOrPut(name) { mutableListOf() }.add(value)
    }
    return out
}

fun buildExchangeForm(clientId: String?, code: String, verifier: String): Map<String, String> =
    linkedMapOf(
        "grant_type" to "authorization_code",
        "client_id" to effectiveClientId(clientId),
        "code_verifier" to verifier,
        "redirect_uri" to OAUTH_REDIRECT_URI,
        "code" to code,
    )

fun buildRefreshForm(clientId: String?, refreshToken: String): Map<String, String> =
    linkedMapOf(
        "grant_type" to "refresh_token",
        "client_id" to effectiveClientId(clientId),
        "refresh_token" to refreshToken,
    )

private fun JsonElement?.stringField(name: String): String? {
    val obj = this as? JsonObject ?: return null
    val prim = obj[name] as? JsonPrimitive ?: return null
    if (!prim.isString) return null
    return prim.content.takeIf { it.isNotEmpty() }
}

fun parseTokens(payload: JsonElement?, fallback: CatalogTokens? = null): CatalogTokens {
    if (payload !is JsonObject) {
        throw CatalogError("the sign-in answer was not a JSON object")
    }
    val accessToken = payload.stringField("access_token")
    val idToken = payload.stringField("id_token") ?: fallback?.idToken
    val refreshToken = payload.stringField("refresh_token") ?: fallback?.refreshToken
    if (accessToken.isNullOrEmpty() || idToken.isNullOrEmpty()) {
        throw CatalogError("access_token or id_token is missing from the sign-in answer")
    }
    return CatalogTokens(accessToken, idToken, refreshToken?.takeIf { it.isNotEmpty() })
}

internal fun rejectedMessage(what: String, status: Int, browserHint: Boolean = false): String {
    val hint = if (status == 401 || status == 403) {
        if (browserHint) " -- the saved sign-in may have expired; the browser sign-in will run next"
        else " -- the saved sign-in may have expired; sign in again"
    } else {
        ""
    }
    return "$what: HTTP $status$hint"
}

suspend fun oauthExchange(
    http: CatalogHttp,
    clientId: String?,
    code: String,
    verifier: String,
): CatalogTokens {
    val fields = buildExchangeForm(clientId, code, verifier)
    val (status, payload) = http.postForm(OAUTH_TOKEN_URL, fields)
    if (status != 200) {
        throw CatalogError(
            "Logitech rejected the code exchange: HTTP $status; codes work once and " +
                "expire within minutes, so sign in afresh"
        )
    }
    return parseTokens(payload)
}

suspend fun oauthRefresh(
    http: CatalogHttp,
    tokens: CatalogTokens,
    clientId: String? = DEFAULT_CLIENT_ID,
): CatalogTokens {
    val refresh = tokens.refreshToken
    if (refresh.isNullOrEmpty()) {
        throw CatalogError("there is no refresh_token; a browser sign-in is needed")
    }
    val fields = buildRefreshForm(clientId, refresh)
    val (status, payload) = http.postForm(OAUTH_TOKEN_URL, fields)
    if (status != 200) {
        throw CatalogError(rejectedMessage("Logitech rejected the renewal", status))
    }
    return parseTokens(payload, tokens)
}
