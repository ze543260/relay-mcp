package dev.josev.relay.ui.quadro

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.Tarefa
import dev.josev.relay.ui.comum.Markdown
import dev.josev.relay.ui.tema.Mono
import kotlinx.coroutines.launch

private val CAMPOS_HIST = mapOf("criada" to "criou a tarefa", "titulo" to "mudou o título", "descricao" to "editou a descrição",
    "status" to "mudou o status", "responsavel" to "mudou o responsável", "prioridade" to "mudou a prioridade",
    "estimativa" to "mudou a estimativa", "prazo" to "mudou o prazo", "etiquetas" to "mudou as etiquetas", "checklist" to "mexeu no checklist")

/** Tarefa em tela cheia: campos (status por menu), etiquetas, descrição, checklist e histórico. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TelaTarefa(vm: RelayViewModel, id: Long, versao: Int) {
    var t by remember(id) { mutableStateOf<Tarefa?>(null) }
    var editandoTitulo by remember { mutableStateOf(false) }
    val escopo = rememberCoroutineScope()
    LaunchedEffect(id, versao) { runCatching { vm.tarefa(id) }.onSuccess { t = it }.onFailure(vm::erro) }
    // Toda mudança devolve a tarefa completa: a tela atualiza com a resposta.
    fun mexer(acao: suspend () -> Tarefa) = escopo.launch { runCatching { acao() }.onSuccess { t = it }.onFailure(vm::erro) }
    fun alterar(vararg campos: Pair<String, Any?>) = mexer { vm.alterarTarefa(id, mapOf(*campos)) }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(t?.let { "#${it.id}" } ?: "Tarefa", fontFamily = Mono) },
                    navigationIcon = { IconButton(vm::fecharTarefa) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                )
            },
        ) { pad ->
            val x = t ?: run { Box(Modifier.fillMaxSize().padding(pad), Alignment.Center) { CircularProgressIndicator() }; return@Scaffold }
            Column(Modifier.fillMaxSize().padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    IconePrioridade(x.prioridade, Modifier.padding(top = 6.dp, end = 6.dp))
                    Text(x.titulo, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    IconButton({ editandoTitulo = true }) { Icon(Icons.Outlined.Edit, "Editar título") }
                }
                Text("Criada por ${x.criadaPor}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Campos(vm, x, ::alterar)
                Etiquetas(x) { nomes -> alterar("etiquetas" to nomes) }
                Descricao(x, vm.eu) { alterar("descricao" to it) }
                Checklist(x,
                    aoNovo = { texto -> mexer { vm.novoItem(id, texto) } },
                    aoMarcar = { item, feito -> mexer { vm.marcarItem(id, item, feito) } },
                    aoApagar = { item -> mexer { vm.apagarItem(id, item) } })
                Historico(x)
                Spacer(Modifier.height(24.dp))
            }
            if (editandoTitulo) {
                var novo by remember { mutableStateOf(x.titulo) }
                AlertDialog(onDismissRequest = { editandoTitulo = false }, title = { Text("Título") },
                    text = { OutlinedTextField(novo, { if (it.length <= 200) novo = it }, Modifier.fillMaxWidth()) },
                    confirmButton = { TextButton(enabled = novo.isNotBlank(), onClick = { editandoTitulo = false; if (novo.trim() != x.titulo) alterar("titulo" to novo.trim()) }) { Text("Salvar") } },
                    dismissButton = { TextButton({ editandoTitulo = false }) { Text("Cancelar") } })
            }
        }
    }
}

@Composable
private fun Rotulo(t: String) = Text(t, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun Menu(rotulo: String, valor: String, opcoes: List<Pair<Any?, String>>, modifier: Modifier = Modifier, aoEscolher: (Any?) -> Unit) {
    var aberto by remember { mutableStateOf(false) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Rotulo(rotulo)
        Box {
            OutlinedButton({ aberto = true }, Modifier.fillMaxWidth()) {
                Text(valor, Modifier.weight(1f), maxLines = 1); Icon(Icons.Filled.ExpandMore, null)
            }
            DropdownMenu(aberto, { aberto = false }) {
                opcoes.forEach { (v, r) -> DropdownMenuItem({ Text(r) }, { aberto = false; aoEscolher(v) }) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Campos(vm: RelayViewModel, t: Tarefa, alterar: (Array<out Pair<String, Any?>>) -> Unit) {
    val membros = (listOfNotNull(t.responsavel, vm.eu) + vm.estado.value.agentes.map { it.nome }).filter { it != "relay" }.distinct()
    var escolhendoPrazo by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Menu("Status", rotuloStatus(t.status), STATUS, Modifier.weight(1f)) { alterar(arrayOf("status" to it)) }
            Menu("Prioridade", rotuloPrioridade(t.prioridade), PRIORIDADES, Modifier.weight(1f)) { alterar(arrayOf("prioridade" to it)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Menu("Responsável", t.responsavel ?: "Ninguém", listOf<Pair<Any?, String>>(null to "Ninguém") + membros.map { it to it },
                Modifier.weight(1f)) { alterar(arrayOf("responsavel" to it)) }
            Menu("Estimativa", t.estimativa?.let { "$it pt" } ?: "Sem estimativa",
                listOf<Pair<Any?, String>>(null to "Sem estimativa") + ESTIMATIVAS.map { it to "$it pt" }, Modifier.weight(1f)) { alterar(arrayOf("estimativa" to it)) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Rotulo("Prazo")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton({ escolhendoPrazo = true }, Modifier.weight(1f)) {
                    Text(t.prazo?.let { prazoCurto(it, t.status == "feito").first } ?: "Sem prazo", Modifier.weight(1f))
                }
                if (t.prazo != null) IconButton({ alterar(arrayOf("prazo" to null)) }) { Icon(Icons.Filled.Close, "Tirar prazo") }
            }
        }
    }
    if (escolhendoPrazo) {
        val estado = rememberDatePickerState(initialSelectedDateMillis = t.prazo?.let {
            runCatching { java.time.LocalDate.parse(it.take(10)).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull() })
        DatePickerDialog(onDismissRequest = { escolhendoPrazo = false },
            confirmButton = {
                TextButton({
                    escolhendoPrazo = false
                    estado.selectedDateMillis?.let { ms ->
                        alterar(arrayOf("prazo" to java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString()))
                    }
                }) { Text("OK") }
            },
            dismissButton = { TextButton({ escolhendoPrazo = false }) { Text("Cancelar") } }) { DatePicker(estado) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Etiquetas(t: Tarefa, aoMudar: (List<String>) -> Unit) {
    var nova by remember { mutableStateOf("") }
    val nomes = t.etiquetas.map { it.nome }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Rotulo("Etiquetas")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            t.etiquetas.forEach { e ->
                InputChip(selected = false, onClick = { aoMudar(nomes - e.nome) }, label = { Text(e.nome) },
                    leadingIcon = { PontoEtiqueta(e.cor) }, trailingIcon = { Icon(Icons.Filled.Close, "Remover ${e.nome}", Modifier.size(16.dp)) })
            }
        }
        if (nomes.size < 10) Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(nova, { if (it.length <= 24) nova = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("Nova etiqueta…") })
            IconButton(enabled = nova.isNotBlank() && nomes.none { it.equals(nova.trim(), true) }, onClick = { aoMudar(nomes + nova.trim()); nova = "" }) {
                Icon(Icons.Filled.Add, "Adicionar etiqueta")
            }
        }
    }
}

@Composable
private fun Descricao(t: Tarefa, eu: String, aoSalvar: (String?) -> Unit) {
    var rascunho by remember(t.id) { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Rotulo("Descrição"); Spacer(Modifier.weight(1f))
            if (rascunho == null) TextButton({ rascunho = t.descricao.orEmpty() }) { Text("Editar") }
        }
        val r = rascunho
        if (r == null) {
            if (t.descricao.isNullOrBlank()) Text("Sem descrição.", color = MaterialTheme.colorScheme.onSurfaceVariant) else Markdown(t.descricao, eu)
        } else {
            OutlinedTextField(r, { rascunho = it }, Modifier.fillMaxWidth().height(180.dp), textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = Mono))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton({ rascunho = null }) { Text("Cancelar") }
                TextButton({ aoSalvar(r.trim().ifEmpty { null }); rascunho = null }) { Text("Salvar") }
            }
        }
    }
}

@Composable
private fun Checklist(t: Tarefa, aoNovo: (String) -> Unit, aoMarcar: (Long, Boolean) -> Unit, aoApagar: (Long) -> Unit) {
    var novo by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Rotulo("Checklist")
            if (t.checklist.total > 0) Text("  ${t.checklist.feitos}/${t.checklist.total}", style = MaterialTheme.typography.labelSmall)
        }
        if (t.checklist.total > 0) LinearProgressIndicator({ t.checklist.feitos.toFloat() / t.checklist.total }, Modifier.fillMaxWidth().padding(vertical = 6.dp))
        t.itens.forEach { i ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(i.feito, { aoMarcar(i.id, it) })
                Text(i.texto, Modifier.weight(1f), textDecoration = if (i.feito) TextDecoration.LineThrough else null,
                    color = if (i.feito) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                IconButton({ aoApagar(i.id) }) { Icon(Icons.Outlined.Delete, "Apagar item", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        if (t.checklist.total < 50) Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(novo, { if (it.length <= 300) novo = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("Novo item…") })
            IconButton(enabled = novo.isNotBlank(), onClick = { aoNovo(novo.trim()); novo = "" }) { Icon(Icons.Filled.Add, "Adicionar item") }
        }
    }
}

@Composable
private fun Historico(t: Tarefa) {
    var aberto by remember { mutableStateOf(false) }
    Column {
        Row(Modifier.fillMaxWidth().clickable { aberto = !aberto }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Rotulo("Histórico (${t.atividade.size})"); Spacer(Modifier.width(4.dp))
            Icon(if (aberto) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (aberto) t.atividade.forEach { a ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Row {
                    Text(a.de, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
                    Text(" ${CAMPOS_HIST[a.campo] ?: a.campo}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if ((a.antes != null || a.depois != null) && a.campo != "criada")
                    Text("${a.antes ?: "∅"} → ${a.depois ?: "∅"}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(a.quando.take(16).replace('T', ' '), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
