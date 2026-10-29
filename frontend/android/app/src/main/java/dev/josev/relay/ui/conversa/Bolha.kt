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
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
private val FormaBolhaMinha = RoundedCornerShape(Tokens.Raio.bolha, Tokens.Raio.bolhaCanto, Tokens.Raio.bolha, Tokens.Raio.bolha)

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
    vistoPor: List<String> = emptyList(),
    vistaPorTodos: Boolean? = null,
    apelido: String? = null,
    aoAbrirPerfil: () -> Unit = {},
) {
    val cores = MaterialTheme.colorScheme
    val extras = LocalExtras.current
    val haptico = LocalHapticFeedback.current
    // Eventos do próprio relay (tarefas, reuniões): linha compacta, não bolha.
    if (m.de == "relay") {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 640.dp).border(1.dp, cores.outlineVariant, RoundedCornerShape(Tokens.Raio.md))
                    .background(cores.surfaceContainerHigh.copy(alpha = 0.5f), RoundedCornerShape(Tokens.Raio.md)).padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides cores.onSurfaceVariant) {
                    Markdown(m.texto, eu)
                }
                Text(hora(m.criado), style = MaterialTheme.typography.labelSmall, color = cores.onSurfaceVariant, modifier = Modifier.align(Alignment.End))
            }
        }
        return
    }
    val mencionaMe = !minha && Regex("@${Regex.escape(eu)}\\b", RegexOption.IGNORE_CASE).containsMatchIn(m.texto)
    val borda = when {
        pendente?.falhou == true -> cores.error.copy(alpha = 0.6f)
        mencionaMe -> cores.primary.copy(alpha = 0.6f)
        minha -> cores.primary.copy(alpha = 0.35f)
        else -> cores.outlineVariant
    }
    Row(modifier.fillMaxWidth().semantics(mergeDescendants = false) { contentDescription = "${m.de}: ${resumo(m.texto, 200)}" }) {
        val forma = if (minha) FormaBolhaMinha else FormaBolha
        if (!minha) Avatar(m.de, 30.dp, Modifier.clickable(onClickLabel = "Abrir perfil", onClick = aoAbrirPerfil))
        Column(Modifier.padding(start = if (minha) 40.dp else 10.dp, end = if (minha) 10.dp else 0.dp).weight(1f),
            horizontalAlignment = if (minha) Alignment.End else Alignment.Start) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(apelido ?: m.de, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.clickable(onClickLabel = "Abrir perfil", onClick = aoAbrirPerfil))
                if (apelido != null) Text(m.de, style = MaterialTheme.typography.labelSmall, color = cores.onSurfaceVariant, fontFamily = dev.josev.relay.ui.tema.Mono)
                m.para?.let { Text("→ $it", color = cores.primary, style = MaterialTheme.typography.bodyMedium) }
                Text(hora(m.criado), color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                if (m.editado != null) Text("(editada)", color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
                when {
                    pendente?.falhou == true -> Text("não enviada", color = cores.error, style = MaterialTheme.typography.bodyMedium)
                    pendente != null -> Text("enviando…", color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    vistaPorTodos == true -> Icon(Icons.Filled.DoneAll, "Vista por todos", Modifier.size(15.dp), tint = cores.primary)
                    vistaPorTodos == false -> Icon(Icons.Filled.Done, "Entregue", Modifier.size(15.dp), tint = cores.onSurfaceVariant)
                }
            }
            if (m.texto.isNotBlank() || citada != null || m.replyTo != null) {
            Box(
                Modifier.padding(top = 4.dp).widthIn(max = 640.dp)
                    .alpha(if (pendente != null && !pendente.falhou) 0.6f else 1f)
                    .background(if (mencionaMe) cores.primary.copy(alpha = 0.08f) else extras.bolha, forma)
                    .border(1.dp, borda, forma)
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
            }
            if (m.anexos.isNotEmpty()) ListaAnexos(m.anexos)
            if (vistoPor.isNotEmpty()) Row(
                Modifier.fillMaxWidth().padding(top = 4.dp).semantics { contentDescription = "Visto por ${vistoPor.joinToString(", ")}" },
                horizontalArrangement = Arrangement.End,
            ) {
                vistoPor.take(6).forEach { n -> Avatar(n, 16.dp, Modifier.padding(start = 2.dp)) }
            }
            if (pendente?.falhou == true) Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(aoTentar, Modifier.height(32.dp)) { Text("Tentar de novo") }
                TextButton(aoDescartar, Modifier.height(32.dp)) { Text("Descartar") }
            }
        }
        if (minha) Avatar(m.de, 30.dp, Modifier.clickable(onClickLabel = "Abrir perfil", onClick = aoAbrirPerfil))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AcoesMensagem(m: Mensagem, podeApagar: Boolean, aoFechar: () -> Unit, aoResponder: () -> Unit, aoApagar: () -> Unit,
                  aoEditar: ((String) -> Unit)? = null) {
    val area = LocalClipboard.current
    val escopo = androidx.compose.runtime.rememberCoroutineScope()
    var confirmar by remember { mutableStateOf(false) }
    var editando by remember { mutableStateOf<String?>(null) }
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
            if (aoEditar != null) ListItem({ Text("Editar") }, Modifier.combinedClickableSimples { editando = m.texto },
                leadingContent = { Icon(Icons.Outlined.Edit, null) }, colors = cor)
            if (podeApagar) ListItem({ Text("Apagar", color = MaterialTheme.colorScheme.error) }, Modifier.combinedClickableSimples { confirmar = true },
                leadingContent = { Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error) }, colors = cor)
        }
    }
    editando?.let { texto ->
        AlertDialog(
            onDismissRequest = { editando = null },
            title = { Text("Editar mensagem") },
            text = { androidx.compose.material3.OutlinedTextField(texto, { editando = it }, Modifier.fillMaxWidth(), minLines = 2, maxLines = 8) },
            confirmButton = {
                TextButton(enabled = texto.isNotBlank(), onClick = {
                    if (texto.trim() != m.texto.trim()) aoEditar?.invoke(texto.trim())
                    editando = null; aoFechar()
                }) { Text("Salvar") }
            },
            dismissButton = { TextButton({ editando = null }) { Text("Cancelar") } },
        )
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

private val MENCAO = Regex("(^|[\\s(])@([\\w.-]{0,32})$")

@Composable
fun Composer(
    sala: String, nome: String, respondendo: Mensagem?, candidatos: List<Pair<String, Boolean>>,
    aoCancelarResposta: () -> Unit, aoEnviar: (String) -> Unit,
    anexando: List<dev.josev.relay.Anexando> = emptyList(), aoAnexar: (List<android.net.Uri>) -> Unit = {}, aoRemoverAnexo: (String) -> Unit = {},
    aoDigitar: (Boolean) -> Unit = {},
) {
    val seletor = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetMultipleContents()) { if (it.isNotEmpty()) aoAnexar(it) }
    val subindo = anexando.any { it.anexo == null && it.erro == null }
    val prontos = anexando.count { it.anexo != null }
    var campo by remember(sala) { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue("")) }
    val cores = MaterialTheme.colorScheme
    // `@parcial` logo antes do cursor abre a lista de quem pode ser mencionado.
    val antes = campo.text.take(campo.selection.start)
    val m = MENCAO.find(antes)
    val termo = m?.groupValues?.get(2)?.lowercase()
    val sugestoes = if (termo == null) emptyList() else candidatos
        .filter { (n, _) -> n != nome && n != "relay" && n.lowercase().contains(termo) }
        .sortedWith(compareByDescending<Pair<String, Boolean>> { it.first.lowercase().startsWith(termo) }.thenByDescending { it.second }.thenBy { it.first })
        .take(6)

    fun escolher(n: String) {
        val inicio = campo.selection.start - (termo?.length ?: 0) - 1
        val novo = campo.text.substring(0, inicio) + "@$n " + campo.text.substring(campo.selection.start)
        val pos = inicio + n.length + 2
        campo = androidx.compose.ui.text.input.TextFieldValue(novo, androidx.compose.ui.text.TextRange(pos))
    }

    Column(Modifier.fillMaxWidth().background(cores.background).navigationBarsPadding()) {
        if (sugestoes.isNotEmpty()) {
            androidx.compose.material3.Surface(
                Modifier.padding(horizontal = 12.dp).padding(bottom = 6.dp).widthIn(max = 320.dp),
                shape = RoundedCornerShape(Tokens.Raio.xl), tonalElevation = 3.dp, shadowElevation = 6.dp,
                border = androidx.compose.foundation.BorderStroke(1.dp, cores.outlineVariant),
            ) {
                Column(Modifier.padding(4.dp)) {
                    Text("MENCIONAR", style = MaterialTheme.typography.labelSmall, color = cores.onSurfaceVariant, modifier = Modifier.padding(8.dp, 4.dp))
                    sugestoes.forEach { (n, online) ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = Tokens.alvoToque).clickable { escolher(n) }.padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(n, 26.dp)
                            Text(n, modifier = Modifier.weight(1f).padding(start = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (online) Text("online", color = LocalExtras.current.ok, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = cores.outlineVariant)
        if (anexando.isNotEmpty()) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            anexando.forEach { an ->
                Row(
                    Modifier.border(1.dp, if (an.erro != null) cores.error else cores.outlineVariant, RoundedCornerShape(Tokens.Raio.xl))
                        .background(cores.surfaceContainer, RoundedCornerShape(Tokens.Raio.xl)).padding(start = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (an.anexo == null && an.erro == null) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    else Icon(if (an.ehImagem) Icons.Outlined.Image else Icons.Outlined.AttachFile, null, Modifier.size(16.dp), tint = if (an.erro != null) cores.error else cores.primary)
                    Text(an.erro ?: an.nome, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 160.dp).padding(start = 6.dp), color = if (an.erro != null) cores.error else cores.onSurface)
                    IconButton({ aoRemoverAnexo(an.chave) }, Modifier.size(36.dp)) { Icon(Icons.Filled.Close, "Remover ${an.nome}", Modifier.size(16.dp)) }
                }
            }
        }
        if (respondendo != null) Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.Reply, null, tint = cores.primary, modifier = Modifier.size(16.dp))
            Text("Respondendo a ${respondendo.de} · ${resumo(respondendo.texto, 80)}", style = MaterialTheme.typography.bodyMedium,
                color = cores.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
            IconButton(aoCancelarResposta) { Icon(Icons.Filled.Close, "Cancelar resposta") }
        }
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            IconButton({ seletor.launch("*/*") }, Modifier.size(48.dp), enabled = anexando.size < 10) {
                Icon(Icons.Outlined.AttachFile, "Anexar foto ou arquivo", tint = cores.onSurfaceVariant)
            }
            TextField(
                campo, { campo = it; aoDigitar(it.text.isNotBlank()) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp, max = 180.dp),
                placeholder = { Text("Mandar como $nome em #$sala…", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                shape = RoundedCornerShape(24.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = cores.surfaceContainerHigh, unfocusedContainerColor = cores.surfaceContainerHigh,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                ),
            )
            Spacer(Modifier.width(8.dp))
            FilledIconButton(
                onClick = { if ((campo.text.isNotBlank() || prontos > 0) && !subindo) { aoEnviar(campo.text); campo = androidx.compose.ui.text.input.TextFieldValue("") } },
                enabled = (campo.text.isNotBlank() || prontos > 0) && !subindo, modifier = Modifier.size(48.dp), shape = CircleShape,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = cores.primary),
            ) { Icon(Icons.AutoMirrored.Filled.Send, "Enviar") }
        }
    }
}
