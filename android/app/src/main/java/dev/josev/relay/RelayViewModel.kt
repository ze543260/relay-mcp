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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.UUID

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
    val aviso: String? = null,
)

class RelayViewModel(app: Application) : AndroidViewModel(app) {
    private val config = Config(app)
    private val _estado = MutableStateFlow(Estado())
    val estado: StateFlow<Estado> = _estado.asStateFlow()

    private var api: RelayApi? = null
    private var stream: Job? = null
    private var periodico: Job? = null
    private val ultimoId get() = _estado.value.mensagens.lastOrNull()?.id ?: 0L

    // App em segundo plano: fecha o stream (bateria); de volta: reabre do último id.
    private val ciclo = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) { if (api != null) abrirStream() }
        override fun onStop(owner: LifecycleOwner) {
            stream?.cancel()
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
        _estado.update {
            it.copy(verificando = false, conexao = c, admin = isAdmin, sala = config.sala(), vistas = config.vistas(), aviso = null)
        }
        abrirSala(_estado.value.sala)
        periodico?.cancel()
        periodico = viewModelScope.launch {
            while (isActive) { atualizarListas(); delay(30_000) }
        }
        if (!silencioso) Unit
    }

    fun sair() {
        stream?.cancel(); periodico?.cancel(); api = null
        viewModelScope.launch { config.sair() }
        _estado.value = Estado(verificando = false)
    }

    private suspend fun atualizarListas() {
        val a = api ?: return
        runCatching { a.salas() }.onSuccess { s -> _estado.update { it.copy(salas = s) } }
        runCatching { a.agentes() }.onSuccess { ag -> _estado.update { it.copy(agentes = ag) } }
    }

    fun abrirSala(sala: String) {
        val a = api ?: return
        stream?.cancel()
        viewModelScope.launch { config.salvarSala(sala) }
        _estado.update {
            it.copy(sala = sala, mensagens = emptyList(), pendentes = emptyList(), carregando = true,
                status = StatusConexao.CARREGANDO, respondendo = null, marcoLeitura = it.vistas[sala] ?: 0L)
        }
        viewModelScope.launch {
            try {
                val p = a.historico(sala)
                _estado.update { it.copy(mensagens = p.mensagens, temMais = p.temMais, carregando = false) }
            } catch (e: Exception) {
                _estado.update { it.copy(carregando = false) }
                tratar(e)
            }
            abrirStream()
            atualizarListas()
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
                    is Evento.Apagada -> _estado.update { s -> s.copy(mensagens = s.mensagens.filterNot { it.id == e.id }) }
                    is Evento.Reconectando -> _estado.update { it.copy(status = StatusConexao.RECONECTANDO, reconectaEm = e.emSegundos) }
                    Evento.SemAcesso -> { sair(); _estado.update { it.copy(aviso = "Token revogado ou inválido.") } }
                }
            }
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
    }

    fun responder(m: Mensagem?) = _estado.update { it.copy(respondendo = m) }

    fun enviar(texto: String) {
        val s = _estado.value
        val c = s.conexao ?: return
        val p = Pendente(UUID.randomUUID().toString(), c.nome, texto.trim(), s.respondendo?.id, System.currentTimeMillis())
        _estado.update { it.copy(pendentes = it.pendentes + p, respondendo = null) }
        postar(p)
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
                val id = a.enviar(NovaMensagem(s.sala, p.texto, de = s.conexao?.nome, clientId = p.clientId, replyTo = p.replyTo))
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

    fun apagar(id: Long) {
        val a = api ?: return
        viewModelScope.launch {
            runCatching { a.apagar(id) }
                .onSuccess { _estado.update { s -> s.copy(mensagens = s.mensagens.filterNot { it.id == id }) } }
                .onFailure { tratar(it) }
        }
    }

    fun avisoMostrado() = _estado.update { it.copy(aviso = null) }

    private fun tratar(e: Throwable) {
        val msg = when {
            e is ErroRelay && e.status == 401 -> { sair(); "Token revogado ou inválido." }
            e is ErroRelay && e.codigo == "credencial_detectada" -> "A mensagem parece ter uma credencial. Não foi enviada."
            e is ErroRelay && e.status == 429 -> "Devagar: limite de envio atingido."
            e is ErroRelay -> e.message ?: "Erro ${e.status}"
            e is IOException -> "Sem conexão com o relay."
            else -> "Algo deu errado."
        }
        _estado.update { it.copy(aviso = msg) }
    }
}
