package dev.josev.relay.ui.conversa

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.ui.graphics.luminance
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.PermanentNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.josev.relay.Estado
import dev.josev.relay.RelayViewModel
import dev.josev.relay.StatusConexao
import dev.josev.relay.dados.Mensagem
import dev.josev.relay.ui.comum.Avatar
import dev.josev.relay.ui.tema.LocalExtras
import kotlinx.coroutines.launch

private sealed interface Item {
    val chave: Any
    data class Msg(val m: Mensagem) : Item { override val chave: Any = m.id }
    data class Pend(val p: dev.josev.relay.dados.Pendente) : Item { override val chave: Any = "p-${p.clientId}" }
    data object Divisor : Item { override val chave: Any = "divisor" }
}

private fun textoStatus(e: Estado) = when (e.status) {
    StatusConexao.CARREGANDO -> "carregando…"
    StatusConexao.AO_VIVO -> "ao vivo"
    StatusConexao.RECONECTANDO -> "reconectando em ${e.reconectaEm} s"
    StatusConexao.PAUSADO -> "pausado"
}

@Composable
fun TelaPrincipal(vm: RelayViewModel, estado: Estado) {
    val acoes = remember(vm) {
        object : AcoesAnexo {
            override suspend fun imagem(url: String) = vm.imagem(url)
            override fun baixar(anexo: dev.josev.relay.dados.Anexo) = vm.baixar(anexo)
        }
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalAcoesAnexo provides acoes) { TelaPrincipalConteudo(vm, estado) }
}

@Composable
private fun TelaPrincipalConteudo(vm: RelayViewModel, estado: Estado) {
    val largo = LocalConfiguration.current.screenWidthDp >= 840
    var aba by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(Aba.CONVERSA) }
    val gaveta = rememberDrawerState(DrawerValue.Closed)
    val escopo = rememberCoroutineScope()
    val conteudoGaveta = @Composable {
        Gaveta(estado, aoEscolher = { vm.abrirSala(it); escopo.launch { gaveta.close() } }, aoSair = vm::sair)
    }
    if (largo) {
        PermanentNavigationDrawer(drawerContent = { PermanentDrawerSheet(Modifier.width(300.dp)) { conteudoGaveta() } }) {
            Conversa(vm, estado, aoMenu = null, aba = aba, aoAba = { aba = it })
        }
    } else {
        ModalNavigationDrawer(drawerState = gaveta, drawerContent = { ModalDrawerSheet(Modifier.width(310.dp)) { conteudoGaveta() } }) {
            Conversa(vm, estado, aoMenu = { escopo.launch { gaveta.open() } }, aba = aba, aoAba = { aba = it })
        }
    }
}

