package app.melodious.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Extra colors the Material scheme has no slot for. */
object MelodiousColors {
    val Canvas = Color(0xFF0E1014)
    val NavBar = Color(0xFF15181D)
    val Card = Color(0xFF171A20)
    val Key = Color(0xFF1F232B)
    val KeyRaised = Color(0xFF2A2F39)
    val DPadRing = Color(0xFF1A1E25)
    val Divider = Color(0xFF22262E)
    val Live = Color(0xFF6FD3A8)
    val Warning = Color(0xFFF2C48D)
    val PowerContainer = Color(0xFF3A1F1F)
    val OnPowerContainer = Color(0xFFFFB4AB)
    val RunningCard = Color(0xFF1D2840)
    val KeyRed = Color(0xFFF06A6A)
    val KeyGreen = Color(0xFF5FD08B)
    val KeyYellow = Color(0xFFF2D25C)
    val KeyBlue = Color(0xFF6AA2F5)
}

private val MelodiousDarkScheme = darkColorScheme(
    primary = Color(0xFF9DB8FF),
    onPrimary = Color(0xFF0B1A3A),
    primaryContainer = Color(0xFF2B3A5E),
    onPrimaryContainer = Color(0xFFD9E2FF),
    secondary = Color(0xFFBEC6DC),
    onSecondary = Color(0xFF283141),
    secondaryContainer = Color(0xFF2B3A5E),
    onSecondaryContainer = Color(0xFFD9E2FF),
    tertiary = Color(0xFF8FE0BC),
    onTertiary = Color(0xFF003828),
    background = MelodiousColors.Canvas,
    onBackground = Color(0xFFE7E9EE),
    surface = MelodiousColors.Canvas,
    onSurface = Color(0xFFE7E9EE),
    surfaceVariant = MelodiousColors.Key,
    onSurfaceVariant = Color(0xFFA3AAB7),
    surfaceContainerLowest = Color(0xFF0A0B0E),
    surfaceContainerLow = MelodiousColors.NavBar,
    surfaceContainer = MelodiousColors.Card,
    surfaceContainerHigh = Color(0xFF1A1D23),
    surfaceContainerHighest = Color(0xFF262A33),
    outline = Color(0xFF4A505C),
    outlineVariant = Color(0xFF343A46),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = MelodiousColors.PowerContainer,
    onErrorContainer = MelodiousColors.OnPowerContainer,
    inverseSurface = Color(0xFFE2E2E9),
    inverseOnSurface = Color(0xFF2F3036),
    inversePrimary = Color(0xFF3F5A9A),
    scrim = Color(0xFF000000),
)

private val MelodiousShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun MelodiousTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MelodiousDarkScheme,
        shapes = MelodiousShapes,
        content = content,
    )
}
