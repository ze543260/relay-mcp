package dev.josev.relay.ui.tema

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Mesma paleta do dashboard web (tokens --fundo, --painel, --acento…).
private val Claro = lightColorScheme(
    primary = Color(0xFFC96442), onPrimary = Color.White,
    primaryContainer = Color(0xFFF5E6DF), onPrimaryContainer = Color(0xFF1D1C1A),
    secondaryContainer = Color(0xFFF5E6DF), onSecondaryContainer = Color(0xFF1D1C1A),
    background = Color(0xFFF6F6F4), onBackground = Color(0xFF1D1C1A),
    surface = Color(0xFFF6F6F4), onSurface = Color(0xFF1D1C1A),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFFFFFFF), surfaceContainerHigh = Color(0xFFF0EFEC),
    surfaceVariant = Color(0xFFF0EFEC), onSurfaceVariant = Color(0xFF6F6D68),
    outline = Color(0xFFD6D5D0), outlineVariant = Color(0xFFE6E5E1), error = Color(0xFFD0453A),
)

private val Escuro = darkColorScheme(
    primary = Color(0xFFD97757), onPrimary = Color.White,
    primaryContainer = Color(0xFF33241E), onPrimaryContainer = Color(0xFFECEBE6),
    secondaryContainer = Color(0xFF33241E), onSecondaryContainer = Color(0xFFECEBE6),
    background = Color(0xFF141413), onBackground = Color(0xFFECEBE6),
    surface = Color(0xFF141413), onSurface = Color(0xFFECEBE6),
    surfaceContainerLowest = Color(0xFF101010), surfaceContainerLow = Color(0xFF1C1C1A),
    surfaceContainer = Color(0xFF1C1C1A), surfaceContainerHigh = Color(0xFF232320),
    surfaceVariant = Color(0xFF232320), onSurfaceVariant = Color(0xFF93918A),
    outline = Color(0xFF3A3935), outlineVariant = Color(0xFF2C2B28), error = Color(0xFFE5675D),
)

@Immutable
data class CoresExtras(val ok: Color, val bolha: Color, val codigo: Color)

val LocalExtras = staticCompositionLocalOf { CoresExtras(Color(0xFF2F8F5B), Color.White, Color(0xFFF6F6F4)) }

private val Tipografia = Typography(
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 20.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelSmall = TextStyle(fontSize = 11.sp, letterSpacing = 0.6.sp, fontWeight = FontWeight.Medium),
)

val Mono = FontFamily.Monospace

@Composable
fun TemaRelay(escuro: Boolean = isSystemInDarkTheme(), conteudo: @Composable () -> Unit) {
    val extras = if (escuro) CoresExtras(Color(0xFF4FBF82), Color(0xFF232320), Color(0xFF141413))
    else CoresExtras(Color(0xFF2F8F5B), Color.White, Color(0xFFF6F6F4))
    androidx.compose.runtime.CompositionLocalProvider(LocalExtras provides extras) {
        MaterialTheme(colorScheme = if (escuro) Escuro else Claro, typography = Tipografia, content = conteudo)
    }
}
