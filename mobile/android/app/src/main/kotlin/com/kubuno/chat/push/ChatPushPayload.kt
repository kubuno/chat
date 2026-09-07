package com.kubuno.chat.push

import android.util.Log
import org.json.JSONObject

/**
 * A push as the core's worker delivers it: `{type, module, title, body,
 * resource_id}`.
 *
 * The chat module fills it deliberately thin — the title names the sender or
 * the group, the body says a message arrived, and nothing of the message
 * itself travels. The app does not try to compensate: showing content the
 * server chose not to send would undo that choice.
 *
 * Parsed with org.json rather than kotlinx.serialization so a malformed push
 * can never throw inside a BroadcastReceiver; every field is read defensively.
 */
data class ChatPushPayload(
    val eventType: String?,
    val title: String?,
    val body: String?,
    /** The conversation to open — resource_id for chat.new_message. */
    val conversationId: String?,
    val senderId: String?,
) {
    /** True for an incoming call ring rather than a message. */
    val isCall: Boolean get() = eventType == "chat.call_ring"

    companion object {
        private const val TAG = "KubunoChatPush"

        fun parse(raw: String?): ChatPushPayload {
            if (raw.isNullOrBlank()) return empty()
            val obj = runCatching { JSONObject(raw) }
                .onFailure { Log.w(TAG, "unparseable push payload", it) }
                .getOrNull() ?: return empty()
            return ChatPushPayload(
                // The core emits either key depending on the event shape.
                eventType = obj.str("event_type") ?: obj.str("type"),
                title = obj.str("title"),
                body = obj.str("body"),
                conversationId = obj.str("conversation_id") ?: obj.str("resource_id"),
                senderId = obj.str("sender_id") ?: obj.str("from_user_id"),
            )
        }

        private fun empty() = ChatPushPayload(null, null, null, null, null)

        /** JSONObject.opt already exists and returns Any?; this one is ours. */
        private fun JSONObject.str(key: String): String? =
            if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null
    }
}
