package dev.josev.relay.notificacoes

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.josev.relay.MainActivity
import dev.josev.relay.R
import dev.josev.relay.dados.Config
import dev.josev.relay.dados.Mensagem
import dev.josev.relay.dados.RelayApi
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

object Notificacoes {
    const val EXTRA_SALA = "sala"
    private const val CANAL_MENCOES = "mencoes"
    private const val CANAL_SALAS = "salas"
    const val CANAL_CONEXAO = "conexao"
    const val EXTRA_RESPONDE_A = "responde_a"
    const val EXTRA_PARA = "para"
    const val CHAVE_RESPOSTA = "resposta"
    private const val TRABALHO = "verificar-mensagens"

    fun criarCanais(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL_MENCOES, "Menções e privadas", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CANAL_SALAS, "Mensagens das salas", NotificationManager.IMPORTANCE_DEFAULT))
        // Notificação fixa do tempo real: mínima (sem som, recolhida).
        nm.createNotificationChannel(NotificationChannel(CANAL_CONEXAO, "Conexão em tempo real", NotificationManager.IMPORTANCE_MIN))
    }

    /** Verifica a cada 15 min (mínimo do Android) com rede; sobrevive a reinício e app fechado. */
    fun agendar(ctx: Context) {
        val pedido = PeriodicWorkRequestBuilder<VerificarMensagens>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(TRABALHO, ExistingPeriodicWorkPolicy.KEEP, pedido)
    }

    fun cancelarAgenda(ctx: Context) = WorkManager.getInstance(ctx).cancelUniqueWork(TRABALHO)

    fun limpar(ctx: Context, sala: String) = NotificationManagerCompat.from(ctx).cancel(sala, 0)

    /** Depois de responder pela notificação o Android exige atualizá-la: mostra a resposta e some em 4 s. */
    fun respondido(ctx: Context, sala: String, texto: String) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val n = NotificationCompat.Builder(ctx, CANAL_SALAS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle("#$sala")
            .setContentText("Você: $texto ✓")
            .setSilent(true).setOnlyAlertOnce(true)
            .setTimeoutAfter(4000)
            .build()
        NotificationManagerCompat.from(ctx).notify(sala, 0, n)
    }

    /** "Responder" direto da notificação: responde à última mensagem; se ela era privada, a resposta também é. */
    private fun acaoResponder(ctx: Context, sala: String, m: Mensagem): NotificationCompat.Action {
        val intent = Intent(ctx, Responder::class.java).putExtra(EXTRA_SALA, sala).putExtra(EXTRA_RESPONDE_A, m.id)
            .apply { if (m.para != null) putExtra(EXTRA_PARA, m.de) }
        val pi = PendingIntent.getBroadcast(ctx, sala.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val entrada = androidx.core.app.RemoteInput.Builder(CHAVE_RESPOSTA).setLabel("Responder em #$sala").build()
        return NotificationCompat.Action.Builder(R.drawable.ic_notificacao, "Responder", pi)
            .addRemoteInput(entrada).setAllowGeneratedReplies(true)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).build()
    }

    fun mostrar(ctx: Context, sala: String, eu: String, novas: List<Mensagem>) {
        if (novas.isEmpty()) return
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val pessoal = novas.any { it.para.equals(eu, true) || it.texto.contains("@$eu", ignoreCase = true) }
        val abrir = PendingIntent.getActivity(ctx, sala.hashCode(),
            Intent(ctx, MainActivity::class.java).putExtra(EXTRA_SALA, sala)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val estilo = NotificationCompat.InboxStyle()
        novas.takeLast(6).forEach { estilo.addLine("${it.de}: ${it.texto.lineSequence().first().take(120)}") }
        val ultima = novas.last()
        val n = NotificationCompat.Builder(ctx, if (pessoal) CANAL_MENCOES else CANAL_SALAS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(if (novas.size == 1) "#$sala · ${ultima.de}" else "#$sala · ${novas.size} novas")
            .setContentText(if (novas.size == 1) ultima.texto else "${ultima.de}: ${ultima.texto}")
            .setStyle(if (novas.size == 1) NotificationCompat.BigTextStyle().bigText(ultima.texto) else estilo)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!pessoal)
            .addAction(acaoResponder(ctx, sala, ultima))
            .build()
        NotificationManagerCompat.from(ctx).notify(sala, 0, n)
    }
}

class VerificarMensagens(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        // App aberto na tela: o stream ao vivo já mostra tudo. Tempo real ligado: o serviço já notifica.
        if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return Result.success()
        if (ServicoTempoReal.rodando) return Result.success()
        val config = Config(applicationContext)
        val c = config.conexao.first() ?: return Result.success()
        val api = RelayApi(c)
        val vistas = config.vistas()
        val salas = runCatching { api.salas() }.getOrElse { return Result.retry() }
        for (s in salas) {
            val ultimo = s.ultimoId ?: continue
            val desde = maxOf(vistas[s.sala] ?: 0L, config.notificado(s.sala))
            if (ultimo <= desde) continue
            if (desde == 0L) { config.marcarNotificado(s.sala, ultimo); continue } // sala nunca aberta: não despeja histórico
            val novas = runCatching { api.historico(s.sala, limite = 30).mensagens }.getOrNull() ?: continue
            val minhas = novas.filter { it.id > desde && it.de != c.nome && it.de != "relay" }
            Notificacoes.mostrar(applicationContext, s.sala, c.nome, minhas)
            config.marcarNotificado(s.sala, ultimo)
        }
        return Result.success()
    }
}
