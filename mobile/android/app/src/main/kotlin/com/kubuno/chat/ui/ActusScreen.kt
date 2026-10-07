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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.account.SharedAccount

/**
 * The "Actus" tab, in the anatomy of WhatsApp's Updates tab: a Statut section
 * on top, then a Chaînes section, both in one vertical scroll.
 *
 * Only Chaînes is real — the module has channel-type conversations and a public
 * directory (`/channels/browse`). It has no status/story feature, so rather
 * than fake a carousel of contacts' statuses, the Statut section states plainly
 * that statuses are not available yet. The camera and edit shortcuts of the
 * real tab are omitted for the same reason: they would post nothing.
 */
@Composable
fun ActusScreen(
    account: SharedAccount?,
    channels: List<UiConversation>,
    onOpenChannel: (String) -> Unit,
    onExplore: () -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface),
    ) {
        item("title") {
            Text(
                text = "Actus",
                fontSize = 32.sp,
                lineHeight = 38.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(start = ChatDims.Gutter, top = 16.dp, bottom = 8.dp),
            )
        }

        item("status") { StatusSection(account) }

        item("channels-header") {
            SectionHeader(
                title = "Chaînes",
                action = "Explorer",
                onAction = onExplore,
            )
        }

        if (channels.isEmpty()) {
            item("channels-empty") {
                Text(
                    text = "Vous ne suivez aucune chaîne. Touchez Explorer pour en découvrir.",
                    style = ChatType.Preview,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
                )
            }
        } else {
            items(channels, key = { it.id }) { channel ->
                ChannelRow(channel, onClick = { onOpenChannel(channel.id) })
            }
        }

        item("channels-footer") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onExplore)
                    .padding(horizontal = ChatDims.Gutter, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Filled.Explore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(22.dp),
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    "Trouvez des chaînes à suivre",
                    style = ChatType.ConversationTitle,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun StatusSection(account: SharedAccount?) {
    SectionHeader(title = "Statut")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ChatDims.Gutter, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The self avatar with a "+" badge — the one recognisable status
        // affordance. It carries no action yet: the note beside it says so.
        Box(contentAlignment = Alignment.BottomEnd) {
            ChatAvatar(
                title = account?.label.orEmpty().ifBlank { "?" },
                url = null,
                seed = account?.userId.orEmpty(),
                size = 56.dp,
            )
            Box(
                Modifier
                    .size(20.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(1.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "Statut",
                style = ChatType.ConversationTitle,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Les statuts arriveront quand le module de votre instance les proposera.",
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun SectionHeader(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = ChatDims.Gutter, end = 8.dp, top = 12.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = ChatType.ConversationTitleUnread,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.weight(1f))
        if (action != null && onAction != null) {
            Text(
                text = action,
                style = ChatType.ConversationTitle,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .clickable(onClick = onAction)
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun ChannelRow(channel: UiConversation, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Channels have no photo of a person: a broadcast glyph reads better
        // than initials for the ones without an avatar.
        if (channel.avatarUrl.isNullOrBlank()) {
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
        } else {
            ChatAvatar(title = channel.title, url = channel.avatarUrl, seed = channel.id)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = channel.title,
                style = if (channel.unreadCount > 0) ChatType.ConversationTitleUnread else ChatType.ConversationTitle,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = channel.previewText.ifBlank { channel.description ?: "Chaîne" },
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            if (channel.lastActivityMs > 0) {
                Text(
                    text = Timestamps.rowStamp(channel.lastActivityMs),
                    style = ChatType.RowTime,
                    color = if (channel.unreadCount > 0) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
            }
            if (channel.unreadCount > 0) UnreadBadge(channel.unreadCount)
        }
    }
}
