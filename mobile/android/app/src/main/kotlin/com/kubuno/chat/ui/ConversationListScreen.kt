package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The conversation list.
 *
 * Anatomy borrowed from WhatsApp's post-2024 design: a neutral (not tinted)
 * header, a persistent row of filter chips, an inline rounded search field,
 * the "Archivées" entry at the top of the list, then 72dp rows carrying
 * avatar / name / preview / time / unread badge. The colours are Kubuno's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationListScreen(
    state: ChatViewModel.ListState,
    onOpen: (String) -> Unit,
    onFilter: (ChatFilter) -> Unit,
    onQuery: (String) -> Unit,
    onShowArchived: (Boolean) -> Unit,
    onTogglePin: (String) -> Unit,
    onRetry: () -> Unit,
) {
    val rows = state.visible

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {

        if (state.showArchived) {
            ArchivedHeader(onBack = { onShowArchived(false) })
        } else {
            SearchField(query = state.query, onQuery = onQuery)
            FilterRow(
                selected = state.filter,
                unread = state.conversations.count { !it.isArchived && (it.isUnread || it.unreadCount > 0) },
                onFilter = onFilter,
            )
        }

        if (!state.connected && !state.loading) {
            OfflineBanner()
        }

        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

            state.error != null -> ErrorState(state.error, onRetry)

            rows.isEmpty() -> EmptyState(
                title = if (state.showArchived) "Aucune conversation archivée" else "Aucune conversation",
                hint = if (state.showArchived) null else "Démarrez une discussion depuis Kubuno sur le web.",
            )

            else -> LazyColumn(Modifier.fillMaxSize()) {
                if (!state.showArchived && state.archivedCount > 0) {
                    item(key = "archived") {
                        ArchivedRow(count = state.archivedCount, onClick = { onShowArchived(true) })
                    }
                }
                items(rows, key = { it.id }) { row ->
                    ConversationRow(
                        row = row,
                        onClick = { onOpen(row.id) },
                        onLongClick = { onTogglePin(row.id) },
                    )
                    HorizontalDivider(
                        modifier = Modifier.padding(start = ChatDims.Gutter + ChatDims.Avatar + 12.dp),
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit) {
    TextField(
        value = query,
        onValueChange = onQuery,
        singleLine = true,
        placeholder = { Text("Rechercher", style = ChatType.Preview) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        shape = ChatShapes.Chip,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterRow(selected: ChatFilter, unread: Int, onFilter: (ChatFilter) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ChatDims.Gutter, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ChatFilter.entries.forEach { filter ->
            val label = when (filter) {
                ChatFilter.All -> "Toutes"
                ChatFilter.Unread -> if (unread > 0) "Non lues $unread" else "Non lues"
                ChatFilter.Favorites -> "Favoris"
                ChatFilter.Groups -> "Groupes"
            }
            FilterChip(
                selected = selected == filter,
                onClick = { onFilter(filter) },
                label = { Text(label, style = ChatType.RowTime) },
                shape = ChatShapes.Chip,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
                border = null,
            )
        }
    }
}

@Composable
private fun ArchivedRow(count: Int, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = ChatDims.Gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Filled.Archive,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.width(ChatDims.Avatar - 24.dp + 12.dp))
        Text("Archivées", style = ChatType.ConversationTitle, color = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.weight(1f))
        Text(
            "$count",
            style = ChatType.RowTime,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ArchivedHeader(onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(ChatDims.HeaderHeight)
            .clickable(onClick = onBack)
            .padding(horizontal = ChatDims.Gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Archive, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(16.dp))
        Text("Archivées", style = ChatType.HeaderTitle, color = MaterialTheme.colorScheme.onSurface)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
}

@Composable
private fun ConversationRow(row: UiConversation, onClick: () -> Unit, onLongClick: () -> Unit) {
    val palette = ChatTheme.palette
    val unread = row.unreadCount > 0 || row.isUnread

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = ChatDims.RowHeight)
            .clickable(onClick = onClick)
            .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ChatAvatar(title = row.title, url = row.avatarUrl, seed = row.id)
        Spacer(Modifier.width(12.dp))

        Column(Modifier.weight(1f)) {
            Text(
                text = row.title,
                style = if (unread) ChatType.ConversationTitleUnread else ChatType.ConversationTitle,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Own last message: the ticks lead the preview, exactly as in
                // the conversation bubble.
                row.lastMessage?.takeIf { it.outgoing && !it.deleted }?.let {
                    DeliveryTicks(
                        state = if (row.unreadCount == 0) DeliveryState.Read else DeliveryState.Sent,
                        palette = palette,
                    )
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    text = row.typingLabel ?: row.previewText,
                    style = ChatType.Preview,
                    color = if (row.typingLabel != null) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = Timestamps.rowStamp(row.lastActivityMs),
                style = ChatType.RowTime,
                color = if (unread) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (row.isMuted) {
                    Icon(
                        Icons.Filled.VolumeOff,
                        contentDescription = "Silencieuse",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                }
                if (row.isPinned) {
                    Icon(
                        Icons.Filled.PushPin,
                        contentDescription = "Épinglée",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                }
                if (row.unreadCount > 0) UnreadBadge(row.unreadCount)
            }
        }
    }
}

@Composable
private fun UnreadBadge(count: Int) {
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = 20.dp, minHeight = 20.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (count > 99) "99+" else "$count",
            color = MaterialTheme.colorScheme.onPrimary,
            style = ChatType.BubbleMeta,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun OfflineBanner() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(horizontal = ChatDims.Gutter, vertical = 6.dp),
    ) {
        Text(
            "Connexion perdue — reconnexion en cours",
            style = ChatType.RowTime,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EmptyState(title: String, hint: String?) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Filled.Chat,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outlineVariant,
            modifier = Modifier.size(56.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(title, style = ChatType.ConversationTitle, color = MaterialTheme.colorScheme.onSurface)
        if (hint != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                hint,
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, style = ChatType.ConversationTitle, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(12.dp))
        Text(
            "Réessayer",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable(onClick = onRetry).padding(8.dp),
        )
    }
}
