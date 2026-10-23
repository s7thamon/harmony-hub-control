package app.melodious.system

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.melodious.protocol.catalog.CatalogTokens
import app.melodious.protocol.catalog.TokenStore
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Logitech tokens encrypted with an AES-GCM key held in the Android
 * Keystore. If the Keystore fails at any point nothing is stored (and any
 * old blob is deleted); an undecryptable blob is deleted on read. The
 * catalog service keeps the tokens in memory for the rest of the run.
 */
class LogitechTokenStore(context: Context) : TokenStore {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    override fun load(): CatalogTokens? {
        val blob = prefs.getString(KEY_TOKENS, null)?.takeIf { it.isNotBlank() } ?: return null
        return try {
            val parts = blob.split(':', limit = 2)
            require(parts.size == 2)
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val cipherText = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, iv))
            val json = JSONObject(String(cipher.doFinal(cipherText), Charsets.UTF_8))
            CatalogTokens(
                accessToken = json.getString("access_token"),
                idToken = json.getString("id_token"),
                refreshToken = json.optString("refresh_token").takeIf { it.isNotEmpty() },
            )
        } catch (_: Exception) {
            clear()
            null
        }
    }

    override fun save(tokens: CatalogTokens) {
        try {
            val json = JSONObject()
                .put("access_token", tokens.accessToken)
                .put("id_token", tokens.idToken)
                .apply { tokens.refreshToken?.let { put("refresh_token", it) } }
                .toString()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val blob = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(json.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
            check(prefs.edit().putString(KEY_TOKENS, blob).commit())
        } catch (_: Exception) {
            // Never leave a partial or stale secret behind on failure.
            clear()
        }
    }

    override fun clear() {
        runCatching { prefs.edit().remove(KEY_TOKENS).commit() }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val PREFS_FILE = "melodious_logitech"
        const val KEY_TOKENS = "logitech_tokens_v1"
        const val KEY_ALIAS = "melodious_logitech_tokens"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
    }
}
