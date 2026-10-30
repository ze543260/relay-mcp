package dev.josev.relay.ui.comum

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.josev.relay.dados.StatusPessoa
import dev.josev.relay.ui.tema.LocalExtras

val ROTULO_ESTADO = mapOf("online" to "Disponível", "ausente" to "Ausente", "ocupado" to "Não perturbe", "offline" to "Offline")
val ROTULO_MODO = mapOf("auto" to "Disponível", "ausente" to "Ausente", "ocupado" to "Não perturbe", "invisivel" to "Invisível")
private val DICA_MODO = mapOf(
    "auto" to "Fica ausente sozinho quando o app vai pro fundo",
    "ausente" to "Aparece como ausente até você mudar",
    "ocupado" to "Silencia as notificações",
    "invisivel" to "Aparece offline pros outros",
)
val ROTULO_ATIVIDADE = mapOf("trabalhando" to "trabalhando…", "pensando" to "pensando…", "em_reuniao" to "em reunião")

@Composable
private fun corEstado(estado: String): Color = when (estado) {
    "online" -> LocalExtras.current.ok
    "ausente" -> Color(0xFFD4A017)
    "ocupado" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** Ponto de status (estilo Discord/Teams). A forma muda com a cor: cheio, lua, traço ou vazado. */
@Composable
fun PontoStatus(estado: String, tamanho: Dp = 10.dp, modifier: Modifier = Modifier, comRotulo: Boolean = true) {
    val cor = corEstado(estado)
    val fundo = MaterialTheme.colorScheme.background
    Box(
        modifier.size(tamanho + 4.dp).background(fundo, CircleShape)
            .then(if (comRotulo) Modifier.semantics { contentDescription = ROTULO_ESTADO[estado] ?: estado } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(tamanho).then(if (estado == "offline") Modifier.border(2.dp, cor, CircleShape) else Modifier.background(cor, CircleShape))) {
            if (estado == "ausente") Box(Modifier.size(tamanho * 0.6f).offset((-1).dp, (-1).dp).background(fundo, CircleShape))
            if (estado == "ocupado") Box(Modifier.align(Alignment.Center).width(tamanho * 0.6f).height(2.dp).background(fundo, CircleShape))
        }
    }
}

/** Avatar com o ponto de status no canto. */
@Composable
fun AvatarComStatus(nome: String, tamanho: Dp, status: StatusPessoa?, modifier: Modifier = Modifier) {
    Box(modifier) {
        Avatar(nome, tamanho)
        if (status != null) PontoStatus(status.estado, tamanho * 0.3f, Modifier.align(Alignment.BottomEnd).offset(2.dp, 2.dp))
    }
}

private val SUGESTOES = listOf("📅" to "Em reunião", "🍽️" to "Almoçando", "🎧" to "Focado", "🤒" to "Doente", "🏖️" to "De folga")
private val DURACOES = listOf("Não limpar" to 0L, "30 min" to 1800L, "1 hora" to 3600L, "4 horas" to 14400L, "Hoje" to -1L)

/** Escolher o modo e a mensagem de status. */
@Composable
fun SeletorStatus(atual: StatusPessoa, aoFechar: () -> Unit, aoModo: (String) -> Unit, aoMensagem: (String?, String?, Long?) -> Unit) {
    var texto by remember { mutableStateOf(atual.texto.orEmpty()) }
    var emoji by remember { mutableStateOf(atual.emoji.orEmpty()) }
    var dura by remember { mutableLongStateOf(0L) }
    AlertDialog(
        onDismissRequest = aoFechar,
        title = { Text("Status") },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                listOf("auto", "ausente", "ocupado", "invisivel").forEach { m ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { aoModo(m) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        PontoStatus(if (m == "auto") "online" else if (m == "invisivel") "offline" else m, comRotulo = false)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(ROTULO_MODO[m]!!, fontWeight = FontWeight.Medium)
                            Text(DICA_MODO[m]!!, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (atual.modo == m) Icon(Icons.Filled.Check, "atual")
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Text("Mensagem de status", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(emoji, { emoji = it.take(8) }, Modifier.width(72.dp), singleLine = true, label = { Text("Emoji") })
                    OutlinedTextField(texto, { texto = it.take(80) }, Modifier.weight(1f), singleLine = true, label = { Text("Em que você está?") })
                }
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SUGESTOES.forEach { (e, t) -> SuggestionChip({ emoji = e; texto = t }, { Text("$e $t") }) }
                }
                Text("Limpar depois de", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DURACOES.forEach { (r, s) -> FilterChip(dura == s, { dura = s }, { Text(r) }) }
                }
            }
        },
        confirmButton = {
            TextButton({
                val segundos = if (dura == -1L) {
                    val c = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, 1); set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0) }
                    ((c.timeInMillis - System.currentTimeMillis()) / 1000).coerceAtLeast(60)
                } else dura
                aoMensagem(texto.trim().ifEmpty { null }, emoji.trim().ifEmpty { null }, segundos.takeIf { it > 0 })
            }) { Text("Salvar mensagem") }
        },
        dismissButton = {
            Row {
                if (atual.texto != null || atual.emoji != null) TextButton({ aoMensagem(null, null, null) }) { Text("Limpar") }
                TextButton(aoFechar) { Text("Fechar") }
            }
        },
    )
}
