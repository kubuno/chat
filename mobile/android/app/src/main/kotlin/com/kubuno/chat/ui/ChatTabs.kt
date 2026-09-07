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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallMade
import androidx.compose.material.icons.filled.CallMissed
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.account.SharedAccount
import com.kubuno.chat.call.CallLog

/** The five destinations of the bottom bar. */
enum class ChatTab(val label: String, val icon: ImageVector) {
    Updates("Actus", Icons.Filled.RadioButtonChecked),
    Calls("Appels", Icons.Filled.Call),
    Communities("Communautés", Icons.Filled.Groups),
    Chats("Discussions", Icons.Filled.Chat),
    You("Vous", Icons.Filled.Person),
}

/**
 * Bottom navigation, WhatsApp's 2024 layout: the destinations moved down to
 * the thumb, with Discussions in the middle and its unread count on the icon.
 */
@Composable
fun ChatBottomBar(
    selected: ChatTab,
    unread: Int,
    missedCalls: Int,
    onSelect: (ChatTab) -> Unit,
) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        ChatTab.entries.forEach { tab ->
            val count = when (tab) {
                ChatTab.Chats -> unread
                ChatTab.Calls -> missedCalls
                else -> 0
            }
            NavigationBarItem(
                selected = selected == tab,
                onClick = { onSelect(tab) },
                icon = {
                    if (count > 0) {
                        BadgedBox(badge = { Badge { Text(if (count > 99) "99+" else "$count") } }) {
                            Icon(tab.icon, contentDescription = tab.label)
                        }
                    } else {
                        Icon(tab.icon, contentDescription = tab.label)
                    }
                },
                label = { Text(tab.label, style = ChatType.BubbleMeta, maxLines = 1) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.onSurface,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                ),
            )
        }
    }
}

/**
 * The Appels tab: this device's own call history, then whoever else can be
 * called.
 *
 * The history is local — see CallLog. The module signals calls and stores
 * nothing about them, so there is no server-side log to read and no way to see
 * calls answered on another device. Saying so on the screen is better than
 * letting the list look like a gap.
 */
@Composable
fun CallsScreen(
    history: List<CallLog.Entry>,
    conversations: List<UiConversation>,
    onCall: (UiConversation, Boolean) -> Unit,
) {
    val direct = conversations.filter { !it.isGroup }.sortedByDescending { it.lastActivityMs }
    val callable = direct.associateBy { it.otherUserId }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        LargeTitle("Appels")
        Text(
            text = "Historique local à cet appareil : votre instance n'enregistre rien côté serveur.",
            style = ChatType.RowTime,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))

        if (history.isEmpty() && direct.isEmpty()) {
            Placeholder(Icons.Filled.Call, "Personne à appeler", "Démarrez d'abord une discussion.")
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize()) {
            if (history.isNotEmpty()) {
                item(key = "recent-header") { SectionLabel("Récents") }
                items(history, key = { it.id }) { entry ->
                    CallHistoryRow(
                        entry = entry,
                        row = callable[entry.peerUserId],
                        onCall = onCall,
                    )
                }
            }
            if (direct.isNotEmpty()) {
                item(key = "contacts-header") { SectionLabel("Appeler") }
                items(direct, key = { it.id }) { row ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ChatAvatar(title = row.title, url = row.avatarUrl, seed = row.id)
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = row.title,
                            style = ChatType.ConversationTitle,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        RoundAction(Icons.Filled.Videocam, "Appel vidéo") { onCall(row, true) }
                        Spacer(Modifier.width(6.dp))
                        RoundAction(Icons.Filled.CallMade, "Appel audio") { onCall(row, false) }
                    }
                }
            }
        }
    }
}

