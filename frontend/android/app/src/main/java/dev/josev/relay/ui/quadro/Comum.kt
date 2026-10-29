package dev.josev.relay.ui.quadro

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.SignalCellularAlt
import androidx.compose.material.icons.outlined.SignalCellularAlt1Bar
import androidx.compose.material.icons.outlined.SignalCellularAlt2Bar
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.josev.relay.ui.tema.Tokens

val STATUS = listOf("a_fazer" to "A fazer", "fazendo" to "Fazendo", "revisao" to "Revisão", "feito" to "Feito")
val PRIORIDADES = listOf("urgente" to "Urgente", "alta" to "Alta", "media" to "Média", "baixa" to "Baixa", "nenhuma" to "Sem prioridade")
val ESTIMATIVAS = listOf(1, 2, 3, 5, 8)
fun rotuloStatus(s: String) = STATUS.firstOrNull { it.first == s }?.second ?: s
fun rotuloPrioridade(p: String) = PRIORIDADES.firstOrNull { it.first == p }?.second ?: p
fun corEtiqueta(i: Int) = Tokens.agentes[((i % 8) + 8) % 8]

/** Prazo ISO (meia-noite UTC do dia) → "05/nov"; vencida se o dia já acabou e não está feita. */
fun prazoCurto(iso: String, feita: Boolean): Pair<String, Boolean> = runCatching {
    val dia = java.time.LocalDate.parse(iso.take(10))
    val texto = dia.format(java.time.format.DateTimeFormatter.ofPattern("dd/MMM", java.util.Locale.forLanguageTag("pt-BR"))).replace(".", "")
    texto to (!feita && dia.isBefore(java.time.LocalDate.now()))
}.getOrDefault(iso to false)

@Composable
fun IconePrioridade(p: String, modifier: Modifier = Modifier) {
    val (icone, cor) = when (p) {
        "urgente" -> Icons.Outlined.ErrorOutline to MaterialTheme.colorScheme.error
        "alta" -> Icons.Outlined.SignalCellularAlt to MaterialTheme.colorScheme.onSurfaceVariant
        "media" -> Icons.Outlined.SignalCellularAlt2Bar to MaterialTheme.colorScheme.onSurfaceVariant
        "baixa" -> Icons.Outlined.SignalCellularAlt1Bar to MaterialTheme.colorScheme.onSurfaceVariant
        else -> return
    }
    Icon(icone, rotuloPrioridade(p), modifier.size(16.dp), tint = cor)
}

@Composable
fun PontoEtiqueta(cor: Int) = Box(Modifier.size(8.dp).background(corEtiqueta(cor), CircleShape))
