package app.melodious.system

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import app.melodious.protocol.rest.CodexHubRestClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Handles taps on the notification remote and the home-screen widget. Both run while the app is
 * closed, so everything here talks to the hub directly using the saved endpoint.
 */
class RemoteActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = goAsync()
        scope.launch {
            try {
                when (intent.action) {
                    ACTION_SEND_KEY -> sendKey(app, intent)
                    ACTION_RUN_ACTIVITY -> runActivity(app, intent.getStringExtra(EXTRA_ACTIVITY_ID) ?: return@launch)
                    ACTION_REFRESH -> refreshState(app)
                }
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun sendKey(context: Context, intent: Intent) {
        val endpoint = HubPrefs(context).savedEndpoint() ?: return
        val deviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: return
        val command = intent.getStringExtra(EXTRA_COMMAND) ?: return
        runCatching {
            rest.irSend(
                endpoint = endpoint,
                deviceId = deviceId,
                command = command,
                functionId = intent.getIntExtra(EXTRA_FUNCTION_ID, 0),
                activityId = intent.getStringExtra(EXTRA_ACTIVITY_ID),
            )
        }.onFailure { toast(context, "Couldn't reach your hub") }
    }

    /**
     * The hub's run call can take longer than a receiver is allowed to live, so it is fired on the
     * process scope and this receiver only waits a few seconds for the state to flip.
     */
    private suspend fun runActivity(context: Context, activityId: String) {
        val prefs = HubPrefs(context)
        val endpoint = prefs.savedEndpoint() ?: return
        prefs.widgetPendingActivityId = activityId
        WidgetRenderer.updateAll(context)
        if (activityId == "-1") RemoteNotification.cancel(context)

        val run = scope.launch {
            runCatching { rest.runActivity(endpoint, activityId) }
                .onFailure { toast(context, "Couldn't reach your hub") }
            settle(context)
        }
        repeat(8) {
            delay(1_000)
            val current = runCatching { rest.getActivityState(endpoint) }.getOrNull()
            if (current == activityId) {
                prefs.cachedCurrentActivityId = current
                prefs.widgetPendingActivityId = null
                WidgetRenderer.updateAll(context)
                return
            }
            if (!run.isActive) return
        }
    }

    private suspend fun settle(context: Context) {
        HubPrefs(context).widgetPendingActivityId = null
        refreshState(context)
    }

    private suspend fun refreshState(context: Context) {
        val prefs = HubPrefs(context)
        val endpoint = prefs.savedEndpoint() ?: return
        runCatching { rest.getActivityState(endpoint) }.onSuccess { current ->
            prefs.cachedCurrentActivityId = current
            if (current == "-1") RemoteNotification.cancel(context)
        }
        WidgetRenderer.updateAll(context)
    }

    private suspend fun toast(context: Context, text: String) = withContext(Dispatchers.Main) {
        Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val ACTION_SEND_KEY = "app.melodious.action.SEND_KEY"
        const val ACTION_RUN_ACTIVITY = "app.melodious.action.RUN_ACTIVITY"
        const val ACTION_REFRESH = "app.melodious.action.REFRESH"
        const val EXTRA_DEVICE_ID = "deviceId"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_FUNCTION_ID = "functionId"
        const val EXTRA_ACTIVITY_ID = "activityId"

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val rest = CodexHubRestClient()

        fun keyIntent(context: Context, requestCode: Int, deviceId: String, command: String, functionId: Int, activityId: String?): PendingIntent =
            broadcast(context, requestCode, Intent(context, RemoteActionReceiver::class.java).apply {
                action = ACTION_SEND_KEY
                putExtra(EXTRA_DEVICE_ID, deviceId)
                putExtra(EXTRA_COMMAND, command)
                putExtra(EXTRA_FUNCTION_ID, functionId)
                putExtra(EXTRA_ACTIVITY_ID, activityId)
            })

        fun runIntent(context: Context, activityId: String): PendingIntent =
            broadcast(context, ("run$activityId").hashCode(), Intent(context, RemoteActionReceiver::class.java).apply {
                action = ACTION_RUN_ACTIVITY
                putExtra(EXTRA_ACTIVITY_ID, activityId)
            })

        fun refreshIntent(context: Context): PendingIntent =
            broadcast(context, "refresh".hashCode(), Intent(context, RemoteActionReceiver::class.java).apply {
                action = ACTION_REFRESH
            })

        private fun broadcast(context: Context, requestCode: Int, intent: Intent): PendingIntent =
            PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }
}
