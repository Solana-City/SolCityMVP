package io.solanacity.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Only the native overlays use this (loading, error). The game draws itself.
// Colours sampled from assets/branding/icon.png.
private val Navy = Color(0xFF061B3A)
private val Teal = Color(0xFF14EBC1)
private val Lime = Color(0xFFB5E738)

private val SolCityColors =
    darkColorScheme(
        primary = Teal,
        secondary = Lime,
        background = Navy,
        surface = Navy,
        onPrimary = Navy,
        onBackground = Color.White,
        onSurface = Color.White,
    )

@Composable
fun SolCityTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SolCityColors, content = content)
}
