package dev.josev.relay.ui.conversa

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.josev.relay.dados.Mensagem
import dev.josev.relay.dados.Pendente
import dev.josev.relay.ui.comum.Avatar
import dev.josev.relay.ui.comum.Markdown
import dev.josev.relay.ui.comum.resumo
import dev.josev.relay.ui.tema.LocalExtras
import dev.josev.relay.ui.tema.Tokens
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Mesmo formato da bolha do web (tokens raio.bolha-canto / raio.bolha).
private val FormaBolha = RoundedCornerShape(Tokens.Raio.bolhaCanto, Tokens.Raio.bolha, Tokens.Raio.bolha, Tokens.Raio.bolha)

private val fmtHora = SimpleDateFormat("HH:mm", Locale("pt", "BR"))
private val fmtDia = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR"))

private fun hora(segundos: Double): String {
    val d = Date((segundos * 1000).toLong())
    val hoje = SimpleDateFormat("yyyyMMdd", Locale.ROOT).let { it.format(d) == it.format(Date()) }
    return (if (hoje) fmtHora else fmtDia).format(d)
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Bolha(
    m: Mensagem,
    minha: Boolean,
    eu: String,
    citada: Mensagem?,
    modifier: Modifier = Modifier,
    pendente: Pendente? = null,
    aoSegurar: () -> Unit = {},
    aoTentar: () -> Unit = {},
    aoDescartar: () -> Unit = {},
) {
    val cores = MaterialTheme.colorScheme
    val extras = LocalExtras.current
    val haptico = LocalHapticFeedback.current
    val mencionaMe = !minha && Regex("@${Regex.escape(eu)}\\b", RegexOption.IGNORE_CASE).containsMatchIn(m.texto)
    val borda = when {
        pendente?.falhou == true -> cores.error.copy(alpha = 0.6f)
        mencionaMe -> cores.primary.copy(alpha = 0.6f)
        minha -> cores.primary.copy(alpha = 0.35f)
        else -> cores.outlineVariant
    }
    Row(modifier.fillMaxWidth().semantics(mergeDescendants = false) { contentDescription = "${m.de}: ${resumo(m.texto, 200)}" }) {
        Avatar(m.de, 30.dp)
        Column(Modifier.padding(start = 10.dp).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(m.de, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                m.para?.let { Text("→ $it", color = cores.primary, style = MaterialTheme.typography.bodyMedium) }
                Text(hora(m.criado), color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                when {
                    pendente?.falhou == true -> Text("não enviada", color = cores.error, style = MaterialTheme.typography.bodyMedium)
                    pendente != null -> Text("enviando…", color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Box(
                Modifier.padding(top = 4.dp).widthIn(max = 640.dp)
                    .alpha(if (pendente != null && !pendente.falhou) 0.6f else 1f)
                    .background(if (mencionaMe) cores.primary.copy(alpha = 0.08f) else extras.bolha, FormaBolha)
                    .border(1.dp, borda, FormaBolha)
                    .combinedClickable(onClick = {}, onLongClick = {
                        if (pendente == null) { haptico.performHapticFeedback(HapticFeedbackType.LongPress); aoSegurar() }
                    }, onLongClickLabel = "Ações da mensagem")
                    .padding(horizontal = 12.dp, vertical = 9.dp)
            ) {
                Column {
                    if (citada != null || m.replyTo != null) {
                        Row(Modifier.padding(bottom = 6.dp).height(IntrinsicSize.Min)) {
                            Box(Modifier.width(2.dp).fillMaxHeight().background(cores.primary.copy(alpha = 0.5f)))
                            Text(
                                if (citada != null) "${citada.de}  ${resumo(citada.texto)}" else "mensagem anterior (não carregada)",
                                style = MaterialTheme.typography.bodyMedium, color = cores.onSurfaceVariant,
                                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                    Markdown(m.texto, eu)
                }
            }
            if (pendente?.falhou == true) Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(aoTentar, Modifier.height(32.dp)) { Text("Tentar de novo") }
                TextButton(aoDescartar, Modifier.height(32.dp)) { Text("Descartar") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AcoesMensagem(m: Mensagem, podeApagar: Boolean, aoFechar: () -> Unit, aoResponder: () -> Unit, aoApagar: () -> Unit) {
    val area = LocalClipboard.current
    val escopo = androidx.compose.runtime.rememberCoroutineScope()
    var confirmar by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = aoFechar) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 8.dp)) {
            Text(resumo(m.texto, 160), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val cor = ListItemDefaults.colors(containerColor = Color.Transparent)
            ListItem({ Text("Responder") }, Modifier.combinedClickableSimples { aoResponder(); aoFechar() },
                leadingContent = { Icon(Icons.AutoMirrored.Filled.Reply, null) }, colors = cor)
            ListItem({ Text("Copiar texto") }, Modifier.combinedClickableSimples {
                escopo.launch { area.setClipEntry(ClipEntry(android.content.ClipData.newPlainText("mensagem", m.texto))) }
                aoFechar()
            }, leadingContent = { Icon(Icons.Outlined.ContentCopy, null) }, colors = cor)
            if (podeApagar) ListItem({ Text("Apagar", color = MaterialTheme.colorScheme.error) }, Modifier.combinedClickableSimples { confirmar = true },
                leadingContent = { Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error) }, colors = cor)
        }
    }
    if (confirmar) AlertDialog(
        onDismissRequest = { confirmar = false },
        title = { Text("Apagar mensagem?") },
        text = { Text("Ela some para todo mundo na sala. Não dá para desfazer.") },
        confirmButton = { TextButton({ aoApagar(); confirmar = false; aoFechar() }) { Text("Apagar", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton({ confirmar = false }) { Text("Cancelar") } },
    )
}

private fun Modifier.combinedClickableSimples(aoClicar: () -> Unit) = this.clickable(onClick = aoClicar)

@Composable
fun Composer(sala: String, nome: String, respondendo: Mensagem?, aoCancelarResposta: () -> Unit, aoEnviar: (String) -> Unit) {
    var texto by remember(sala) { mutableStateOf("") }
    val cores = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(cores.background).navigationBarsPadding()) {
        HorizontalDivider(color = cores.outlineVariant)
        if (respondendo != null) Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.Reply, null, tint = cores.primary, modifier = Modifier.size(16.dp))
            Text("Respondendo a ${respondendo.de} · ${resumo(respondendo.texto, 80)}", style = MaterialTheme.typography.bodyMedium,
                color = cores.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
            IconButton(aoCancelarResposta) { Icon(Icons.Filled.Close, "Cancelar resposta") }
        }
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            TextField(
                texto, { texto = it }, modifier = Modifier.weight(1f).heightIn(min = 48.dp, max = 180.dp),
                placeholder = { Text("Mandar como $nome em #$sala…", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                shape = RoundedCornerShape(24.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = cores.surfaceContainerHigh, unfocusedContainerColor = cores.surfaceContainerHigh,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                ),
            )
            Spacer(Modifier.width(8.dp))
            FilledIconButton(
                onClick = { if (texto.isNotBlank()) { aoEnviar(texto); texto = "" } },
                enabled = texto.isNotBlank(), modifier = Modifier.size(48.dp), shape = CircleShape,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = cores.primary),
            ) { Icon(Icons.AutoMirrored.Filled.Send, "Enviar") }
        }
    }
}
