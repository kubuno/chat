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
)

/** Maps a wire conversation to its row model. */
fun ConversationSummary.toUi(last: UiMessage?, nowMs: Long): UiConversation = UiConversation(
    id = conversation.id,
    title = title,
    isGroup = conversation.convType != "direct",
    avatarUrl = otherUser?.avatarUrl,
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
        deleted = deletedAt != null,
        pinned = isPinned,
        replyToId = replyToId,
        messageType = messageType,
        reactions = reactions,
        myReactions = mine,
    )
