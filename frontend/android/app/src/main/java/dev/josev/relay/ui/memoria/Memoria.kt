package dev.josev.relay.ui.memoria

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.Fato
import dev.josev.relay.ui.tema.Tokens
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun origemTexto(f: Fato) = when (f.origem.tipo) {
    "msg" -> "mensagem #${f.origem.id}"
    "ata" -> "ata da reunião #${f.origem.id}"
    "tarefa" -> "tarefa #${f.origem.id}"
    else -> "${f.origem.tipo} ${f.origem.id}"
}

/** Aba Memória: fatos da equipe agrupados por assunto; candidatos (de atas) no topo pra um humano decidir. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun Memoria(vm: RelayViewModel, sala: String, admin: Boolean, modifier: Modifier, aoAbrirMensagem: (Long) -> Unit) {
    var q by rememberSaveable(sala) { mutableStateOf("") }
    var fatos by remember(sala) { mutableStateOf<List<Fato>?>(null) }
    var candidatos by remember(sala) { mutableStateOf<List<Fato>>(emptyList()) }
    var carregando by remember { mutableStateOf(false) }
    var versao by remember { mutableIntStateOf(0) }
    val escopo = rememberCoroutineScope()
    val cores = MaterialTheme.colorScheme

    LaunchedEffect(sala, q, versao) {
        if (q.isNotBlank()) delay(250)
        carregando = true
        runCatching { vm.fatos(q.trim()) }.onSuccess { fatos = it }.onFailure(vm::erro)
        runCatching { vm.candidatos() }.onSuccess { candidatos = it }
        carregando = false
    }

    Column(modifier.fillMaxSize()) {
        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(16.dp, 8.dp), singleLine = true,
            placeholder = { Text("Buscar na memória de #$sala") }, leadingIcon = { Icon(Icons.Outlined.Search, null) },
            trailingIcon = { if (q.isNotEmpty()) IconButton({ q = "" }) { Icon(Icons.Filled.Close, "Limpar") } },
            shape = RoundedCornerShape(24.dp))
        if (carregando && fatos == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        PullToRefreshBox(carregando && fatos != null, { versao++ }, Modifier.fillMaxSize()) {
            val grupos = fatos.orEmpty().groupBy { it.sujeito }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                if (candidatos.isNotEmpty()) {
                    item(key = "cand") {
                        Column(Modifier.padding(16.dp, 8.dp).fillMaxWidth()
                            .border(1.dp, cores.primary.copy(alpha = 0.5f), RoundedCornerShape(Tokens.Raio.xl))
                            .background(cores.primaryContainer.copy(alpha = 0.4f), RoundedCornerShape(Tokens.Raio.xl)).padding(12.dp)) {
                            Text("${candidatos.size} ${if (candidatos.size == 1) "candidato" else "candidatos"} pra confirmar",
                                fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
                            Text(if (admin) "Só um humano com token próprio confirma." else "Vieram de atas: confirme o que vale pra equipe.",
                                style = MaterialTheme.typography.bodyMedium, color = cores.onSurfaceVariant)
                            candidatos.forEach { f ->
                                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = cores.outlineVariant)
                                LinhaFato(f, comSujeito = true)
                                if (!admin) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                                    OutlinedButton({ escopo.launch { runCatching { vm.decidirFato(f.id, true) }.onFailure(vm::erro); versao++ } }) { Text("Confirmar") }
                                    TextButton({ escopo.launch { runCatching { vm.decidirFato(f.id, false) }.onFailure(vm::erro); versao++ } }) { Text("Rejeitar") }
                                }
                            }
                        }
                    }
                }
                if (fatos?.isEmpty() == true) item(key = "vazio") {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(if (q.isBlank()) "A memória de #$sala está vazia" else "Nada encontrado", style = MaterialTheme.typography.titleMedium)
                        Text(if (q.isBlank()) "Fatos aparecem quando alguém registra uma decisão (ou uma ata é confirmada)." else "Tente outra palavra.",
                            color = cores.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                    }
                }
                grupos.forEach { (sujeito, lista) ->
                    item(key = "s-$sujeito") {
                        Text(sujeito, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(16.dp, 16.dp, 16.dp, 4.dp).semantics { heading() })
                    }
                    items(lista, key = { it.id }) { f ->
                        Box(Modifier.fillMaxWidth().animateItem()
                            .then(if (f.origem.tipo == "msg") Modifier.clickable(onClickLabel = "Abrir a mensagem de origem") {
                                f.origem.id.toLongOrNull()?.let(aoAbrirMensagem)
                            } else Modifier)
                            .padding(16.dp, 8.dp)) { LinhaFato(f) }
                    }
                }
            }
        }
    }
}

@Composable
private fun LinhaFato(f: Fato, comSujeito: Boolean = false) {
    val cores = MaterialTheme.colorScheme
    Column {
        Text(buildAnnotatedString {
            if (comSujeito) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(f.sujeito); append(" ") }
            withStyle(SpanStyle(color = cores.onSurfaceVariant)) { append(f.predicado) }
            append(" "); append(f.objeto)
        })
        Text("${origemTexto(f)} · ${f.autor}${f.confirmadoPor?.let { " · confirmado por $it" } ?: ""}",
            style = MaterialTheme.typography.labelSmall, color = cores.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
    }
}
