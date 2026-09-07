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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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

    // Which messages a forward is about: the long-pressed one, or the selection.
    var forwarding by remember { mutableStateOf<List<UiMessage>>(emptyList()) }

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
                    val state = conversation!!
                    // Back peels one layer at a time, innermost first.
                    BackHandler {
                        when {
                            state.selecting -> viewModel.clearSelection()
                            state.search != null -> viewModel.closeSearch()
                            state.replyTo != null || state.editing != null -> viewModel.cancelCompose()
                            else -> viewModel.closeConversation()
                        }
                    }
                    ConversationScreen(
                        state = state,
                        onBack = viewModel::closeConversation,
                        onSend = viewModel::send,
                        onDraftChanged = viewModel::onDraftChanged,
                        onLoadOlder = viewModel::loadOlder,
                        onRetry = viewModel::retry,
                        onLongPress = viewModel::openActions,
                        onReply = viewModel::startReply,
                        onToggleSelect = viewModel::toggleSelect,
                        onClearSelection = viewModel::clearSelection,
                        onCancelCompose = viewModel::cancelCompose,
                        onDeleteSelected = {
                            state.messages.filter { it.id in state.selection }.forEach(viewModel::deleteMessage)
                            viewModel.clearSelection()
                        },
                        onForwardSelected = {
                            forwarding = state.messages.filter { it.id in state.selection }
                        },
                        onOpenSearch = viewModel::openSearch,
                        onCloseSearch = viewModel::closeSearch,
                        onSearch = viewModel::setSearch,
                        onStepSearch = viewModel::stepSearch,
                    )

                    state.actionTarget?.let { target ->
                        MessageActionsOverlay(
                            message = target,
                            canEdit = target.outgoing && !target.deleted,
                            canDelete = target.outgoing && !target.deleted,
                            onDismiss = viewModel::closeActions,
                            onReact = { viewModel.toggleReaction(target, it) },
                            onReply = { viewModel.startReply(target) },
                            onEdit = { viewModel.startEdit(target) },
                            onDelete = { viewModel.deleteMessage(target) },
                            onForward = {
                                viewModel.closeActions()
                                forwarding = listOf(target)
                            },
                            onPin = { viewModel.togglePinMessage(target) },
                            onSelect = { viewModel.toggleSelect(target) },
                        )
                    }

                    if (forwarding.isNotEmpty()) {
                        ForwardSheet(
                            count = forwarding.size,
                            targets = viewModel.forwardTargets(),
                            onDismiss = { forwarding = emptyList() },
                            onPick = { target ->
                                viewModel.forward(forwarding, target)
                                forwarding = emptyList()
                            },
                        )
                    }
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
