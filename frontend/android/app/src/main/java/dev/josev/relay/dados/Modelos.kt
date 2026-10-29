package dev.josev.relay.dados

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Anexo(val id: String, val nome: String, val tipo: String, val tamanho: Long, val url: String)

@Serializable
data class Mensagem(
    val id: Long,
    val de: String,
    val para: String? = null,
    val texto: String,
    val criado: Double = 0.0,
    @SerialName("criado_em") val criadoEm: String? = null,
    @SerialName("client_id") val clientId: String? = null,
    @SerialName("reply_to") val replyTo: Long? = null,
    val anexos: List<Anexo> = emptyList(),
    val editado: Double? = null,
)

@Serializable
data class Sala(
    val sala: String,
    val total: Int,
    @SerialName("ultimo_id") val ultimoId: Long? = null,
    val agentes: List<String> = emptyList(),
)

@Serializable
data class Agente(
    val nome: String,
    val apelido: String? = null,
    @SerialName("visto_em") val vistoEm: String? = null,
    val online: Boolean = false,
    val tipo: String = "humano",
)

@Serializable
data class Eu(val nome: String? = null, val admin: Boolean = false)

@Serializable
data class PaginaHistorico(val mensagens: List<Mensagem>, @SerialName("tem_mais") val temMais: Boolean)

@Serializable
data class IdCriado(val id: Long)

/** RFC 9457 (problem+json) do servidor v2. */
@Serializable
data class Problema(val status: Int = 0, val detail: String? = null, val codigo: String? = null, val erro: String? = null)

@Serializable
data class NovaMensagem(
    val sala: String,
    val texto: String,
    val de: String? = null,
    @SerialName("client_id") val clientId: String,
    @SerialName("reply_to") val replyTo: Long? = null,
    val anexos: List<String>? = null,
)

/** Mensagem minha ainda não confirmada pelo servidor (envio otimista). */
data class Pendente(
    val clientId: String,
    val de: String,
    val texto: String,
    val replyTo: Long?,
    val criadoMs: Long,
    val anexos: List<Anexo> = emptyList(),
    val falhou: Boolean = false,
    val idReal: Long? = null,
)

class ErroRelay(val status: Int, val codigo: String?, mensagem: String, val retryAfter: Int? = null) : Exception(mensagem)

@Serializable
data class Leitura(val nome: String, @SerialName("ultimo_id") val ultimoId: Long, val quando: String? = null)

@Serializable
data class NomesDigitando(val nomes: List<String> = emptyList())
