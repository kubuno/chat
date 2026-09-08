package com.kubuno.chat.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kubuno.android.account.R

/**
 * Chat's own sign-in flow — server address, credentials, then a TOTP step when
 * the instance asks for it. [onDone] fires once the account is registered (and
 * thereby published to the system for the sibling apps to reuse). Shown when
 * chat has no usable account, or to re-authenticate one whose session died.
 */
@Composable
fun OnboardingScreen(
    onDone: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.done) { if (state.done) onDone() }

    when {
        state.totpSession != null -> TotpScreen(viewModel)
        state.serverValidated -> LoginScreen(viewModel)
        else -> ServerScreen(viewModel)
    }
}

@Composable
private fun OnboardingColumn(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        content()
    }
}

@Composable
private fun BusyButtonLabel(busy: Boolean, textRes: Int) {
    if (busy) CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
    else Text(stringResource(textRes))
}

@Composable
private fun ServerScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    OnboardingColumn {
        Text(stringResource(R.string.server_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.server_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = state.serverInput,
            onValueChange = viewModel::onServerInput,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text(stringResource(R.string.server_hint)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            isError = state.serverError != null,
            supportingText = { state.serverError?.let { Text(stringResource(it)) } },
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = viewModel::checkServer,
            enabled = !state.serverBusy && state.serverInput.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { BusyButtonLabel(state.serverBusy, R.string.server_continue) }
    }
}

@Composable
private fun LoginScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var login by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    OnboardingColumn {
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = login,
            onValueChange = { login = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text(stringResource(R.string.login_login_label)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text(stringResource(R.string.login_password_label)) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            isError = state.loginError != null,
            supportingText = { state.loginError?.let { Text(stringResource(it)) } },
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { viewModel.login(login, password) },
            enabled = !state.loginBusy && login.isNotBlank() && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
        ) { BusyButtonLabel(state.loginBusy, R.string.login_submit) }
        TextButton(onClick = viewModel::resetServer) {
            Text(stringResource(R.string.login_change_server))
        }
    }
}

@Composable
private fun TotpScreen(viewModel: OnboardingViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var code by rememberSaveable { mutableStateOf("") }

    OnboardingColumn {
        Text(stringResource(R.string.totp_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.totp_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.filter(Char::isDigit).take(8) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text(stringResource(R.string.totp_code_label)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            isError = state.totpError != null,
            supportingText = { state.totpError?.let { Text(stringResource(it)) } },
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { viewModel.verifyTotp(code) },
            enabled = !state.totpBusy && code.length >= 6,
            modifier = Modifier.fillMaxWidth(),
        ) { BusyButtonLabel(state.totpBusy, R.string.totp_submit) }
    }
}
