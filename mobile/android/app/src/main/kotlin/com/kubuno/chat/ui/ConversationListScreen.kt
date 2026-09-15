package com.kubuno.chat.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CheckCircleOutline
import androidx.compose.material.icons.filled.MarkChatRead
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
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
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.ui.components.KubunoChip

/**
 * The conversation list — the app's front door.
 *
 * Anatomy taken from WhatsApp: a compact action row (overflow, camera, new
 * chat), then a LARGE title, then the search pill, the filter chips, the
 * "Archivées" entry, and 72dp rows. The big title is the piece that makes the
 * screen recognisable at a glance; a conventional 56dp app bar reads as a
 * generic Material app instead.
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
    onMarkUnread: (String) -> Unit,
    onArchive: (String) -> Unit,
    onOptions: (UiConversation) -> Unit,
    onToggleSelected: (String) -> Unit,
    onStartSelection: () -> Unit,
    onEndSelection: () -> Unit,
    onMarkAllRead: () -> Unit,
    onArchiveSelected: () -> Unit,
    onReadSelected: () -> Unit,
    onClearSelected: () -> Unit,
    onRetry: () -> Unit,
    onReauth: () -> Unit,
    onNewChat: () -> Unit,
    onCamera: () -> Unit,
) {
    val rows = state.visible
    var confirmClear by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {

        when {
            state.selecting -> SelectionHeader(count = state.selection.size, onDone = onEndSelection)

            state.showArchived -> ArchivedHeader(onBack = { onShowArchived(false) })

            else -> {
                ActionRow(
                    onSelectChats = onStartSelection,
                    onMarkAllRead = onMarkAllRead,
                    onCamera = onCamera,
                    onNewChat = onNewChat,
                )
                Text(
                    text = "Discussions",
                    fontSize = 32.sp,
                    lineHeight = 38.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(start = ChatDims.Gutter, top = 2.dp, bottom = 10.dp),
                )
            }
        }

        if (!state.showArchived) {
            SearchField(query = state.query, onQuery = onQuery)
            // Filters make no sense while picking rows: they would hide the
            // very conversations already selected.
            if (!state.selecting) {
                FilterRow(
                    selected = state.filter,
                    unread = state.conversations.count { !it.isArchived && (it.isUnread || it.unreadCount > 0) },
                    onFilter = onFilter,
                )
            }
        }

        if (!state.connected && !state.loading) OfflineBanner()

        Box(Modifier.weight(1f)) {
            when {
                state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

                state.authExpired -> SessionExpiredState(
                    busy = state.reauthenticating,
                    onReauth = onReauth,
                )

                state.error != null -> ErrorState(state.error, onRetry)

                rows.isEmpty() -> EmptyState(
                    title = if (state.showArchived) "Aucune conversation archivée" else "Aucune conversation",
                    hint = if (state.showArchived) null else "Touchez + pour démarrer une discussion.",
                )

                else -> LazyColumn(Modifier.fillMaxSize()) {
                    if (!state.showArchived && state.archivedCount > 0) {
                        item(key = "archived") {
                            ArchivedRow(count = state.archivedCount, onClick = { onShowArchived(true) })
                        }
                    }
                    items(rows, key = { it.id }) { row ->
                        SwipeableConversationRow(
                            row = row,
                            selecting = state.selecting,
                            selected = row.id in state.selection,
                            onOpen = { if (state.selecting) onToggleSelected(row.id) else onOpen(row.id) },
                            onLongClick = { onToggleSelected(row.id) },
                            onMarkUnread = { onMarkUnread(row.id) },
                            onTogglePin = { onTogglePin(row.id) },
                            onOptions = { onOptions(row) },
                            onArchive = { onArchive(row.id) },
                            archiveLabel = if (state.showArchived) "Désarchiver" else "Archiver",
                        )
                        HorizontalDivider(
                            modifier = Modifier.padding(start = ChatDims.Gutter + ChatDims.Avatar + 12.dp),
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                        )
                    }
                }
            }
        }

        if (state.selecting) {
            SelectionBar(
                enabled = state.selection.isNotEmpty(),
                archiveLabel = if (state.showArchived) "Désarchiver" else "Archiver",
                onArchive = onArchiveSelected,
                onRead = onReadSelected,
                onClear = { confirmClear = true },
            )
        }
    }

    if (confirmClear) {
        ClearConversationsDialog(
            count = state.selection.size,
            onDismiss = { confirmClear = false },
            onConfirm = { confirmClear = false; onClearSelected() },
        )
    }
}

/** The row above the title: overflow on the left, camera and new-chat on the right. */
@Composable
private fun ActionRow(
    onSelectChats: () -> Unit,
    onMarkAllRead: () -> Unit,
    onCamera: () -> Unit,
    onNewChat: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .clickable { menuOpen = true },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.MoreHoriz,
                    contentDescription = "Plus",
                    tint = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.size(20.dp),
                )
            }
            // The menu hangs under the button it belongs to, which is what
            // makes it read as that button's menu rather than a screen menu.
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
                shape = RoundedCornerShape(14.dp),
            ) {
                DropdownMenuItem(
                    text = { Text("Sélectionner discussions", style = ChatType.ConversationTitle) },
                    trailingIcon = { Icon(Icons.Filled.CheckCircleOutline, contentDescription = null) },
                    onClick = { menuOpen = false; onSelectChats() },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
                DropdownMenuItem(
                    text = { Text("Tout lire", style = ChatType.ConversationTitle) },
                    trailingIcon = { Icon(Icons.Filled.MarkChatRead, contentDescription = null) },
                    onClick = { menuOpen = false; onMarkAllRead() },
                )
            }
        }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onCamera) {
            Icon(Icons.Filled.PhotoCamera, contentDescription = "Appareil photo")
        }
        Spacer(Modifier.width(4.dp))
        // The accent circle is the primary action of the whole screen, which is
        // why it sits in the header rather than floating over the list.
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .clickable(onClick = onNewChat),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Add,
                contentDescription = "Nouvelle discussion",
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(22.dp),
            )
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
            .padding(horizontal = ChatDims.Gutter)
            .heightIn(min = 48.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterRow(selected: ChatFilter, unread: Int, onFilter: (ChatFilter) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ChatDims.Gutter, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ChatFilter.entries.forEach { filter ->
            val label = when (filter) {
                ChatFilter.All -> "Toutes"
                ChatFilter.Unread -> if (unread > 0) "Non lues $unread" else "Non lues"
                ChatFilter.Favorites -> "Favoris"
                ChatFilter.Groups -> "Groupes"
            }
            KubunoChip(
                label = label,
                selected = selected == filter,
                onClick = { onFilter(filter) },
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConversationRow(
    row: UiConversation,
    selecting: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    // Horizontal shift of the row (reveals the swipe actions behind it), and
    // the drag gesture that produces it. They are split on purpose: the offset
    // is applied EARLY so the row's own background travels with it, while the
    // drag goes LAST so it wins the horizontal gesture — placed before the
    // click, the row's tap detector swallowed every drag.
    offsetX: () -> Int = { 0 },
    dragModifier: Modifier = Modifier,
) {
    val palette = ChatTheme.palette
    val unread = row.unreadCount > 0 || row.isUnread
    val last = row.lastMessage

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = ChatDims.RowHeight)
            .offset { IntOffset(offsetX(), 0) }
            // Opaque first, so the swipe actions drawn behind a row never show
            // through; the selection tint sits on top of that.
            .background(MaterialTheme.colorScheme.surface)
            .background(
                if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
                else Color.Transparent
            )
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .then(dragModifier)
            .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (selecting) {
            Icon(
                imageVector = if (selected) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked,
                contentDescription = if (selected) "Sélectionnée" else "Non sélectionnée",
                tint = if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outline,
                modifier = Modifier.size(24.dp),
            )
            Spacer(Modifier.width(12.dp))
        }
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
                last?.takeIf { it.outgoing && !it.deleted }?.let {
                    DeliveryTicks(
                        state = if (row.unreadCount == 0) DeliveryState.Read else DeliveryState.Sent,
                        palette = palette,
                    )
                    Spacer(Modifier.width(4.dp))
                }
                // An attachment shows its kind as an icon, the way a preview
                // line reads at a glance: "📷 Photo" rather than empty text.
                attachmentIcon(last)?.let { icon ->
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(15.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    text = row.typingLabel ?: previewLine(row),
                    style = ChatType.Preview,
                    color = if (row.typingLabel != null) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
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
                fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
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

/**
 * In a group, the preview names who spoke — without it, a busy group is a wall
 * of anonymous lines. Direct conversations already have the name in the title.
 */
private fun previewLine(row: UiConversation): String {
    val last = row.lastMessage ?: return ""
    val body = last.preview()
    if (!row.isGroup || last.outgoing || body.isBlank()) return body
    val speaker = row.senderNames[last.senderId] ?: return body
    return "$speaker : $body"
}

private fun attachmentIcon(message: UiMessage?): ImageVector? {
    val media = message?.content?.media ?: return null
    if (message.deleted) return null
    return when {
        media.voice -> Icons.Filled.Mic
        media.kind == "image" || media.kind == "sticker" || media.kind == "gif" -> Icons.Filled.Image
        media.kind == "video" -> Icons.Filled.Videocam
        media.kind == "audio" -> Icons.Filled.Headphones
        else -> Icons.AutoMirrored.Filled.InsertDriveFile
    }
}

@Composable
internal fun UnreadBadge(count: Int) {
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
            Text(hint, style = ChatType.Preview, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SessionExpiredState(busy: Boolean, onReauth: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Session expirée",
            style = ChatType.ConversationTitleUnread,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Reconnectez-vous pour continuer.",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        if (busy) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        } else {
            Text(
                "Se reconnecter",
                style = ChatType.ConversationTitle,
                color = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.primary)
                    .clickable(onClick = onReauth)
                    .padding(horizontal = 24.dp, vertical = 12.dp),
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

// ---------------------------------------------------------------- selection

/** Replaces the action row while picking conversations. */
@Composable
private fun SelectionHeader(count: Int, onDone: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
        Text(
            text = "Terminé",
            style = ChatType.ConversationTitle,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable(onClick = onDone)
                .padding(start = ChatDims.Gutter, top = 14.dp, bottom = 6.dp, end = 16.dp),
        )
        Text(
            text = when (count) {
                0 -> "Sélectionner"
                1 -> "1 sélectionnée"
                else -> "$count sélectionnées"
            },
            fontSize = 32.sp,
            lineHeight = 38.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(start = ChatDims.Gutter, bottom = 10.dp),
        )
    }
}

/** The three bulk actions, pinned to the bottom while picking. */
@Composable
private fun SelectionBar(
    enabled: Boolean,
    archiveLabel: String,
    onArchive: () -> Unit,
    onRead: () -> Unit,
    onClear: () -> Unit,
) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = ChatDims.Gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BulkAction(archiveLabel, enabled, MaterialTheme.colorScheme.onSurface, onArchive)
        Spacer(Modifier.weight(1f))
        BulkAction("Lire", enabled, MaterialTheme.colorScheme.onSurface, onRead)
        Spacer(Modifier.weight(1f))
        BulkAction("Effacer", enabled, MaterialTheme.colorScheme.error, onClear)
    }
}

@Composable
private fun BulkAction(label: String, enabled: Boolean, color: Color, onClick: () -> Unit) {
    Text(
        text = label,
        style = ChatType.ConversationTitle,
        color = if (enabled) color else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

/**
 * Asks before emptying conversations, and says exactly what that does here.
 *
 * The module has no "delete my copy": clearing removes the messages for every
 * member. Offering the action without saying so would be a trap.
 */
@Composable
private fun ClearConversationsDialog(count: Int, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (count <= 1) "Effacer cette discussion ?" else "Effacer $count discussions ?",
                style = ChatType.HeaderTitle,
            )
        },
        text = {
            Text(
                "Les messages seront supprimés pour tous les participants, pas seulement " +
                    "pour vous : votre instance ne propose pas d'effacement local. " +
                    "Cette action est définitive.",
                style = ChatType.Preview,
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("Effacer", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

// ------------------------------------------------------------ swipe actions

/**
 * A conversation row that reveals actions when dragged sideways: mark-unread
 * and pin to the right, options and archive to the left — the two gestures a
 * messaging list is expected to answer.
 *
 * Written by hand rather than with SwipeToDismissBox, which reveals a single
 * background per direction and so cannot show two distinct buttons on a side.
 */
@Composable
private fun SwipeableConversationRow(
    row: UiConversation,
    selecting: Boolean,
    selected: Boolean,
    onOpen: () -> Unit,
    onLongClick: () -> Unit,
    onMarkUnread: () -> Unit,
    onTogglePin: () -> Unit,
    onOptions: () -> Unit,
    onArchive: () -> Unit,
    archiveLabel: String,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val maxPx = with(density) { (SwipeActionWidth * 2).toPx() }
    // The live drag position is a plain float updated synchronously inside the
    // gesture, so the release handler reads the true offset. An Animatable
    // snapped from a coroutine per delta lags, and the release then reads a
    // stale zero — which is why a quick swipe used to spring straight back.
    var offset by remember { mutableFloatStateOf(0f) }
    val anim = remember { Animatable(0f) }
    // While an animation is running it owns the value; otherwise the finger does.
    var animating by remember { mutableStateOf(false) }
    val shown = if (animating) anim.value else offset

    fun settleTo(target: Float) {
        scope.launch {
            animating = true
            anim.snapTo(offset)
            anim.animateTo(target)
            offset = target
            animating = false
        }
    }

    // Picking rows and dragging them are different gestures; entering
    // multi-select closes whatever was open.
    LaunchedEffect(selecting) { if (selecting) { offset = 0f; settleTo(0f) } }

    fun close() = settleTo(0f)

    fun act(action: () -> Unit) {
        action()
        close()
    }

    Box(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.matchParentSize(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SwipeAction(
                label = if (row.isUnread || row.unreadCount > 0) "Lu" else "Non lu",
                icon = Icons.Filled.MarkChatUnread,
                container = MaterialTheme.colorScheme.primary,
                onClick = { act(onMarkUnread) },
            )
            SwipeAction(
                label = if (row.isPinned) "Détacher" else "Épingler",
                icon = Icons.Filled.PushPin,
                container = MaterialTheme.colorScheme.surfaceVariant,
                content = MaterialTheme.colorScheme.onSurfaceVariant,
                onClick = { act(onTogglePin) },
            )
            Spacer(Modifier.weight(1f))
            SwipeAction(
                label = "Options",
                icon = Icons.Filled.MoreHoriz,
                container = MaterialTheme.colorScheme.surfaceVariant,
                content = MaterialTheme.colorScheme.onSurfaceVariant,
                onClick = { act(onOptions) },
            )
            SwipeAction(
                label = archiveLabel,
                icon = Icons.Filled.Archive,
                container = MaterialTheme.colorScheme.primary,
                onClick = { act(onArchive) },
            )
        }

        ConversationRow(
            row = row,
            selecting = selecting,
            selected = selected,
            // A tap on an open row closes it rather than opening the
            // conversation, so the actions are never hit by accident.
            onClick = { if (shown != 0f) close() else onOpen() },
            onLongClick = onLongClick,
            offsetX = { shown.roundToInt() },
            dragModifier = Modifier
                .draggable(
                    enabled = !selecting,
                    orientation = Orientation.Horizontal,
                    // The delta is applied synchronously to a plain float, so
                    // the stop handler below reads the real position.
                    state = rememberDraggableState { delta ->
                        offset = (offset + delta).coerceIn(-maxPx, maxPx)
                    },
                    onDragStopped = {
                        // Past a third of the way the actions stay open; the
                        // rest of the time the row springs back.
                        settleTo(
                            when {
                                offset > maxPx / 3 -> maxPx
                                offset < -maxPx / 3 -> -maxPx
                                else -> 0f
                            }
                        )
                    },
                ),
        )
    }
}

@Composable
private fun SwipeAction(
    label: String,
    icon: ImageVector,
    container: Color,
    content: Color = MaterialTheme.colorScheme.onPrimary,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .width(SwipeActionWidth)
            .fillMaxHeight()
            .background(container)
            .clickable(onClick = onClick),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(4.dp))
        Text(label, style = ChatType.BubbleMeta, color = content, maxLines = 1)
    }
}

private val SwipeActionWidth = 84.dp
