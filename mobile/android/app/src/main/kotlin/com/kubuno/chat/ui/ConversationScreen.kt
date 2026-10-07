package com.kubuno.chat.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.MediaPlayback
import com.kubuno.chat.net.VoiceRecorder
import java.io.File
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * A single conversation.
 *
 * Layout follows WhatsApp: a 56dp header where the back arrow, the avatar and
 * the title form one tap target, the message list on a tinted backdrop, then
 * the composer — a fully rounded field with emoji/attach/camera inside it and
 * a round accent button outside that morphs between mic and send.
 *
 * The header has three states: normal, in-conversation search, and multi-select
 * (which turns it into an action bar, the one place where that old pattern is
 * still the right one — the actions apply to a set, not to a message on screen).
 */
@Composable
fun ConversationScreen(
    state: ConversationState,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onDraftChanged: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onRetry: (UiMessage) -> Unit,
    onLongPress: (UiMessage) -> Unit,
    onReply: (UiMessage) -> Unit,
    onToggleSelect: (UiMessage) -> Unit,
    onClearSelection: () -> Unit,
    onCancelCompose: () -> Unit,
    onDeleteSelected: () -> Unit,
    onForwardSelected: () -> Unit,
    onOpenSearch: () -> Unit,
    onCloseSearch: () -> Unit,
    onSearch: (String) -> Unit,
    onStepSearch: (Boolean) -> Unit,
    recording: VoiceRecorder.State,
    mediaFiles: Map<String, File>,
    playback: MediaPlayback.State,
    onAttach: () -> Unit,
    onCamera: () -> Unit,
    onStartRecording: () -> Unit,
    onFinishRecording: () -> Unit,
    onCancelRecording: () -> Unit,
    onRequestMedia: (ChatEnvelope.Media) -> Unit,
    onOpenMedia: (UiMessage) -> Unit,
    onTogglePlay: (UiMessage) -> Unit,
    onCycleSpeed: () -> Unit,
    onSeek: (Float) -> Unit,
    onAudioCall: () -> Unit,
    onVideoCall: () -> Unit,
    polls: Map<String, com.kubuno.chat.net.PollResults>,
    onLoadPoll: (String) -> Unit,
    onVote: (String, Int) -> Unit,
    onStepPinned: () -> Unit,
    onEphemeral: (Long?) -> Unit,
) {
    val palette = ChatTheme.palette
    val listState = rememberLazyListState()
    // TextFieldValue rather than String so the caret can be placed: entering
    // edit mode must leave it at the END of the text being rewritten, not at
    // position 0 where the next keystroke would prepend.
    var draft by remember(state.id) { mutableStateOf(TextFieldValue()) }

    LaunchedEffect(state.editing?.id) {
        state.editing?.let {
            val text = it.content.text.orEmpty()
            draft = TextFieldValue(text, TextRange(text.length))
        }
    }

    // Reaching the top pulls the previous page. derivedStateOf keeps this from
    // recomposing on every pixel of scroll.
    val atTop by remember { derivedStateOf { listState.firstVisibleItemIndex <= 2 } }
    LaunchedEffect(atTop, state.hasMore, state.loadingMore) {
        if (atTop && state.hasMore && !state.loadingMore && state.messages.isNotEmpty()) onLoadOlder()
    }

    // Stick to the bottom when a message arrives while we are already there.
    LaunchedEffect(state.id) {
        snapshotFlow { state.messages.size }.collect { size ->
            if (size > 0) listState.scrollToItem(size + 1)
        }
    }

    // Jump to the current search hit.
    LaunchedEffect(state.searchHit) {
        val hit = state.searchHit ?: return@LaunchedEffect
        val index = state.messages.indexOfFirst { it.id == hit }
        if (index >= 0) listState.animateScrollToItem(index)
    }

    Column(Modifier.fillMaxSize().background(palette.backdrop)) {

        when {
            state.selecting -> SelectionBar(
                count = state.selection.size,
                onClear = onClearSelection,
                onDelete = onDeleteSelected,
                onForward = onForwardSelected,
            )
            state.search != null -> SearchBar(
                query = state.search,
                matches = state.searchMatches.size,
                index = state.searchIndex,
                onQuery = onSearch,
                onStep = onStepSearch,
                onClose = onCloseSearch,
            )
            else -> ConversationHeader(
                state = state,
                onBack = onBack,
                onSearch = onOpenSearch,
                onAudioCall = onAudioCall,
                onVideoCall = onVideoCall,
                onEphemeral = onEphemeral,
            )
        }

        if (!state.selecting && state.search == null && state.pinned.isNotEmpty()) {
            PinnedBanner(
                message = state.pinned[state.pinnedIndex.coerceIn(state.pinned.indices)],
                index = state.pinnedIndex,
                total = state.pinned.size,
                onClick = onStepPinned,
            )
        }

        Box(Modifier.weight(1f)) {
            when {
                state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

                state.error != null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(state.error, style = ChatType.Preview, color = MaterialTheme.colorScheme.error)
                }

                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (state.loadingMore) {
                        item(key = "loading-more") {
                            Box(Modifier.fillMaxWidth().padding(12.dp), Alignment.Center) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                            }
                        }
                    }

                    messageItems(
                        state = state,
                        mediaFiles = mediaFiles,
                        playback = playback,
                        onRetry = onRetry,
                        onLongPress = onLongPress,
                        onReply = onReply,
                        onToggleSelect = onToggleSelect,
                        onRequestMedia = onRequestMedia,
                        onOpenMedia = onOpenMedia,
                        onTogglePlay = onTogglePlay,
                        onCycleSpeed = onCycleSpeed,
                        onSeek = onSeek,
                        polls = polls,
                        onLoadPoll = onLoadPoll,
                        onVote = onVote,
                    )

                    item(key = "typing") {
                        if (state.typingUserIds.isNotEmpty()) TypingRow(state) else Spacer(Modifier.height(4.dp))
                    }
                }
            }
        }

        if (state.mentionSuggestions.isNotEmpty()) {
            MentionSuggestions(state.mentionSuggestions) { name ->
                // Replace the half-typed token, do not append after it.
                val at = draft.text.lastIndexOf('@')
                if (at >= 0) {
                    val completed = draft.text.take(at) + "@" + name + " "
                    draft = TextFieldValue(completed, TextRange(completed.length))
                    onDraftChanged(completed)
                }
            }
        }

        Composer(
            draft = draft,
            recording = recording,
            onAttach = onAttach,
            onCamera = onCamera,
            onStartRecording = onStartRecording,
            onFinishRecording = onFinishRecording,
            onCancelRecording = onCancelRecording,
            replyTo = state.replyTo,
            replyLabel = state.replyTo?.let { if (it.outgoing) "Vous" else state.senderLabel(it.senderId) },
            editing = state.editing,
            onDraft = {
                draft = it
                onDraftChanged(it.text)
            },
            onCancelCompose = {
                draft = TextFieldValue()
                onCancelCompose()
            },
            onSend = {
                onSend(draft.text)
                draft = TextFieldValue()
            },
        )
    }
}

