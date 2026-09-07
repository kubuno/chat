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
fun ChatBottomBar(selected: ChatTab, unread: Int, onSelect: (ChatTab) -> Unit) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        ChatTab.entries.forEach { tab ->
            NavigationBarItem(
                selected = selected == tab,
                onClick = { onSelect(tab) },
                icon = {
                    if (tab == ChatTab.Chats && unread > 0) {
                        BadgedBox(badge = { Badge { Text(if (unread > 99) "99+" else "$unread") } }) {
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
 * The Appels tab.
 *
 * The module keeps no call history — calls are signalling only, nothing is
 * recorded — so instead of inventing an empty log this lists the people you can
 * call, which is what the tab is actually for.
 */
@Composable
fun CallsScreen(
    conversations: List<UiConversation>,
    onCall: (UiConversation, Boolean) -> Unit,
) {
    val direct = conversations.filter { !it.isGroup }.sortedByDescending { it.lastActivityMs }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        LargeTitle("Appels")
        Text(
            text = "Votre instance ne conserve pas d'historique d'appels : rien n'est enregistré côté serveur.",
            style = ChatType.RowTime,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))
        if (direct.isEmpty()) {
            Placeholder(Icons.Filled.Call, "Personne à appeler", "Démarrez d'abord une discussion.")
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
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
