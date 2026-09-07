package com.kubuno.chat.net

import android.util.Base64
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.security.SecureRandom

/**
 * The message envelope carried in `encrypted_data`.
 *
 * IMPORTANT, AND THE REASON THIS APP PROMISES NOTHING ABOUT ENCRYPTION: the
 * field is base64url of a UTF-8 JSON object, nothing more. The web client
 * (chat/frontend/src/chatStore.ts, encodeTextMessage/decodeEnvelope) does the
 * same, the X3DH prekeys the module publishes are never consumed, and the
 * per-blob AES key of a media attachment travels in this very envelope — so the
 * server can read message text and media alike.
 *
 * Everything here is therefore an interoperability shim with the web client,
 * NOT a cryptographic layer. When the module grows a real protocol, encode()
 * and decode() are the only two functions that change.
 */
object ChatEnvelope {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val random = SecureRandom()

    private const val B64 = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP

    @Serializable
    data class Media(
        @SerialName("media_id") val mediaId: String,
        val key: String = "",
        val iv: String = "",
        val mime: String = "application/octet-stream",
        val name: String = "",
        val size: Long = 0,
        val kind: String = "file", // image | video | audio | file | sticker | gif
        val width: Int? = null,
        val height: Int? = null,
        val duration: Double? = null,
        val voice: Boolean = false,
        val waveform: List<Float>? = null,
    )

    @Serializable
    data class Poll(
        val question: String = "",
        val options: List<String> = emptyList(),
    )

    @Serializable
    private data class Wire(
        val text: String? = null,
        val media: Media? = null,
        val poll: Poll? = null,
        val card: JsonObject? = null,
    )

    /** What a decoded message actually holds. */
    data class Content(
        val text: String?,
        val media: Media?,
        val poll: Poll?,
        val hasCard: Boolean,
    ) {
        val isEmpty: Boolean get() = text.isNullOrEmpty() && media == null && poll == null && !hasCard
    }

    fun decode(encoded: String): Content {
        val bytes = runCatching { Base64.decode(encoded, B64) }.getOrNull()
            ?: return Content(null, null, null, false)
        val raw = String(bytes, Charsets.UTF_8)
        runCatching { json.decodeFromString(Wire.serializer(), raw) }.getOrNull()?.let { w ->
            if (w.text != null || w.media != null || w.poll != null || w.card != null) {
                return Content(w.text, w.media, w.poll, w.card != null)
            }
        }
        // Same fallback as the web client: an envelope that is not JSON is read
        // as plain base64 text (very old messages).
        return Content(raw.takeIf { it.isNotBlank() }, null, null, false)
    }

    fun encodeText(text: String): SendMessageBody =
        SendMessageBody(encryptedData = encodeWire(Wire(text = text)), nonce = newNonce())

    /** 24 random bytes, base64url — the shape the module expects, and its idempotency key. */
    fun newNonce(): String {
        val bytes = ByteArray(24).also(random::nextBytes)
        return Base64.encodeToString(bytes, B64)
    }

    private fun encodeWire(wire: Wire): String {
        val body = json.encodeToString(Wire.serializer(), wire)
        return Base64.encodeToString(body.toByteArray(Charsets.UTF_8), B64)
    }
}
