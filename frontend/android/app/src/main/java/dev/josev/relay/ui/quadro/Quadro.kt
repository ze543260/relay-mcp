package dev.josev.relay.ui.quadro

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.Tarefa
import dev.josev.relay.ui.comum.Avatar
import dev.josev.relay.ui.tema.Mono
import kotlinx.coroutines.launch

/** Quadro do app: lista agrupada por status (plano: "quadro = lista"), filtros, busca e criar tarefa. */
@Composable
fun Quadro(vm: RelayViewModel, sala: String, versao: Int, modifier: Modifier = Modifier) {
    var tarefas by remember(sala) { mutableStateOf<List<Tarefa>?>(null) }
    var busca by remember { mutableStateOf("") }
    var minhas by remember { mutableStateOf(false) }
    var prioridade by remember { mutableStateOf<String?>(null) }
    var etiqueta by remember { mutableStateOf<String?>(null) }
    var criando by remember { mutableStateOf(false) }
    val recolhidas = remember { mutableStateMapOf("feito" to true) }
    LaunchedEffect(sala, versao) { runCatching { vm.tarefas() }.onSuccess { tarefas = it }.onFailure(vm::erro) }

    val lista = tarefas
    val eu = vm.eu
    val visiveis = lista.orEmpty().filter { t ->
        (!minhas || t.responsavel == eu) && (prioridade == null || t.prioridade == prioridade) &&
            (etiqueta == null || t.etiquetas.any { it.nome.equals(etiqueta, true) }) &&
            (busca.isBlank() || "#${t.id} ${t.titulo} ${t.descricao.orEmpty()}".contains(busca.trim(), true))
    }
    val etiquetas = lista.orEmpty().flatMap { it.etiquetas }.distinctBy { it.nome.lowercase() }

    Box(modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "busca") {
                OutlinedTextField(busca, { busca = it }, Modifier.fillMaxWidth(), singleLine = true,
                    placeholder = { Text("Buscar tarefas…") }, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    shape = RoundedCornerShape(12.dp))
            }
            item(key = "filtros") {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { FilterChip(minhas, { minhas = !minhas }, label = { Text("Minhas") }) }
                    item { MenuFiltro("Prioridade", prioridade?.let(::rotuloPrioridade), PRIORIDADES) { prioridade = it } }
                    if (etiquetas.isNotEmpty()) item {
                        MenuFiltro("Etiqueta", etiqueta, etiquetas.map { it.nome to it.nome }) { etiqueta = it }
                    }
                }
            }
            if (lista == null) item { Text("carregando…", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            STATUS.forEach { (st, rotulo) ->
                val doStatus = visiveis.filter { it.status == st }
                val fechada = recolhidas[st] == true
                item(key = "cab-$st") {
                    Row(Modifier.fillMaxWidth().clickable { recolhidas[st] = !fechada }.padding(horizontal = 4.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(rotulo.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("  ${doStatus.size}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.weight(1f))
                        Icon(if (fechada) Icons.Filled.ExpandMore else Icons.Filled.ExpandLess, if (fechada) "Abrir $rotulo" else "Recolher $rotulo",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (!fechada) {
                    items(doStatus, key = { it.id }) { t -> CartaoTarefa(t) { vm.abrirTarefa(t.id) } }
                    if (doStatus.isEmpty() && lista != null) item(key = "vazia-$st") {
                        Text("Nada aqui.", Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        ExtendedFloatingActionButton(onClick = { criando = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Nova tarefa") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp))
    }
    if (criando) NovaTarefa(vm, aoFechar = { criando = false }, aoCriar = { t -> criando = false; tarefas = (tarefas.orEmpty() + t) })
}

@Composable
private fun MenuFiltro(rotulo: String, valor: String?, opcoes: List<Pair<String, String>>, aoEscolher: (String?) -> Unit) {
    var aberto by remember { mutableStateOf(false) }
    Box {
        FilterChip(valor != null, { aberto = true }, label = { Text(valor ?: rotulo) },
            trailingIcon = { Icon(Icons.Filled.ExpandMore, null, Modifier.size(18.dp)) })
        DropdownMenu(aberto, { aberto = false }) {
            DropdownMenuItem({ Text("Todas") }, { aoEscolher(null); aberto = false })
            opcoes.forEach { (v, r) -> DropdownMenuItem({ Text(r) }, { aoEscolher(v); aberto = false }) }
        }
    }
}

@Composable
private fun CartaoTarefa(t: Tarefa, aoAbrir: () -> Unit) {
    val urgente = t.prioridade == "urgente" && t.status != "feito"
    Card(onClick = aoAbrir, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        border = BorderStroke(1.dp, if (urgente) MaterialTheme.colorScheme.error.copy(alpha = 0.6f) else MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("#${t.id}", fontFamily = Mono, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                IconePrioridade(t.prioridade, Modifier.padding(start = 6.dp))
                Text(t.titulo, Modifier.weight(1f).padding(start = 8.dp), fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                t.responsavel?.let { Avatar(it, 22.dp) }
            }
            val prazo = t.prazo?.let { prazoCurto(it, t.status == "feito") }
            if (t.etiquetas.isNotEmpty() || t.checklist.total > 0 || prazo != null || t.estimativa != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    t.etiquetas.take(3).forEach { e ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            PontoEtiqueta(e.cor)
                            Text(e.nome, Modifier.padding(start = 4.dp), style = MaterialTheme.typography.labelSmall, maxLines = 1)
                        }
                    }
                    if (t.checklist.total > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CheckBox, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(" ${t.checklist.feitos}/${t.checklist.total}", style = MaterialTheme.typography.labelSmall)
                    }
                    prazo?.let { (texto, vencida) ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val cor = if (vencida) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
                            Icon(Icons.Outlined.CalendarToday, null, Modifier.size(13.dp), tint = cor)
                            Text(" ${if (vencida) "atrasada " else ""}$texto", style = MaterialTheme.typography.labelSmall, color = cor)
                        }
                    }
                    t.estimativa?.let { Text("$it pt", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NovaTarefa(vm: RelayViewModel, aoFechar: () -> Unit, aoCriar: (Tarefa) -> Unit) {
    var titulo by remember { mutableStateOf("") }
    var descricao by remember { mutableStateOf("") }
    var prioridade by remember { mutableStateOf("nenhuma") }
    var paraMim by remember { mutableStateOf(false) }
    var salvando by remember { mutableStateOf(false) }
    val escopo = rememberCoroutineScope()
    // Folha aberta inteira e com os insets do teclado: nada fica escondido atrás dele.
    ModalBottomSheet(onDismissRequest = aoFechar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        contentWindowInsets = { WindowInsets.ime.union(WindowInsets.navigationBars) }) {
        // Com o teclado aberto, a folha sobe e rola: prioridade e "Criar tarefa" nunca ficam escondidos.
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Nova tarefa", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(titulo, { if (it.length <= 200) titulo = it }, Modifier.fillMaxWidth(), label = { Text("Título") }, singleLine = true)
            OutlinedTextField(descricao, { descricao = it }, Modifier.fillMaxWidth().height(110.dp), label = { Text("Descrição (opcional, aceita Markdown)") })
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(PRIORIDADES) { (v, r) -> FilterChip(prioridade == v, { prioridade = v }, label = { Text(r) }) }
            }
            FilterChip(paraMim, { paraMim = !paraMim }, label = { Text("Fica comigo") })
            Button(enabled = titulo.isNotBlank() && !salvando, modifier = Modifier.fillMaxWidth(), onClick = {
                salvando = true
                escopo.launch {
                    runCatching {
                        vm.criarTarefa(mapOf("titulo" to titulo.trim(), "descricao" to descricao.trim().ifEmpty { null },
                            "prioridade" to prioridade, "responsavel" to (if (paraMim) vm.eu else null)))
                    }.onSuccess(aoCriar).onFailure { vm.erro(it); salvando = false }
                }
            }) { Text(if (salvando) "Criando…" else "Criar tarefa") }
        }
    }
}