/** Bubbles plus their date separators, in one pass so run grouping is cheap. */
private fun LazyListScope.messageItems(
    state: ConversationState,
    mediaFiles: Map<String, File>,
    playback: MediaPlayback.State,
    onRetry: (UiMessage) -> Unit,
    onLongPress: (UiMessage) -> Unit,
    onReply: (UiMessage) -> Unit,
    onToggleSelect: (UiMessage) -> Unit,
    onRequestMedia: (ChatEnvelope.Media) -> Unit,
    onOpenMedia: (UiMessage) -> Unit,
    onTogglePlay: (UiMessage) -> Unit,
    onCycleSpeed: () -> Unit,
    onSeek: (Float) -> Unit,
    polls: Map<String, com.kubuno.chat.net.PollResults>,
    onLoadPoll: (String) -> Unit,
    onVote: (String, Int) -> Unit,
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
            SwipeableBubble(
                message = message,
                state = state,
                runStart = runStart,
                mediaFiles = mediaFiles,
                playback = playback,
                onRetry = onRetry,
                onLongPress = onLongPress,
                onReply = onReply,
                onToggleSelect = onToggleSelect,
                onRequestMedia = onRequestMedia,
                onOpenMedia = onOpenMedia,
                onTogglePlay = onTogglePlay,
                onCycleSpeed = onCycleSpeed,
                onSeek = onSeek,
                polls = polls,
                onLoadPoll = onLoadPoll,
                onVote = onVote,
            )
        }
    }
}

/**
 * A bubble that can be dragged to the right to reply — the gesture every
 * messenger user already knows. Past the threshold the reply arrow lights up
 * and releasing arms the quote; below it the bubble springs back.
 */
