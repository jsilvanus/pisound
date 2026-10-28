package org.keskuskirkko.pisound.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val DarkBackground = Color(0xFF121417)
val DarkSurface = Color(0xFF1C1F24)
val DarkSurfaceVariant = Color(0xFF282C34)

val MicActiveGreen = Color(0xFF00C853)
val MicMutedRed = Color(0xFFD32F2F)
val MicSoloAmber = Color(0xFFFFB300)
val AccentBlue = Color(0xFF2979FF)

private val DarkColorScheme = darkColorScheme(
    primary = AccentBlue,
    secondary = MicActiveGreen,
    tertiary = MicSoloAmber,
    background = DarkBackground,
    surface = DarkSurface,
    surfaceVariant = DarkSurfaceVariant,
    error = MicMutedRed
)

@Composable
fun PiSoundTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
