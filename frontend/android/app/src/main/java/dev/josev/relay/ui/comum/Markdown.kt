package dev.josev.relay.ui.comum

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.josev.relay.ui.tema.LocalExtras
import dev.josev.relay.ui.tema.Mono

/** Blocos de Markdown que a sala usa (GFM enxuto + LaTeX mostrado como fórmula em fonte mono). */
private sealed interface Bloco {
    data class Titulo(val nivel: Int, val texto: String) : Bloco
    data class Paragrafo(val texto: String) : Bloco
    data class Lista(val itens: List<String>, val numerada: Boolean) : Bloco
    data class Citacao(val texto: String) : Bloco
    data class Codigo(val linguagem: String, val texto: String) : Bloco
    data class Formula(val tex: String) : Bloco
    data class Tabela(val cabecalho: List<String>, val linhas: List<List<String>>) : Bloco
    data object Regua : Bloco
}

private fun celulas(linha: String) = linha.trim().trim('|').split('|').map { it.trim() }

private fun analisar(fonte: String): List<Bloco> {
    val linhas = fonte.replace("\r", "").lines()
    val blocos = mutableListOf<Bloco>()
    var i = 0
    val paragrafo = StringBuilder()
    fun fecharParagrafo() {
        if (paragrafo.isNotBlank()) blocos += Bloco.Paragrafo(paragrafo.toString().trim())
        paragrafo.clear()
    }
    while (i < linhas.size) {
        val l = linhas[i]
        val t = l.trim()
        when {
            t.startsWith("```") -> {
                fecharParagrafo()
                val lang = t.removePrefix("```").trim()
                val corpo = StringBuilder()
                i++
                while (i < linhas.size && !linhas[i].trim().startsWith("```")) { corpo.appendLine(linhas[i]); i++ }
                blocos += Bloco.Codigo(lang, corpo.toString().trimEnd())
            }
            t.startsWith("$$") -> {
                fecharParagrafo()
                if (t.length > 4 && t.endsWith("$$")) blocos += Bloco.Formula(t.removeSurrounding("$$").trim())
                else {
                    val corpo = StringBuilder(t.removePrefix("$$"))
                    i++
                    while (i < linhas.size && !linhas[i].contains("$$")) { corpo.appendLine(linhas[i]); i++ }
                    if (i < linhas.size) corpo.append(linhas[i].substringBefore("$$"))
                    blocos += Bloco.Formula(corpo.toString().trim())
                }
            }
            Regex("^#{1,6}\\s").containsMatchIn(t) -> {
                fecharParagrafo()
                blocos += Bloco.Titulo(t.takeWhile { it == '#' }.length, t.trimStart('#').trim())
            }
            t.startsWith("|") && i + 1 < linhas.size && Regex("^\\|?\\s*:?-{3,}").containsMatchIn(linhas[i + 1].trim()) -> {
                fecharParagrafo()
                val cab = celulas(t)
                i += 2
                val corpo = mutableListOf<List<String>>()
                while (i < linhas.size && linhas[i].trim().startsWith("|")) { corpo += celulas(linhas[i]); i++ }
                i--
                blocos += Bloco.Tabela(cab, corpo)
            }
            Regex("^([-*+]|\\d+[.)])\\s").containsMatchIn(t) -> {
                fecharParagrafo()
                val numerada = t.first().isDigit()
                val itens = mutableListOf<String>()
                while (i < linhas.size && Regex("^\\s*([-*+]|\\d+[.)])\\s").containsMatchIn(linhas[i])) {
                    itens += linhas[i].trim().replaceFirst(Regex("^([-*+]|\\d+[.)])\\s+"), ""); i++
                }
                i--
                blocos += Bloco.Lista(itens, numerada)
            }
            t.startsWith(">") -> {
                fecharParagrafo()
                val corpo = mutableListOf<String>()
                while (i < linhas.size && linhas[i].trim().startsWith(">")) { corpo += linhas[i].trim().removePrefix(">").trim(); i++ }
                i--
                blocos += Bloco.Citacao(corpo.joinToString("\n"))
            }
            Regex("^(-{3,}|\\*{3,})$").matches(t) -> { fecharParagrafo(); blocos += Bloco.Regua }
            t.isEmpty() -> fecharParagrafo()
            else -> paragrafo.appendLine(l)
        }
        i++
    }
    fecharParagrafo()
    return blocos
}

private val INLINE = Regex(
    "(`[^`]+`)|(\\$[^$\\n]+\\$)|(\\*\\*[^*]+\\*\\*)|(__[^_]+__)|(\\*[^*\\s][^*]*\\*)|(~~[^~]+~~)|(\\[[^\\]]+]\\((https?://[^)\\s]+)\\))|(@[\\w.-]+)"
)

