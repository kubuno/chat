package com.kubuno.chat.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Two screens, one back stack step: the list, and a conversation on top of it.
 * Deliberately not Navigation Compose — the whole app is list ⇄ conversation,
 * and the socket lives in the shared ViewModel either way.
 */
@Composable
fun ChatApp(viewModel: ChatViewModel = hiltViewModel()) {
    val accounts by viewModel.accounts.collectAsStateWithLifecycle()
    val list by viewModel.list.collectAsStateWithLifecycle()
    val conversation by viewModel.conversation.collectAsStateWithLifecycle()

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
    ) { padding ->
        // Scaffold already insets for the status bar under enableEdgeToEdge;
        // adding statusBarsPadding() on top of it would double the gap.
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                accounts.isEmpty() -> NoAccount()

                conversation != null -> {
                    BackHandler { viewModel.closeConversation() }
                    ConversationScreen(
                        state = conversation!!,
                        onBack = viewModel::closeConversation,
                        onSend = viewModel::send,
                        onLoadOlder = viewModel::loadOlder,
                        onRetry = viewModel::retry,
                    )
                }

                else -> {
                    if (list.showArchived) {
                        BackHandler { viewModel.setShowArchived(false) }
                    }
                    ConversationListScreen(
                        state = list,
                        onOpen = viewModel::openConversation,
                        onFilter = viewModel::setFilter,
                        onQuery = viewModel::setQuery,
                        onShowArchived = viewModel::setShowArchived,
                        onTogglePin = viewModel::togglePin,
                        onRetry = viewModel::loadConversations,
                    )
                }
            }
        }
    }
}

/**
 * Chat is a consumer app: it never signs anyone in, it borrows the accounts a
 * sibling Kubuno app already registered with the system AccountManager.
 */
@Composable
private fun NoAccount() {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Aucun compte Kubuno sur cet appareil",
            style = ChatType.ConversationTitle,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Ouvrez Kubuno Drive ou Mail pour ajouter un compte, puis revenez.",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
