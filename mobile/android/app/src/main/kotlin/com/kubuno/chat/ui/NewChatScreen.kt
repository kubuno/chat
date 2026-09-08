package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.chat.net.UserSuggestion

/**
 * "Nouvelle discussion": search people, tap one to open a direct conversation,
 * or switch to group mode and pick several.
 *
 * The people come from the CORE's /users/search, not from the chat module — the
 * module knows conversations, the core knows who exists.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(
    state: ChatViewModel.NewChatState,
    onBack: () -> Unit,
    onQuery: (String) -> Unit,
    onPickDirect: (UserSuggestion) -> Unit,
    onToggleMember: (UserSuggestion) -> Unit,
    onSetGroupMode: (Boolean) -> Unit,
    onGroupName: (String) -> Unit,
    onCreateGroup: () -> Unit,
    onNewMeeting: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).imePadding()) {

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = ChatDims.HeaderHeight)
                .padding(end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = if (state.groupMode) "Nouveau groupe" else "Nouvelle discussion",
                    style = ChatType.HeaderTitle,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (state.groupMode) {
                    Text(
                        text = "${state.selected.size} participant${if (state.selected.size > 1) "s" else ""}",
                        style = ChatType.HeaderSub,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (state.groupMode && state.selected.isNotEmpty() && state.groupName.isNotBlank()) {
                IconButton(onClick = onCreateGroup, enabled = !state.creating) {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = "Créer le groupe",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }

        if (!state.groupMode) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSetGroupMode(true) }
                    .padding(horizontal = ChatDims.Gutter, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(ChatDims.Avatar)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Groups,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    "Nouveau groupe",
                    style = ChatType.ConversationTitle,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onNewMeeting)
                    .padding(horizontal = ChatDims.Gutter, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(ChatDims.Avatar)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Videocam,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    "Nouvelle réunion",
                    style = ChatType.ConversationTitle,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        } else {
            TextField(
                value = state.groupName,
                onValueChange = onGroupName,
                singleLine = true,
                placeholder = { Text("Nom du groupe", style = ChatType.Preview) },
                shape = ChatShapes.Chip,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                modifier = Modifier.fillMaxWidth().padding(horizontal = ChatDims.Gutter, vertical = 4.dp),
            )
            if (state.selected.isNotEmpty()) {
                LazyRow(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = ChatDims.Gutter),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(state.selected, key = { it.id }) { person ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box {
                                ChatAvatar(
                                    title = person.displayName ?: person.username,
                                    url = person.avatarUrl,
                                    seed = person.id,
                                    size = ChatDims.AvatarSmall,
                                )
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .size(18.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.surface)
                                        .clickable { onToggleMember(person) },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        Icons.Filled.Close,
                                        contentDescription = "Retirer",
                                        modifier = Modifier.size(12.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = (person.displayName ?: person.username).take(10),
                                style = ChatType.BubbleMeta,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }

        TextField(
            value = state.query,
            onValueChange = onQuery,
            singleLine = true,
            placeholder = { Text("Rechercher une personne", style = ChatType.Preview) },
            shape = ChatShapes.Chip,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = ChatDims.Gutter, vertical = 6.dp),
        )

        when {
            state.searching -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }

            state.results.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), Alignment.Center) {
                Text(
                    if (state.query.isBlank())
                        "Personne d'autre dans votre unité organisationnelle."
                    else "Personne ne correspond dans votre unité.",
                    style = ChatType.Preview,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            else -> LazyColumn(Modifier.fillMaxSize()) {
                // Before any search, the list IS the unit directory; a labelled
                // header says so, the way WhatsApp titles its contact groups.
                if (state.query.isBlank()) {
                    item("directory-header") {
                        Text(
                            "Contacts de votre unité",
                            style = ChatType.SenderName,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = ChatDims.Gutter, top = 8.dp, bottom = 4.dp),
                        )
                    }
                }
                items(state.results, key = { it.id }) { person ->
                    val picked = state.selected.any { it.id == person.id }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                if (state.groupMode) onToggleMember(person) else onPickDirect(person)
                            }
                            .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ChatAvatar(
                            title = person.displayName ?: person.username,
                            url = person.avatarUrl,
                            seed = person.id,
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = person.displayName ?: person.username,
                                style = ChatType.ConversationTitle,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = person.username,
                                style = ChatType.RowTime,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (state.groupMode && picked) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = "Sélectionné",
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}
