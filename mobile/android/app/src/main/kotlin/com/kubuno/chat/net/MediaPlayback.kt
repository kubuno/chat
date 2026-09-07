package com.kubuno.chat.net

import android.media.MediaPlayer
import android.util.Log
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Plays one voice message or audio attachment at a time.
 *
 * Single instance on purpose: starting a second clip must stop the first, the
 * way every messenger behaves. Playback survives leaving the conversation, so
 * a long voice note keeps going while the user browses the list — that is the
 * "listen outside the chat" behaviour people expect.
 */
@Singleton
class MediaPlayback @Inject constructor() {

    data class State(
        /** Message id currently playing, or null when nothing is. */
        val messageId: String? = null,
        val positionMs: Int = 0,
        val durationMs: Int = 0,
        val speed: Float = 1f,
        val playing: Boolean = false,
    ) {
        val progress: Float
            get() = if (durationMs <= 0) 0f else (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var player: MediaPlayer? = null
    private var ticker: Job? = null

    /** Starts [file] for [messageId], or pauses/resumes if it is already loaded. */
    fun toggle(messageId: String, file: File) {
        val current = _state.value
        if (current.messageId == messageId && player != null) {
            if (current.playing) pause() else resume()
            return
        }
        stop()
        val created = runCatching {
            MediaPlayer().apply {
                setDataSource(file.absolutePath)
                prepare()
                setOnCompletionListener { stop() }
                start()
            }
        }.onFailure { Log.w(TAG, "playback failed", it) }.getOrNull() ?: return

        player = created
        _state.value = State(
            messageId = messageId,
            durationMs = created.duration,
            playing = true,
            speed = 1f,
        )
        startTicker()
    }

    /** Cycles 1× → 1.5× → 2× → 1×, like the messengers people already use. */
    fun cycleSpeed() {
        val next = when (_state.value.speed) {
            1f -> 1.5f
            1.5f -> 2f
            else -> 1f
        }
        val current = player ?: run {
            _state.value = _state.value.copy(speed = next)
            return
        }
        runCatching {
            val wasPlaying = current.isPlaying
            current.playbackParams = current.playbackParams.setSpeed(next)
            // Setting playbackParams starts a paused player; keep the state honest.
            if (!wasPlaying) current.pause()
        }.onFailure { Log.w(TAG, "speed change failed", it) }
        _state.value = _state.value.copy(speed = next)
    }

    fun seekTo(fraction: Float) {
        val current = player ?: return
        val target = (current.duration * fraction).toInt().coerceIn(0, current.duration)
        runCatching { current.seekTo(target) }
        _state.value = _state.value.copy(positionMs = target)
    }

    fun pause() {
        runCatching { player?.pause() }
        ticker?.cancel()
        _state.value = _state.value.copy(playing = false)
    }

    fun resume() {
        val current = player ?: return
        runCatching { current.start() }
        _state.value = _state.value.copy(playing = true)
        startTicker()
    }

    fun stop() {
        ticker?.cancel()
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        _state.value = State()
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                delay(TICK_MS)
                val current = player ?: break
                val position = runCatching { current.currentPosition }.getOrNull() ?: break
                _state.value = _state.value.copy(positionMs = position)
            }
        }
    }

    private companion object {
        const val TAG = "KubunoChatPlayer"
        const val TICK_MS = 120L
    }
}