@Composable
private fun SwipeableBubble(
    message: UiMessage,
    state: ConversationState,
    runStart: Boolean,
    mediaFiles: Map<String, File>,
    playback: MediaPlayback.State,
    onRetry: (UiMessage) -> Unit,
    onLongPress: (UiMessage) -> Unit,
    onReply: (UiMessage) -> Unit,
    onToggleSelect: (UiMessage) -> Unit,
    onRequestMedia: (ChatEnvelope.Media) -> Unit,
    onOpenMedia: (UiMessage) -> Unit,
    onTogglePlay: (UiMessage) -> Unit,
    onCycleSpeed: () -> Unit,
    onSeek: (Float) -> Unit,
    polls: Map<String, com.kubuno.chat.net.PollResults>,
    onLoadPoll: (String) -> Unit,
    onVote: (String, Int) -> Unit,
) {
    val density = LocalDensity.current
    val threshold = with(density) { SWIPE_THRESHOLD_DP.dp.toPx() }
    val maxDrag = with(density) { SWIPE_MAX_DP.dp.toPx() }
    var drag by remember(message.id) { mutableFloatStateOf(0f) }
    val offset by animateFloatAsState(drag, label = "swipe")
    val armed = drag >= threshold
    val selected = message.id in state.selection

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
                else androidx.compose.ui.graphics.Color.Transparent
            )
    ) {
        // The arrow revealed behind the bubble while dragging.
        if (drag > 1f) {
            Box(
                modifier = Modifier.fillMaxHeight().padding(start = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Reply,
                    contentDescription = null,
                    tint = if (armed) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        Box(
            modifier = Modifier
                .offset { IntOffset(offset.roundToInt(), 0) }
                // The drag detector goes FIRST in the chain. With the tap
                // detector ahead of it, the tap pass swallowed the pointer and
                // the swipe never reached the drag detector at all.
                .pointerInput(message.id) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (drag >= threshold) onReply(message)
                            drag = 0f
                        },
                        onDragCancel = { drag = 0f },
                    ) { change, amount ->
                        // Right-only and capped: a reply gesture must never
                        // fight the list's vertical scroll.
                        val next = (drag + amount).coerceIn(0f, maxDrag)
                        if (next != drag) change.consume()
                        drag = next
                    }
                }
                .pointerInput(message.id, state.selecting) {
                    detectTapGestures(
                        onLongPress = { onLongPress(message) },
                        onTap = { if (state.selecting) onToggleSelect(message) else if (message.failed) onRetry(message) },
                    )
                }
        ) {
            MessageBubble(
                message = message,
                runStart = runStart,
                showSender = state.isGroup && runStart,
                senderName = state.senderLabel(message.senderId),
                deliveryState = when {
                    message.failed -> DeliveryState.Failed
                    message.pending -> DeliveryState.Pending
                    else -> DeliveryState.Sent
                },
                quoted = state.message(message.replyToId),
                quotedLabel = state.message(message.replyToId)?.let {
                    if (it.outgoing) "Vous" else state.senderLabel(it.senderId)
                },
                highlighted = state.searchHit == message.id,
                mediaFile = message.content.media?.let { mediaFiles[it.mediaId] },
                playback = playback,
                onRequestMedia = { message.content.media?.let(onRequestMedia) },
                onOpenMedia = { onOpenMedia(message) },
                onTogglePlay = { onTogglePlay(message) },
                onCycleSpeed = onCycleSpeed,
                onSeek = onSeek,
                pollResults = polls[message.id],
                onLoadPoll = { onLoadPoll(message.id) },
                onVote = { index -> onVote(message.id, index) },
            )
        }
    }
}

@Composable
private fun ConversationHeader(
    state: ConversationState,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onAudioCall: () -> Unit,
    onVideoCall: () -> Unit,
    onEphemeral: (Long?) -> Unit,
) {
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
            val sub = if (typing) typingLabel(state) else state.subtitle
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
        IconButton(onClick = onVideoCall) {
            Icon(Icons.Filled.Videocam, contentDescription = "Appel vidéo")
        }
        IconButton(onClick = onAudioCall) {
            Icon(Icons.Filled.Call, contentDescription = "Appel audio")
        }
        // Search lives in the overflow rather than the bar: a fourth icon left
        // no room for the conversation's own name, which is the one thing the
        // header must never truncate.
        var menuOpen by remember { mutableStateOf(false) }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "Plus")
            }
            var ephemeralOpen by remember { mutableStateOf(false) }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Rechercher", style = ChatType.Preview) },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        onSearch()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Messages éphémères", style = ChatType.Preview) },
                    leadingIcon = { Icon(Icons.Filled.Timer, contentDescription = null) },
                    trailingIcon = {
                        if (state.ephemeralSeconds != null) {
                            Text(
                                ephemeralLabel(state.ephemeralSeconds),
                                style = ChatType.BubbleMeta,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    },
                    onClick = {
                        menuOpen = false
                        ephemeralOpen = true
                    },
                )
            }
            EphemeralMenu(
                current = state.ephemeralSeconds,
                expanded = ephemeralOpen,
                onDismiss = { ephemeralOpen = false },
                onPick = onEphemeral,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
}

