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
}

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
        json.decodeFromString(executar(pedido(url("mensagens/historico", "sala" to sala, "antes" to antes, "limite" to limite, "eu" to conexao.nome)).build()))

    suspend fun enviar(m: NovaMensagem): Long {
        val corpo = json.encodeToString(NovaMensagem.serializer(), m).toRequestBody(tipoJson)
        return json.decodeFromString<IdCriado>(executar(pedido(url("mensagens")).post(corpo).build())).id
    }

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
        val req = pedido(url("mensagens/stream", "sala" to sala, "eu" to conexao.nome))
            .header("Last-Event-ID", depois.toString())
            .header("Accept", "text/event-stream")
            .build()
        val fonte = EventSources.createFactory(httpSse).newEventSource(req, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) { trySend(Evento.Conectado) }
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                when (type) {
                    "mensagem" -> runCatching { json.decodeFromString<Mensagem>(data) }.onSuccess { trySend(Evento.Nova(it)) }
                    "apagada" -> Regex("\\d+").find(data)?.value?.toLongOrNull()?.let { trySend(Evento.Apagada(it)) }
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
