package com.kubuno.chat.net

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.log10
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
 * Records a voice message to AAC/M4A and samples its level as it goes.
 *
 * The waveform is captured live from [MediaRecorder.getMaxAmplitude] rather
 * than analysed afterwards: decoding the file back would cost a second pass
 * over it, and the recipient only needs a shape, not a spectrum.
 */
@Singleton
class VoiceRecorder @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    data class State(
        val recording: Boolean = false,
        val paused: Boolean = false,
        val elapsedMs: Long = 0,
        /** Normalised peaks in [0,1], oldest first. */
        val waveform: List<Float> = emptyList(),
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var recorder: MediaRecorder? = null
    private var output: File? = null
    private var sampler: Job? = null
    private var startedAtMs = 0L
    private var accumulatedMs = 0L

    /** Begins a new recording; returns false when the microphone is unavailable. */
    fun start(): Boolean {
        if (_state.value.recording) return true
        val file = File(context.cacheDir, "voice-${System.currentTimeMillis()}.m4a")
        val created = runCatching {
            @Suppress("DEPRECATION") // the Context overload only exists from API 31
            val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context)
            else MediaRecorder()
            rec.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(BIT_RATE)
                setAudioSamplingRate(SAMPLE_RATE)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
        }.onFailure { Log.w(TAG, "could not start recording", it) }.getOrNull()

        if (created == null) {
            file.delete()
            return false
        }
        recorder = created
        output = file
        startedAtMs = System.currentTimeMillis()
        accumulatedMs = 0
        _state.value = State(recording = true)
        startSampling()
        return true
    }

    /** Pause and resume need API 24+, which minSdk 26 guarantees. */
    fun pause() {
        val rec = recorder ?: return
        if (!_state.value.recording || _state.value.paused) return
        runCatching { rec.pause() }.onFailure { Log.w(TAG, "pause failed", it); return }
        accumulatedMs += System.currentTimeMillis() - startedAtMs
        sampler?.cancel()
        _state.value = _state.value.copy(paused = true, elapsedMs = accumulatedMs)
    }

    fun resume() {
        val rec = recorder ?: return
        if (!_state.value.paused) return
        runCatching { rec.resume() }.onFailure { Log.w(TAG, "resume failed", it); return }
        startedAtMs = System.currentTimeMillis()
        _state.value = _state.value.copy(paused = false)
        startSampling()
    }

    /** Finishes and returns the recording, or null if it was too short to send. */
    fun stop(): Result? {
        val rec = recorder ?: return null
        val file = output
        sampler?.cancel()
        val ok = runCatching { rec.stop() }.isSuccess
        runCatching { rec.release() }
        recorder = null
        output = null

        val elapsed = accumulatedMs + if (_state.value.paused) 0 else System.currentTimeMillis() - startedAtMs
        val waveform = _state.value.waveform
        _state.value = State()

        if (!ok || file == null || !file.exists() || elapsed < MIN_DURATION_MS) {
            file?.delete()
            return null
        }
        return Result(file, elapsed / 1000.0, waveform)
    }

    /** Throws the recording away — the "slide to cancel" gesture. */
    fun cancel() {
        sampler?.cancel()
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        recorder = null
        output?.delete()
        output = null
        _state.value = State()
    }

    data class Result(val file: File, val durationSeconds: Double, val waveform: List<Float>)

    private fun startSampling() {
        sampler?.cancel()
        sampler = scope.launch {
            while (true) {
                delay(SAMPLE_EVERY_MS)
                val rec = recorder ?: break
                val amplitude = runCatching { rec.maxAmplitude }.getOrDefault(0)
                // Amplitude is linear 0..32767; the ear is not, so store dB
                // mapped into 0..1 or the waveform is a flat line with spikes.
                val level = if (amplitude <= 1) 0f else {
                    ((20 * log10(amplitude / 32767.0) + DB_FLOOR) / DB_FLOOR)
                        .coerceIn(0.0, 1.0)
                        .toFloat()
                }
                _state.update { current ->
                    current.copy(
                        elapsedMs = accumulatedMs + (System.currentTimeMillis() - startedAtMs),
                        waveform = (current.waveform + level).takeLast(MAX_PEAKS),
                    )
                }
            }
        }
    }

    private inline fun MutableStateFlow<State>.update(block: (State) -> State) {
        value = block(value)
    }

    private companion object {
        const val TAG = "KubunoChatVoice"
        const val BIT_RATE = 64_000
        const val SAMPLE_RATE = 44_100
        const val SAMPLE_EVERY_MS = 80L
        const val MAX_PEAKS = 96
        const val MIN_DURATION_MS = 600L
        const val DB_FLOOR = 60.0
    }
}
