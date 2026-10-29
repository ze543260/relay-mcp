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
        setContent { TemaRelay { Raiz(vm) } }
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
                else -> TelaPrincipal(vm, estado)
            }
        }
        AvisoAtualizacao()
    }
}
