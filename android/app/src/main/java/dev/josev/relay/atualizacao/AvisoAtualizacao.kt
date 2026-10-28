package dev.josev.relay.atualizacao

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Procura versão nova ao abrir o app e oferece atualizar. "Depois" esconde até a próxima abertura. */
@Composable
fun AvisoAtualizacao() {
    val ctx = LocalContext.current
    val escopo = rememberCoroutineScope()
    var versao by remember { mutableStateOf<Versao?>(null) }
    var progresso by remember { mutableStateOf<Float?>(null) }
    var erro by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { versao = runCatching { Atualizador.verificar() }.getOrNull() }

    val v = versao ?: return
    AlertDialog(
        onDismissRequest = { if (progresso == null) versao = null },
        title = { Text("Atualização disponível") },
        text = {
            Column {
                Text(v.nome, style = MaterialTheme.typography.titleSmall)
                if (v.notas.isNotBlank()) Text(v.notas, Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()),
                    style = MaterialTheme.typography.bodyMedium)
                progresso?.let { LinearProgressIndicator({ it }, Modifier.fillMaxWidth()) }
                erro?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = progresso == null, onClick = {
                if (!Atualizador.podeInstalar(ctx)) { Atualizador.pedirPermissao(ctx); return@TextButton }
                erro = null; progresso = 0f
                escopo.launch {
                    runCatching { Atualizador.instalar(ctx, v) { p -> progresso = p } }
                        .onFailure { erro = "Não deu pra baixar: ${it.message}" }
                    progresso = null
                }
            }) { Text(if (Atualizador.podeInstalar(ctx)) "Atualizar" else "Permitir instalação") }
        },
        dismissButton = { TextButton(enabled = progresso == null, onClick = { versao = null }) { Text("Depois") } },
    )
}
