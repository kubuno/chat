package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The chat that runs alongside a meeting call, so people can type without
 * leaving the video — the panel the Android call was missing next to the web's.
 *
 * It is the SAME conversation as the meeting room, so it has the same
 * capabilities as any group chat: messages are attributed to their sender,
 * arrive live over the shared socket, and are sent to the same conversation.
 * The room being a group, an incoming message shows who wrote it, coloured the
 * way group bubbles are.
 */
@Composable
fun InCallChatPanel(
    state: ConversationState?,
    onSend: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    // A slide-over on the right on a wide screen, full width on a phone.
    Box(Modifier.fillMaxSize().background(Color(0xCC0E1013))) {
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .fillMaxWidth()
                .widthIn(max = 520.dp)
                .background(Color(0xFF15181C))
                .imePadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().height(56.dp).padding(end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Fermer le chat", tint = Color.White)
                }
                Text(
                    text = "Chat de la réunion",
                    color = Color.White,
                    style = ChatType.HeaderTitle,
                )
            }

            val messages = state?.messages.orEmpty()
            val listState = rememberLazyListState()
            LaunchedEffect(messages.size) {
                if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
            }

            if (messages.isEmpty()) {
                Box(Modifier.weight(1f).fillMaxWidth(), Alignment.Center) {
                    Text(
                        "Aucun message. Écrivez pour lancer la discussion.",
                        color = Color(0xFF9AA0A6),
                        style = ChatType.Preview,
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                ) {
                    items(messages, key = { it.id }) { message ->
                        InCallMessage(message, isGroup = state?.isGroup == true, senderName = state?.senderLabel(message.senderId))
                    }
                }
            }

            Composer(onSend = onSend)
        }
    }
}

@Composable
private fun InCallMessage(message: UiMessage, isGroup: Boolean, senderName: String?) {
    val outgoing = message.outgoing
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalAlignment = if (outgoing) Alignment.End else Alignment.Start,
    ) {
        // Who wrote it — the whole point: an incoming message in a group names
        // and colours its sender, exactly like the group chat's bubbles.
        if (!outgoing && isGroup && !senderName.isNullOrBlank()) {
            Text(
                text = senderName,
                color = ChatColors.senderColor(message.senderId),
                style = ChatType.SenderName,
                modifier = Modifier.padding(start = 4.dp, bottom = 1.dp),
            )
        }
        Box(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .background(
                    if (outgoing) ChatColors.BubbleOut else Color(0xFF262A30),
                    RoundedCornerShape(14.dp),
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(
                text = message.preview(),
                color = Color.White,
                style = ChatType.Body,
            )
        }
    }
}

@Composable
private fun Composer(onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Row(
        modifier = Modifier.fillMaxWidth().padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Message", color = Color(0xFF9AA0A6)) },
            singleLine = true,
            shape = RoundedCornerShape(24.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color(0xFF262A30),
                unfocusedContainerColor = Color(0xFF262A30),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = {
                val t = text.trim()
                if (t.isNotEmpty()) { onSend(t); text = "" }
            }),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        val enabled = text.isNotBlank()
        Box(
            modifier = Modifier
                .size(48.dp)
                .background(
                    if (enabled) ChatColors.BubbleOut else Color(0xFF3A3F45),
                    RoundedCornerShape(50),
                ),
            contentAlignment = Alignment.Center,
        ) {
            IconButton(
                onClick = {
                    val t = text.trim()
                    if (t.isNotEmpty()) { onSend(t); text = "" }
                },
                enabled = enabled,
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Envoyer", tint = Color.White)
            }
        }
    }
}
