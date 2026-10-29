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
    /** Só vem no stream de todas as salas (serviço em segundo plano). */
    val sala: String? = null,
)

@Serializable
data class Sala(
    val sala: String,
    val total: Int,
    @SerialName("ultimo_id") val ultimoId: Long? = null,
    val agentes: List<String> = emptyList(),
    /** Servidor novo: contagem do ponto de vista de quem pede. */
    @SerialName("nao_lidas") val naoLidas: Int? = null,
    val mencoes: Int? = null,
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
    val para: String? = null,
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

// --- Perfil (docs/PLANO-PERFIL.md) ---------------------------------------

@Serializable
data class Persona(
    val equipe: String? = null,
    val papel: String? = null,
    val foco: String? = null,
    val tom: String? = null,
    val limites: String? = null,
    @SerialName("editado_por") val editadoPor: String? = null,
)

@Serializable
data class TarefaResumo(val id: Long, val sala: String, val titulo: String, val status: String, val prioridade: String = "nenhuma")

@Serializable
data class Acesso(@SerialName("token_ativo") val tokenAtivo: Boolean, @SerialName("criado_em") val criadoEm: String,
                  val dispositivos: List<Dispositivo> = emptyList())

@Serializable
data class Dispositivo(val rotulo: String, val via: String, val ip: String? = null,
                       @SerialName("primeiro_em") val primeiroEm: String, @SerialName("ultimo_em") val ultimoEm: String)

@Serializable
data class Perfil(
    val nome: String,
    val apelido: String? = null,
    val tipo: String = "humano",
    val dono: String? = null,
    val online: Boolean = false,
    @SerialName("visto_em") val vistoEm: String? = null,
    val persona: Persona? = null,
    val tarefas: List<TarefaResumo> = emptyList(),
    @SerialName("fatos_registrados") val fatosRegistrados: Int = 0,
    @SerialName("pode_editar") val podeEditar: Boolean = false,
    val acesso: Acesso? = null,
)

@Serializable
data class NoGrafo(val nome: String, val rotulo: String, val aliases: List<String> = emptyList(), val fatos: Int = 0)

@Serializable
data class OrigemFato(val tipo: String, val id: String)

@Serializable
data class ArestaGrafo(val fato: Long, val de: String, val predicado: String, val para: String, val folha: Boolean = false,
                       val origem: OrigemFato, val autor: String)

@Serializable
data class Grafo(val centros: List<String> = emptyList(), val nos: List<NoGrafo> = emptyList(),
                 val arestas: List<ArestaGrafo> = emptyList(), val cortado: Boolean = false)

// --- Quadro (kanban fase 1 do servidor) -----------------------------------

@Serializable
data class Etiqueta(val id: Long, val nome: String, val cor: Int = 0)

@Serializable
data class ResumoChecklist(val feitos: Int = 0, val total: Int = 0)

@Serializable
data class ItemChecklist(val id: Long, val texto: String, val feito: Boolean = false)

@Serializable
data class Atividade(val de: String, val campo: String, val antes: String? = null, val depois: String? = null, val quando: String)

/** `GET /tarefas` traz a lista; `GET /tarefas/{id}` vem com `itens` e `atividade`. */
@Serializable
data class Tarefa(
    val id: Long,
    val sala: String,
    val titulo: String,
    val descricao: String? = null,
    val status: String = "a_fazer",
    val responsavel: String? = null,
    @SerialName("criada_por") val criadaPor: String = "",
    @SerialName("criado_em") val criadoEm: String = "",
    val prazo: String? = null,
    val prioridade: String = "nenhuma",
    val estimativa: Int? = null,
    val etiquetas: List<Etiqueta> = emptyList(),
    val checklist: ResumoChecklist = ResumoChecklist(),
    val itens: List<ItemChecklist> = emptyList(),
    val atividade: List<Atividade> = emptyList(),
)

@Serializable
data class OrigemFatoMemoria(val tipo: String, val id: String)

@Serializable
data class Fato(
    val id: Long, val sala: String, val sujeito: String, val predicado: String, val objeto: String,
    val origem: OrigemFatoMemoria, val estado: String, val autor: String,
    @SerialName("confirmado_por") val confirmadoPor: String? = null,
    @SerialName("criado_em") val criadoEm: String,
)

@Serializable
data class Artefato(
    val id: Long, val sala: String, val titulo: String, val tipo: String, val versao: Int, val estado: String,
    @SerialName("criado_por") val criadoPor: String,
    @SerialName("atualizado_em") val atualizadoEm: String,
    @SerialName("autor_versao") val autorVersao: String? = null,
    val resumo: String? = null,
    val conteudo: String? = null,
    @SerialName("msg_id") val msgId: Long? = null,
)
