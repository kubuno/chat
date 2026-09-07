package com.kubuno.chat.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Wire shapes of the chat module (chat/src/models/*.rs). Field names match the
// Rust structs exactly; anything the client does not use is simply omitted,
// since the Json instance ignores unknown keys.

@Serializable
data class Conversation(
    val id: String,
    @SerialName("conv_type") val convType: String,      // "direct" | "group" | "channel"
    val name: String? = null,
    val description: String? = null,
    @SerialName("avatar_path") val avatarPath: String? = null,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("is_meeting") val isMeeting: Boolean = false,
)

@Serializable
data class OtherUser(
    val id: String,
    @SerialName("display_name") val displayName: String? = null,
    val username: String,
    @SerialName("avatar_url") val avatarUrl: String? = null,
)

@Serializable
data class ConversationSummary(
    val conversation: Conversation,
    @SerialName("unread_count") val unreadCount: Long = 0,
    @SerialName("is_unread") val isUnread: Boolean = false,
    @SerialName("member_count") val memberCount: Long = 0,
    @SerialName("is_pinned") val isPinned: Boolean = false,
    @SerialName("is_archived") val isArchived: Boolean = false,
    @SerialName("is_favorite") val isFavorite: Boolean = false,
    @SerialName("muted_until") val mutedUntil: String? = null,
    @SerialName("other_user") val otherUser: OtherUser? = null,
) {
    /** What the conversation row shows as a title. */
    val title: String
        get() = conversation.name
            ?: otherUser?.displayName
            ?: otherUser?.username
            ?: "?"
}

@Serializable
data class ConversationListResponse(val conversations: List<ConversationSummary> = emptyList())

@Serializable
data class Member(
    @SerialName("user_id") val userId: String,
    val role: String = "member",
    @SerialName("display_name") val displayName: String? = null,
    val username: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
) {
    val label: String get() = displayName ?: username ?: userId.take(8)
}

@Serializable
data class ConversationDetail(
    val conversation: Conversation,
    val members: List<Member> = emptyList(),
)

@Serializable
data class Message(
    val id: String,
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("sender_id") val senderId: String,
    // Despite the name this is NOT ciphertext today: the module stores
    // base64url(JSON). See ChatEnvelope — and note that the app makes no
    // encryption claim in its UI because of it.
    @SerialName("encrypted_data") val encryptedData: String,
    @SerialName("message_type") val messageType: String = "text",
    @SerialName("media_meta") val mediaMeta: JsonElement? = null,
    @SerialName("reply_to_id") val replyToId: String? = null,
    val status: String = "sent",
    @SerialName("edited_at") val editedAt: String? = null,
    @SerialName("deleted_at") val deletedAt: String? = null,
    val nonce: String = "",
    @SerialName("sequence_num") val sequenceNum: Long = 0,
    @SerialName("created_at") val createdAt: String,
    @SerialName("is_pinned") val isPinned: Boolean = false,
    @SerialName("scheduled_at") val scheduledAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
)

@Serializable
data class Reaction(
    @SerialName("message_id") val messageId: String,
    @SerialName("user_id") val userId: String,
    val emoji: String,
)

@Serializable
data class MessagesResponse(
    val messages: List<Message> = emptyList(),
    val reactions: List<Reaction> = emptyList(),
)

@Serializable
data class MessageResponse(val message: Message, val duplicate: Boolean = false)

/**
 * Send body. `nonce` doubles as the module's idempotency key: re-POSTing the
 * same (conversation, nonce) returns the existing message with
 * `duplicate = true` instead of creating a second one, which is what makes the
 * outbox safe to retry after a dropped connection.
 *
 * The X3DH fields of the Rust DTO (ephemeral_key, ratchet_header, used_opk_id,
 * sender_ik_pub) are deliberately absent: nothing populates them today, and
 * sending half a handshake would be worse than sending none.
 */
@Serializable
data class SendMessageBody(
    @SerialName("encrypted_data") val encryptedData: String,
    val nonce: String,
    @SerialName("message_type") val messageType: String = "text",
    @SerialName("reply_to_id") val replyToId: String? = null,
)

@Serializable
data class EditMessageBody(
    @SerialName("encrypted_data") val encryptedData: String,
    val nonce: String,
)

@Serializable
data class ReadReceiptBody(@SerialName("up_to_message_id") val upToMessageId: String)

@Serializable
data class ReactionBody(val emoji: String)

@Serializable
data class MemberSettingsBody(
    val pin: Boolean? = null,
    val archive: Boolean? = null,
    val favorite: Boolean? = null,
    @SerialName("mark_unread") val markUnread: Boolean? = null,
    val unmute: Boolean? = null,
    @SerialName("mute_until") val muteUntil: String? = null,
)

@Serializable
data class ReadStateMember(
    @SerialName("user_id") val userId: String,
    @SerialName("last_read_message_id") val lastReadMessageId: String? = null,
    @SerialName("last_read_at") val lastReadAt: String,
)

@Serializable
data class ReadStateResponse(val members: List<ReadStateMember> = emptyList())

/** GET /api/v1/users/search — a CORE route, not a chat one. */
@Serializable
data class UserSuggestion(
    val id: String,
    val username: String,
    @SerialName("display_name") val displayName: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
)

@Serializable
data class UserSearchResponse(val users: List<UserSuggestion> = emptyList())
