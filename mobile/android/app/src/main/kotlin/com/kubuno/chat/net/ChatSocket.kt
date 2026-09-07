package com.kubuno.chat.net

import android.util.Log
import com.kubuno.android.account.BrokeredClient
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * The chat module's OWN realtime socket: wss://<host>/api/v1/chat/ws?token=<access>.
 *
 * This is NOT the core's /ws — the core socket only carries the notification
 * bell for chat. The module keeps one hub entry per user and fans an event out
 * to every connection that user has open, so the client subscribes to nothing:
 * it receives everything about itself and filters locally.
 *
 * The token rides in the query string because a WebSocket handshake cannot
 * carry our Authorization header; a fresh one is fetched on every (re)connect
 * since access tokens live 15 minutes.
 */
class ChatSocket(
    private val client: BrokeredClient,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private val wsClient: OkHttpClient = client.okHttpClient.newBuilder()
        .pingInterval(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val _events = MutableSharedFlow<Envelope>(extraBufferCapacity = 64)
    val events: SharedFlow<Envelope> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    @Volatile private var wanted = false
    @Volatile private var socket: WebSocket? = null
    @Volatile private var attempt = 0

    @Serializable
    data class Envelope(
        val event: String,
        val payload: JsonElement? = null,
    ) {
        /** Reads a string field out of the payload object, or null. */
        fun str(field: String): String? =
            runCatching { (payload as? JsonObject)?.get(field)?.jsonPrimitive?.content }
                .getOrNull()
                ?.takeIf { it != "null" }
    }

    @Serializable
    data class NewMessagePayload(val message: Message)

    @Serializable
    data class MessageUpdatedPayload(
        val message: Message? = null,
        @SerialName("message_id") val messageId: String? = null,
        @SerialName("conversation_id") val conversationId: String? = null,
        val deleted: Boolean = false,
    )

    fun start() {
        if (wanted) return
        wanted = true
        scope.launch { connect() }
    }

    fun stop() {
        wanted = false
        _connected.value = false
        socket?.close(NORMAL_CLOSURE, null)
        socket = null
        synchronized(pending) { pending.clear() }
        scope.coroutineContext.cancelChildren()
    }

    /**
     * Tells the other members that this user is typing. The module has no REST
     * route for it: typing is ephemeral and only exists on the socket, so a
     * dropped frame simply means the indicator does not show.
     */
    fun typing(conversationId: String, started: Boolean) {
        // Typing is not queued: an indicator that arrives after the fact is
        // noise, so a dropped frame is the correct outcome here.
        val action = if (started) "typing_start" else "typing_stop"
        socket?.send("""{"action":"$action","conversation_id":"$conversationId"}""")
    }

    /**
     * Relays one call signal to a peer. The hub only routes it; SDP and ICE
     * never touch the module's storage.
     */
    fun callSignal(toUserId: String, signal: kotlinx.serialization.json.JsonElement) {
        val frame = buildJsonObject {
            put("action", kotlinx.serialization.json.JsonPrimitive("call_signal"))
            put("to_user_id", kotlinx.serialization.json.JsonPrimitive(toUserId))
            put("signal", signal)
        }
        send(frame.toString())
    }

    /**
     * Sends a frame, holding it until the socket is up.
     *
     * Without this a call placed in the seconds after launch — or across a
     * reconnect — silently loses its ring and offer: `socket` is null, `send`
     * returns nothing, and the caller hears an endless "ringing" while the
     * callee's phone never lit up. Signalling frames are small and few, so a
     * short bounded queue is the right trade; it is dropped on stop() because
     * a signal that outlived its call is worse than no signal.
     */
    private fun send(frame: String) {
        val live = socket
        if (live != null && _connected.value) {
            live.send(frame)
            return
        }
        synchronized(pending) {
            if (pending.size >= MAX_PENDING) pending.removeFirst()
            pending.addLast(frame)
        }
    }

    private fun flushPending() {
        val live = socket ?: return
        val frames = synchronized(pending) {
            val copy = pending.toList()
            pending.clear()
            copy
        }
        frames.forEach { live.send(it) }
    }

    private val pending = ArrayDeque<String>()

    /** Decodes a payload into [T], or null when the shape does not match. */
    fun <T> decode(envelope: Envelope, deserializer: kotlinx.serialization.DeserializationStrategy<T>): T? {
        val payload = envelope.payload ?: return null
        return runCatching { json.decodeFromJsonElement(deserializer, payload) }.getOrNull()
    }

    private suspend fun connect() {
        if (!wanted) return
        val token = runCatching { client.bearer.validAccessToken() }.getOrNull()
        if (token == null) {
            Log.d(TAG, "no access token, retrying")
            scheduleReconnect(); return
        }
        val base = client.serverUrl.replaceFirst("http", "ws")
        val request = Request.Builder().url("$base/api/v1/chat/ws?token=$token").build()
        Log.d(TAG, "connecting to $base/api/v1/chat/ws")
        socket = wsClient.newWebSocket(request, listener)
    }

    private fun scheduleReconnect() {
        if (!wanted) return
        // Capped exponential backoff: a module restart should not turn into a
        // reconnect storm from every phone at once.
        val delayMs = (BASE_DELAY_MS shl attempt.coerceAtMost(4)).coerceAtMost(MAX_DELAY_MS)
        attempt++
        scope.launch {
            delay(delayMs)
            connect()
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            attempt = 0
            _connected.value = true
            Log.d(TAG, "connected")
            flushPending()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val envelope = runCatching { json.decodeFromString(Envelope.serializer(), text) }.getOrNull()
                ?: return
            _events.tryEmit(envelope)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.d(TAG, "failure: ${t.javaClass.simpleName}: ${t.message} (http ${response?.code})")
            socket = null
            _connected.value = false
            scheduleReconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            socket = null
            _connected.value = false
            scheduleReconnect()
        }
    }

    private companion object {
        const val TAG = "KubunoChatWs"
        const val NORMAL_CLOSURE = 1000
        const val BASE_DELAY_MS = 2_000L
        const val MAX_DELAY_MS = 30_000L
        const val MAX_PENDING = 32
    }
}
