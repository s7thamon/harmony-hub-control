package app.melodious.protocol.catalog

sealed interface SignInLaunchResult {
    data class Returned(val callbackUrl: String) : SignInLaunchResult
    data object Cancelled : SignInLaunchResult
}

/** Opens the authorize URL in the browser and hands the callback URL back. */
interface SignInLauncher {
    suspend fun launch(authorizeUrl: String): SignInLaunchResult
}
