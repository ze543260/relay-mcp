package dev.josev.relay.ui.tema

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Cores, raios e tipo vêm do Relay DS (design/tokens.json → Tokens.kt), iguais aos do web.
private val Claro = with(Tokens.Claro) {
    lightColorScheme(
        primary = acento, onPrimary = acentoTexto,
        primaryContainer = acentoFundo, onPrimaryContainer = texto,
        secondaryContainer = acentoFundo, onSecondaryContainer = texto,
        background = fundo, onBackground = texto, surface = fundo, onSurface = texto,
        surfaceContainerLowest = painel, surfaceContainerLow = painel, surfaceContainer = painel,
        surfaceContainerHigh = superficie, surfaceVariant = superficie, onSurfaceVariant = suave,
        outline = bordaCampo, outlineVariant = borda, error = erro,
    )
}

private val Escuro = with(Tokens.Escuro) {
    darkColorScheme(
        primary = acento, onPrimary = acentoTexto,
        primaryContainer = acentoFundo, onPrimaryContainer = texto,
        secondaryContainer = acentoFundo, onSecondaryContainer = texto,
        background = fundo, onBackground = texto, surface = fundo, onSurface = texto,
        surfaceContainerLowest = fundo, surfaceContainerLow = painel, surfaceContainer = painel,
        surfaceContainerHigh = superficie, surfaceVariant = superficie, onSurfaceVariant = suave,
        outline = bordaCampo, outlineVariant = borda, error = erro,
    )
}

@Immutable
data class CoresExtras(val ok: Color, val bolha: Color, val codigo: Color)

val LocalExtras = staticCompositionLocalOf { CoresExtras(Tokens.Claro.ok, Tokens.Claro.bolha, Tokens.Claro.codigo) }

private fun estilo(tamanho: androidx.compose.ui.unit.TextUnit, altura: androidx.compose.ui.unit.TextUnit, peso: Int, espacamento: Float = 0f) =
    TextStyle(fontSize = tamanho, lineHeight = altura, fontWeight = FontWeight(peso), letterSpacing = espacamento.sp)

private val Tipografia = with(Tokens.Tipo) {
    Typography(
        titleLarge = estilo(tituloGrandeTamanho, tituloGrandeAltura, tituloGrandePeso, -0.2f),
        titleMedium = estilo(tituloTamanho, tituloAltura, tituloPeso),
        bodyLarge = estilo(corpoTamanho, corpoAltura, corpoPeso),
        bodyMedium = estilo(corpoDesktopTamanho, corpoDesktopAltura, corpoDesktopPeso),
        labelSmall = estilo(legendaTamanho, legendaAltura, legendaPeso, 0.6f),
    )
}

val Mono = FontFamily.Monospace

/** Troca claro/escuro com revelação em círculo a partir de um ponto da tela (centro do botão). */
val LocalTrocaTema = staticCompositionLocalOf<(androidx.compose.ui.geometry.Offset) -> Unit> { {} }

@Composable
fun TemaRelay(escuro: Boolean = isSystemInDarkTheme(), conteudo: @Composable () -> Unit) {
    val extras = if (escuro) CoresExtras(Tokens.Escuro.ok, Tokens.Escuro.bolha, Tokens.Escuro.codigo)
    else CoresExtras(Tokens.Claro.ok, Tokens.Claro.bolha, Tokens.Claro.codigo)
    CompositionLocalProvider(LocalExtras provides extras) {
        MaterialTheme(colorScheme = if (escuro) Escuro else Claro, typography = Tipografia, content = conteudo)
    }
}
