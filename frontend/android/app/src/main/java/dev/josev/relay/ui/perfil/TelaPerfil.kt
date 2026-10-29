package dev.josev.relay.ui.perfil

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.Grafo
import dev.josev.relay.dados.Perfil
import dev.josev.relay.dados.Persona
import dev.josev.relay.ui.comum.Avatar
import dev.josev.relay.ui.tema.LocalExtras
import dev.josev.relay.ui.tema.Mono
import kotlinx.coroutines.launch

private val CAMPOS = listOf("equipe" to 60, "papel" to 160, "foco" to 160, "tom" to 80, "limites" to 240)
private val ROTULOS = mapOf("equipe" to "Equipe", "papel" to "Papel", "foco" to "Foco", "tom" to "Tom", "limites" to "Limites")
private val STATUS = mapOf("a_fazer" to "A fazer", "fazendo" to "Fazendo", "revisao" to "Revisão", "feito" to "Feito")

/** ISO do servidor (UTC) → "hoje às 14:05", "ontem às 09:12" ou "28/10 às 18:40", no fuso do aparelho. */
private fun quando(iso: String): String = runCatching {
    val t = java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
    val hoje = java.time.LocalDate.now()
    val hora = t.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
    when (t.toLocalDate()) {
        hoje -> "hoje às $hora"
        hoje.minusDays(1) -> "ontem às $hora"
        else -> "${t.format(java.time.format.DateTimeFormatter.ofPattern("dd/MM"))} às $hora"
    }
}.getOrDefault(iso)

private fun Persona.campo(c: String) = when (c) { "equipe" -> equipe; "papel" -> papel; "foco" -> foco; "tom" -> tom; else -> limites }

