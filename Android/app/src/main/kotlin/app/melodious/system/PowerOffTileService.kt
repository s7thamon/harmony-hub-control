package app.melodious.system

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.melodious.protocol.model.HubEndpoint
import app.melodious.protocol.rest.CodexHubRestClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Android Quick Settings tile ("Melodious: Turn off"):
 * Lets the user swipe down the Android notification shade from any app and tap once
 * to power off the running hub activity over the LAN.
 */
class PowerOffTileService : TileService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val restClient = CodexHubRestClient()

    override fun onStartListening() {
        super.onStartListening()
        refreshTileState()
    }

    override fun onClick() {
        super.onClick()
        val endpoint = savedEndpoint() ?: return
        serviceScope.launch {
            runCatching {
                restClient.powerOff(endpoint)
            }
            refreshTileState()
        }
    }

    private fun refreshTileState() {
        val tile = qsTile ?: return
        val endpoint = savedEndpoint()
        if (endpoint == null) {
            tile.state = Tile.STATE_INACTIVE
            tile.label = "Melodious"
            tile.setSubtitleCompat("No hub set up")
            tile.updateTile()
            return
        }

        serviceScope.launch {
            val currentActId = runCatching { restClient.getActivityState(endpoint) }.getOrDefault("-1")
            val isRunning = currentActId.isNotBlank() && currentActId != "-1"
            tile.state = if (isRunning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            tile.label = if (isRunning) "Turn off" else "Melodious"
            tile.setSubtitleCompat(if (isRunning) "Activity running" else "Everything is off")
            tile.updateTile()
        }
    }

    private fun savedEndpoint(): HubEndpoint? = HubPrefs(this).savedEndpoint()

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }
}

private fun Tile.setSubtitleCompat(text: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) subtitle = text
}
