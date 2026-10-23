package app.melodious.system

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import app.melodious.protocol.catalog.CatalogError
import app.melodious.protocol.catalog.SignInLaunchResult
import app.melodious.protocol.catalog.SignInLauncher
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal const val NEEDS_CHROME_MESSAGE =
    "Logitech sign-in needs Chrome 137 or later. Install or update Chrome."

/**
 * Launches Logitech's authorize page in a Chrome Auth Tab and hands the
 * callback URL back through the activity-result callback. No intent filter
 * claims Logitech's scheme; Chrome returns the redirect to this app.
 *
 * App-scoped so the pending attempt survives an activity recreation while
 * Chrome is open; MainActivity rebinds its launcher on every onCreate.
 */
object AuthTabSignIn : SignInLauncher {
    const val CHROME_PACKAGE = "com.android.chrome"

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var launcher: ActivityResultLauncher<Intent>? = null

    private var pending: CancellableContinuation<SignInLaunchResult>? = null

    fun bind(context: Context, launcher: ActivityResultLauncher<Intent>) {
        appContext = context.applicationContext
        this.launcher = launcher
    }

    fun unbind(launcher: ActivityResultLauncher<Intent>) {
        if (this.launcher === launcher) this.launcher = null
    }

    override suspend fun launch(authorizeUrl: String): SignInLaunchResult {
        val context = appContext ?: throw CatalogError(NEEDS_CHROME_MESSAGE)
        val activeLauncher = launcher ?: throw CatalogError(NEEDS_CHROME_MESSAGE)
        val pkg = authTabPackage(context) ?: throw CatalogError(NEEDS_CHROME_MESSAGE)
        return suspendCancellableCoroutine { cont ->
            synchronized(this) {
                if (pending != null) {
                    cont.resumeWithException(CatalogError("A Logitech sign-in is already open"))
                    return@suspendCancellableCoroutine
                }
                pending = cont
            }
            cont.invokeOnCancellation {
                synchronized(this) { if (pending === cont) pending = null }
            }
            try {
                val intent = AuthTabIntent.Builder().build()
                intent.intent.setPackage(pkg)
                intent.launch(activeLauncher, Uri.parse(authorizeUrl), "com.logitech.harmony")
            } catch (_: Exception) {
                synchronized(this) { if (pending === cont) pending = null }
                if (cont.isActive) {
                    cont.resumeWithException(CatalogError("Could not open Logitech sign-in. Try again."))
                }
            }
        }
    }

    fun onResult(result: AuthTabIntent.AuthResult) {
        val cont = synchronized(this) {
            val taken = pending
            pending = null
            taken
        } ?: return
        if (!cont.isActive) return
        when (result.resultCode) {
            AuthTabIntent.RESULT_OK -> {
                val uri = result.resultUri
                if (uri != null) {
                    cont.resume(SignInLaunchResult.Returned(uri.toString()))
                } else {
                    cont.resumeWithException(CatalogError("Sign-in was interrupted; sign in again"))
                }
            }
            AuthTabIntent.RESULT_CANCELED -> cont.resume(SignInLaunchResult.Cancelled)
            AuthTabIntent.RESULT_VERIFICATION_FAILED,
            AuthTabIntent.RESULT_VERIFICATION_TIMED_OUT ->
                cont.resumeWithException(
                    CatalogError("Chrome could not verify the sign-in return; sign in again")
                )
            else -> cont.resumeWithException(CatalogError("Sign-in was interrupted; sign in again"))
        }
    }

    /** Chrome first, then the default Custom Tabs browser if it supports Auth Tab. */
    fun authTabPackage(context: Context): String? {
        if (isSupported(context, CHROME_PACKAGE)) return CHROME_PACKAGE
        val tabs = runCatching { CustomTabsClient.getPackageName(context, null) }.getOrNull()
        if (!tabs.isNullOrBlank() && tabs != CHROME_PACKAGE && isSupported(context, tabs)) {
            return tabs
        }
        return null
    }

    private fun isSupported(context: Context, pkg: String): Boolean =
        runCatching { CustomTabsClient.isAuthTabSupported(context, pkg) }.getOrDefault(false)
}
