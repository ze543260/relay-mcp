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

    fun pedirPermissao(ctx: Context) = ctx.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )

    /** Baixa o APK direto numa sessão do PackageInstaller; o sistema pede confirmação. */
    suspend fun instalar(ctx: Context, v: Versao, progresso: (Float) -> Unit) = withContext(Dispatchers.IO) {
        val instalador = ctx.packageManager.packageInstaller
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

/** Recebe o status da sessão; se o sistema pedir confirmação, abre a tela dele. */
class ResultadoInstalacao : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirmar = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                ctx.startActivity(confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> android.widget.Toast.makeText(ctx,
                "Falha ao atualizar: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "erro"}",
                android.widget.Toast.LENGTH_LONG).show()
        }
    }
}
