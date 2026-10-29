package dev.josev.relay

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.josev.relay.atualizacao.AvisoAtualizacao
import dev.josev.relay.ui.conversa.TelaPrincipal
import dev.josev.relay.ui.entrar.TelaEntrar
import dev.josev.relay.ui.tema.TemaRelay

class MainActivity : ComponentActivity() {
    private val vm: RelayViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val tema by vm.tema.collectAsStateWithLifecycle()
            val escuro = when (tema) { "claro" -> false; "escuro" -> true; else -> androidx.compose.foundation.isSystemInDarkTheme() }
            // Ícones da barra de status seguem o tema do app (não só o do sistema).
            androidx.compose.runtime.LaunchedEffect(escuro) {
                val estilo = if (escuro) androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                else androidx.activity.SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = estilo, navigationBarStyle = estilo)
            }
            // Revelação do tema: foto da tela no tema antigo por cima, recortada por um círculo que cresce do botão.
            val camada = androidx.compose.ui.graphics.rememberGraphicsLayer()
            var antigo by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
            var origem by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
            val raio = androidx.compose.runtime.remember { androidx.compose.animation.core.Animatable(0f) }
            val escopo = androidx.compose.runtime.rememberCoroutineScope()
            val anda = dev.josev.relay.ui.conversa.movimentoLigado()
            val trocar: (androidx.compose.ui.geometry.Offset) -> Unit = { ponto ->
                escopo.launch {
                    if (antigo != null) return@launch
                    if (anda) runCatching { antigo = camada.toImageBitmap(); origem = ponto; raio.snapTo(0f) }.onFailure { android.util.Log.w("RelayTema", "sem foto do tema", it) }
                    vm.alternarTema(escuro).join()
                    androidx.compose.runtime.withFrameNanos { }; androidx.compose.runtime.withFrameNanos { }  // tema novo já desenhado
                    if (antigo != null) raio.animateTo(1f, androidx.compose.animation.core.tween(450, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)))
                    antigo = null
                }
            }
            Box(Modifier.fillMaxSize().drawWithContent {
                camada.record { this@drawWithContent.drawContent() }
                drawLayer(camada)
                antigo?.let { foto ->
                    val r = raio.value * kotlin.math.hypot(maxOf(origem.x, size.width - origem.x), maxOf(origem.y, size.height - origem.y))
                    val fora = androidx.compose.ui.graphics.Path().apply {
                        addRect(androidx.compose.ui.geometry.Rect(androidx.compose.ui.geometry.Offset.Zero, size))
                        addOval(androidx.compose.ui.geometry.Rect(origem, r))
                        fillType = androidx.compose.ui.graphics.PathFillType.EvenOdd
                    }
                    clipPath(fora) { drawImage(foto) }
                }
            }) {
                TemaRelay(escuro = escuro) {
                    androidx.compose.runtime.CompositionLocalProvider(dev.josev.relay.ui.tema.LocalTrocaTema provides trocar) { Raiz(vm) }
                }
            }
        }
        abrirDaNotificacao(intent)
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        abrirDaNotificacao(intent)
    }

    private fun abrirDaNotificacao(intent: android.content.Intent?) {
        intent?.getStringExtra(dev.josev.relay.notificacoes.Notificacoes.EXTRA_SALA)?.let { vm.irPara(it) }
    }
}

@Composable
private fun Raiz(vm: RelayViewModel) {
    val estado by vm.estado.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        val tela = when {
            estado.verificando -> 0
            estado.conexao == null -> 1
            else -> 2
        }
        Crossfade(tela, label = "tela") { t ->
            when (t) {
                0 -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                1 -> TelaEntrar(vm, estado.aviso)
                else -> {
                    TelaPrincipal(vm, estado)
                    estado.tarefa?.let { id ->
                        androidx.activity.compose.BackHandler { vm.fecharTarefa() }
                        dev.josev.relay.ui.quadro.TelaTarefa(vm, id, estado.versaoTarefas)
                    }
                    estado.perfil?.let { nome ->
                        androidx.activity.compose.BackHandler { vm.fecharPerfil() }
                        dev.josev.relay.ui.perfil.TelaPerfil(vm, nome, admin = estado.admin)
                    }
                }
            }
        }
        AvisoAtualizacao()
    }
}
