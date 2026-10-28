package dev.josev.relay.ui.conversa

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.josev.relay.dados.Anexo
import dev.josev.relay.ui.tema.Tokens

/** Carregar imagem (com o token) e baixar arquivo: fornecidos pelo ViewModel na tela. */
interface AcoesAnexo {
    suspend fun imagem(url: String): ImageBitmap?
    fun baixar(anexo: Anexo)
}

val LocalAcoesAnexo = staticCompositionLocalOf<AcoesAnexo?> { null }

fun ehImagem(tipo: String) = Regex("^image/(png|jpe?g|gif|webp|avif)$").matches(tipo)

fun tamanhoLegivel(b: Long): String = when {
    b < 1024 -> "$b B"
    b < 1024 * 1024 -> "${b / 1024} KB"
    else -> String.format(java.util.Locale("pt", "BR"), "%.1f MB", b / 1024.0 / 1024.0)
}

@Composable
private fun ImagemRemota(url: String, descricao: String, modifier: Modifier, escala: ContentScale) {
    val acoes = LocalAcoesAnexo.current
    val img by produceState<ImageBitmap?>(null, url) { value = acoes?.imagem(url) }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
        val i = img
        if (i == null) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        else Image(i, descricao, Modifier.fillMaxSize(), contentScale = escala)
    }
}

@Composable
fun ListaAnexos(anexos: List<Anexo>) {
    val acoes = LocalAcoesAnexo.current
    var aberta by remember { mutableStateOf<Anexo?>(null) }
    val imagens = anexos.filter { ehImagem(it.tipo) }
    val outros = anexos.filterNot { ehImagem(it.tipo) }
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        imagens.chunked(2).forEach { linha ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                linha.forEach { a ->
                    val forma = RoundedCornerShape(Tokens.Raio.bolha)
                    ImagemRemota(a.url, a.nome,
                        Modifier.then(if (imagens.size == 1) Modifier.widthIn(max = 280.dp).heightIn(max = 320.dp).aspectRatio(4f / 3) else Modifier.size(132.dp))
                            .clip(forma).border(1.dp, MaterialTheme.colorScheme.outlineVariant, forma).clickable { aberta = a },
                        ContentScale.Crop)
                }
            }
        }
        outros.forEach { a ->
            Row(
                Modifier.widthIn(max = 300.dp).fillMaxWidth().clip(RoundedCornerShape(Tokens.Raio.xl))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Tokens.Raio.xl))
                    .background(MaterialTheme.colorScheme.surfaceContainer).clickable { acoes?.baixar(a) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.InsertDriveFile, null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Text(a.nome, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(tamanhoLegivel(a.tamanho), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(Icons.Outlined.Download, "Baixar", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    aberta?.let { a ->
        Dialog(onDismissRequest = { aberta = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f)).clickable { aberta = null }, contentAlignment = Alignment.Center) {
                ImagemRemota(a.url, a.nome, Modifier.fillMaxWidth().aspectRatio(1f), ContentScale.Fit)
                IconButton({ acoes?.baixar(a) }, Modifier.align(Alignment.TopEnd).padding(16.dp)) {
                    Icon(Icons.Outlined.Download, "Baixar", tint = Color.White)
                }
            }
        }
    }
}
