package dev.josev.relay.dados

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min

/** Evento de tempo real vindo do SSE do servidor. */
sealed interface Evento {
    data object Conectado : Evento
    data class Nova(val m: Mensagem) : Evento
    data class Apagada(val id: Long) : Evento
    data class Reconectando(val emSegundos: Int) : Evento
    data object SemAcesso : Evento
    data class Digitando(val nomes: List<String>) : Evento
    data object Leu : Evento
    data object TarefaMudou : Evento
    data class Editada(val m: Mensagem) : Evento
}

/** `todas=1`: com token de admin, vê também as privadas (igual ao dashboard); para agentes o servidor ignora. */
class RelayApi(private val conexao: Conexao) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val base: HttpUrl = conexao.url.trimEnd('/').toHttpUrl()
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    // SSE: o servidor manda ping a cada 15 s, então 45 s sem nada = conexão morta.
    private val httpSse = http.newBuilder().readTimeout(45, TimeUnit.SECONDS).build()
    private val tipoJson = "application/json".toMediaType()

    private fun url(caminho: String, vararg q: Pair<String, Any?>): HttpUrl =
        base.newBuilder().addPathSegments(caminho.trimStart('/')).apply {
            q.forEach { (k, v) -> if (v != null) addQueryParameter(k, v.toString()) }
        }.build()

    private fun pedido(u: HttpUrl) = Request.Builder().url(u)
        .header("Authorization", "Bearer ${conexao.token}")
        .header("X-Relay", "1")

    private suspend fun executar(req: Request): String = withContext(Dispatchers.IO) {
        suspendCancellableCoroutine { cont ->
            val call = http.newCall(req)
            cont.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
                override fun onResponse(call: Call, response: Response) {
                    response.use { r ->
                        val corpo = r.body.string()
                        if (r.isSuccessful) cont.resume(corpo)
                        else cont.resumeWithException(erroDe(r.code, corpo, r.header("Retry-After")))
                    }
                }
            })
        }
    }

    private fun erroDe(status: Int, corpo: String, retry: String?): ErroRelay {
        val p = runCatching { json.decodeFromString<Problema>(corpo) }.getOrNull()
        return ErroRelay(status, p?.codigo, p?.detail ?: p?.erro ?: "Erro $status", retry?.toIntOrNull())
    }

    suspend fun eu(): Eu = json.decodeFromString(executar(pedido(url("eu")).build()))
    suspend fun salas(): List<Sala> = json.decodeFromString(executar(pedido(url("salas")).build()))
    suspend fun agentes(): List<Agente> = json.decodeFromString(executar(pedido(url("agentes")).build()))

    suspend fun historico(sala: String, antes: Long? = null, limite: Int = 50): PaginaHistorico =
        json.decodeFromString(executar(pedido(url("mensagens/historico", "sala" to sala, "antes" to antes, "limite" to limite, "eu" to conexao.nome, "todas" to 1)).build()))

    suspend fun enviar(m: NovaMensagem): Long {
        val corpo = json.encodeToString(NovaMensagem.serializer(), m).toRequestBody(tipoJson)
        return json.decodeFromString<IdCriado>(executar(pedido(url("mensagens")).post(corpo).build())).id
    }

    /** Sobe bytes crus (POST /arquivos); o servidor guarda e devolve o id para anexar. */
    suspend fun subirArquivo(bytes: ByteArray, nome: String, tipo: String): Anexo {
        val req = pedido(url("arquivos", "de" to conexao.nome))
            .header("X-Nome", java.net.URLEncoder.encode(nome, "UTF-8").replace("+", "%20"))
            .post(bytes.toRequestBody(tipo.toMediaType()))
            .build()
        return json.decodeFromString(executar(req))
    }

    /** Bytes de um anexo (imagens na conversa). */
    suspend fun baixarBytes(caminho: String): ByteArray = withContext(Dispatchers.IO) {
        http.newCall(pedido(base.resolve(caminho) ?: url(caminho)).build()).execute().use { r ->
            if (!r.isSuccessful) throw erroDe(r.code, r.body.string(), null)
            r.body.bytes()
        }
    }

    fun urlAbsoluta(caminho: String): String = (base.resolve(caminho) ?: url(caminho)).toString()
    val tokenAtual: String get() = conexao.token

    suspend fun leituras(sala: String): List<Leitura> =
        json.decodeFromString(executar(pedido(url("leituras", "sala" to sala)).build()))

    suspend fun marcarLeitura(sala: String, ultimoId: Long) {
        val corpo = """{"sala":${json.encodeToString(kotlinx.serialization.serializer<String>(), sala)},"ultimo_id":$ultimoId,"de":${json.encodeToString(kotlinx.serialization.serializer<String>(), conexao.nome)}}"""
        executar(pedido(url("leituras")).post(corpo.toRequestBody(tipoJson)).build())
    }

    suspend fun digitando(sala: String, parou: Boolean) {
        val corpo = """{"sala":${json.encodeToString(kotlinx.serialization.serializer<String>(), sala)},"parou":$parou,"de":${json.encodeToString(kotlinx.serialization.serializer<String>(), conexao.nome)}}"""
        executar(pedido(url("digitando")).post(corpo.toRequestBody(tipoJson)).build())
    }

    suspend fun editar(id: Long, texto: String): Mensagem {
        val corpo = """{"texto":${json.encodeToString(kotlinx.serialization.serializer<String>(), texto)},"de":${json.encodeToString(kotlinx.serialization.serializer<String>(), conexao.nome)}}"""
        return json.decodeFromString(executar(pedido(url("mensagens/$id")).patch(corpo.toRequestBody(tipoJson)).build()))
    }

    // --- quadro ---------------------------------------------------------
    suspend fun tarefas(sala: String): List<Tarefa> = json.decodeFromString(executar(pedido(url("tarefas", "sala" to sala)).build()))
    suspend fun tarefa(id: Long): Tarefa = json.decodeFromString(executar(pedido(url("tarefas/$id")).build()))

    private fun corpo(campos: Map<String, Any?>): okhttp3.RequestBody = kotlinx.serialization.json.JsonObject(campos.mapValues { (_, v) ->
        when (v) {
            null -> kotlinx.serialization.json.JsonNull
            is Number -> kotlinx.serialization.json.JsonPrimitive(v)
            is Boolean -> kotlinx.serialization.json.JsonPrimitive(v)
            is List<*> -> kotlinx.serialization.json.JsonArray(v.map { kotlinx.serialization.json.JsonPrimitive(it.toString()) })
            else -> kotlinx.serialization.json.JsonPrimitive(v.toString())
        }
    }).toString().toRequestBody(tipoJson)

    suspend fun criarTarefa(sala: String, campos: Map<String, Any?>): Tarefa =
        json.decodeFromString(executar(pedido(url("tarefas")).post(corpo(campos + ("sala" to sala) + ("de" to conexao.nome))).build()))

    /** PATCH parcial: só os campos passados (null limpa o campo). */
    suspend fun alterarTarefa(id: Long, campos: Map<String, Any?>): Tarefa =
        json.decodeFromString(executar(pedido(url("tarefas/$id")).patch(corpo(campos + ("de" to conexao.nome))).build()))

    suspend fun novoItem(id: Long, texto: String): Tarefa =
        json.decodeFromString(executar(pedido(url("tarefas/$id/checklist")).post(corpo(mapOf("texto" to texto, "de" to conexao.nome))).build()))
    suspend fun marcarItem(id: Long, item: Long, feito: Boolean): Tarefa =
        json.decodeFromString(executar(pedido(url("tarefas/$id/checklist/$item")).patch(corpo(mapOf("feito" to feito, "de" to conexao.nome))).build()))
    suspend fun apagarItem(id: Long, item: Long): Tarefa =
        json.decodeFromString(executar(pedido(url("tarefas/$id/checklist/$item")).delete().build()))

    // --- perfil ---------------------------------------------------------
    suspend fun perfil(nome: String): Perfil = json.decodeFromString(executar(pedido(url("agentes/$nome")).build()))

    suspend fun salvarPersona(nome: String, p: Persona) {
        val corpo = json.encodeToString(Persona.serializer(), p.copy(editadoPor = null)).toRequestBody(tipoJson)
        executar(pedido(url("agentes/$nome/persona")).put(corpo).build())
    }

    suspend fun revogar(nome: String) { executar(pedido(url("agentes/$nome")).delete().build()) }

    /** Vizinhança na memória: centro = agente (fatos sobre e de autoria dele) ou um assunto. */
    suspend fun grafo(sala: String, agente: String?, sujeito: String?): Grafo = json.decodeFromString(executar(pedido(
        url("memoria/grafo", "sala" to sala, "profundidade" to 1,
            "centro" to agente?.let { "agente:$it" }, "sujeito" to sujeito)).build()))

    suspend fun apagar(id: Long) {
        executar(pedido(url("mensagens/$id")).delete().build())
    }

    /** Stream da sala; reconecta sozinho (Last-Event-ID) com backoff até cancelar o Flow. */
    fun tempoReal(sala: String, depois: () -> Long): Flow<Evento> = flow {
        var falhas = 0
        while (true) {
            var conectou = false
            var semAcesso = false
            sse(sala, depois()).collect { e ->
                when (e) {
                    Evento.Conectado -> { conectou = true; falhas = 0 }
                    Evento.SemAcesso -> semAcesso = true
                    else -> Unit
                }
                emit(e)
            }
            if (semAcesso) return@flow
            if (!conectou) falhas++
            val espera = min(30, 1 shl min(falhas, 5))
            emit(Evento.Reconectando(espera))
            delay(espera * 1000L)
        }
    }

    private fun sse(sala: String, depois: Long): Flow<Evento> = callbackFlow {
        val req = pedido(url("mensagens/stream", "sala" to sala, "eu" to conexao.nome, "todas" to 1))
            .header("Last-Event-ID", depois.toString())
            .header("Accept", "text/event-stream")
            .build()
        val fonte = EventSources.createFactory(httpSse).newEventSource(req, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) { trySend(Evento.Conectado) }
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                when (type) {
                    "mensagem" -> runCatching { json.decodeFromString<Mensagem>(data) }.onSuccess { trySend(Evento.Nova(it)) }
                    "editada" -> runCatching { json.decodeFromString<Mensagem>(data) }.onSuccess { trySend(Evento.Editada(it)) }
                    "apagada" -> Regex("\\d+").find(data)?.value?.toLongOrNull()?.let { trySend(Evento.Apagada(it)) }
                    "digitando" -> runCatching { json.decodeFromString<NomesDigitando>(data) }.onSuccess { trySend(Evento.Digitando(it.nomes)) }
                    "leitura" -> trySend(Evento.Leu)
                    "tarefa" -> trySend(Evento.TarefaMudou)
                }
            }
            override fun onClosed(eventSource: EventSource) { channel.close() }
            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                if (response?.code == 401) trySend(Evento.SemAcesso)
                channel.close()
            }
        })
        awaitClose { fonte.cancel() }
    }
}
