package app.melodious.ui.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import app.melodious.ui.components.Haptics
import app.melodious.ui.theme.MelodiousColors
import app.melodious.protocol.model.ResolvedButtonAction

enum class KeyBehavior {
    /** Fires once when the finger lifts. */
    TAP,
    /** Fires on touch-down, then repeats (or HBus-holds) while the finger stays down. */
    REPEAT,
    /** Short tap fires the press action; holding fires the activity's long-press action. */
    LONG_PRESS_ACTION,
}

/**
 * Everything a key needs to know: what is mapped, how it should behave, and where to send it.
 * One controller is built per remote surface so keys never reach into the ViewModel directly.
 */
class RemoteController(
    val keys: Map<String, ResolvedButtonAction>,
    val haptics: Haptics,
    private val press: (key: String, long: Boolean) -> Unit,
    private val holdStart: (key: String) -> Unit,
    private val holdEnd: () -> Unit,
) {
    fun isMapped(key: String) = key in keys

    fun behavior(key: String): KeyBehavior = when {
        keys[key]?.hasHold == true -> KeyBehavior.LONG_PRESS_ACTION
        key in REPEATABLE_KEYS -> KeyBehavior.REPEAT
        else -> KeyBehavior.TAP
    }

    fun fire(key: String) {
        if (!isMapped(key)) {
            haptics.reject()
            return
        }
        haptics.tap()
        press(key, false)
    }

    fun fireLong(key: String) {
        haptics.longPress()
        press(key, true)
    }

    fun startHold(key: String) {
        haptics.tick()
        holdStart(key)
    }

    fun endHold() = holdEnd()

    companion object {
        val REPEATABLE_KEYS = setOf(
            "VolumeUp", "VolumeDown", "ChannelUp", "ChannelDown",
            "DirectionUp", "DirectionDown", "DirectionLeft", "DirectionRight",
        )
        const val HOLD_DELAY_MS = 380L
        const val LONG_PRESS_MS = 500L
    }
}

/**
 * Raw pointer handling for a remote key. Mirrors a physical remote: volume and arrows respond on
 * touch-down and keep going while held; everything else commits on release.
 */
fun Modifier.remoteKey(
    controller: RemoteController,
    key: String,
    label: String,
    onPressedChange: (Boolean) -> Unit,
): Modifier {
    val mapped = controller.isMapped(key)
    val behavior = controller.behavior(key)
    return this
        .clearAndSetSemantics {
            role = Role.Button
            contentDescription = label
            if (!mapped) disabled()
            onClick(label = label) { controller.fire(key); true }
            if (behavior == KeyBehavior.LONG_PRESS_ACTION) {
                onLongClick(label = "Hold $label") { controller.fireLong(key); true }
            }
        }
        .pointerInput(controller, key) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                if (!mapped) {
                    controller.haptics.reject()
                    waitForUpOrCancellation()
                    return@awaitEachGesture
                }
                onPressedChange(true)
                var holding = false
                try {
                    when (behavior) {
                        KeyBehavior.TAP -> {
                            if (waitForUpOrCancellation() != null) controller.fire(key)
                        }
                        KeyBehavior.REPEAT -> {
                            controller.fire(key)
                            val finished = withTimeoutOrNull(RemoteController.HOLD_DELAY_MS) {
                                waitForUpOrCancellation()
                                true
                            }
                            if (finished == null) {
                                holding = true
                                controller.startHold(key)
                                waitForUpOrCancellation()
                            }
                        }
                        KeyBehavior.LONG_PRESS_ACTION -> {
                            val lifted = withTimeoutOrNull(RemoteController.LONG_PRESS_MS) {
                                waitForUpOrCancellation() != null
                            }
                            when (lifted) {
                                true -> controller.fire(key)
                                false -> Unit // finger slid off the key: treat as cancelled
                                null -> {
                                    controller.fireLong(key)
                                    waitForUpOrCancellation()
                                }
                            }
                        }
                    }
                } finally {
                    if (holding) controller.endHold()
                    onPressedChange(false)
                }
            }
        }
}

/** A single remote key: a tinted surface that brightens while pressed and dims when unmapped. */
@Composable
fun KeyButton(
    controller: RemoteController,
    key: String,
    label: String,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(20.dp),
    container: Color = MelodiousColors.Key,
    pressedContainer: Color = MelodiousColors.KeyRaised,
    content: @Composable () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val mapped = controller.isMapped(key)
    Box(
        modifier = modifier
            .alpha(if (mapped) 1f else 0.35f)
            .clip(shape)
            .background(if (pressed) pressedContainer else container)
            .remoteKey(controller, key, label) { pressed = it },
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

@Composable
fun IconKey(
    controller: RemoteController,
    key: String,
    label: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    container: Color = MelodiousColors.Key,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    shape: Shape = RoundedCornerShape(16.dp),
) {
    KeyButton(controller, key, label, modifier, shape = shape, container = container) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(26.dp))
    }
}

