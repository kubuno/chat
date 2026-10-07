package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

/** The six emoji a long-press offers before the full picker. */
val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

/**
 * The long-press overlay: a row of quick reactions above the actions.
 *
 * Deliberately the modern pattern rather than the old "turn the header into an
 * action bar", because it keeps the message the user pressed on screen and in
 * context — the action bar hides it behind the toolbar.
 */
@Composable
fun MessageActionsOverlay(
    message: UiMessage,
    canEdit: Boolean,
    canDelete: Boolean,
    onDismiss: () -> Unit,
    onReact: (String) -> Unit,
    onReply: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onForward: () -> Unit,
    onPin: () -> Unit,
    onSelect: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Quick reactions
            Surface(
                shape = ChatShapes.Chip,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp,
                shadowElevation = 4.dp,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    QUICK_REACTIONS.forEach { emoji ->
                        val mine = emoji in message.myReactions
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(
                                    if (mine) MaterialTheme.colorScheme.primaryContainer
                                    else Color.Transparent
                                )
                                .clickable { onReact(emoji) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(emoji, fontSize = 22.sp)
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            Surface(
                shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp,
                shadowElevation = 4.dp,
            ) {
                Column(Modifier.padding(vertical = 6.dp)) {
                    ActionRow(Icons.AutoMirrored.Filled.Reply, "Répondre", onReply)
                    ActionRow(Icons.AutoMirrored.Filled.Send, "Transférer", onForward)
                    if (!message.deleted) {
                        ActionRow(Icons.Filled.ContentCopy, "Copier", onClick = {
                            clipboard.setText(AnnotatedString(message.preview()))
                            onDismiss()
                        })
                    }
                    ActionRow(
                        Icons.Filled.PushPin,
                        if (message.pinned) "Désépingler" else "Épingler",
                        onPin,
                    )
                    if (canEdit) ActionRow(Icons.Filled.Edit, "Modifier", onEdit)
                    ActionRow(Icons.Filled.Checklist, "Sélectionner", onSelect)
                    if (canDelete) {
                        ActionRow(
                            Icons.Filled.Delete,
                            "Supprimer",
                            onDelete,
                            tint = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    tint: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = Modifier
            .width(230.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, style = ChatType.Preview, color = tint)
    }
}

/** "Transférer à…": pick one conversation, WhatsApp-style. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForwardSheet(
    count: Int,
    targets: List<UiConversation>,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = ChatShapes.Sheet) {
        Text(
            text = if (count > 1) "Transférer $count messages à…" else "Transférer à…",
            style = ChatType.HeaderTitle,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
        )
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
            items(targets, key = { it.id }) { target ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(target.id) }
                        .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ChatAvatar(
                        title = target.title,
                        url = target.avatarUrl,
                        seed = target.id,
                        size = ChatDims.AvatarSmall,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = target.title,
                        style = ChatType.ConversationTitle,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}