/** Inline: `código`, $fórmula$, **negrito**, *itálico*, ~~riscado~~, [link](url), @menção. */
@Composable
private fun inline(texto: String, eu: String?): AnnotatedString {
    val cores = MaterialTheme.colorScheme
    val extras = LocalExtras.current
    return remember(texto, eu, cores.primary) {
        buildAnnotatedString {
            var pos = 0
            for (m in INLINE.findAll(texto)) {
                append(texto.substring(pos, m.range.first))
                val v = m.value
                when {
                    v.startsWith("`") -> withStyle(SpanStyle(fontFamily = Mono, fontSize = 13.sp, background = extras.codigo)) { append(" ${v.trim('`')} ") }
                    v.startsWith("$") -> withStyle(SpanStyle(fontFamily = Mono, fontStyle = FontStyle.Italic, color = cores.primary)) { append(v.trim('$')) }
                    v.startsWith("**") || v.startsWith("__") -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(v.drop(2).dropLast(2)) }
                    v.startsWith("~~") -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(v.drop(2).dropLast(2)) }
                    v.startsWith("*") -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(v.drop(1).dropLast(1)) }
                    v.startsWith("[") -> {
                        val rotulo = v.substringAfter('[').substringBefore("](")
                        val url = m.groupValues[8]
                        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = cores.primary, textDecoration = TextDecoration.Underline)))) { append(rotulo) }
                    }
                    v.startsWith("@") -> withStyle(SpanStyle(color = cores.primary, fontWeight = if (eu != null && v.drop(1).equals(eu, true)) FontWeight.Bold else FontWeight.Medium)) { append(v) }
                    else -> append(v)
                }
                pos = m.range.last + 1
            }
            append(texto.substring(pos))
        }
    }
}

@Composable
fun Markdown(texto: String, eu: String? = null, modifier: Modifier = Modifier, selecionavel: Boolean = false) {
    val blocos = remember(texto) { analisar(texto) }
    val cores = MaterialTheme.colorScheme
    val extras = LocalExtras.current
    val estilo = MaterialTheme.typography.bodyLarge
    // Sem seleção por padrão: segurar a mensagem abre as ações (copiar está lá).
    if (selecionavel) SelectionContainer(modifier) { Blocos(blocos, eu, estilo) } else Box(modifier) { Blocos(blocos, eu, estilo) }
}

@Composable
private fun Blocos(blocos: List<Bloco>, eu: String?, estilo: androidx.compose.ui.text.TextStyle) {
    val cores = MaterialTheme.colorScheme
    val extras = LocalExtras.current
    run {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (b in blocos) when (b) {
                is Bloco.Titulo -> Text(inline(b.texto, eu), style = estilo.copy(fontWeight = FontWeight.SemiBold, fontSize = if (b.nivel == 1) 17.sp else 15.5.sp))
                is Bloco.Paragrafo -> Text(inline(b.texto, eu), style = estilo)
                is Bloco.Lista -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    b.itens.forEachIndexed { n, item ->
                        Row {
                            Text(if (b.numerada) "${n + 1}." else "•", style = estilo, color = cores.onSurfaceVariant, modifier = Modifier.width(20.dp))
                            Text(inline(item, eu), style = estilo)
                        }
                    }
                }
                is Bloco.Citacao -> Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(Modifier.width(3.dp).fillMaxHeight().background(cores.outline, RoundedCornerShape(2.dp)))
                    Text(inline(b.texto, eu), style = estilo, color = cores.onSurfaceVariant, modifier = Modifier.padding(start = 10.dp))
                }
                is Bloco.Codigo -> Box(
                    Modifier.fillMaxWidth().background(extras.codigo, RoundedCornerShape(8.dp))
                        .border(1.dp, cores.outlineVariant, RoundedCornerShape(8.dp))
                        .horizontalScroll(rememberScrollState()).padding(10.dp)
                ) { Text(b.texto, fontFamily = Mono, fontSize = 12.5.sp, lineHeight = 18.sp) }
                is Bloco.Formula -> Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp)) {
                    Text(b.tex, fontFamily = Mono, fontStyle = FontStyle.Italic, color = cores.primary, fontSize = 14.sp)
                }
                is Bloco.Tabela -> Box(Modifier.horizontalScroll(rememberScrollState())) {
                    Column(Modifier.border(1.dp, cores.outlineVariant, RoundedCornerShape(6.dp))) {
                        (listOf(b.cabecalho) + b.linhas).forEachIndexed { n, linha ->
                            Row(Modifier.background(if (n == 0) extras.codigo else Color.Transparent)) {
                                linha.forEach { c ->
                                    Text(inline(c, eu), style = estilo.copy(fontSize = 13.5.sp, fontWeight = if (n == 0) FontWeight.SemiBold else FontWeight.Normal),
                                        modifier = Modifier.width(140.dp).padding(horizontal = 10.dp, vertical = 6.dp))
                                }
                            }
                        }
                    }
                }
                Bloco.Regua -> Box(Modifier.fillMaxWidth().height(1.dp).background(cores.outlineVariant))
            }
        }
    }
}

/** Uma linha de texto puro (citações, notificações). */
fun resumo(texto: String, max: Int = 120): String {
    val limpo = texto.replace(Regex("```[\\s\\S]*?```"), " [código] ")
        .replace(Regex("\\$\\$[\\s\\S]*?\\$\\$"), " [fórmula] ")
        .replace(Regex("(?m)^\\s*\\|?\\s*:?-{3,}.*$"), " ")
        .replace(Regex("[|#>*_`~$]"), " ").replace(Regex("\\s+"), " ").trim()
    return if (limpo.length > max) limpo.take(max - 1) + "…" else limpo
}