@Composable
fun TextKey(
    controller: RemoteController,
    key: String,
    label: String,
    modifier: Modifier = Modifier,
    fontSize: Int = 15,
    shape: Shape = RoundedCornerShape(16.dp),
) {
    KeyButton(controller, key, label, modifier, shape = shape) {
        Text(label, fontSize = fontSize.sp, fontWeight = FontWeight.Medium)
    }
}

/** Labelled key with an icon above a caption, used for Back / Menu / Exit / Mute. */
@Composable
fun CaptionKey(
    controller: RemoteController,
    key: String,
    label: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    KeyButton(controller, key, label, modifier) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
            Text(label, fontSize = 12.sp, color = Color(0xFFC3C8D2))
        }
    }
}

/** Circular D-pad that scales to the space it is given (never larger than 300dp). */
@Composable
fun DPad(controller: RemoteController, modifier: Modifier = Modifier, maxSize: Dp = 320.dp) {
    // Bottom-aligned so the pad sits next to the volume cluster, inside the thumb's natural arc.
    BoxWithConstraints(modifier, contentAlignment = Alignment.BottomCenter) {
        val size = min(min(maxWidth, maxHeight), maxSize)
        val arm = size * 0.31f
        val ok = size * 0.38f
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(MelodiousColors.DPadRing),
        ) {
            val inset = size * 0.02f
            DirectionKey(controller, "DirectionUp", "Up", Icons.Filled.KeyboardArrowUp, arm,
                Modifier.align(Alignment.TopCenter).offset(y = inset))
            DirectionKey(controller, "DirectionDown", "Down", Icons.Filled.KeyboardArrowDown, arm,
                Modifier.align(Alignment.BottomCenter).offset(y = -inset))
            DirectionKey(controller, "DirectionLeft", "Left", Icons.Filled.KeyboardArrowLeft, arm,
                Modifier.align(Alignment.CenterStart).offset(x = inset))
            DirectionKey(controller, "DirectionRight", "Right", Icons.Filled.KeyboardArrowRight, arm,
                Modifier.align(Alignment.CenterEnd).offset(x = -inset))
            KeyButton(
                controller = controller,
                key = "Select",
                label = "OK",
                shape = CircleShape,
                container = MelodiousColors.KeyRaised,
                pressedContainer = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.align(Alignment.Center).size(ok),
            ) {
                Text("OK", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun DirectionKey(
    controller: RemoteController,
    key: String,
    label: String,
    icon: ImageVector,
    size: Dp,
    modifier: Modifier,
) {
    KeyButton(
        controller = controller,
        key = key,
        label = label,
        shape = CircleShape,
        container = Color.Transparent,
        pressedContainer = MelodiousColors.KeyRaised,
        modifier = modifier.size(size),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(34.dp))
    }
}

/** Vertical +/- rocker (volume) or up/down rocker (channel). */
@Composable
fun Rocker(
    controller: RemoteController,
    upKey: String,
    downKey: String,
    caption: String,
    upLabel: String,
    downLabel: String,
    modifier: Modifier = Modifier,
    useArrows: Boolean = false,
) {
    Column(
        modifier = modifier
            .width(72.dp)
            .fillMaxHeight()
            .clip(RoundedCornerShape(36.dp))
            .background(MelodiousColors.Key),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        KeyButton(
            controller, upKey, upLabel,
            modifier = Modifier.fillMaxWidth().weight(1f),
            shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
        ) {
            Icon(if (useArrows) Icons.Filled.KeyboardArrowUp else Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(28.dp))
        }
        Text(
            caption,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        KeyButton(
            controller, downKey, downLabel,
            modifier = Modifier.fillMaxWidth().weight(1f),
            shape = RoundedCornerShape(bottomStart = 36.dp, bottomEnd = 36.dp),
        ) {
            Icon(if (useArrows) Icons.Filled.KeyboardArrowDown else Icons.Filled.Remove, contentDescription = null, modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
fun ColorKey(controller: RemoteController, key: String, color: Color, modifier: Modifier = Modifier) {
    KeyButton(controller, key, key, modifier, shape = RoundedCornerShape(14.dp), container = Color(0xFF262A33)) {
        Box(Modifier.size(width = 32.dp, height = 6.dp).clip(RoundedCornerShape(3.dp)).background(color))
    }
}
