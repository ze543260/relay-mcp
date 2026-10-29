package dev.josev.relay.ui.conversa

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.ErroRelay
import dev.josev.relay.dados.Mensagem
import dev.josev.relay.ui.comum.Avatar
import dev.josev.relay.ui.comum.resumo
import kotlinx.coroutines.delay
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val fmtData = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR"))

private fun semAcento(s: String) = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase()

/** Termos buscados em negrito sobre o acento-fundo (começo de palavra, sem acento, como o FTS do servidor). */
private fun marcar(texto: String, q: String, fundo: Color): AnnotatedString {
    val termos = q.split(Regex("\\s+")).map(::semAcento).filter { it.length >= 2 }
    // Caractere a caractere, pra os índices baterem com o texto original.
    val base = texto.map { semAcento(it.toString()).firstOrNull() ?: it }.joinToString("")
    val marcas = BooleanArray(texto.length)
    termos.forEach { t ->
        var i = base.indexOf(t)
        while (i >= 0) {
            if (i == 0 || !base[i - 1].isLetterOrDigit()) for (j in i until minOf(i + t.length, texto.length)) marcas[j] = true
            i = base.indexOf(t, i + 1)
        }
    }
    return buildAnnotatedString {
        append(texto)
        var i = 0
        while (i < texto.length) {
            if (!marcas[i]) { i++; continue }
            val ini = i
            while (i < texto.length && marcas[i]) i++
            addStyle(SpanStyle(fontWeight = FontWeight.SemiBold, background = fundo), ini, i)
        }
    }
}

/** Texto de mensagem sem a sintaxe do Markdown, pra lista de resultados. */
private fun textoPlano(s: String) = s.replace(Regex("```[\\s\\S]*?```"), " … ")
    .replace(Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)"), "$1").replace(Regex("[*_`#>~|]+"), "").replace(Regex("\\s+"), " ").trim()

/** Busca nas mensagens: nesta sala ou em todas. Escolher abre a sala e rola até a mensagem. */
@Composable
fun TelaBusca(vm: RelayViewModel, sala: String, aoFechar: () -> Unit, aoEscolher: (sala: String, id: Long) -> Unit) {
    var q by rememberSaveable { mutableStateOf("") }
    var todas by rememberSaveable { mutableStateOf(false) }
    var resultados by remember { mutableStateOf<List<Mensagem>?>(null) }
    var temMais by remember { mutableStateOf(false) }
    var carregando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    val foco = remember { FocusRequester() }
    val cores = MaterialTheme.colorScheme
    val termo = q.trim()

    LaunchedEffect(Unit) { foco.requestFocus() }
    LaunchedEffect(termo, todas) {
        erro = null
        if (termo.length < 2) { resultados = null; return@LaunchedEffect }
        delay(250)  // espera parar de digitar
        carregando = true
        runCatching { vm.buscar(termo, if (todas) null else sala) }
            .onSuccess { resultados = it.mensagens; temMais = it.temMais }
            .onFailure { e -> erro = if (e is ErroRelay && e.status == 404) "Este servidor ainda não tem busca." else "Não deu pra buscar agora." }
        carregando = false
    }

    Surface(Modifier.fillMaxSize(), color = cores.background) {
        Column(Modifier.statusBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(aoFechar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Fechar busca") }
                TextField(
                    q, { q = it }, Modifier.weight(1f).focusRequester(foco), singleLine = true,
                    placeholder = { Text(if (todas) "Buscar em todas as salas…" else "Buscar em #$sala…") },
                    trailingIcon = { if (q.isNotEmpty()) IconButton({ q = "" }) { Icon(Icons.Filled.Close, "Limpar") } },
                    shape = RoundedCornerShape(24.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = cores.surfaceContainerHigh, unfocusedContainerColor = cores.surfaceContainerHigh,
                        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                    ),
                )
            }
            Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!todas, { todas = false }, { Text("#$sala") })
                FilterChip(todas, { todas = true }, { Text("Todas as salas") })
            }
            if (carregando) LinearProgressIndicator(Modifier.fillMaxWidth()) else HorizontalDivider(color = cores.outlineVariant)
            val aviso = when {
                erro != null -> erro
                termo.length < 2 -> "Digite pelo menos 2 letras."
                resultados?.isEmpty() == true -> "Nenhuma mensagem encontrada."
                resultados != null -> "${resultados!!.size}${if (temMais) "+" else ""} ${if (resultados!!.size == 1) "resultado" else "resultados"}"
                else -> null
            }
            if (aviso != null) Text(aviso, color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(16.dp, 10.dp).semantics { liveRegion = LiveRegionMode.Polite })
            LazyColumn(Modifier.fillMaxSize()) {
                items(resultados.orEmpty(), key = { it.id }) { m ->
                    Row(
                        Modifier.fillMaxWidth().clickable(onClickLabel = "Ir para a mensagem") { aoEscolher(m.sala ?: sala, m.id) }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Avatar(m.de, 28.dp)
                        Column(Modifier.padding(start = 12.dp).weight(1f)) {
                            Text(
                                listOfNotNull(m.de, m.sala?.takeIf { todas }?.let { "#$it" }, fmtData.format(Date((m.criado * 1000).toLong()))).joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall, color = cores.onSurfaceVariant,
                            )
                            Text(marcar(resumo(textoPlano(m.texto), 300), termo, cores.primaryContainer), maxLines = 3, overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }
}
