package app.melodious.system

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import app.melodious.MainActivity
import app.melodious.R

/** Home-screen widget: one tap starts an activity or turns everything off. */
class ActivityWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        WidgetRenderer.updateAll(context)
    }
}

object WidgetRenderer {
    private const val MAX_ACTIVITIES = 6

    fun hasWidgets(context: Context): Boolean =
        AppWidgetManager.getInstance(context)
            .getAppWidgetIds(ComponentName(context, ActivityWidgetProvider::class.java))
            .isNotEmpty()

    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, ActivityWidgetProvider::class.java))
        if (ids.isEmpty()) return
        manager.updateAppWidget(ids, build(context))
    }

    private fun build(context: Context): RemoteViews {
        val prefs = HubPrefs(context)
        val activities = prefs.cachedActivities.take(MAX_ACTIVITIES)
        val current = prefs.cachedCurrentActivityId
        val pending = prefs.widgetPendingActivityId
        val names = activities.toMap()

        val views = RemoteViews(context.packageName, R.layout.widget_activities)
        val openApp = PendingIntent.getActivity(
            context, 1, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        views.setOnClickPendingIntent(R.id.widget_header, openApp)
        views.setOnClickPendingIntent(R.id.widget_refresh, RemoteActionReceiver.refreshIntent(context))

        views.setTextViewText(
            R.id.widget_status,
            when {
                pending == "-1" -> "Turning off…"
                pending != null -> "Starting ${names[pending] ?: "activity"}…"
                activities.isEmpty() -> "Open Melodious to connect"
                current != "-1" && names[current] != null -> "${names[current]} is on"
                else -> "Everything's off"
            },
        )

        views.removeAllViews(R.id.widget_list)
        activities.forEach { (id, name) ->
            val item = RemoteViews(context.packageName, R.layout.widget_activity_item)
            item.setTextViewText(R.id.widget_item_label, name)
            val running = id == current && pending == null
            item.setInt(
                R.id.widget_item_label, "setBackgroundResource",
                if (running) R.drawable.widget_item_running else R.drawable.widget_item,
            )
            item.setTextColor(R.id.widget_item_label, if (running) 0xFFD9E2FF.toInt() else 0xFFE7E9EE.toInt())
            item.setContentDescription(R.id.widget_item_label, if (running) "$name, running" else "Start $name")
            item.setOnClickPendingIntent(R.id.widget_item_label, RemoteActionReceiver.runIntent(context, id))
            views.addView(R.id.widget_list, item)
        }
        views.setViewVisibility(R.id.widget_off, if (activities.isEmpty()) View.GONE else View.VISIBLE)
        views.setOnClickPendingIntent(R.id.widget_off, RemoteActionReceiver.runIntent(context, "-1"))
        return views
    }
}
