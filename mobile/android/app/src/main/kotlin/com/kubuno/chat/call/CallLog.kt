package com.kubuno.chat.call

import android.content.Context
import android.util.Log
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The device's own record of who called whom, and the missed-call count the
 * Appels tab carries as a badge.
 *
 * WHY IT IS LOCAL. The module signals calls and stores nothing about them:
 * there is no call history endpoint to read, and a ring that nobody answers
 * leaves no trace on the server at all. So the history is built here, from what
 * this device witnessed — which also means it is per-device, exactly like the
 * call log of a phone, and never leaves it.
 *
 * A ring is written as soon as it is seen, including from a push that woke a
 * dead process, and only later becomes answered, declined or missed. A ring
 * whose ending was never observed — the usual case for a push that arrived
 * while the app was not running — ages into a missed call once it is older than
 * any plausible ring, which is precisely what it was.
 */
object CallLog {

    /** How a call ended, from this device's point of view. */
    enum class Outcome {
        /** Still ringing, or the app died before it saw the end. */
        Ringing,
        Answered,
        /** Rang here and nobody picked up. */
        Missed,
        /** Rang here and was refused on purpose — seen, so never a badge. */
        Declined,
        /** We rang and the other side never answered. */
        NoAnswer,
    }

    @Serializable
    data class Entry(
        val id: String,
        val room: String,
        val peerUserId: String,
        val peerName: String,
        val video: Boolean,
        val incoming: Boolean,
        val outcome: Outcome,
        val startedAtMs: Long,
        val durationSecs: Long = 0,
        /** True once the Appels tab has been opened after this call. */
        val seen: Boolean = false,
    )

    private const val TAG = "KubunoChatCallLog"
    private const val FILE = "call-log.json"
    private const val MAX = 200

    /**
     * How long a ring may stay unresolved before it counts as missed. Long
     * enough to outlast a real ring, short enough that a missed call shows up
     * the next time the app is opened rather than a day later.
     */
    private const val RING_TIMEOUT_MS = 90_000L

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    // One writer, in order: the log is touched from the call engine on the main
    // thread and from the push receiver on a broadcast thread.
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private var appContext: Context? = null
    private var loaded = false

    private val _entries = MutableStateFlow<List<Entry>>(emptyList())
    val entries: StateFlow<List<Entry>> = _entries.asStateFlow()

    /** Number of missed calls the user has not looked at yet. */
    val missedCount: StateFlow<Int> = MutableStateFlow(0)

    /** Called from every entry point; the first one wins. */
    @Synchronized
    fun attach(context: Context) {
        if (appContext == null) appContext = context.applicationContext
        if (!loaded) load()
    }

    // ------------------------------------------------------------- recording

    /** A call started ringing, in either direction. Returns its entry id. */
    @Synchronized
    fun ringing(
        room: String,
        peerUserId: String,
        peerName: String,
        video: Boolean,
        incoming: Boolean,
    ): String {
        val now = System.currentTimeMillis()
        // A ring seen twice — over the socket and through the push — is one
        // call, so an unresolved ring for the same pair is reused rather than
        // logged again.
        inFlight(room, peerUserId)?.let { existing ->
            update(existing.id) {
                it.copy(
                    peerName = peerName.ifBlank { it.peerName },
                    video = it.video || video,
                )
            }
            return existing.id
        }
        val entry = Entry(
            id = "$room:$peerUserId:$now",
            room = room,
            peerUserId = peerUserId,
            peerName = peerName.ifBlank { peerUserId.take(6) },
            video = video,
            incoming = incoming,
            outcome = Outcome.Ringing,
            startedAtMs = now,
        )
        write(listOf(entry) + _entries.value)
        return entry.id
    }

    /** The call was picked up. */
    @Synchronized
    fun answered(room: String, peerUserId: String) {
        val entry = inFlight(room, peerUserId) ?: return
        update(entry.id) { it.copy(outcome = Outcome.Answered, seen = true) }
    }

    /** The call ended after being answered. */
    @Synchronized
    fun ended(room: String, peerUserId: String, durationSecs: Long) {
        val entry = latestFor(room, peerUserId) ?: return
        if (entry.outcome != Outcome.Answered) return
        update(entry.id) { it.copy(durationSecs = durationSecs) }
    }

    /** Nobody picked up here. */
    @Synchronized
    fun missed(room: String, peerUserId: String) {
        val entry = inFlight(room, peerUserId) ?: return
        update(entry.id) { it.copy(outcome = Outcome.Missed, seen = false) }
    }

    /** Refused here, on purpose. */
    @Synchronized
    fun declined(room: String, peerUserId: String) {
        val entry = inFlight(room, peerUserId) ?: return
        update(entry.id) { it.copy(outcome = Outcome.Declined, seen = true) }
    }

    /** We rang and gave up before an answer. */
    @Synchronized
    fun noAnswer(room: String, peerUserId: String) {
        val entry = inFlight(room, peerUserId) ?: return
        update(entry.id) { it.copy(outcome = Outcome.NoAnswer, seen = true) }
    }

    /** The Appels tab was opened: the badge clears. */
    @Synchronized
    fun markAllSeen() {
        if (_entries.value.none { !it.seen }) return
        write(_entries.value.map { if (it.seen) it else it.copy(seen = true) })
    }

    @Synchronized
    fun clear() = write(emptyList())

    // ---------------------------------------------------------------- lookup

    private fun inFlight(room: String, peerUserId: String): Entry? =
        _entries.value.firstOrNull {
            it.room == room && it.peerUserId == peerUserId && it.outcome == Outcome.Ringing
        }

    private fun latestFor(room: String, peerUserId: String): Entry? =
        _entries.value.firstOrNull { it.room == room && it.peerUserId == peerUserId }

    private fun update(id: String, change: (Entry) -> Entry) {
        write(_entries.value.map { if (it.id == id) change(it) else it })
    }

    // ----------------------------------------------------------- persistence

    private fun file(): File? = appContext?.let { File(it.filesDir, FILE) }

    private fun load() {
        val target = file() ?: return
        loaded = true
        val raw = runCatching { if (target.exists()) target.readText() else null }
            .onFailure { Log.w(TAG, "could not read the call log", it) }
            .getOrNull() ?: return
        val stored = runCatching { json.decodeFromString<List<Entry>>(raw) }
            .onFailure { Log.w(TAG, "unreadable call log, starting a new one", it) }
            .getOrDefault(emptyList())
        // Resolve rings whose ending this device never saw — a push that woke a
        // process which then died is the common case, and it was a missed call.
        val cutoff = System.currentTimeMillis() - RING_TIMEOUT_MS
        val resolved = stored.map { entry ->
            if (entry.outcome != Outcome.Ringing || entry.startedAtMs > cutoff) entry
            else entry.copy(outcome = if (entry.incoming) Outcome.Missed else Outcome.NoAnswer)
        }
        publish(resolved)
        if (resolved != stored) persist(resolved)
    }

    private fun write(next: List<Entry>) {
        val capped = next.sortedByDescending { it.startedAtMs }.take(MAX)
        publish(capped)
        persist(capped)
    }

    private fun publish(next: List<Entry>) {
        _entries.value = next
        (missedCount as MutableStateFlow).value =
            next.count { it.outcome == Outcome.Missed && !it.seen }
    }

    private fun persist(next: List<Entry>) {
        val target = file() ?: return
        io.launch {
            runCatching { target.writeText(json.encodeToString(next)) }
                .onFailure { Log.w(TAG, "could not save the call log", it) }
        }
    }
}
