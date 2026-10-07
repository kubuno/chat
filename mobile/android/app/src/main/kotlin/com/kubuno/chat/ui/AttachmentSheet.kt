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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** What the user can attach. Poll and contact land in later milestones. */
enum class AttachmentKind { Gallery, Camera, Document, Audio, Poll, Contact }

private data class Entry(
    val kind: AttachmentKind,
    val label: String,
    val icon: ImageVector,
    val tint: Color,
    val enabled: Boolean = true,
)

/**
 * The attachment drawer: a grid of round, colour-coded icons.
 *
 * The colour coding is the point — people reach for "the purple one" long
 * before they read the label, which is why every messenger uses a distinct hue
 * per type rather than a uniform accent.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentSheet(
    onDismiss: () -> Unit,
    onPick: (AttachmentKind) -> Unit,
) {
    val entries = listOf(
        Entry(AttachmentKind.Gallery, "Galerie", Icons.Filled.Image, Color(0xFFB042F5)),
        Entry(AttachmentKind.Camera, "Appareil photo", Icons.Filled.PhotoCamera, Color(0xFFE8437A)),
        Entry(AttachmentKind.Document, "Document", Icons.Filled.Description, Color(0xFF6C63FF)),
        Entry(AttachmentKind.Audio, "Audio", Icons.Filled.Headphones, Color(0xFFE8710A)),
        Entry(AttachmentKind.Poll, "Sondage", Icons.Filled.Poll, Color(0xFFF2B01E)),
        Entry(AttachmentKind.Contact, "Contact", Icons.Filled.Person, Color(0xFF1E88E5), enabled = false),
    )

    ModalBottomSheet(onDismissRequest = onDismiss, shape = ChatShapes.Sheet) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
            entries.chunked(3).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    row.forEach { entry ->
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .clickable(enabled = entry.enabled) { onPick(entry.kind) }
                                .padding(vertical = 12.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(54.dp)
                                    .clip(RoundedCornerShape(18.dp))
                                    .background(
                                        entry.tint.copy(alpha = if (entry.enabled) 1f else 0.35f)
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    entry.icon,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(26.dp),
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = entry.label,
                                style = ChatType.RowTime,
                                textAlign = TextAlign.Center,
                                color = if (entry.enabled) MaterialTheme.colorScheme.onSurface
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    // Keep the last short row aligned on the same 3 columns.
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
