package app.melodious.system

import android.content.Context
import android.content.SharedPreferences
import app.melodious.protocol.model.HubEndpoint

/**
 * Single source of truth for the hub the user last connected to plus phone-side preferences.
 * Shared by the app UI and the Quick Settings tile so both talk to the same host, port and auth.
 */
class HubPrefs(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("melodious_prefs", Context.MODE_PRIVATE)

    fun savedEndpoint(): HubEndpoint? {
        val host = prefs.getString(KEY_HOST, null)?.takeIf { it.isNotBlank() } ?: return null
        val port = prefs.getInt(KEY_PORT, 8080)
        return HubEndpoint(
            name = "Hub",
            host = host,
            webUiPort = port,
            hubId = prefs.getString(KEY_HUB_ID, "").orEmpty(),
            isSimulated = port == 8787,
            basicAuthHeader = prefs.getString(KEY_AUTH, null)?.takeIf { it.isNotBlank() },
        )
    }

    fun saveEndpoint(endpoint: HubEndpoint) {
        prefs.edit()
            .putString(KEY_HOST, endpoint.host)
            .putInt(KEY_PORT, endpoint.webUiPort)
            .putString(KEY_HUB_ID, endpoint.hubId)
            .putString(KEY_AUTH, endpoint.basicAuthHeader)
            .apply()
    }

    var volumeKeysEnabled: Boolean
        get() = prefs.getBoolean(KEY_VOLUME_KEYS, true)
        set(value) = prefs.edit().putBoolean(KEY_VOLUME_KEYS, value).apply()

    var hapticsEnabled: Boolean
        get() = prefs.getBoolean(KEY_HAPTICS, true)
        set(value) = prefs.edit().putBoolean(KEY_HAPTICS, value).apply()

    var remoteMode: String
        get() = prefs.getString(KEY_REMOTE_MODE, "BUTTONS") ?: "BUTTONS"
        set(value) = prefs.edit().putString(KEY_REMOTE_MODE, value).apply()

    var notificationRemoteEnabled: Boolean
        get() = prefs.getBoolean(KEY_NOTIF_REMOTE, true)
        set(value) = prefs.edit().putBoolean(KEY_NOTIF_REMOTE, value).apply()

    /** The user answered (or dismissed) the "control from your lock screen" prompt. */
    var notificationPromptHandled: Boolean
        get() = prefs.getBoolean(KEY_NOTIF_PROMPT, false)
        set(value) = prefs.edit().putBoolean(KEY_NOTIF_PROMPT, value).apply()

    /**
     * Activities + running state cached for the home-screen widget, which renders without the app
     * running. Names never contain newlines (hub UI forbids them), so a line-based format is enough.
     */
    var cachedActivities: List<Pair<String, String>>
        get() = prefs.getString(KEY_ACTIVITIES, "").orEmpty().lineSequence()
            .mapNotNull { line -> line.split('\t', limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }
            .toList()
        set(value) = prefs.edit()
            .putString(KEY_ACTIVITIES, value.joinToString("\n") { (id, name) -> "$id\t${name.replace('\n', ' ')}" })
            .apply()

    var cachedCurrentActivityId: String
        get() = prefs.getString(KEY_CURRENT, "-1") ?: "-1"
        set(value) = prefs.edit().putString(KEY_CURRENT, value).apply()

    /** Activity the widget asked the hub to start and is still waiting on ("-1" = turning off). */
    var widgetPendingActivityId: String?
        get() = prefs.getString(KEY_WIDGET_PENDING, null)
        set(value) = prefs.edit().putString(KEY_WIDGET_PENDING, value).apply()

    private companion object {
        const val KEY_HOST = "saved_hub_host"
        const val KEY_PORT = "saved_hub_port"
        const val KEY_HUB_ID = "saved_hub_id"
        const val KEY_AUTH = "saved_hub_auth"
        const val KEY_VOLUME_KEYS = "volume_keys_enabled"
        const val KEY_HAPTICS = "haptics_enabled"
        const val KEY_REMOTE_MODE = "remote_mode"
        const val KEY_NOTIF_REMOTE = "notification_remote_enabled"
        const val KEY_NOTIF_PROMPT = "notification_prompt_handled"
        const val KEY_ACTIVITIES = "cached_activities"
        const val KEY_CURRENT = "cached_current_activity"
        const val KEY_WIDGET_PENDING = "widget_pending_activity"
    }
}