/** Perfil em tela cheia (plano do app: "perfil vira screen"): identidade, ficha, tarefas, memória e acesso. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TelaPerfil(vm: RelayViewModel, nome: String, admin: Boolean) {
    var perfil by remember(nome) { mutableStateOf<Perfil?>(null) }
    var erro by remember(nome) { mutableStateOf(false) }
    var versao by remember(nome) { mutableIntStateOf(0) }
    var editando by remember(nome) { mutableStateOf(false) }
    LaunchedEffect(nome, versao) {
        runCatching { vm.perfil(nome) }.onSuccess { perfil = it }.onFailure { erro = true }
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        val p = perfil
        if (editando && p != null) {
            EditarFicha(vm, p, aoFechar = { salvo -> editando = false; if (salvo) versao++ })
            return@Surface
        }
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Perfil") },
                    navigationIcon = { IconButton(vm::fecharPerfil) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                )
            },
        ) { pad ->
            when {
                erro -> Text("Ninguém com esse nome por aqui.", Modifier.padding(pad).padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                p == null -> Column(Modifier.fillMaxSize().padding(pad), Arrangement.Center, Alignment.CenterHorizontally) { CircularProgressIndicator() }
                else -> Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    Identidade(p)
                    Secao(Icons.Outlined.Badge, "Ficha") { Ficha(p) { editando = true } }
                    Secao(Icons.Outlined.Checklist, "Tarefas abertas (${p.tarefas.size})") {
                        if (p.tarefas.isEmpty()) Suave("Nenhuma tarefa aberta.")
                        p.tarefas.forEach { t ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("#${t.id}", fontFamily = Mono, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(t.titulo, Modifier.weight(1f).padding(horizontal = 10.dp), maxLines = 2)
                                Text(STATUS[t.status] ?: t.status, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (p.tipo == "ia") Secao(Icons.Outlined.AccountTree, "Memória (${p.fatosRegistrados} fatos registrados)") { Memoria(vm, p.nome) }
                    p.acesso?.let { a -> Secao(Icons.Outlined.Key, "Acesso") { Acesso(vm, p, a.tokenAtivo, a.criadoEm.orEmpty(), admin) { versao++ } } }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun Identidade(p: Perfil) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Avatar(p.nome, 64.dp)
        Column(Modifier.padding(start = 16.dp)) {
            Text(p.apelido ?: p.nome, style = MaterialTheme.typography.titleLarge)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (p.apelido != null) Text(p.nome, fontFamily = Mono, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (p.tipo == "ia") "IA" else "Humano", style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape).padding(horizontal = 8.dp, vertical = 2.dp))
                p.dono?.let { Text("do $it", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                androidx.compose.foundation.layout.Box(Modifier.size(8.dp).background(
                    if (p.online) LocalExtras.current.ok else MaterialTheme.colorScheme.outline, CircleShape))
                Text(if (p.online) "online agora" else if (p.vistoEm != null) "visto ${quando(p.vistoEm)}" else "ainda não apareceu",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp))
            }
        }
    }
}

@Composable
private fun Secao(icone: ImageVector, titulo: String, conteudo: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icone, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(titulo, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp))
        }
        conteudo()
    }
}

@Composable
private fun Suave(t: String) = Text(t, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun Ficha(p: Perfil, aoEditar: () -> Unit) {
    val ficha = p.persona
    val preenchidos = CAMPOS.map { it.first }.filter { !ficha?.campo(it).isNullOrBlank() }
    if (preenchidos.isEmpty()) Suave("Sem ficha ainda.")
    preenchidos.forEach { c ->
        Row(Modifier.fillMaxWidth()) {
            Text(ROTULOS.getValue(c), Modifier.width(72.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(ficha!!.campo(c)!!, Modifier.weight(1f))
        }
    }
    ficha?.editadoPor?.let { Text("editada por $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (p.podeEditar) OutlinedButton(aoEditar) { Icon(Icons.Outlined.Edit, null, Modifier.size(18.dp)); Text("Editar ficha", Modifier.padding(start = 8.dp)) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditarFicha(vm: RelayViewModel, p: Perfil, aoFechar: (Boolean) -> Unit) {
    val valores = remember { mutableStateListOf(*CAMPOS.map { (c, _) -> p.persona?.campo(c).orEmpty() }.toTypedArray()) }
    var salvando by remember { mutableStateOf(false) }
    val escopo = rememberCoroutineScope()
    androidx.activity.compose.BackHandler { aoFechar(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Ficha de ${p.apelido ?: p.nome}") },
                navigationIcon = { IconButton({ aoFechar(false) }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Cancelar") } },
                actions = {
                    TextButton(enabled = !salvando, onClick = {
                        salvando = true
                        escopo.launch {
                            runCatching {
                                vm.salvarPersona(p.nome, Persona(valores[0], valores[1], valores[2], valores[3], valores[4]))
                            }.onSuccess { aoFechar(true) }.onFailure { vm.erro(it); salvando = false }
                        }
                    }) { Text("Salvar") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CAMPOS.forEachIndexed { i, (c, max) ->
                OutlinedTextField(valores[i], { if (it.length <= max) valores[i] = it }, Modifier.fillMaxWidth(),
                    label = { Text(ROTULOS.getValue(c)) },
                    supportingText = { Text("${valores[i].length}/$max") }, minLines = if (max > 100) 2 else 1)
            }
        }
    }
}

/** Assuntos ligados à IA; tocar num assunto destrincha, com a trilha pra voltar. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Memoria(vm: RelayViewModel, nome: String) {
    val trilha = remember(nome) { mutableStateListOf<String>() }
    val rotulos = remember(nome) { mutableMapOf<String, String>() }
    var grafo by remember(nome) { mutableStateOf<Grafo?>(null) }
    var falhou by remember(nome) { mutableStateOf(false) }
    val atual = trilha.lastOrNull()
    LaunchedEffect(nome, atual) {
        grafo = null
        runCatching { vm.grafo(if (atual == null) nome else null, atual) }
            .onSuccess { g -> g.nos.forEach { rotulos[it.nome] = it.rotulo }; grafo = g }.onFailure { falhou = true }
    }
    if (falhou) { Suave("A memória em grafo ainda não está disponível neste servidor."); return }
    FlowRow(verticalArrangement = Arrangement.Center) {
        Text(nome, Modifier.clickable { trilha.clear() }.padding(4.dp), fontWeight = if (atual == null) FontWeight.SemiBold else FontWeight.Normal)
        trilha.forEachIndexed { i, s ->
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, Modifier.size(16.dp).align(Alignment.CenterVertically), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(rotulos[s] ?: s, Modifier.clickable { while (trilha.size > i + 1) trilha.removeAt(trilha.lastIndex) }.padding(4.dp),
                fontWeight = if (i == trilha.lastIndex) FontWeight.SemiBold else FontWeight.Normal)
        }
    }
    val g = grafo ?: run { CircularProgressIndicator(Modifier.size(24.dp)); return }
    if (g.arestas.isEmpty()) { Suave("Nada na memória ligado a isso ainda."); return }
    g.arestas.groupBy { it.predicado }.forEach { (pred, arestas) ->
        Text(pred, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            arestas.forEach { a ->
                fun r(n: String) = rotulos[n] ?: n
                val sai = a.de in g.centros
                val entra = a.para in g.centros
                val outro = if (sai) a.para else a.de
                val texto = if (sai) r(a.para) else if (entra) "← ${r(a.de)}" else "${r(a.de)} → ${r(a.para)}"
                if (rotulos.containsKey(outro) && (entra || !a.folha || !sai)) {
                    AssistChip(onClick = { trilha.add(outro) }, label = { Text(texto) },
                        colors = AssistChipDefaults.assistChipColors(labelColor = MaterialTheme.colorScheme.primary))
                } else SuggestionChip(onClick = {}, label = { Text(texto) }, enabled = false)
            }
        }
    }
    if (g.cortado) Text("Mostrando as 50 ligações mais recentes.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Acesso(vm: RelayViewModel, p: Perfil, ativo: Boolean, criado: String, admin: Boolean, aoMudar: () -> Unit) {
    var confirmar by remember { mutableStateOf(false) }
    val escopo = rememberCoroutineScope()
    Text(when {
        ativo -> "Token ativo desde ${criado.take(10).split('-').reversed().joinToString("/")}."
        p.acesso?.soAdmin == true -> "Sem token próprio: entra com o token de admin."
        else -> "Sem token ativo."
    })
    // Auditoria: onde esse nome entrou (app, navegador, MCP), do mais recente pro mais antigo.
    val aparelhos = p.acesso?.dispositivos.orEmpty()
    if (aparelhos.isNotEmpty()) {
        Text("Dispositivos", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp))
        aparelhos.forEach { d ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Text(d.rotulo, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
                Text(listOfNotNull(
                    "visto ${quando(d.ultimoEm)}", "desde ${quando(d.primeiroEm)}", d.ip,
                    when (d.via) { "sessao" -> "login no web"; "sessao_admin" -> "login com token de admin"; "token_admin" -> "token de admin"; else -> "token" },
                ).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if (admin && ativo) OutlinedButton({ confirmar = true }) { Text("Revogar token", color = MaterialTheme.colorScheme.error) }
    if (confirmar) AlertDialog(
        onDismissRequest = { confirmar = false },
        title = { Text("Revogar o token de ${p.apelido ?: p.nome}?") },
        text = { Text("O agente perde o acesso na hora. Para voltar, o admin gera um token novo.") },
        confirmButton = {
            Button({ confirmar = false; escopo.launch { runCatching { vm.revogar(p.nome) }.onSuccess { aoMudar() }.onFailure(vm::erro) } }) { Text("Revogar") }
        },
        dismissButton = { TextButton({ confirmar = false }) { Text("Cancelar") } },
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
