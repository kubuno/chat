package com.kubuno.chat.ui

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kubuno.android.ui.components.KubunoButton
import com.kubuno.android.ui.components.KubunoButtonSize
import com.kubuno.android.ui.components.KubunoButtonVariant
import com.kubuno.android.ui.components.KubunoTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import com.kubuno.android.account.SharedAccount
import com.kubuno.chat.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Which "Vous" detail sheet is open. */
enum class YouSheet { Account, Devices, Notifications, Appearance, Storage, About, SwitchAccount }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YouDetailSheet(
    sheet: YouSheet,
    account: SharedAccount?,
    accounts: List<SharedAccount>,
    pushEnabled: Boolean,
    context: Context,
    onSelectAccount: (SharedAccount) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = ChatShapes.Sheet) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            when (sheet) {
                YouSheet.Account -> AccountSheet(account)
                YouSheet.SwitchAccount -> SwitchAccountSheet(account, accounts, onSelectAccount)
                YouSheet.Devices -> DevicesSheet()
                YouSheet.Notifications -> NotificationsSheet(pushEnabled)
                YouSheet.Appearance -> AppearanceSheet()
                YouSheet.Storage -> StorageSheet(context)
                YouSheet.About -> AboutSheet()
            }
        }
    }
}

@Composable
private fun SheetTitle(text: String) {
    Text(
        text = text,
        style = ChatType.HeaderTitle,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
    )
}

@Composable
private fun SheetBody(text: String) {
    Text(
        text = text,
        style = ChatType.Preview,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 6.dp),
    )
}

@Composable
private fun FieldRow(label: String, value: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = ChatDims.Gutter, vertical = 8.dp)) {
        Text(label, style = ChatType.RowTime, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(2.dp))
        Text(value, style = ChatType.ConversationTitle, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun AccountSheet(account: SharedAccount?) {
    SheetTitle("Compte")
    account?.displayName?.let { FieldRow("Nom", it) }
    account?.email?.let { FieldRow("E-mail", it) }
    account?.host?.let { FieldRow("Serveur", it) }
    Spacer(Modifier.height(8.dp))
    SheetBody(
        "Ce compte est géré par les autres applications Kubuno de cet appareil. " +
            "Pour ajouter ou retirer un compte, ou vous déconnecter, passez par Drive ou Mail — " +
            "la messagerie emprunte le compte, elle ne le détient pas."
    )
}

@Composable
private fun SwitchAccountSheet(
    current: SharedAccount?,
    accounts: List<SharedAccount>,
    onSelect: (SharedAccount) -> Unit,
) {
    SheetTitle("Changer de compte")
    accounts.forEach { acc ->
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onSelect(acc) }
                .padding(horizontal = ChatDims.Gutter, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChatAvatar(title = acc.label, url = null, seed = acc.userId, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(acc.label, style = ChatType.ConversationTitle, color = MaterialTheme.colorScheme.onSurface)
                Text(acc.host, style = ChatType.Preview, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (acc.systemName == current?.systemName) {
                Icon(Icons.Filled.Check, contentDescription = "Actuel", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun DevicesSheet() {
    SheetTitle("Appareils connectés")
    SheetBody(
        "Vos sessions et appareils Kubuno se gèrent depuis l'écran Compte de Drive ou de Mail, " +
            "où vous pouvez voir chaque session ouverte et en révoquer une. La messagerie partage " +
            "ces mêmes appareils : elle n'ouvre pas de session séparée."
    )
}

@Composable
private fun NotificationsSheet(pushEnabled: Boolean) {
    SheetTitle("Notifications")
    FieldRow("État", if (pushEnabled) "Activées" else "Aucun distributeur")
    Spacer(Modifier.height(4.dp))
    SheetBody(
        if (pushEnabled)
            "Les notifications passent par UnifiedPush (par ex. ntfy) — pas de service propriétaire. " +
                "Le contenu du message ne voyage jamais dans la notification : elle nomme l'expéditeur ou le groupe, rien de plus."
        else
            "Aucun distributeur UnifiedPush n'est installé, donc l'application n'a rien enregistré. " +
                "Installez un distributeur (par ex. ntfy) pour recevoir les nouveaux messages hors ligne ; " +
                "tout le reste continue de fonctionner sans lui."
    )
}

@Composable
private fun AppearanceSheet() {
    SheetTitle("Apparence")
    FieldRow("Thème", "Système")
    Spacer(Modifier.height(4.dp))
    SheetBody(
        "L'application suit le thème clair ou sombre de votre téléphone. " +
            "Un choix indépendant du système pourra être ajouté ici."
    )
}

@Composable
private fun StorageSheet(context: Context) {
    var cleared by remember { mutableStateOf(false) }
    val size by produceState(initialValue = -1L, cleared) {
        value = withContext(Dispatchers.IO) { dirSize(context.cacheDir) }
    }

    SheetTitle("Stockage et données")
    FieldRow(
        "Cache des médias",
        when {
            cleared -> "Vidé"
            size < 0 -> "Calcul…"
            else -> humanBytes(size)
        },
    )
    Spacer(Modifier.height(4.dp))
    SheetBody(
        "Les photos, vidéos et messages vocaux téléchargés sont mis en cache pour un accès rapide. " +
            "Les vider les retéléchargera à la demande ; aucun message n'est supprimé."
    )
    KubunoButton(
        text = "Vider le cache",
        onClick = {
            clearCache(context)
            cleared = true
        },
        variant = KubunoButtonVariant.TEXT,
        modifier = Modifier.padding(horizontal = 8.dp),
    )
}

@Composable
private fun AboutSheet() {
    SheetTitle("Aide et à propos")
    FieldRow("Application", "Kubuno Messages")
    FieldRow("Version", BuildConfig.VERSION_NAME)
    FieldRow("Licence", "GNU AGPL v3.0")
    Spacer(Modifier.height(8.dp))
    Text(
        text = "Confidentialité et chiffrement",
        style = ChatType.ConversationTitleUnread,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 6.dp),
    )
    SheetBody(
        "Ce module ne chiffre pas encore les messages de bout en bout : les corps de message " +
            "voyagent en base64 côté serveur. Cette application n'affiche donc nulle part le chiffrement " +
            "de bout en bout comme acquis, et ne publie ni ne récupère de clés. Quand le module livrera " +
            "un vrai protocole, c'est le seul endroit du code qui changera."
    )
}

// ----------------------------------------------------------------- helpers

private fun dirSize(dir: File?): Long {
    if (dir == null || !dir.exists()) return 0
    return dir.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
}

private fun clearCache(context: Context) {
    runCatching { context.cacheDir?.deleteRecursively() }
}

private fun humanBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes o"
    val units = listOf("Ko", "Mo", "Go")
    var value = bytes.toDouble() / 1024
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) { value /= 1024; unit++ }
    return String.format("%.1f %s", value, units[unit])
}
