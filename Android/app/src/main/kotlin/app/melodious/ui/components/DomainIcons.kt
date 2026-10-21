package app.melodious.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SettingsInputHdmi
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.filled.Speaker
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.ui.graphics.vector.ImageVector
import app.melodious.protocol.model.HubActivity
import app.melodious.protocol.model.HubDevice

fun activityIcon(activity: HubActivity): ImageVector {
    val name = activity.name.lowercase()
    return when {
        name.contains("pc") || name.contains("computer") -> Icons.Filled.Computer
        activity.type == 1 -> Icons.Filled.Tv
        activity.type == 2 -> Icons.Filled.Movie
        activity.type == 3 -> Icons.Filled.SportsEsports
        activity.type == 4 -> Icons.Filled.MusicNote
        else -> Icons.Filled.PlayArrow
    }
}

fun deviceIcon(device: HubDevice): ImageVector {
    val type = device.type.lowercase()
    val name = "${device.name} ${device.model}".lowercase()
    return when {
        STREAMER_HINTS.any { name.contains(it) } -> Icons.Filled.Cast
        type.contains("television") || type.contains("tv") || type.contains("projector") -> Icons.Filled.Tv
        type.contains("amplifier") || type.contains("receiver") || type.contains("sound") || type.contains("speaker") -> Icons.Filled.Speaker
        type.contains("game") || type.contains("console") -> Icons.Filled.SportsEsports
        type.contains("computer") || type.contains("pc") -> Icons.Filled.Computer
        type.contains("media") || type.contains("stream") -> Icons.Filled.Cast
        type.contains("switch") -> Icons.Filled.SettingsInputHdmi
        type.contains("camera") -> Icons.Filled.Videocam
        device.isBluetoothHid -> Icons.Filled.Bluetooth
        else -> Icons.Filled.Tv
    }
}

private val STREAMER_HINTS = listOf("shield", "google tv", "chromecast", "apple tv", "roku", "fire tv", "firestick")

/** Human labels for hub role types, phrased as the job a device does. */
object RoleLabels {
    val order = listOf(
        "DisplayActivityRole",
        "VolumeActivityRole",
        "PlayMovieActivityRole",
        "PlayGameActivityRole",
        "PlayMediaActivityRole",
        "ChannelChangingActivityRole",
        "KeyboardTextEntryActivityRole",
    )

    fun label(roleType: String): String = when (roleType) {
        "DisplayActivityRole" -> "Screen"
        "VolumeActivityRole" -> "Sound / volume"
        "PlayMovieActivityRole" -> "Plays movies & shows"
        "PlayGameActivityRole" -> "Plays games"
        "PlayMediaActivityRole" -> "Plays music"
        "ChannelChangingActivityRole" -> "Changes channels"
        "KeyboardTextEntryActivityRole" -> "Keyboard / typing"
        else -> roleType.removeSuffix("ActivityRole")
    }
}
