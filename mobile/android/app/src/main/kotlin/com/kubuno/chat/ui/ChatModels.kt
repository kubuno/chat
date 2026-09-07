package com.kubuno.chat.ui

import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.ConversationSummary
import com.kubuno.chat.net.Member
import com.kubuno.chat.net.Message

/** A message with its envelope already opened and its reactions attached. */
data class UiMessage(
    val id: String,
    val conversationId: String,
    val senderId: String,
    val outgoing: Boolean,
    val content: ChatEnvelope.Content,
    val createdAtMs: Long,
    val editedAtMs: Long?,
    val deleted: Boolean,
    val pinned: Boolean,
    val replyToId: String?,
    val messageType: String,
    val reactions: Map<String, Int> = emptyMap(),
    val myReactions: Set<String> = emptySet(),
    /** Not yet acknowledged by the server (optimistic row from the outbox). */
    val pending: Boolean = false,
    val failed: Boolean = false,
) {
    /** What a conversation row or a reply quote shows for this message. */
    fun preview(): String = when {
        deleted -> DELETED
        content.media != null -> when (content.media.kind) {
            "image" -> if (content.text.isNullOrBlank()) "📷 Photo" else "📷 ${content.text}"
            "video" -> "🎥 Vidéo"
            "audio" -> if (content.media.voice) "🎤 Message vocal" else "🎵 Audio"
            "sticker" -> "Sticker"
            "gif" -> "GIF"
            else -> "📄 ${content.media.name.ifBlank { "Document" }}"
        }
        content.poll != null -> "📊 ${content.poll.question}"
        content.hasCard -> "Carte Kubuno"
        else -> content.text.orEmpty()
    }

    companion object {
        const val DELETED = "Ce message a été supprimé"
    }
}

/** Delivery state drawn as ticks in the bubble and the conversation row. */
enum class DeliveryState { Pending, Sent, Delivered, Read, Failed }

/** One row of the conversation list. */
data class UiConversation(
    val id: String,
    val title: String,
    val isGroup: Boolean,
    val avatarUrl: String?,
    /** The other party of a direct conversation, when there is one. */
    val otherUserId: String? = null,
    val unreadCount: Int,
    val isUnread: Boolean,
    val isPinned: Boolean,
    val isArchived: Boolean,
    val isFavorite: Boolean,
    val isMuted: Boolean,
    val memberCount: Int,
    val lastMessage: UiMessage?,
    val lastActivityMs: Long,
    val typingLabel: String? = null,
    /**
     * Display names for this conversation's members, used to prefix a group's
     * preview with who spoke. Only filled for conversations whose member list
     * we already fetched — the list endpoint carries no names, and asking for
     * them per row would be the N+1 the server just removed.
     */
    val senderNames: Map<String, String> = emptyMap(),
) {
    val previewText: String get() = lastMessage?.preview().orEmpty()
}

/** The filter chips above the list, WhatsApp-style. */
enum class ChatFilter { All, Unread, Favorites, Groups }

/** Everything the conversation screen needs to draw a header and bubbles. */
data class ConversationState(
    val id: String,
    val title: String,
    val isGroup: Boolean,
    val avatarUrl: String? = null,
    val subtitle: String? = null,
    val members: Map<String, Member> = emptyMap(),
    val messages: List<UiMessage> = emptyList(),
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val hasMore: Boolean = true,
    val typingUserIds: Set<String> = emptySet(),
    val error: String? = null,
    /** Message being replied to, shown as a quote above the composer. */
    val replyTo: UiMessage? = null,
    /** Message being edited; the composer switches to "save" while set. */
    val editing: UiMessage? = null,
    /** Message whose action overlay is open (long-press). */
    val actionTarget: UiMessage? = null,
    /** Ids selected in multi-select mode; empty means the mode is off. */
    val selection: Set<String> = emptySet(),
    /** In-conversation search: null when the search bar is closed. */
    val search: String? = null,
    val searchMatches: List<String> = emptyList(),
    val searchIndex: Int = 0,
    /** Pinned messages, newest first, shown as a banner under the header. */
    val pinned: List<UiMessage> = emptyList(),
    /** Which pinned message the banner is showing, when there are several. */
    val pinnedIndex: Int = 0,
) {
    val selecting: Boolean get() = selection.isNotEmpty()

    fun message(id: String?): UiMessage? = id?.let { key -> messages.firstOrNull { it.id == key } }

    /** The one message currently highlighted by the search, if any. */
    val searchHit: String? get() = searchMatches.getOrNull(searchIndex)

    fun senderLabel(userId: String): String? = members[userId]?.label
}

/** Maps a wire conversation to its row model. */
fun ConversationSummary.toUi(last: UiMessage?, nowMs: Long): UiConversation = UiConversation(
    id = conversation.id,
    title = title,
    isGroup = conversation.convType != "direct",
    avatarUrl = otherUser?.avatarUrl,
    otherUserId = otherUser?.id,
    unreadCount = unreadCount.toInt(),
    isUnread = isUnread,
    isPinned = isPinned,
    isArchived = isArchived,
    isFavorite = isFavorite,
    isMuted = mutedUntil?.let { Timestamps.parseMs(it) ?: 0L }?.let { it > nowMs } ?: false,
    memberCount = memberCount.toInt(),
    lastMessage = last,
    lastActivityMs = last?.createdAtMs ?: Timestamps.parseMs(conversation.updatedAt) ?: 0L,
)

/** Maps a wire message, opening its envelope. */
fun Message.toUi(selfUserId: String, reactions: Map<String, Int> = emptyMap(), mine: Set<String> = emptySet()): UiMessage =
    UiMessage(
        id = id,
        conversationId = conversationId,
        senderId = senderId,
        outgoing = senderId == selfUserId,
        content = ChatEnvelope.decode(encryptedData),
        createdAtMs = Timestamps.parseMs(createdAt) ?: 0L,
        editedAtMs = editedAt?.let(Timestamps::parseMs),
        // A tombstone comes back with message_type "deleted" and an empty
        // envelope; deleted_at alone is not enough, since the module also
        // returns it on the live message_updated event.
        deleted = deletedAt != null || messageType == "deleted",
        pinned = isPinned,
        replyToId = replyToId,
        messageType = messageType,
        reactions = reactions,
        myReactions = mine,
    )
