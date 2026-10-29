package dev.josev.relay.ui.comum

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.josev.relay.ui.tema.Tokens


/** Mesmo hash do web: a cor de cada nome é igual nos dois lugares. */
fun corDe(nome: String): Color {
    var h = 0L
    for (c in nome) h = (h * 31 + c.code) and 0xFFFFFFFFL
    return Tokens.agentes[(h % Tokens.agentes.size).toInt()]
}

fun siglaDe(nome: String) = nome.removePrefix("claude-").ifEmpty { nome }.take(2).uppercase()
fun ehIa(nome: String) = Regex("^(claude|gemma|qwen|llama|gpt)").containsMatchIn(nome)

@Composable
fun Avatar(nome: String, tamanho: Dp = 32.dp, modifier: Modifier = Modifier) {
    // IA = círculo, humano = quadrado arredondado (igual ao web).
    val forma = if (ehIa(nome)) CircleShape else RoundedCornerShape(tamanho * 0.25f)
    Box(modifier.size(tamanho).clip(forma).background(corDe(nome)), contentAlignment = Alignment.Center) {
        Text(siglaDe(nome), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (tamanho.value * 0.34f).sp)
    }
}
