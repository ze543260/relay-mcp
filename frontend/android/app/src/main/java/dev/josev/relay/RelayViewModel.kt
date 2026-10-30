package dev.josev.relay

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.viewModelScope
import dev.josev.relay.dados.Agente
import dev.josev.relay.dados.Conexao
import dev.josev.relay.dados.Config
import dev.josev.relay.dados.ErroRelay
import dev.josev.relay.dados.Evento
import dev.josev.relay.dados.Mensagem
import dev.josev.relay.dados.NovaMensagem
import dev.josev.relay.dados.Pendente
import dev.josev.relay.dados.RelayApi
import dev.josev.relay.dados.Sala
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.UUID

data class Anexando(val chave: String, val nome: String, val tamanho: Long, val ehImagem: Boolean, val anexo: dev.josev.relay.dados.Anexo? = null, val erro: String? = null)

/** Aviso no topo quando chega mensagem de outra sala com o app aberto (agrupa por sala). */
data class Toast(val id: Long, val sala: String, val de: String, val texto: String, val mencao: Boolean, val quantas: Int = 1)

enum class StatusConexao { CARREGANDO, AO_VIVO, RECONECTANDO, PAUSADO }

data class Estado(
    val verificando: Boolean = true,
    val conexao: Conexao? = null,
    val admin: Boolean = false,
    val salas: List<Sala> = emptyList(),
    val sala: String = "geral",
    val mensagens: List<Mensagem> = emptyList(),
    val pendentes: List<Pendente> = emptyList(),
    val temMais: Boolean = false,
    val carregando: Boolean = false,
    val carregandoAntigas: Boolean = false,
    val status: StatusConexao = StatusConexao.CARREGANDO,
    val reconectaEm: Int = 0,
    val agentes: List<Agente> = emptyList(),
    val vistas: Map<String, Long> = emptyMap(),
    /** Última mensagem vista ao abrir a sala: o divisor "Novas mensagens" nasce dela. */
    val marcoLeitura: Long = 0,
    val respondendo: Mensagem? = null,
    /** Arquivos escolhidos no composer: sobem na hora; o envio espera todos. */
    val anexando: List<Anexando> = emptyList(),
    val digitando: List<String> = emptyList(),
    /** nome -> último id lido (sem mim). */
    val leituras: Map<String, Long> = emptyMap(),
    val aviso: String? = null,
    /** Perfil aberto em tela cheia (nome técnico), ou null. */
    val perfil: String? = null,
    /** Tarefa aberta em tela cheia, ou null. */
    val tarefa: Long? = null,
    /** Sobe a cada evento "tarefa" do SSE: quadro e tela da tarefa recarregam. */
    val versaoTarefas: Int = 0,
    val toast: Toast? = null,
    /** Artefato aberto em tela cheia, ou null. */
    val artefato: Long? = null,
    /** Meu status (com `modo`); null = servidor antigo ou entrou com o token mestre. */
    val meuStatus: dev.josev.relay.dados.StatusPessoa? = null,
    /** Mensagem pra qual a conversa deve rolar e destacar (citação, busca); a tela zera ao chegar. */
    val irPara: Long? = null,
    /** Buscando páginas antigas atrás do alvo de "ir para": a tela não rola pro fim nesse meio-tempo. */
    val temIrPendente: Boolean = false,
)

class RelayViewModel(app: Application) : AndroidViewModel(app) {
    private val config = Config(app)
    private val _estado = MutableStateFlow(Estado())
    val estado: StateFlow<Estado> = _estado.asStateFlow()

    private var api: RelayApi? = null
    private var stream: Job? = null
    private var periodico: Job? = null
    /** Com o app aberto: ouve todas as salas só pra avisos e selos (o serviço cala quando a tela está à vista). */
    private var geral: Job? = null
    private var ultimoGeral = 0L
    /** Depois de abrir uma sala vinda da busca: rola até esta mensagem quando o histórico chegar. */
    private var irDepoisDeAbrir: Long? = null
    private val ultimoId get() = _estado.value.mensagens.lastOrNull()?.id ?: 0L

