package app.melodious.system

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.melodious.MainActivity
import app.melodious.R
import app.melodious.protocol.model.HubActivity
import app.melodious.protocol.model.ResolvedButtonAction

/**
 * Lock-screen / notification-shade remote shown while an activity runs and the app is not in
 * front: volume, mute, play, pause and turn off, one tap each, no unlock needed.
 */
object RemoteNotification {
    private const val CHANNEL_ID = "remote_controls"
    private const val NOTIFICATION_ID = 1001

    private data class Slot(val viewId: Int, val key: String)

    private val SLOTS = listOf(
        Slot(R.id.notif_vol_down, "VolumeDown"),
        Slot(R.id.notif_vol_up, "VolumeUp"),
        Slot(R.id.notif_mute, "VolumeMute"),
        Slot(R.id.notif_play, "Play"),
        Slot(R.id.notif_pause, "Pause"),
    )

    fun hasPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun canPost(context: Context): Boolean =
        HubPrefs(context).notificationRemoteEnabled && hasPermission(context) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun post(context: Context, activity: HubActivity, subtitle: String, keys: Map<String, ResolvedButtonAction>) {
        if (!canPost(context)) return
        ensureChannel(context)

        val views = RemoteViews(context.packageName, R.layout.notification_remote)
        SLOTS.forEachIndexed { index, slot ->
            val action = keys[slot.key]
            if (action == null) {
                views.setViewVisibility(slot.viewId, View.GONE)
            } else {
                views.setViewVisibility(slot.viewId, View.VISIBLE)
                views.setOnClickPendingIntent(
                    slot.viewId,
                    RemoteActionReceiver.keyIntent(
                        context, 100 + index, action.pressDeviceId, action.pressCommand, action.pressFunctionId, activity.id,
                    ),
                )
            }
        }
        views.setOnClickPendingIntent(R.id.notif_power, RemoteActionReceiver.runIntent(context, "-1"))

        val openApp = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_melodious)
            .setContentTitle(activity.name)
            .setContentText(subtitle)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(views)
            .setCustomBigContentView(views)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // A forgotten activity shouldn't leave controls in the shade forever.
            .setTimeoutAfter(6 * 60 * 60 * 1000L)
            .build()
        @Suppress("MissingPermission") // checked in canPost()
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Remote controls", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Volume and power controls while an activity is running"
                setShowBadge(false)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
        )
    }
}