/** The header while messages are selected: the actions apply to the whole set. */
@Composable
private fun SelectionBar(count: Int, onClear: () -> Unit, onDelete: () -> Unit, onForward: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .heightIn(min = ChatDims.HeaderHeight)
            .padding(end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClear) {
            Icon(Icons.Filled.Close, contentDescription = "Annuler la sélection")
        }
        Text(
            text = "$count",
            style = ChatType.HeaderTitle,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onForward) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Transférer")
        }
        IconButton(onClick = onDelete) {
            Icon(
                Icons.Filled.Delete,
                contentDescription = "Supprimer",
                tint = MaterialTheme.colorScheme.error,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
}

/** In-conversation search: a field plus previous/next through the hits. */
@Composable
private fun SearchBar(
    query: String,
    matches: Int,
    index: Int,
    onQuery: (String) -> Unit,
    onStep: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
    // Opening the search bar must also put the caret in it: a search field the
    // user has to tap before typing is a search field that gets used once.
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .heightIn(min = ChatDims.HeaderHeight)
            .padding(end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClose) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Fermer la recherche")
        }
        BasicTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            textStyle = LocalTextStyle.current.merge(ChatType.Body)
                .copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier.weight(1f).padding(vertical = 12.dp).focusRequester(focus),
            decorationBox = { inner ->
                Box {
                    if (query.isEmpty()) {
                        Text(
                            "Rechercher dans la conversation",
                            style = ChatType.Body,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    inner()
                }
            },
        )
        if (query.isNotBlank()) {
            Text(
                text = if (matches == 0) "0" else "${index + 1}/$matches",
                style = ChatType.RowTime,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            IconButton(onClick = { onStep(false) }, enabled = matches > 0) {
                Icon(Icons.Filled.ExpandLess, contentDescription = "Précédent")
            }
            IconButton(onClick = { onStep(true) }, enabled = matches > 0) {
                Icon(Icons.Filled.ExpandMore, contentDescription = "Suivant")
            }
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
private fun Composer(
    draft: TextFieldValue,
    replyTo: UiMessage?,
    replyLabel: String?,
    editing: UiMessage?,
    recording: VoiceRecorder.State,
    onDraft: (TextFieldValue) -> Unit,
    onCancelCompose: () -> Unit,
    onSend: () -> Unit,
    onAttach: () -> Unit,
    onCamera: () -> Unit,
    onStartRecording: () -> Unit,
    onFinishRecording: () -> Unit,
    onCancelRecording: () -> Unit,
) {
    val canSend = draft.text.isNotBlank()

    Column(
        Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
    ) {
        // Context banner: the quote being answered, or the message being edited.
        if (replyTo != null || editing != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp)
                    .clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .width(3.dp)
                        .height(32.dp)
                        .background(MaterialTheme.colorScheme.primary)
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = if (editing != null) "Modifier le message" else (replyLabel ?: "Réponse"),
                        style = ChatType.BubbleMeta,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = (editing ?: replyTo)?.preview().orEmpty(),
                        style = ChatType.BubbleMeta,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = onCancelCompose, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Annuler",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (recording.recording) {
                RecordingBar(recording, onCancelRecording)
            } else
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(ChatShapes.Composer)
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                IconButton(onClick = { /* emoji picker: M3 */ }, modifier = Modifier.size(36.dp)) {
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
                    // The hint must OVERLAY the field, not precede it: without
                    // a Box the two stack and the caret drops to a second line.
                    decorationBox = { inner ->
                        Box {
                            if (draft.text.isEmpty()) {
                                Text(
                                    "Message",
                                    style = ChatType.Body,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            inner()
                        }
                    },
                )
                IconButton(onClick = onAttach, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Filled.AttachFile,
                        contentDescription = "Joindre",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(22.dp),
                    )
                }
                IconButton(onClick = onCamera, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Filled.PhotoCamera,
                        contentDescription = "Appareil photo",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }

            // Mic when the field is empty, send once there is text, check while
            // editing — the swap the eye reads as "a chat app". Voice recording
            // itself lands in M3.
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .then(
                        // Press and hold to record, release to send — the
                        // gesture people already have in their fingers. A tap
                        // on the send arrow stays a plain click.
                        if (canSend || editing != null) {
                            Modifier.clickable(onClick = onSend)
                        } else {
                            Modifier.pointerInput(recording.recording) {
                                detectTapGestures(
                                    onPress = {
                                        onStartRecording()
                                        val completed = tryAwaitRelease()
                                        if (completed) onFinishRecording() else onCancelRecording()
                                    },
                                )
                            }
                        }
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = when {
                        editing != null -> Icons.Filled.Check
                        canSend -> Icons.AutoMirrored.Filled.Send
                        recording.recording -> Icons.Filled.Stop
                        else -> Icons.Filled.Mic
                    },
                    contentDescription = when {
                        editing != null -> "Enregistrer"
                        canSend -> "Envoyer"
                        recording.recording -> "Terminer"
                        else -> "Maintenir pour enregistrer"
                    },
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

/** What the composer becomes while a voice message is being recorded. */
@Composable
private fun RowScope.RecordingBar(state: VoiceRecorder.State, onCancel: () -> Unit) {
    Row(
        modifier = Modifier
            .weight(1f)
            .clip(ChatShapes.Composer)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The red dot is the one thing that says "the microphone is live".
        Box(
            Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.error)
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = elapsed(state.elapsedMs),
            style = ChatType.Body,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = "Relâchez pour envoyer",
            style = ChatType.HeaderSub,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onCancel, modifier = Modifier.size(32.dp)) {
            Icon(
                Icons.Filled.Delete,
                contentDescription = "Annuler l'enregistrement",
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

private fun elapsed(ms: Long): String {
    val total = (ms / 1000).toInt()
    return "%d:%02d".format(total / 60, total % 60)
}

private const val SWIPE_THRESHOLD_DP = 56
private const val SWIPE_MAX_DP = 84

/**
 * The pinned-message banner, under the header.
 *
 * A pin only earns its place if it is readable at a glance, so the banner
 * shows one message at a time and tapping cycles — a stack of three would
 * push the conversation itself off the screen.
 */
@Composable
private fun PinnedBanner(message: UiMessage, index: Int, total: Int, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(3.dp)
                .height(30.dp)
                .background(MaterialTheme.colorScheme.primary)
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = if (total > 1) "Message épinglé ${index + 1}/$total" else "Message épinglé",
                style = ChatType.BubbleMeta,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = message.preview(),
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(
            Icons.Filled.PushPin,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
}

/**
 * The @mention list, shown just above the composer while a mention is being
 * typed. Tapping completes the name in place rather than appending it, which
 * is what makes the feature worth having at all.
 */
@Composable
private fun MentionSuggestions(members: List<com.kubuno.chat.net.Member>, onPick: (String) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
        shadowElevation = 4.dp,
    ) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 200.dp)) {
            items(members, key = { it.userId }) { member ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(member.label) }
                        .padding(horizontal = ChatDims.Gutter, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ChatAvatar(
                        title = member.label,
                        url = member.avatarUrl,
                        seed = member.userId,
                        size = 32.dp,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = member.label,
                        style = ChatType.Preview,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** How long messages sent from here survive. */
@Composable
private fun EphemeralMenu(current: Long?, expanded: Boolean, onDismiss: () -> Unit, onPick: (Long?) -> Unit) {
    val options = listOf<Pair<String, Long?>>(
        "Désactivé" to null,
        "24 heures" to 24L * 3600,
        "7 jours" to 7L * 24 * 3600,
        "90 jours" to 90L * 24 * 3600,
    )
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        options.forEach { (label, seconds) ->
            DropdownMenuItem(
                text = { Text(label, style = ChatType.Preview) },
                trailingIcon = {
                    if (current == seconds) {
                        Icon(
                            Icons.Filled.Check,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                },
                onClick = {
                    onDismiss()
                    onPick(seconds)
                },
            )
        }
    }
}

private fun ephemeralLabel(seconds: Long?): String = when (seconds) {
    null -> ""
    24L * 3600 -> "24 h"
    7L * 24 * 3600 -> "7 j"
    90L * 24 * 3600 -> "90 j"
    else -> "${seconds / 3600} h"
}
