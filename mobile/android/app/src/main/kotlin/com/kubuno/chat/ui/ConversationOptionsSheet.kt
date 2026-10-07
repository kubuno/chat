package com.kubuno.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * The per-conversation menu behind the "Options" swipe action.
 *
 * Everything here maps to something the module actually implements: the member
 * settings (pin, favourite, mute, mark-unread, archive) and the one destructive
 * route, clear.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationOptionsSheet(
    row: UiConversation,
    onDismiss: () -> Unit,
    onTogglePin: () -> Unit,
    onToggleFavorite: () -> Unit,
    onToggleMute: () -> Unit,
    onMarkUnread: () -> Unit,
    onArchive: () -> Unit,
    onClear: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = ChatShapes.Sheet) {
        Text(
            text = row.title,
            style = ChatType.HeaderTitle,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
        )
        OptionRow(Icons.Filled.PushPin, if (row.isPinned) "Détacher" else "Épingler") {
            onTogglePin(); onDismiss()
        }
        OptionRow(Icons.Filled.Star, if (row.isFavorite) "Retirer des favoris" else "Ajouter aux favoris") {
            onToggleFavorite(); onDismiss()
        }
        OptionRow(Icons.Filled.NotificationsOff, if (row.isMuted) "Réactiver les notifications" else "Mettre en sourdine") {
            onToggleMute(); onDismiss()
        }
        OptionRow(Icons.Filled.MarkChatUnread, "Marquer comme non lue") {
            onMarkUnread(); onDismiss()
        }
        OptionRow(
            if (row.isArchived) Icons.Filled.Unarchive else Icons.Filled.Archive,
            if (row.isArchived) "Désarchiver" else "Archiver",
        ) {
            onArchive(); onDismiss()
        }
        OptionRow(Icons.Filled.Delete, "Effacer la discussion", MaterialTheme.colorScheme.error) {
            onClear(); onDismiss()
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun OptionRow(
    icon: ImageVector,
    label: String,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = ChatDims.Gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, style = ChatType.ConversationTitle, color = tint)
    }
}