/** One past call: who, which way it went, when, and how to call back. */
@Composable
private fun CallHistoryRow(
    entry: CallLog.Entry,
    row: UiConversation?,
    onCall: (UiConversation, Boolean) -> Unit,
) {
    val missed = entry.outcome == CallLog.Outcome.Missed
    val icon = when {
        missed -> Icons.Filled.CallMissed
        entry.incoming -> Icons.Filled.CallReceived
        else -> Icons.Filled.CallMade
    }
    val accent = if (missed) MaterialTheme.colorScheme.error
    else MaterialTheme.colorScheme.onSurfaceVariant

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ChatDims.Gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ChatAvatar(title = entry.peerName, url = row?.avatarUrl, seed = entry.peerUserId)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = entry.peerName,
                style = if (missed) ChatType.ConversationTitleUnread else ChatType.ConversationTitle,
                color = if (missed) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(4.dp))
                Text(
                    text = callSubtitle(entry),
                    style = ChatType.Preview,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        if (row != null) {
            RoundAction(
                if (entry.video) Icons.Filled.Videocam else Icons.Filled.Call,
                "Rappeler",
            ) { onCall(row, entry.video) }
        }
    }
}

private fun callSubtitle(entry: CallLog.Entry): String {
    val when_ = Timestamps.rowStamp(entry.startedAtMs)
    val kind = if (entry.video) "Vidéo" else "Audio"
    return when (entry.outcome) {
        CallLog.Outcome.Missed -> "$kind manqué · $when_"
        CallLog.Outcome.Declined -> "$kind refusé · $when_"
        CallLog.Outcome.NoAnswer -> "$kind sans réponse · $when_"
        CallLog.Outcome.Ringing -> "$kind en cours · $when_"
        CallLog.Outcome.Answered ->
            if (entry.durationSecs > 0) "$kind · ${duration(entry.durationSecs)} · $when_"
            else "$kind · $when_"
    }
}

private fun duration(seconds: Long): String {
    val m = seconds / 60
    val s = seconds % 60
    return if (m > 0) "$m min $s s" else "$s s"
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = ChatType.SenderName,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = ChatDims.Gutter, top = 12.dp, bottom = 4.dp),
    )
}

/** The Vous tab: who you are signed in as, and what this build does not claim. */
@Composable
fun YouScreen(account: SharedAccount?) {
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        LargeTitle("Vous")
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = ChatDims.Gutter, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChatAvatar(
                title = account?.label.orEmpty().ifBlank { "?" },
                url = null,
                seed = account?.userId.orEmpty(),
                size = 64.dp,
            )
            Spacer(Modifier.width(16.dp))
            Column {
                Text(
                    text = account?.label.orEmpty(),
                    style = ChatType.ConversationTitleUnread,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = account?.host.orEmpty(),
                    style = ChatType.Preview,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Text(
            text = "Le compte est géré par les autres applications Kubuno de cet appareil : " +
                "ajoutez ou retirez un compte depuis Drive ou Mail.",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
        )
        Text(
            text = "Ce module ne chiffre pas encore les messages de bout en bout. " +
                "L'application ne l'affiche donc nulle part comme acquis.",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
        )
    }
}

/** Actus and Communautés: nothing to show until the module grows them. */
@Composable
fun NotYetScreen(tab: ChatTab) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        LargeTitle(tab.label)
        Placeholder(
            icon = tab.icon,
            title = when (tab) {
                ChatTab.Updates -> "Pas encore de statuts"
                else -> "Pas encore de communautés"
            },
            hint = "Le module chat de votre instance ne fournit pas encore cette fonctionnalité.",
        )
    }
}

@Composable
private fun LargeTitle(text: String) {
    Text(
        text = text,
        fontSize = 32.sp,
        lineHeight = 38.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.padding(start = ChatDims.Gutter, top = 16.dp, bottom = 8.dp),
    )
}

@Composable
private fun RoundAction(icon: ImageVector, description: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun Placeholder(icon: ImageVector, title: String, hint: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outlineVariant,
            modifier = Modifier.size(56.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(title, style = ChatType.ConversationTitle, color = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.height(6.dp))
        Text(
            hint,
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
