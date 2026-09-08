package com.kubuno.chat.ui.onboarding

import android.content.Context
import android.os.Build
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kubuno.android.account.AccountClients
import com.kubuno.android.account.AccountId
import com.kubuno.android.account.AccountRegistry
import com.kubuno.android.account.R
import com.kubuno.android.api.KubunoClient
import com.kubuno.android.api.auth.LoginOutcome
import com.kubuno.android.api.auth.TokenManager
import com.kubuno.android.api.model.DeclareDeviceRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OnboardingUiState(
    val serverInput: String = "",
    val serverBusy: Boolean = false,
    @param:StringRes val serverError: Int? = null,
    val serverValidated: Boolean = false,
    val loginBusy: Boolean = false,
    @param:StringRes val loginError: Int? = null,
    val totpSession: String? = null,
    val totpBusy: Boolean = false,
    @param:StringRes val totpError: Int? = null,
    /** True once the account is registered — leave onboarding. */
    val done: Boolean = false,
)

/**
 * Signs into one instance and registers the result as a shared account.
 *
 * Chat runs the SAME flow the other Kubuno apps do: it becomes the account's
 * owner, keeps the refresh token in its own encrypted store, and — through
 * [AccountRegistry] and the account bridge already installed in the app —
 * publishes the account to the system's AccountManager, where the sibling apps
 * discover it and borrow access tokens. So an account signed into here is
 * usable by them all, and one they registered is usable here.
 *
 * Deliberately independent of any sync engine: chat has none, and the flow only
 * touches the shared account layer.
 */
@HiltViewModel
class OnboardingViewModel @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val registry: AccountRegistry,
    private val clients: AccountClients,
) : ViewModel() {

    private val _state = MutableStateFlow(OnboardingUiState())
    val state: StateFlow<OnboardingUiState> = _state

    private var pending: PendingSignIn? = null

    private class PendingSignIn(
        val accountId: AccountId,
        val serverUrl: String,
        val client: KubunoClient,
    ) {
        val tokens: TokenManager get() = client.tokenManager
    }

    fun onServerInput(value: String) {
        _state.update { it.copy(serverInput = value, serverError = null) }
    }

    fun checkServer() {
        val input = _state.value.serverInput.trim()
        if (input.isEmpty()) return
        _state.update { it.copy(serverBusy = true, serverError = null) }
        viewModelScope.launch {
            val url = KubunoClient.normalize(input)
            val candidate = AccountId(UUID.randomUUID().toString())
            val client = clients.probe(url, candidate)
            val reachable = try {
                client.authApi.health().isSuccessful
            } catch (e: IOException) {
                false
            } catch (e: IllegalArgumentException) {
                false
            }
            if (reachable) {
                pending = PendingSignIn(candidate, url, client)
                _state.update { it.copy(serverBusy = false, serverValidated = true) }
            } else {
                client.shutdown()
                _state.update { it.copy(serverBusy = false, serverError = R.string.server_error_unreachable) }
            }
        }
    }

    fun resetServer() {
        pending?.client?.shutdown()
        pending = null
        _state.update { it.copy(serverValidated = false, loginError = null, totpSession = null) }
    }

    fun login(loginText: String, password: String) {
        val attempt = pending ?: return
        if (loginText.isBlank() || password.isEmpty()) return
        _state.update { it.copy(loginBusy = true, loginError = null) }
        viewModelScope.launch {
            val outcome = attempt.tokens.login(loginText.trim(), password, deviceName())
            handleOutcome(attempt, outcome, isTotpStep = false)
        }
    }

    fun verifyTotp(code: String) {
        val attempt = pending ?: return
        val session = _state.value.totpSession ?: return
        if (code.isBlank()) return
        _state.update { it.copy(totpBusy = true, totpError = null) }
        viewModelScope.launch {
            val outcome = attempt.tokens.verifyTotp(code.trim(), session)
            handleOutcome(attempt, outcome, isTotpStep = true)
        }
    }

    private suspend fun handleOutcome(attempt: PendingSignIn, outcome: LoginOutcome, isTotpStep: Boolean) {
        when (outcome) {
            is LoginOutcome.Success -> {
                val user = outcome.user
                if (user == null) {
                    _state.update { it.copy(loginBusy = false, totpBusy = false, loginError = R.string.login_error_server) }
                    return
                }
                val record = registry.upsert(
                    serverUrl = attempt.serverUrl,
                    userId = user.id,
                    email = user.email,
                    displayName = user.displayName ?: user.username,
                    avatarPath = user.avatarUrl,
                )
                if (record.id != attempt.accountId) {
                    clients.store(attempt.accountId).load()?.let { tokens ->
                        clients.store(record.id).save(tokens)
                    }
                    clients.store(attempt.accountId).clear()
                }
                declareDevice(attempt)
                attempt.client.shutdown()
                pending = null
                registry.setActive(record.id)
                _state.update { it.copy(loginBusy = false, totpBusy = false, done = true) }
            }
            is LoginOutcome.TotpRequired ->
                _state.update { it.copy(loginBusy = false, totpBusy = false, totpSession = outcome.totpSession) }
            is LoginOutcome.Failure -> {
                val message = when {
                    outcome.httpCode == null -> R.string.login_error_network
                    outcome.httpCode in listOf(400, 401, 403, 422) ->
                        if (isTotpStep) R.string.totp_error else R.string.login_error_credentials
                    else -> R.string.login_error_server
                }
                _state.update {
                    if (isTotpStep) it.copy(totpBusy = false, totpError = message)
                    else it.copy(loginBusy = false, loginError = message)
                }
            }
        }
    }

    fun restart() {
        pending?.client?.shutdown()
        pending = null
        _state.value = OnboardingUiState()
    }

    private suspend fun declareDevice(attempt: PendingSignIn) {
        runCatching {
            attempt.client.authApi.declareDevice(
                DeclareDeviceRequest(
                    platform = "android",
                    platformVersion = Build.VERSION.RELEASE,
                    appVersion = appVersion(),
                )
            )
        }
    }

    private fun appVersion(): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull() ?: "unknown"

    private fun deviceName(): String {
        val model = Build.MODEL.orEmpty()
        val manufacturer = Build.MANUFACTURER.orEmpty()
        return when {
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }.trim().ifEmpty { "Android" }
    }
}
