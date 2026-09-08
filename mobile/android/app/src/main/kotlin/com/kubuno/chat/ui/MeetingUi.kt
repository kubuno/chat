package com.kubuno.chat.ui

import android.content.Context
import android.content.Intent
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
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Opens the Android share sheet with [text] — used to share a meeting link. */
fun shareText(context: Context, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
        putExtra(Intent.EXTRA_SUBJECT, "Réunion Kubuno")
    }
    context.startActivity(Intent.createChooser(intent, "Partager le lien de la réunion"))
}

/** Host controls for one meeting participant, reached by long-pressing a tile. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeetingHostSheet(
    name: String,
    onMute: () -> Unit,
    onRemove: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = ChatShapes.Sheet) {
        Column(Modifier.fillMaxWidth().padding(bottom = 20.dp)) {
            Text(
                name,
                style = ChatType.HeaderTitle,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
            )
            HostRow(Icons.AutoMirrored.Filled.VolumeOff, "Couper le micro", MaterialTheme.colorScheme.onSurface, onMute)
            HostRow(Icons.Filled.PersonRemove, "Retirer de la réunion", MaterialTheme.colorScheme.error, onRemove)
        }
    }
}

@Composable
private fun HostRow(icon: ImageVector, label: String, tint: Color, onClick: () -> Unit) {
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

/** Asks for a meeting name before creating it. */
@Composable
fun NewMeetingDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nouvelle réunion") },
        text = {
            Column {
                Text(
                    "Donnez un nom à la réunion. Vous obtiendrez un lien à partager ; " +
                        "toute personne de votre instance qui l'ouvre pourra rejoindre.",
                    style = ChatType.Preview,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                TextField(
                    value = name,
                    onValueChange = { name = it },
                    singleLine = true,
                    placeholder = { Text("Nom de la réunion") },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name.trim().ifBlank { "Réunion" }) },
            ) { Text("Créer et rejoindre") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}
