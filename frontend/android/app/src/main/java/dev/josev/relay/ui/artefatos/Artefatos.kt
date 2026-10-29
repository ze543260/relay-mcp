package dev.josev.relay.ui.artefatos

import android.annotation.SuppressLint
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.Artefato
import dev.josev.relay.ui.comum.Markdown
import dev.josev.relay.ui.tema.Mono
import dev.josev.relay.ui.tema.Tokens

// Mesma CSP do web: o mockup não fala com a rede (nem fetch, nem imagem externa, nem form).
private const val CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

private fun icone(tipo: String) = when (tipo) {
    "html" -> Icons.Outlined.Code
    "svg" -> Icons.Outlined.Image
    "mermaid" -> Icons.Outlined.AccountTree
    else -> Icons.Outlined.Description
}

private fun rotuloEstado(e: String) = when (e) { "aprovado" -> "aprovado"; "arquivado" -> "arquivado"; else -> "rascunho" }

/** Aba Artefatos: lista da sala; tocar abre em tela cheia. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun Artefatos(vm: RelayViewModel, sala: String, eu: String, modifier: Modifier) {
    var lista by remember(sala) { mutableStateOf<List<Artefato>?>(null) }
    var carregando by remember { mutableStateOf(false) }
    var versao by remember { mutableIntStateOf(0) }
    val cores = MaterialTheme.colorScheme

    LaunchedEffect(sala, versao) {
        carregando = true
        runCatching { vm.artefatos() }.onSuccess { lista = it }.onFailure(vm::erro)
        carregando = false
    }

    Box(modifier.fillMaxSize()) {
        if (lista == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        PullToRefreshBox(carregando && lista != null, { versao++ }, Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                if (lista?.isEmpty() == true) item {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Nenhum artefato em #$sala", style = MaterialTheme.typography.titleMedium)
                        Text("Planos, diagramas e mockups que a equipe cria na conversa aparecem aqui.",
                            color = cores.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                    }
                }
                items(lista.orEmpty(), key = { it.id }) { a ->
                    Row(Modifier.fillMaxWidth().animateItem().clickable(onClickLabel = "Abrir artefato") { vm.abrirArtefato(a.id) }.padding(16.dp, 12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(40.dp).background(cores.surfaceContainerHigh, RoundedCornerShape(Tokens.Raio.lg)), contentAlignment = Alignment.Center) {
                            Icon(icone(a.tipo), null, tint = cores.primary)
                        }
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text("#${a.id} ${a.titulo}", fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text("${a.tipo} · v${a.versao} · ${rotuloEstado(a.estado)} · ${a.autorVersao ?: a.criadoPor}",
                                style = MaterialTheme.typography.bodyMedium, color = if (a.estado == "aprovado") dev.josev.relay.ui.tema.LocalExtras.current.ok else cores.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

/** Tela cheia (acima das abas), como perfil e tarefa. */
@Composable
fun TelaArtefato(vm: RelayViewModel, id: Long, eu: String, aoFechar: () -> Unit) {
    var a by remember(id) { mutableStateOf<Artefato?>(null) }
    LaunchedEffect(id) { runCatching { vm.artefato(id) }.onSuccess { a = it }.onFailure { vm.erro(it); aoFechar() } }
    val cores = MaterialTheme.colorScheme
    Surface(Modifier.fillMaxSize(), color = cores.background) {
        Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(aoFechar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Fechar artefato") }
                Column(Modifier.weight(1f)) {
                    Text(a?.titulo ?: "Carregando…", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    a?.let { Text("${it.tipo} · v${it.versao} · ${rotuloEstado(it.estado)}", style = MaterialTheme.typography.bodyMedium, color = cores.onSurfaceVariant) }
                }
            }
            val art = a ?: return@Column LinearProgressIndicator(Modifier.fillMaxWidth())
            val conteudo = art.conteudo.orEmpty()
            when (art.tipo) {
                "html" -> Isolado(documentoHtml(conteudo), comScript = true, Modifier.weight(1f))
                "svg" -> Isolado(documentoHtml("<img alt=\"\" style=\"max-width:100%\" src=\"data:image/svg+xml;charset=utf-8,${java.net.URLEncoder.encode(conteudo, "UTF-8").replace("+", "%20")}\">"),
                    comScript = false, Modifier.weight(1f))
                "mermaid" -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)) {
                    Text("O diagrama aparece desenhado no web; aqui vai o código.", color = cores.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    Text(conteudo, fontFamily = Mono, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp).fillMaxWidth().background(cores.surfaceContainerHigh, RoundedCornerShape(Tokens.Raio.md))
                            .horizontalScroll(rememberScrollState()).padding(12.dp))
                }
                else -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)) { Markdown(conteudo, eu) }
            }
        }
    }
}

private fun documentoHtml(corpo: String) =
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"$CSP\">" +
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body style=\"margin:0\">$corpo</body></html>"

/**
 * WebView isolada pro conteúdo de agente: sem rede, sem arquivos, sem ponte JS com o app, sem cookies
 * e origem nula. Script só no HTML (mockup); SVG roda sem script.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun Isolado(documento: String, comScript: Boolean, modifier: Modifier) {
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.apply {
                    javaScriptEnabled = comScript
                    blockNetworkLoads = true
                    allowFileAccess = false
                    allowContentAccess = false
                    domStorageEnabled = false
                    javaScriptCanOpenWindowsAutomatically = false
                    setSupportMultipleWindows(false)
                    cacheMode = WebSettings.LOAD_NO_CACHE
                }
                android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                setBackgroundColor(android.graphics.Color.WHITE)
                // Nada navega pra fora (links e formulários ficam presos no documento).
                webViewClient = object : android.webkit.WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: android.webkit.WebResourceRequest?) = true
                }
                loadDataWithBaseURL(null, documento, "text/html", "utf-8", null)
            }
        },
        modifier = modifier.fillMaxWidth(),
        onRelease = { it.destroy() },
    )
}
