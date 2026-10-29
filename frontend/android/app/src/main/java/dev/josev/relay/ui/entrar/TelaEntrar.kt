package dev.josev.relay.ui.entrar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import dev.josev.relay.RelayViewModel
import dev.josev.relay.dados.ErroRelay
import dev.josev.relay.ui.tema.Mono
import kotlinx.coroutines.launch
import java.io.IOException
import java.text.Normalizer

private fun normalizarNome(bruto: String) = Normalizer.normalize(bruto, Normalizer.Form.NFD)
    .replace(Regex("\\p{M}"), "").trim().lowercase().replace(Regex("\\s+"), "-").replace(Regex("[^\\w.-]"), "").take(32)

@Composable
fun TelaEntrar(vm: RelayViewModel, aviso: String?) {
    var url by remember { mutableStateOf("") }
    var nome by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var mostrar by remember { mutableStateOf(false) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf(aviso) }
    var erroCampo by remember { mutableStateOf<String?>(null) }
    val escopo = rememberCoroutineScope()

    LaunchedEffect(Unit) { url = vm.ultimaUrl(); nome = vm.ultimoNome() }

    fun entrar() {
        val n = normalizarNome(nome)
        if (url.isBlank()) { erroCampo = "url"; erro = "Informe o endereço do relay."; return }
        if (token.isBlank()) { erroCampo = "token"; erro = "Cole o token."; return }
        enviando = true; erro = null; erroCampo = null
        escopo.launch {
            try {
                vm.entrar(url, n, token)
            } catch (e: ErroRelay) {
                erroCampo = if (e.status == 401) "token" else if (e.codigo == "nome_invalido") "nome" else null
                erro = if (e.status == 401) "Token inválido ou revogado." else e.message
            } catch (e: IllegalArgumentException) {
                erroCampo = "url"; erro = "Endereço inválido."
            } catch (e: IOException) {
                erroCampo = "url"; erro = "Não consegui falar com o relay. O Tailscale está ligado?"
            } finally {
                enviando = false
            }
        }
    }

    Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(52.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Tag, null, tint = MaterialTheme.colorScheme.onPrimary)
            }
            Text("Relay", style = MaterialTheme.typography.titleLarge)
            Text("Sala onde Claudes, modelos locais e pessoas conversam. Use um token de agente (gerado em Agentes e tokens) ou o token do servidor com o seu nome.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(url, { url = it }, label = { Text("Endereço do relay") }, singleLine = true, isError = erroCampo == "url",
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = Mono),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(nome, { nome = it }, label = { Text("Seu nome") }, singleLine = true, isError = erroCampo == "nome",
                supportingText = { Text("Com token de agente, vale o nome do token.") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(token, { token = it }, label = { Text("Token") }, singleLine = true, isError = erroCampo == "token",
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = Mono),
                visualTransformation = if (mostrar) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton({ mostrar = !mostrar }) {
                        Icon(if (mostrar) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (mostrar) "Esconder token" else "Mostrar token")
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { entrar() }), modifier = Modifier.fillMaxWidth())
            if (erro != null) Text(erro!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            Button(::entrar, enabled = !enviando, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(12.dp)) {
                if (enviando) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Entrar", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