@Composable
private fun Gaveta(estado: Estado, aoEscolher: (String) -> Unit, aoSair: () -> Unit) {
    var criando by remember { mutableStateOf(false) }
    val salas = estado.salas.let { s -> if (s.any { it.sala == estado.sala }) s else listOf(dev.josev.relay.dados.Sala(estado.sala, 0)) + s }
    Column(Modifier.fillMaxHeight().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Tag, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(18.dp))
            }
            Column(Modifier.padding(start = 12.dp)) {
                Text("Relay", fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val vivo = estado.status == StatusConexao.AO_VIVO
                    Box(Modifier.size(7.dp).background(if (vivo) LocalExtras.current.ok else MaterialTheme.colorScheme.onSurfaceVariant, CircleShape))
                    Text(textoStatus(estado), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("SALAS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            IconButton({ criando = true }) { Icon(Icons.Filled.Add, "Entrar em outra sala") }
        }
        LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            items(salas, key = { it.sala }) { s ->
                val naoLida = s.sala != estado.sala && (s.ultimoId ?: 0) > (estado.vistas[s.sala] ?: 0)
                NavigationDrawerItem(
                    label = {
                        Column {
                            Text(s.sala, fontWeight = FontWeight.Medium)
                            Text(s.agentes.filter { it.isNotBlank() }.joinToString(", ").ifEmpty { "vazia" },
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    },
                    icon = { Icon(Icons.Filled.Tag, null) },
                    badge = { if (naoLida) Badge(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) { Text("${s.total}") } else Text("${s.total}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    selected = s.sala == estado.sala,
                    onClick = { aoEscolher(s.sala) },
                    colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = MaterialTheme.colorScheme.primaryContainer),
                    modifier = Modifier.padding(vertical = 2.dp),
                )
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        val nome = estado.conexao?.nome.orEmpty()
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(nome, 34.dp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(nome, fontWeight = FontWeight.Medium)
                Text(if (estado.admin) "admin" else "agente", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(aoSair) { Icon(Icons.AutoMirrored.Filled.Logout, "Sair") }
        }
    }
    if (criando) NovaSala(aoFechar = { criando = false }, aoEntrar = { criando = false; aoEscolher(it) })
}

@Composable
private fun NovaSala(aoFechar: () -> Unit, aoEntrar: (String) -> Unit) {
    var nome by remember { mutableStateOf("") }
    val valido = Regex("^[\\w.-]{1,64}$").matches(nome)
    AlertDialog(
        onDismissRequest = aoFechar,
        title = { Text("Entrar em outra sala") },
        text = {
            OutlinedTextField(nome, { nome = it.trim().lowercase().replace(' ', '-') }, singleLine = true,
                label = { Text("Nome da sala") }, prefix = { Text("#") }, isError = nome.isNotEmpty() && !valido)
        },
        confirmButton = { TextButton({ aoEntrar(nome) }, enabled = valido) { Text("Entrar") } },
        dismissButton = { TextButton(aoFechar) { Text("Cancelar") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun Conversa(vm: RelayViewModel, estado: Estado, aoMenu: (() -> Unit)?, aba: Aba, aoAba: (Aba) -> Unit) {
    val eu = estado.conexao?.nome.orEmpty()
    val lista = rememberLazyListState()
    val snack = remember { SnackbarHostState() }
    val escopo = rememberCoroutineScope()
    var acoesDe by remember { mutableStateOf<Mensagem?>(null) }

    // reverseLayout: índice 0 = mais nova, embaixo. O divisor fica antes da 1ª nova de outra pessoa.
    val itens = remember(estado.mensagens, estado.pendentes, estado.marcoLeitura) {
        val lista = mutableListOf<Item>()
        val idxNova = if (estado.marcoLeitura > 0) estado.mensagens.indexOfFirst { it.id > estado.marcoLeitura && it.de != eu } else -1
        estado.mensagens.forEachIndexed { i, m -> if (i == idxNova) lista += Item.Divisor; lista += Item.Msg(m) }
        estado.pendentes.forEach { lista += Item.Pend(it) }
        lista.asReversed()
    }
    val porId = remember(estado.mensagens) { estado.mensagens.associateBy { it.id } }
    // Avatares de "visto" na última mensagem que cada um leu; ✓✓ nas minhas que todos leram.
    val vistoEm = remember(estado.mensagens, estado.leituras) {
        val mapa = mutableMapOf<Long, MutableList<String>>()
        estado.leituras.forEach { (nome, ate) -> estado.mensagens.lastOrNull { it.id <= ate }?.let { mapa.getOrPut(it.id) { mutableListOf() } += nome } }
        mapa
    }
    fun vistaPorTodos(id: Long) = estado.leituras.isNotEmpty() && estado.leituras.values.all { it >= id }
    val noFim by remember { derivedStateOf { lista.firstVisibleItemIndex <= 1 } }
    val novasAbaixo = if (noFim) 0 else estado.mensagens.count { it.id > (estado.vistas[estado.sala] ?: 0) && it.de != eu }

    LaunchedEffect(estado.aviso) {
        estado.aviso?.let { snack.showSnackbar(it); vm.avisoMostrado() }
    }
    // Abre no divisor de não lidas; se não houver, no fim.
    LaunchedEffect(estado.sala, estado.carregando) {
        if (!estado.carregando) {
            val d = itens.indexOfFirst { it is Item.Divisor }
            lista.scrollToItem(if (d >= 0) d else 0)
        }
    }
    // Chegou mensagem e eu estava no fim: continua no fim (e conta como lida).
    LaunchedEffect(itens.size) { if (noFim) { lista.animateScrollToItem(0); vm.marcarLida() } }
    LaunchedEffect(lista) {
        snapshotFlow { lista.firstVisibleItemIndex }.collect { primeiro ->
            if (primeiro <= 1) vm.marcarLida()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("#${estado.sala}", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val online = estado.agentes.filter { it.online }.map { it.nome }
                        Text(if (online.isEmpty()) textoStatus(estado) else "${online.size} online · ${online.take(3).joinToString(", ")}",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = { if (aoMenu != null) IconButton(aoMenu) { Icon(Icons.Filled.Menu, "Abrir salas") } },
                actions = {
                    Participantes(estado, vm::abrirPerfil)
                    BotaoTema(vm)
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        snackbarHost = { SnackbarHost(snack) },
        // Teclado aberto: a barra some e o composer encosta no teclado.
        bottomBar = { if (!WindowInsets.isImeVisible) BarraInferior(aba, aoAba) },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        if (aba != Aba.CONVERSA) { EmBreve(aba, Modifier.padding(pad)); return@Scaffold }
        Column(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad).imePadding()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Box(Modifier.weight(1f)) {
                if (estado.carregando && estado.mensagens.isEmpty()) Esqueleto()
                else if (itens.isEmpty()) Vazio(estado.sala)
                else LazyColumn(
                    state = lista, reverseLayout = true, modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(itens, key = { it.chave }, contentType = { it::class }) { it ->
                        when (it) {
                            is Item.Msg -> Bolha(
                                m = it.m, minha = it.m.de == eu, eu = eu, citada = it.m.replyTo?.let(porId::get),
                                aoSegurar = { acoesDe = it.m }, modifier = Modifier.animateItem(),
                                apelido = estado.agentes.firstOrNull { a -> a.nome == it.m.de }?.apelido,
                                vistoPor = vistoEm[it.m.id].orEmpty(), vistaPorTodos = if (it.m.de == eu) vistaPorTodos(it.m.id) else null,
                                aoAbrirPerfil = { vm.abrirPerfil(it.m.de) },
                            )
                            is Item.Pend -> Bolha(
                                m = Mensagem(-1, it.p.de, texto = it.p.texto, criado = it.p.criadoMs / 1000.0, replyTo = it.p.replyTo, anexos = it.p.anexos),
                                minha = true, eu = eu, citada = it.p.replyTo?.let(porId::get),
                                pendente = it.p, aoTentar = { vm.retentar(it.p.clientId) }, aoDescartar = { vm.descartar(it.p.clientId) },
                                modifier = Modifier.animateItem(),
                            )
                            Item.Divisor -> Divisor()
                        }
                    }
                    item(key = "topo") {
                        Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
                            if (estado.temMais) OutlinedButton(onClick = vm::carregarAntigas, enabled = !estado.carregandoAntigas, shape = CircleShape) {
                                Text(if (estado.carregandoAntigas) "carregando…" else "Ver mensagens anteriores")
                            } else Text("início da conversa", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                BotaoFim(!noFim, novasAbaixo, Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)) {
                    escopo.launch { lista.animateScrollToItem(0) }
                }
            }
            val candidatos = remember(estado.agentes, estado.mensagens.size) {
                val online = estado.agentes.associate { it.nome to it.online }
                (estado.mensagens.map { it.de } + estado.agentes.map { it.nome }).distinct().map { it to (online[it] ?: false) }
            }
            Digitando(estado.digitando)
            Composer(estado.sala, eu, estado.respondendo, candidatos, aoCancelarResposta = { vm.responder(null) }, aoEnviar = vm::enviar,
                anexando = estado.anexando, aoAnexar = vm::anexar, aoRemoverAnexo = vm::removerAnexo, aoDigitar = vm::digitando)
        }
    }

    acoesDe?.let { m ->
        AcoesMensagem(m, podeApagar = estado.admin || m.de == eu, aoFechar = { acoesDe = null },
            aoResponder = { vm.responder(m) }, aoApagar = { vm.apagar(m.id) },
            aoEditar = if (m.de == eu && m.texto.isNotBlank()) { t -> vm.editar(m.id, t) } else null)
    }
}

@Composable
private fun BotaoFim(visivel: Boolean, novas: Int, modifier: Modifier, aoClicar: () -> Unit) {
    AnimatedVisibility(visivel, modifier = modifier, enter = fadeIn() + scaleIn(), exit = fadeOut() + scaleOut()) {
        ExtendedFloatingActionButton(
            onClick = aoClicar,
            icon = { Icon(Icons.Filled.KeyboardArrowDown, null) },
            text = { Text(if (novas > 0) (if (novas == 1) "1 nova" else "$novas novas") else "Ir para o fim") },
            containerColor = if (novas > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = if (novas > 0) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.height(40.dp),
        )
    }
}

@Composable
private fun Digitando(nomes: List<String>) {
    val texto = when (nomes.size) {
        0 -> ""
        1 -> "${nomes[0]} está digitando…"
        2 -> "${nomes[0]} e ${nomes[1]} estão digitando…"
        else -> "${nomes.size} pessoas estão digitando…"
    }
    androidx.compose.animation.AnimatedVisibility(texto.isNotEmpty()) {
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
    }
}

enum class Aba(val rotulo: String) { CONVERSA("Conversa"), QUADRO("Quadro"), MEMORIA("Memória"), ARTEFATOS("Artefatos") }

@Composable
private fun BarraInferior(aba: Aba, aoAba: (Aba) -> Unit) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Aba.entries.forEach { a ->
            val icone = when (a) {
                Aba.CONVERSA -> Icons.AutoMirrored.Outlined.Chat
                Aba.QUADRO -> Icons.Outlined.ViewKanban
                Aba.MEMORIA -> Icons.Outlined.Psychology
                Aba.ARTEFATOS -> Icons.Outlined.Description
            }
            NavigationBarItem(selected = aba == a, onClick = { aoAba(a) }, icon = { Icon(icone, null) }, label = { Text(a.rotulo) })
        }
    }
}

/** Botão de tema à vista: um toque alterna claro/escuro ("Sistema" fica no padrão até a primeira troca). */
@Composable
private fun BotaoTema(vm: RelayViewModel) {
    val escuro = MaterialTheme.colorScheme.background.luminance() < 0.5f
    IconButton({ vm.alternarTema(escuro) }) {
        Icon(if (escuro) Icons.Outlined.LightMode else Icons.Outlined.DarkMode, if (escuro) "Mudar para o tema claro" else "Mudar para o tema escuro")
    }
}

/** Abas que chegam nas próximas fases do plano: por enquanto apontam pro web. */
@Composable
private fun EmBreve(aba: Aba, modifier: Modifier) {
    val fase = when (aba) { Aba.QUADRO -> "na fase 2"; Aba.MEMORIA, Aba.ARTEFATOS -> "na fase 4"; else -> "" }
    Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("${aba.rotulo} chega ao app $fase", style = MaterialTheme.typography.titleMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text("Por enquanto, use a aba ${aba.rotulo} no web.", color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
private fun Participantes(estado: Estado, aoAbrir: (String) -> Unit) {
    val online = estado.agentes.filter { it.online && it.nome != "relay" }.take(4)
    Row(Modifier.padding(end = 4.dp), horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
        online.forEach { a ->
            // Anel na cor do fundo separa os avatares sobrepostos.
            Box(Modifier.size(30.dp).background(MaterialTheme.colorScheme.background, CircleShape)
                .clickable(onClickLabel = "Abrir perfil de ${a.apelido ?: a.nome}") { aoAbrir(a.nome) }, contentAlignment = Alignment.Center) {
                Avatar(a.nome, 26.dp)
            }
        }
    }
}

@Composable
private fun Divisor() {
    val cor = MaterialTheme.colorScheme.primary
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Box(Modifier.weight(1f).height(1.dp).background(cor.copy(alpha = 0.4f)))
        Text("Novas mensagens", color = cor, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp))
        Box(Modifier.weight(1f).height(1.dp).background(cor.copy(alpha = 0.4f)))
    }
}

@Composable
private fun Esqueleto() {
    val cor = MaterialTheme.colorScheme.surfaceContainerHigh
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.Bottom)) {
        listOf(0.6f, 0.85f, 0.4f).forEach { w ->
            Row {
                Box(Modifier.size(32.dp).background(cor, CircleShape))
                Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.width(96.dp).height(10.dp).background(cor, RoundedCornerShape(4.dp)))
                    Box(Modifier.fillMaxWidth(w).height(44.dp).background(cor, RoundedCornerShape(10.dp)))
                }
            }
        }
    }
}

@Composable
private fun Vazio(sala: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Nada por aqui ainda", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        Text("As mensagens aparecem em tempo real quando alguém escrever em #$sala.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
