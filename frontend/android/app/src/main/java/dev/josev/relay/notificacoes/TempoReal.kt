package dev.josev.relay.notificacoes

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import dev.josev.relay.MainActivity
import dev.josev.relay.R
import dev.josev.relay.dados.Config
import dev.josev.relay.dados.Evento
import dev.josev.relay.dados.Mensagem
import dev.josev.relay.dados.NovaMensagem
import dev.josev.relay.dados.RelayApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Tempo real em segundo plano (fase 3 do plano do app): um SSE de todas as salas (`sala=*`) enquanto o
 * app não está na tela. Menções e privadas notificam na hora; o resto agrupa por sala. Notificação fixa mínima.
 */
class ServicoTempoReal : Service() {
    companion object {
        @Volatile var rodando = false
            private set
        private const val ID_FIXA = 4242

        fun iniciar(ctx: Context) = runCatching {
            ContextCompat.startForegroundService(ctx, Intent(ctx, ServicoTempoReal::class.java))
        }
        fun parar(ctx: Context) = ctx.stopService(Intent(ctx, ServicoTempoReal::class.java))
    }

    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var stream: Job? = null
    /** Não lidas por sala desde que o app saiu da tela (viram a notificação agrupada). */
    private val pendentes = mutableMapOf<String, MutableList<Mensagem>>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notificacoes.criarCanais(this)
        val tipo = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        ServiceCompat.startForeground(this, ID_FIXA, fixa("Conectando…"), tipo)
        rodando = true
        if (stream == null) stream = escopo.launch { ouvir() }
        return START_STICKY
    }

    override fun onDestroy() {
        rodando = false
        escopo.cancel()
        super.onDestroy()
    }

    private fun fixa(texto: String): Notification {
        val abrir = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, Notificacoes.CANAL_CONEXAO)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle("Relay em tempo real")
            .setContentText(texto)
            .setOngoing(true).setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(abrir)
            .build()
    }

    private fun status(texto: String) = runCatching { NotificationManagerCompat.from(this).notify(ID_FIXA, fixa(texto)) }

    private fun naTela() = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    private suspend fun ouvir() {
        val c = Config(this).conexao.first() ?: return stopSelf()
        val api = RelayApi(c)
        var ultimo = 0L
        api.tempoReal("*") { ultimo }.collect { e ->
            when (e) {
                Evento.Conectado -> status("Conectado")
                is Evento.Reconectando -> status("Sem conexão; tentando de novo em ${e.emSegundos} s")
                Evento.SemAcesso -> { status("Token revogado"); stopSelf() }
                is Evento.Nova -> {
                    ultimo = maxOf(ultimo, e.m.id)
                    receber(c.nome, e.m)
                }
                else -> Unit
            }
        }
    }

    private fun receber(eu: String, m: Mensagem) {
        val sala = m.sala ?: return
        if (naTela()) { pendentes.clear(); return }  // a tela já mostra ao vivo
        if (m.de == eu || m.de == "relay") return
        val lista = pendentes.getOrPut(sala) { mutableListOf() }
        lista += m
        Notificacoes.mostrar(this, sala, eu, lista)
    }
}

/** "Responder" da notificação: posta na sala (privada se a original era), sem abrir o app. */
class Responder : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val texto = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notificacoes.CHAVE_RESPOSTA)?.toString()?.trim()
        val sala = intent.getStringExtra(Notificacoes.EXTRA_SALA) ?: return
        if (texto.isNullOrEmpty()) return
        val respondeA = intent.getLongExtra(Notificacoes.EXTRA_RESPONDE_A, 0).takeIf { it > 0 }
        val para = intent.getStringExtra(Notificacoes.EXTRA_PARA)
        val pendente = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val c = Config(ctx).conexao.first() ?: return@launch
                runCatching {
                    RelayApi(c).enviar(NovaMensagem(sala = sala, texto = texto, de = c.nome, clientId = UUID.randomUUID().toString(),
                        replyTo = respondeA, para = para))
                }.onSuccess { Notificacoes.respondido(ctx, sala, texto) }
                    .onFailure {
                        android.os.Handler(android.os.Looper.getMainLooper()).post {
                            android.widget.Toast.makeText(ctx, "Não deu pra responder: sem conexão com o relay.", android.widget.Toast.LENGTH_LONG).show()
                        }
                    }
            } finally {
                pendente.finish()
            }
        }
    }
}
