package dev.josev.relay.dados

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

data class Conexao(val url: String, val nome: String, val token: String)

private val Context.dados by preferencesDataStore("relay")

/** Endereço, nome e token salvos no aparelho (DataStore, sem backup: allowBackup=false). */
class Config(private val contexto: Context) {
    private val kUrl = stringPreferencesKey("url")
    private val kNome = stringPreferencesKey("nome")
    private val kToken = stringPreferencesKey("token")
    private val kSala = stringPreferencesKey("sala")
    private val kTema = stringPreferencesKey("tema")

    private val kTempoReal = androidx.datastore.preferences.core.booleanPreferencesKey("tempo_real")

    /** Notificações em tempo real (serviço com SSE) ou economia (WorkManager a cada 15 min). Padrão: tempo real. */
    val tempoReal: Flow<Boolean> = contexto.dados.data.map { it[kTempoReal] ?: true }
    suspend fun salvarTempoReal(v: Boolean) = contexto.dados.edit { it[kTempoReal] = v }

    /** "sistema" | "claro" | "escuro". */
    val tema: Flow<String> = contexto.dados.data.map { it[kTema] ?: "sistema" }
    suspend fun salvarTema(t: String) = contexto.dados.edit { it[kTema] = t }
    private fun kVista(sala: String) = longPreferencesKey("vista:$sala")

    val conexao: Flow<Conexao?> = contexto.dados.data.map { p ->
        val url = p[kUrl]; val token = p[kToken]
        if (url.isNullOrBlank() || token.isNullOrBlank()) null else Conexao(url, p[kNome].orEmpty(), token)
    }

    suspend fun ultimaUrl(): String = contexto.dados.data.first()[kUrl] ?: "http://100.125.4.73:8790"
    suspend fun ultimoNome(): String = contexto.dados.data.first()[kNome].orEmpty()
    suspend fun sala(): String = contexto.dados.data.first()[kSala] ?: "geral"
    suspend fun vistas(): Map<String, Long> = contexto.dados.data.first().asMap()
        .filterKeys { it.name.startsWith("vista:") }
        .mapKeys { it.key.name.removePrefix("vista:") }
        .mapValues { (it.value as? Long) ?: 0L }

    suspend fun salvar(c: Conexao) = contexto.dados.edit {
        it[kUrl] = c.url; it[kNome] = c.nome; it[kToken] = c.token
    }

    suspend fun salvarSala(sala: String) = contexto.dados.edit { it[kSala] = sala }
    suspend fun marcarVista(sala: String, id: Long) = contexto.dados.edit {
        if ((it[kVista(sala)] ?: 0L) < id) it[kVista(sala)] = id
    }

    /** Último id já notificado por sala (separado de "vista": notificar não é ler). */
    private fun kNotificado(sala: String) = longPreferencesKey("notificado:$sala")
    suspend fun notificado(sala: String): Long = contexto.dados.data.first()[kNotificado(sala)] ?: 0L
    suspend fun marcarNotificado(sala: String, id: Long) = contexto.dados.edit { it[kNotificado(sala)] = id }

    suspend fun sair() = contexto.dados.edit { it.remove(kToken) }
}