    // App em segundo plano: fecha o stream (bateria); de volta: reabre do último id.
    private val ciclo = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            if (api != null) { abrirStream(); abrirGeral(); ocioso(false) }
        }
        override fun onStop(owner: LifecycleOwner) {
            ocioso(true)  // app no fundo: aparece "ausente" (como no Teams)
            stream?.cancel(); geral?.cancel()
            _estado.update { it.copy(status = StatusConexao.PAUSADO) }
        }
    }

    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(ciclo)
        viewModelScope.launch {
            val c = config.conexao.first()
            if (c == null) _estado.update { it.copy(verificando = false) } else conectar(c, silencioso = true)
        }
    }

    override fun onCleared() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(ciclo)
    }

    suspend fun ultimaUrl() = config.ultimaUrl()
    suspend fun ultimoNome() = config.ultimoNome()

    /** Valida o token com /eu; token de agente traz o nome do servidor. Lança ErroRelay/IOException. */
    suspend fun entrar(url: String, nome: String, token: String) {
        val c = Conexao(url.trim().trimEnd('/'), nome.trim(), token.trim())
        val eu = RelayApi(c).eu()
        val final = c.copy(nome = eu.nome ?: c.nome)
        config.salvar(final)
        conectar(final, silencioso = false, admin = eu.admin)
    }

    private suspend fun conectar(c: Conexao, silencioso: Boolean, admin: Boolean? = null) {
        val nova = RelayApi(c)
        val isAdmin = admin ?: runCatching { nova.eu().admin }.getOrElse { e ->
            if (e is ErroRelay && e.status == 401) {
                config.sair(); _estado.update { it.copy(verificando = false, aviso = "Sessão expirada. Entre de novo.") }
                return
            }
            false
        }
        api = nova
        dev.josev.relay.notificacoes.Notificacoes.criarCanais(getApplication())
        dev.josev.relay.notificacoes.Notificacoes.agendar(getApplication())  // economia, e reserva do tempo real
        viewModelScope.launch { if (config.tempoReal.first()) dev.josev.relay.notificacoes.ServicoTempoReal.iniciar(getApplication()) }
        _estado.update {
            it.copy(verificando = false, conexao = c, admin = isAdmin, sala = config.sala(), vistas = config.vistas(), aviso = null)
        }
        abrirSala(_estado.value.sala)
        abrirGeral()
        periodico?.cancel()
        periodico = viewModelScope.launch {
            while (isActive) { atualizarListas(); delay(30_000) }
        }
        if (!silencioso) Unit
    }

    fun sair() {
        dev.josev.relay.notificacoes.Notificacoes.cancelarAgenda(getApplication())
        dev.josev.relay.notificacoes.ServicoTempoReal.parar(getApplication())
        stream?.cancel(); periodico?.cancel(); geral?.cancel(); api = null
        viewModelScope.launch { config.sair() }
        _estado.value = Estado(verificando = false)
    }

    private fun ocioso(v: Boolean) { api?.let { a -> viewModelScope.launch { runCatching { a.marcarOcioso(v) } } } }

    private fun guardarStatus(st: dev.josev.relay.dados.StatusPessoa) {
        _estado.update { it.copy(meuStatus = st) }
        // As notificações (WorkManager e serviço) leem daqui pra respeitar o "Não perturbe".
        getApplication<Application>().getSharedPreferences("relay_status", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("nao_perturbe", st.modo == "ocupado").apply()
    }

    /** modo: auto | ausente | ocupado | invisivel. Texto/emoji vazios limpam; duraS = prazo da mensagem. */
    fun definirStatus(modo: String? = null, texto: String? = null, emoji: String? = null, duraS: Long? = null, mensagem: Boolean = false) {
        val a = api ?: return
        val campos = buildMap<String, Any?> {
            if (modo != null) put("modo", modo)
            if (mensagem) { put("texto", texto); put("emoji", emoji); put("dura_s", duraS) }
        }
        viewModelScope.launch { runCatching { a.definirStatus(campos) }.onSuccess(::guardarStatus).onFailure(::tratar) }
    }

    private suspend fun atualizarListas() {
        val a = api ?: return
        runCatching { a.meuStatus() }.onSuccess(::guardarStatus)
        runCatching { a.salas() }.onSuccess { s -> _estado.update { it.copy(salas = s) } }
        runCatching { a.agentes() }.onSuccess { ag -> _estado.update { it.copy(agentes = ag) } }
    }

    /** Vindo de uma notificação: abre a sala agora ou depois de conectar. */
    fun irPara(sala: String) {
        if (api != null) abrirSala(sala) else viewModelScope.launch { config.salvarSala(sala) }
    }

    fun abrirSala(sala: String) {
        val a = api ?: return
        if (_estado.value.toast?.sala == sala) fecharToast()
        dev.josev.relay.notificacoes.Notificacoes.limpar(getApplication(), sala)
        stream?.cancel()
        viewModelScope.launch { config.salvarSala(sala) }
        _estado.update {
            it.copy(sala = sala, irPara = null, mensagens = emptyList(), pendentes = emptyList(), carregando = true, digitando = emptyList(), leituras = emptyMap(),
                status = StatusConexao.CARREGANDO, respondendo = null, marcoLeitura = it.vistas[sala] ?: 0L)
        }
        viewModelScope.launch {
            // Sem o histórico, o stream partiria do id 0 e despejaria as mensagens mais antigas: tenta até conseguir.
            var espera = 1_000L
            while (isActive) {
                try {
                    val p = a.historico(sala)
                    // Vindo da busca: o alvo sai junto com o histórico, pra tela não abrir no divisor por cima dele.
                    val alvo = irDepoisDeAbrir.also { irDepoisDeAbrir = null }
                    val carregado = alvo != null && p.mensagens.any { it.id == alvo }
                    _estado.update { it.copy(mensagens = p.mensagens, temMais = p.temMais, carregando = false, irPara = if (carregado) alvo else it.irPara) }
                    if (alvo != null && !carregado) irParaMensagem(alvo)
                    break
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    tratar(e)
                    delay(espera); espera = (espera * 2).coerceAtMost(30_000)
                }
            }
            abrirStream()
            atualizarListas()
            atualizarLeituras()
        }
    }

    private fun abrirStream() {
        val a = api ?: return
        val sala = _estado.value.sala
        stream?.cancel()
        stream = viewModelScope.launch {
            a.tempoReal(sala) { ultimoId }.collect { e ->
                when (e) {
                    Evento.Conectado -> _estado.update { it.copy(status = StatusConexao.AO_VIVO) }
                    is Evento.Nova -> anexar(e.m)
                    is Evento.Editada -> substituir(e.m)
                    is Evento.Apagada -> _estado.update { s -> s.copy(mensagens = s.mensagens.filterNot { it.id == e.id }) }
                    is Evento.Reconectando -> _estado.update { it.copy(status = StatusConexao.RECONECTANDO, reconectaEm = e.emSegundos) }
                    Evento.SemAcesso -> { sair(); _estado.update { it.copy(aviso = "Token revogado ou inválido.") } }
                    is Evento.Digitando -> _estado.update { it.copy(digitando = e.nomes.filter { n -> n != it.conexao?.nome }) }
                    Evento.Leu -> atualizarLeituras()
                    Evento.TarefaMudou -> _estado.update { it.copy(versaoTarefas = it.versaoTarefas + 1) }
                }
            }
        }
    }

    private fun abrirGeral() {
        val a = api ?: return
        if (geral?.isActive == true) return
        geral = viewModelScope.launch {
            a.tempoReal("*") { ultimoGeral }.collect { e ->
                if (e !is Evento.Nova) return@collect
                ultimoGeral = maxOf(ultimoGeral, e.m.id)
                val m = e.m
                val s = _estado.value
                val eu = s.conexao?.nome ?: return@collect
                if (m.sala == null || m.sala == s.sala || m.de == eu || m.de == "relay") return@collect
                val mencao = m.para == eu || Regex("@${Regex.escape(eu)}\\b", RegexOption.IGNORE_CASE).containsMatchIn(m.texto)
                _estado.update { st ->
                    val antes = st.toast?.takeIf { it.sala == m.sala }
                    st.copy(toast = Toast(m.id, m.sala, m.de, m.texto, mencao || antes?.mencao == true, (antes?.quantas ?: 0) + 1))
                }
                atualizarListas()  // selos da gaveta
            }
        }
    }

    fun fecharToast() = _estado.update { it.copy(toast = null) }

    /** Rola até a mensagem (carrega as anteriores se precisar). Fora do histórico da sala: avisa. */
    fun irParaMensagem(id: Long) {
        val s = _estado.value
        if (s.mensagens.any { it.id == id }) return _estado.update { it.copy(irPara = id) }
        val a = api ?: return
        _estado.update { it.copy(temIrPendente = true) }
        viewModelScope.launch {
            var paginas = 0
            while (paginas++ < 20) {
                val st = _estado.value
                val menor = st.mensagens.firstOrNull()?.id ?: break
                if (menor <= id || !st.temMais) break
                val p = runCatching { a.historico(st.sala, antes = menor, limite = 100) }.getOrNull() ?: break
                _estado.update { it.copy(mensagens = p.mensagens.filter { m -> m.id < menor } + it.mensagens, temMais = p.temMais) }
                if (p.mensagens.any { it.id == id }) break
            }
            _estado.update { it.copy(temIrPendente = false, irPara = id.takeIf { _ -> it.mensagens.any { m -> m.id == id } }, aviso = if (it.mensagens.any { m -> m.id == id }) it.aviso else "Mensagem não encontrada (talvez apagada).") }
        }
    }

    fun chegouEm() = _estado.update { it.copy(irPara = null) }

    /** Resultado de busca ou toast: abre a sala (se outra) e rola até a mensagem. */
    fun abrirMensagem(sala: String, id: Long?) {
        if (sala == _estado.value.sala) { id?.let(::irParaMensagem); return }
        irDepoisDeAbrir = id
        abrirSala(sala)
    }

    suspend fun buscar(q: String, sala: String?): dev.josev.relay.dados.PaginaHistorico = api!!.buscar(q, sala)

    suspend fun rascunho(sala: String) = config.rascunho(sala)
    fun salvarRascunho(sala: String, texto: String) = viewModelScope.launch { config.salvarRascunho(sala, texto) }

    private fun atualizarLeituras() {
        val a = api ?: return
        val s = _estado.value
        viewModelScope.launch {
            runCatching { a.leituras(s.sala) }.onSuccess { ls ->
                _estado.update { st -> st.copy(leituras = ls.filter { it.nome != st.conexao?.nome && it.nome != "relay" }.associate { it.nome to it.ultimoId }) }
            }
        }
    }

    private var ultimoDigitando = 0L
    private var avisouDigitando = false

    /** Avisa "digitando" no máximo a cada 3 s; sem texto, avisa que parou. */
    fun digitando(comTexto: Boolean) {
        val a = api ?: return
        val sala = _estado.value.sala
        val agora = System.currentTimeMillis()
        if (comTexto) {
            if (agora - ultimoDigitando < 3000) return
            ultimoDigitando = agora; avisouDigitando = true
            viewModelScope.launch { runCatching { a.digitando(sala, parou = false) } }
        } else if (avisouDigitando) {
            avisouDigitando = false; ultimoDigitando = 0
            viewModelScope.launch { runCatching { a.digitando(sala, parou = true) } }
        }
    }

    private fun anexar(m: Mensagem) = _estado.update { s ->
        if (m.id <= (s.mensagens.lastOrNull()?.id ?: 0L)) return@update s
        // A versão real substitui a otimista (por id do POST, client_id ou autor + texto).
        val pend = s.pendentes.filterNot { p ->
            p.idReal == m.id || (m.clientId != null && m.clientId == p.clientId) ||
                (!p.falhou && p.idReal == null && p.de == m.de && p.texto == m.texto)
        }
        s.copy(mensagens = s.mensagens + m, pendentes = pend)
    }

    fun carregarAntigas() {
        val a = api ?: return
        val s = _estado.value
        val menor = s.mensagens.firstOrNull()?.id ?: return
        if (!s.temMais || s.carregandoAntigas) return
        _estado.update { it.copy(carregandoAntigas = true) }
        viewModelScope.launch {
            runCatching { a.historico(s.sala, antes = menor) }
                .onSuccess { p ->
                    _estado.update { st ->
                        st.copy(mensagens = p.mensagens.filter { it.id < menor } + st.mensagens, temMais = p.temMais, carregandoAntigas = false)
                    }
                }
                .onFailure { _estado.update { it.copy(carregandoAntigas = false) } }
        }
    }

    fun marcarLida() {
        val s = _estado.value
        val id = s.mensagens.lastOrNull()?.id ?: return
        if ((s.vistas[s.sala] ?: 0L) >= id) return
        _estado.update { it.copy(vistas = it.vistas + (it.sala to id)) }
        viewModelScope.launch { config.marcarVista(s.sala, id) }
        api?.let { a -> viewModelScope.launch { runCatching { a.marcarLeitura(s.sala, id) } } }
    }

    fun responder(m: Mensagem?) = _estado.update { it.copy(respondendo = m) }

    fun enviar(texto: String) {
        val s = _estado.value
        val c = s.conexao ?: return
        if (s.anexando.any { it.anexo == null && it.erro == null }) return
        val anexos = s.anexando.mapNotNull { it.anexo }
        if (texto.isBlank() && anexos.isEmpty()) return
        val p = Pendente(UUID.randomUUID().toString(), c.nome, texto.trim(), s.respondendo?.id, System.currentTimeMillis(), anexos = anexos)
        _estado.update { it.copy(pendentes = it.pendentes + p, respondendo = null, anexando = emptyList()) }
        avisouDigitando = false; ultimoDigitando = 0
        postar(p)
    }

    /** Lê o arquivo do seletor do Android e sobe na hora (máx. 25 MB, 10 por mensagem). */
    fun anexar(uris: List<android.net.Uri>) {
        val a = api ?: return
        val cr = getApplication<Application>().contentResolver
        uris.take(10 - _estado.value.anexando.size).forEach { uri ->
            var nome = "arquivo"; var tamanho = 0L
            cr.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { nome = c.getString(it) ?: nome }
                    c.getColumnIndex(android.provider.OpenableColumns.SIZE).takeIf { it >= 0 }?.let { tamanho = c.getLong(it) }
                }
            }
            val tipo = cr.getType(uri) ?: "application/octet-stream"
            val chave = UUID.randomUUID().toString()
            _estado.update { it.copy(anexando = it.anexando + Anexando(chave, nome, tamanho, tipo.startsWith("image/"))) }
            viewModelScope.launch {
                try {
                    if (tamanho > 25L * 1024 * 1024) throw ErroRelay(413, "arquivo_grande", "Arquivo grande demais (máx. 25 MB).")
                    val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        cr.openInputStream(uri)?.use { it.readBytes() } ?: throw IOException("não consegui ler o arquivo")
                    }
                    val anexo = a.subirArquivo(bytes, nome, tipo)
                    _estado.update { st -> st.copy(anexando = st.anexando.map { if (it.chave == chave) it.copy(anexo = anexo) else it }) }
                } catch (e: Exception) {
                    val msg = (e as? ErroRelay)?.message ?: "falhou"
                    _estado.update { st -> st.copy(anexando = st.anexando.map { if (it.chave == chave) it.copy(erro = msg) else it }) }
                }
            }
        }
    }

    fun removerAnexo(chave: String) = _estado.update { s -> s.copy(anexando = s.anexando.filterNot { it.chave == chave }) }

    // Imagens dos anexos: cache em memória (decodificadas já reduzidas).
    private val cacheImagens = android.util.LruCache<String, androidx.compose.ui.graphics.ImageBitmap>(40)

    suspend fun imagem(url: String, larguraMax: Int = 1080): androidx.compose.ui.graphics.ImageBitmap? {
        cacheImagens.get(url)?.let { return it }
        val a = api ?: return null
        return runCatching {
            val bytes = a.baixarBytes(url)
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
                val limites = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, limites)
                var amostra = 1
                while (limites.outWidth / (amostra * 2) >= larguraMax) amostra *= 2
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
                    android.graphics.BitmapFactory.Options().apply { inSampleSize = amostra })?.let {
                    val img = it.asImageBitmap()
                    cacheImagens.put(url, img)
                    img
                }
            }
        }.getOrNull()
    }

    /** Baixa um anexo para Downloads pelo gerenciador do Android (com o token no cabeçalho). */
    fun baixar(anexo: dev.josev.relay.dados.Anexo) {
        val a = api ?: return
        val dm = getApplication<Application>().getSystemService(android.app.DownloadManager::class.java)
        val req = android.app.DownloadManager.Request(android.net.Uri.parse(a.urlAbsoluta(anexo.url) + "?baixar=1"))
            .addRequestHeader("Authorization", "Bearer ${a.tokenAtual}")
            .setTitle(anexo.nome)
            .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, anexo.nome)
        dm.enqueue(req)
        _estado.update { it.copy(aviso = "Baixando ${anexo.nome}…") }
    }

    fun retentar(clientId: String) {
        _estado.value.pendentes.find { it.clientId == clientId }?.let { p ->
            _estado.update { s -> s.copy(pendentes = s.pendentes.map { if (it.clientId == clientId) it.copy(falhou = false) else it }) }
            postar(p.copy(falhou = false))
        }
    }

    fun descartar(clientId: String) = _estado.update { s -> s.copy(pendentes = s.pendentes.filterNot { it.clientId == clientId }) }

    private fun postar(p: Pendente) {
        val a = api ?: return
        val s = _estado.value
        viewModelScope.launch {
            try {
                val id = a.enviar(NovaMensagem(s.sala, p.texto, de = s.conexao?.nome, clientId = p.clientId, replyTo = p.replyTo,
                    anexos = p.anexos.map { it.id }.ifEmpty { null }))
                _estado.update { st ->
                    if (id <= ultimoId) st.copy(pendentes = st.pendentes.filterNot { it.clientId == p.clientId })
                    else st.copy(pendentes = st.pendentes.map { if (it.clientId == p.clientId) it.copy(idReal = id) else it })
                }
            } catch (e: Exception) {
                _estado.update { st -> st.copy(pendentes = st.pendentes.map { if (it.clientId == p.clientId) it.copy(falhou = true) else it }) }
                tratar(e)
            }
        }
    }

    private fun substituir(m: Mensagem) = _estado.update { s ->
        s.copy(mensagens = s.mensagens.map { if (it.id == m.id) m.copy(anexos = m.anexos.ifEmpty { it.anexos }) else it })
    }

    fun editar(id: Long, texto: String) {
        val a = api ?: return
        viewModelScope.launch { runCatching { a.editar(id, texto) }.onSuccess(::substituir).onFailure { tratar(it) } }
    }

    fun apagar(id: Long) {
        val a = api ?: return
        viewModelScope.launch {
            runCatching { a.apagar(id) }
                .onSuccess { _estado.update { s -> s.copy(mensagens = s.mensagens.filterNot { it.id == id }) } }
                .onFailure { tratar(it) }
        }
    }

    fun avisoMostrado() = _estado.update { it.copy(aviso = null) }

    // --- tema ----------------------------------------------------------------
    val tema = config.tema.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, "sistema")
    /** Botão à vista: alterna entre claro e escuro a partir do que está na tela agora. */
    fun alternarTema(escuroAgora: Boolean) = viewModelScope.launch { config.salvarTema(if (escuroAgora) "claro" else "escuro") }

    // --- tempo real ----------------------------------------------------------
    val tempoReal = config.tempoReal.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, true)
    fun alternarTempoReal(ligado: Boolean) = viewModelScope.launch {
        config.salvarTempoReal(ligado)
        if (ligado) dev.josev.relay.notificacoes.ServicoTempoReal.iniciar(getApplication())
        else dev.josev.relay.notificacoes.ServicoTempoReal.parar(getApplication())
    }

    // --- quadro --------------------------------------------------------------
    fun abrirTarefa(id: Long) = _estado.update { it.copy(tarefa = id) }
    fun fecharTarefa() = _estado.update { it.copy(tarefa = null) }
    suspend fun tarefas(): List<dev.josev.relay.dados.Tarefa> = api!!.tarefas(_estado.value.sala)
    suspend fun tarefa(id: Long): dev.josev.relay.dados.Tarefa = api!!.tarefa(id)
    suspend fun criarTarefa(campos: Map<String, Any?>) = api!!.criarTarefa(_estado.value.sala, campos)
    suspend fun alterarTarefa(id: Long, campos: Map<String, Any?>) = api!!.alterarTarefa(id, campos)
    suspend fun novoItem(id: Long, texto: String) = api!!.novoItem(id, texto)
    suspend fun marcarItem(id: Long, item: Long, feito: Boolean) = api!!.marcarItem(id, item, feito)
    suspend fun apagarItem(id: Long, item: Long) = api!!.apagarItem(id, item)
    val eu: String get() = _estado.value.conexao?.nome.orEmpty()

    // --- memória e artefatos --------------------------------------------------
    suspend fun fatos(q: String?) = api!!.fatos(_estado.value.sala, q)
    suspend fun candidatos() = api!!.candidatos(_estado.value.sala)
    suspend fun decidirFato(id: Long, confirmar: Boolean) = api!!.decidirFato(id, if (confirmar) "confirmar" else "rejeitar")
    suspend fun artefatos() = api!!.artefatos(_estado.value.sala)
    suspend fun artefato(id: Long) = api!!.artefato(id)
    fun abrirArtefato(id: Long) = _estado.update { it.copy(artefato = id) }
    fun fecharArtefato() = _estado.update { it.copy(artefato = null) }

    // --- perfil --------------------------------------------------------------
    fun abrirPerfil(nome: String) { if (nome != "relay") _estado.update { it.copy(perfil = nome) } }
    fun fecharPerfil() = _estado.update { it.copy(perfil = null) }
    suspend fun perfil(nome: String): dev.josev.relay.dados.Perfil = api!!.perfil(nome)
    suspend fun grafo(agente: String?, sujeito: String?): dev.josev.relay.dados.Grafo = api!!.grafo(_estado.value.sala, agente, sujeito)
    suspend fun salvarPersona(nome: String, p: dev.josev.relay.dados.Persona) = api!!.salvarPersona(nome, p)
    suspend fun revogar(nome: String) = api!!.revogar(nome)
    fun erro(e: Throwable) = tratar(e)

    private fun tratar(e: Throwable) {
        val msg = when {
            e is ErroRelay && e.status == 401 -> { sair(); "Token revogado ou inválido." }
            e is ErroRelay && e.codigo == "credencial_detectada" -> "A mensagem parece ter uma credencial. Não foi enviada."
            e is ErroRelay && e.status == 429 -> "Devagar: limite de envio atingido."
            e is ErroRelay -> e.message ?: "Erro ${e.status}"
            e is IOException -> "Sem conexão com o relay."
            else -> "Algo deu errado: ${e.message?.take(80)}"
        }
        _estado.update { it.copy(aviso = msg) }
    }
}
