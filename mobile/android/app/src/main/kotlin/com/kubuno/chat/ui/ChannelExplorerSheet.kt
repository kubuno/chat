package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.kubuno.chat.net.ChannelInfo

/**
 * The "Explorer" directory of public channels, behind the Chaînes section's
 * Explore button. Lists what `/channels/browse` returns and follows one with a
 * single tap. Empty when the instance disables public spaces — which the
 * message says plainly rather than looking broken.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelExplorerSheet(
    state: ChatViewModel.ChannelExplorer,
    onQuery: (String) -> Unit,
    onJoin: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = ChatShapes.Sheet) {
        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            Text(
                text = "Explorer les chaînes",
                style = ChatType.HeaderTitle,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
            )
            TextField(
                value = state.query,
                onValueChange = onQuery,
                singleLine = true,
                placeholder = { Text("Rechercher une chaîne", style = ChatType.Preview) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                shape = ChatShapes.Chip,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                modifier = Modifier.fillMaxWidth().padding(horizontal = ChatDims.Gutter).heightIn(min = 48.dp),
            )
            Spacer(Modifier.height(8.dp))

            when {
                state.loading -> Box(
                    Modifier.fillMaxWidth().padding(32.dp),
                    Alignment.Center,
                ) { CircularProgressIndicator() }

                state.error != null -> Message(state.error)

                state.channels.isEmpty() -> Message(
                    if (state.query.isBlank())
                        "Aucune chaîne publique n'est proposée par votre instance."
                    else "Aucune chaîne ne correspond à « ${state.query} »."
                )

                else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
                    items(state.channels, key = { it.id }) { channel ->
                        ExplorerRow(
                            channel = channel,
                            joining = channel.id in state.joining,
                            onJoin = { onJoin(channel.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Message(text: String) {
    Text(
        text = text,
        style = ChatType.Preview,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 16.dp),
    )
}

@Composable
private fun ExplorerRow(channel: ChannelInfo, joining: Boolean, onJoin: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(ChatDims.Avatar)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Campaign,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(24.dp),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = channel.name ?: "Chaîne",
                style = ChatType.ConversationTitle,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = channel.description?.takeIf { it.isNotBlank() }
                    ?: "${channel.memberCount} abonné${if (channel.memberCount > 1) "s" else ""}",
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(8.dp))
        TextButton(
            onClick = onJoin,
            enabled = !joining,
        ) {
            Text(if (joining) "…" else "Suivre", color = MaterialTheme.colorScheme.primary)
        }
    }
}
