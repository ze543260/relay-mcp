package dev.josev.relay.atualizacao

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import dev.josev.relay.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/** Versão publicada nas GitHub Releases. Tag `app-<versionCode>`, asset `relay.apk`. */
data class Versao(val codigo: Int, val nome: String, val notas: String, val apk: String, val tamanho: Long)

@Serializable private data class Asset(val name: String, val browser_download_url: String, val size: Long = 0)
@Serializable private data class Release(
    val tag_name: String, val name: String? = null, val body: String? = null,
    val draft: Boolean = false, val prerelease: Boolean = false, val assets: List<Asset> = emptyList(),
)

object Atualizador {
    private const val REPO = "ze543260/relay-mcp"
    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient()

    /** A release `app-*` mais nova, se for maior que a instalada. */
    suspend fun verificar(): Versao? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("https://api.github.com/repos/$REPO/releases?per_page=20")
            .header("Accept", "application/vnd.github+json").build()
        val releases = http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw IOException("GitHub ${r.code}")
            json.decodeFromString<List<Release>>(r.body.string())
        }
        releases.asSequence()
            .filter { !it.draft && !it.prerelease && it.tag_name.startsWith("app-") }
            .mapNotNull { rel ->
                val codigo = rel.tag_name.removePrefix("app-").toIntOrNull() ?: return@mapNotNull null
                val apk = rel.assets.firstOrNull { it.name.endsWith(".apk") } ?: return@mapNotNull null
                Versao(codigo, rel.name ?: rel.tag_name, rel.body.orEmpty(), apk.browser_download_url, apk.size)
            }
            .maxByOrNull { it.codigo }
            ?.takeIf { it.codigo > BuildConfig.VERSION_CODE }
    }

    fun podeInstalar(ctx: Context) = ctx.packageManager.canRequestPackageInstalls()

    /**
     * Atualização sem toque (Android 12+): só vale quando o próprio Relay foi quem instalou a versão atual
     * (a 1ª atualização feita pelo app o torna "instalador"); instalado pelo navegador, o sistema ainda pede confirmação.
     */
    fun podeSilencioso(ctx: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 31 || !podeInstalar(ctx)) return false
        val origem = runCatching { ctx.packageManager.getInstallSourceInfo(ctx.packageName) }.getOrNull() ?: return false
        return origem.installingPackageName == ctx.packageName || origem.updateOwnerPackageNameCompat() == ctx.packageName
    }

    private fun android.content.pm.InstallSourceInfo.updateOwnerPackageNameCompat(): String? =
        if (android.os.Build.VERSION.SDK_INT >= 34) updateOwnerPackageName else null

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("atualizacao", Context.MODE_PRIVATE)

    /**
     * Tentativa sem toque que não concluiu (HyperOS/MIUI seguram a sessão em segundo plano esperando o
     * verificador). Se a versão ainda é mais nova que a instalada, a próxima abertura cai no diálogo.
     */
    fun marcarTentativa(ctx: Context, codigo: Int) = prefs(ctx).edit().putInt("tentou", codigo).apply()
    fun silenciosoFalhou(ctx: Context, codigo: Int) = prefs(ctx).getInt("tentou", -1) >= codigo

    /** Guarda as notas antes de instalar: a 1ª abertura da versão nova mostra "o que mudou". */
    fun lembrarNotas(ctx: Context, v: Versao) = prefs(ctx).edit().putInt("codigo", v.codigo).putString("nome", v.nome).putString("notas", v.notas).apply()

    /** Notas da versão que acabou de ser instalada sozinha (uma vez só). */
    fun novidades(ctx: Context): Versao? {
        val p = prefs(ctx)
        if (p.getInt("codigo", -1) != BuildConfig.VERSION_CODE) return null
        p.edit().remove("tentou").apply()
        val v = Versao(BuildConfig.VERSION_CODE, p.getString("nome", "").orEmpty(), p.getString("notas", "").orEmpty(), "", 0)
        p.edit().clear().apply()
        return v
    }

    /** Agenda a verificação a cada 6 h, com rede; a instalação silenciosa acontece com o app fora da tela. */
    fun agendar(ctx: Context) {
        val pedido = androidx.work.PeriodicWorkRequestBuilder<AtualizarSozinho>(6, java.util.concurrent.TimeUnit.HOURS)
            .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build())
            .build()
        androidx.work.WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("atualizar-app", androidx.work.ExistingPeriodicWorkPolicy.KEEP, pedido)
    }

    /** Pede uma verificação já (ex.: o app acabou de ir pro fundo e havia versão nova). */
    fun verificarAgora(ctx: Context) {
        val pedido = androidx.work.OneTimeWorkRequestBuilder<AtualizarSozinho>()
            .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build())
            .build()
        androidx.work.WorkManager.getInstance(ctx).enqueueUniqueWork("atualizar-app-agora", androidx.work.ExistingWorkPolicy.KEEP, pedido)
    }

    fun pedirPermissao(ctx: Context) = ctx.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )

    /** Baixa o APK direto numa sessão do PackageInstaller; o sistema pede confirmação. */
    suspend fun instalar(ctx: Context, v: Versao, progresso: (Float) -> Unit) = withContext(Dispatchers.IO) {
        val instalador = ctx.packageManager.packageInstaller
        // Sessões antigas presas (o sistema não as termina sozinho) seguram a nova: limpa antes.
        instalador.mySessions.forEach { runCatching { instalador.abandonSession(it.sessionId) } }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (v.tamanho > 0) setSize(v.tamanho)
            if (android.os.Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = instalador.createSession(params)
        instalador.openSession(id).use { sessao ->
            try {
                http.newCall(Request.Builder().url(v.apk).build()).execute().use { r ->
                    if (!r.isSuccessful) throw IOException("download ${r.code}")
                    val total = r.body.contentLength().takeIf { it > 0 } ?: v.tamanho
                    sessao.openWrite("relay.apk", 0, total.takeIf { it > 0 } ?: -1).use { saida ->
                        val entrada = r.body.byteStream()
                        val buf = ByteArray(64 * 1024)
                        var lidos = 0L
                        while (true) {
                            val n = entrada.read(buf); if (n < 0) break
                            saida.write(buf, 0, n); lidos += n
                            if (total > 0) progresso(lidos.toFloat() / total)
                        }
                        sessao.fsync(saida)
                    }
                }
                val intent = Intent(ctx, ResultadoInstalacao::class.java)
                val pi = PendingIntent.getBroadcast(ctx, id, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                sessao.commit(pi.intentSender)
            } catch (e: Throwable) {
                sessao.abandon(); throw e
            }
        }
    }
}

/** Em segundo plano: se há versão nova e dá pra instalar sem toque, instala (nunca com o app na tela). */
class AtualizarSozinho(ctx: Context, params: androidx.work.WorkerParameters) : androidx.work.CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        if (!Atualizador.podeSilencioso(ctx)) return Result.success()
        val naTela = withContext(Dispatchers.Main) {
            androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)
        }
        if (naTela) return Result.success()  // não derruba o app no meio do uso; tenta quando sair da tela
        val v = runCatching { Atualizador.verificar() }.getOrElse { return Result.retry() } ?: return Result.success()
        if (Atualizador.silenciosoFalhou(ctx, v.codigo)) return Result.success()  // já travou uma vez: espera o diálogo
        Atualizador.lembrarNotas(ctx, v)
        Atualizador.marcarTentativa(ctx, v.codigo)
        return runCatching { Atualizador.instalar(ctx, v) {} }.fold({ Result.success() }, { Result.retry() })
    }
}

/** Recebe o status da sessão; se o sistema pedir confirmação, abre a tela dele. */
class ResultadoInstalacao : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirmar = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) ?: return
                val naTela = androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.currentState
                    .isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)
                // Em segundo plano o Android bloqueia abrir tela: vira notificação "toque pra atualizar".
                if (naTela) ctx.startActivity(confirmar) else avisarConfirmacao(ctx, confirmar)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> android.widget.Toast.makeText(ctx,
                "Falha ao atualizar: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "erro"}",
                android.widget.Toast.LENGTH_LONG).show()
        }
    }
}

private fun avisarConfirmacao(ctx: Context, confirmar: Intent) {
    val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
    nm.createNotificationChannel(android.app.NotificationChannel("atualizacao", "Atualizações do app",
        android.app.NotificationManager.IMPORTANCE_DEFAULT))
    val pi = PendingIntent.getActivity(ctx, 7, confirmar, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    nm.notify(7, android.app.Notification.Builder(ctx, "atualizacao")
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle("Nova versão do Relay pronta")
        .setContentText("Toque para atualizar")
        .setContentIntent(pi).setAutoCancel(true).build())
}
