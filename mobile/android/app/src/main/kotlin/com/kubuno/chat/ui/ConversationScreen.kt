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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * A single conversation.
 *
 * Layout follows WhatsApp: a 56dp header where the back arrow, the avatar and
 * the title form one tap target, the message list on a tinted backdrop, then
 * the composer — a fully rounded field with emoji/attach/camera inside it and
 * a round accent button outside that morphs between mic and send.
 */
@Composable
fun ConversationScreen(
    state: ConversationState,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onRetry: (UiMessage) -> Unit,
) {
    val palette = ChatTheme.palette
    val listState = rememberLazyListState()
    var draft by remember(state.id) { mutableStateOf("") }

    // Reaching the top pulls the previous page. derivedStateOf keeps this from
    // recomposing on every pixel of scroll.
    val atTop by remember {
        derivedStateOf { listState.firstVisibleItemIndex <= 2 }
    }
    LaunchedEffect(atTop, state.hasMore, state.loadingMore) {
        if (atTop && state.hasMore && !state.loadingMore && state.messages.isNotEmpty()) onLoadOlder()
    }

    // Stick to the bottom when a message arrives while we are already there.
    LaunchedEffect(state.id) {
        snapshotFlow { state.messages.size }.collect { size ->
            if (size > 0) listState.scrollToItem(size + 1)
        }
    }

    Column(Modifier.fillMaxSize().background(palette.backdrop)) {

        ConversationHeader(state = state, onBack = onBack)

        Box(Modifier.weight(1f)) {
            when {
                state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

                state.error != null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(state.error, style = ChatType.Preview, color = MaterialTheme.colorScheme.error)
                }

                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                ) {
                    if (state.loadingMore) {
                        item(key = "loading-more") {
                            Box(Modifier.fillMaxWidth().padding(12.dp), Alignment.Center) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                            }
                        }
                    }

                    itemsIndexed(state, onRetry)

                    item(key = "typing") {
                        if (state.typingUserIds.isNotEmpty()) {
                            TypingRow(state)
                        } else {
                            Spacer(Modifier.height(4.dp))
                        }
                    }
                }
            }
        }

        Composer(
            draft = draft,
            onDraft = { draft = it },
            onSend = {
                onSend(draft)
                draft = ""
            },
        )
    }
}

/** Bubbles plus their date separators, in one pass so run grouping is cheap. */
private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexed(
    state: ConversationState,
    onRetry: (UiMessage) -> Unit,
) {
    val messages = state.messages
    messages.forEachIndexed { index, message ->
        val previous = messages.getOrNull(index - 1)
        val newDay = previous == null || Timestamps.differentDay(previous.createdAtMs, message.createdAtMs)
        // A run is a block of consecutive messages from one sender on one day.
        val runStart = newDay || previous?.senderId != message.senderId

        if (newDay) {
            item(key = "day-${message.id}") { DateSeparator(message.createdAtMs) }
        }
        item(key = message.id) {
            Spacer(Modifier.height(if (runStart) ChatDims.GroupGap else ChatDims.RunGap))
            MessageBubble(
                message = message,
                runStart = runStart,
                showSender = state.isGroup && runStart,
                senderName = state.members[message.senderId]?.label,
                deliveryState = when {
                    message.failed -> DeliveryState.Failed
                    message.pending -> DeliveryState.Pending
                    else -> DeliveryState.Sent
                },
                modifier = if (message.failed) Modifier.clickable { onRetry(message) } else Modifier,
            )
        }
    }
}

@Composable
private fun ConversationHeader(state: ConversationState, onBack: () -> Unit) {
    val typing = state.typingUserIds.isNotEmpty()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .heightIn(min = ChatDims.HeaderHeight)
            .padding(end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
        }
        ChatAvatar(
            title = state.title,
            url = state.avatarUrl,
            seed = state.id,
            size = ChatDims.AvatarSmall,
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = state.title,
                style = ChatType.HeaderTitle,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val sub = when {
                typing -> typingLabel(state)
                else -> state.subtitle
            }
            if (!sub.isNullOrBlank()) {
                Text(
                    text = sub,
                    style = ChatType.HeaderSub,
                    color = if (typing) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        IconButton(onClick = { /* video call: M5 */ }) {
            Icon(Icons.Filled.Videocam, contentDescription = "Appel vidéo")
        }
        IconButton(onClick = { /* audio call: M5 */ }) {
            Icon(Icons.Filled.Call, contentDescription = "Appel audio")
        }
        IconButton(onClick = { /* overflow: M2 */ }) {
            Icon(Icons.Filled.MoreVert, contentDescription = "Plus")
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
}

@Composable
private fun TypingRow(state: ConversationState) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = typingLabel(state),
            style = ChatType.HeaderSub,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

private fun typingLabel(state: ConversationState): String {
    val names = state.typingUserIds.mapNotNull { state.members[it]?.label }
    return when {
        names.isEmpty() -> "est en train d'écrire…"
        names.size == 1 -> "${names.first()} est en train d'écrire…"
        else -> "${names.size} personnes écrivent…"
    }
}

@Composable
private fun Composer(draft: String, onDraft: (String) -> Unit, onSend: () -> Unit) {
    val canSend = draft.isNotBlank()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .clip(ChatShapes.Composer)
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconButton(onClick = { /* emoji picker: M2 */ }, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Filled.EmojiEmotions,
                    contentDescription = "Emoji",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
            BasicTextField(
                value = draft,
                onValueChange = onDraft,
                textStyle = LocalTextStyle.current.merge(ChatType.Body)
                    .copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                maxLines = 6,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp)
                    .padding(horizontal = 4.dp, vertical = 10.dp),
                decorationBox = { inner ->
                    if (draft.isEmpty()) {
                        Text(
                            "Message",
                            style = ChatType.Body,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    inner()
                },
            )
            IconButton(onClick = { /* attachments: M3 */ }, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Filled.AttachFile,
                    contentDescription = "Joindre",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
            IconButton(onClick = { /* camera: M3 */ }, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Filled.PhotoCamera,
                    contentDescription = "Appareil photo",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
        }

        // Mic when the field is empty, send once there is text — the swap the
        // eye reads as "a chat app". Voice recording itself lands in M3.
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .clickable(enabled = canSend, onClick = onSend),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (canSend) Icons.AutoMirrored.Filled.Send else Icons.Filled.Mic,
                contentDescription = if (canSend) "Envoyer" else "Message vocal",
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}
