package com.kubuno.chat.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.MediaPlayback
import java.io.File
import java.util.Locale
import kotlin.math.roundToInt

/**
 * The attachment part of a bubble.
 *
 * Every kind shares one rule: the blob is downloaded and decrypted lazily, the
 * first time its bubble is composed. Until that lands, the bubble shows the
 * shape it will take — dimensions and duration travel in clear precisely so the
 * layout does not jump when the bytes arrive.
 */
@Composable
fun MediaContent(
    message: UiMessage,
    media: ChatEnvelope.Media,
    file: File?,
    playback: MediaPlayback.State,
    outgoing: Boolean,
    onRequest: () -> Unit,
    onOpen: () -> Unit,
    onTogglePlay: () -> Unit,
    onCycleSpeed: () -> Unit,
    onSeek: (Float) -> Unit,
) {
    // Pending uploads have no media id yet; nothing to fetch.
    LaunchedEffect(media.mediaId) {
        if (media.mediaId.isNotBlank() && file == null) onRequest()
    }

    when {
        media.voice || (media.kind == "audio" && media.waveform != null) ->
            VoiceContent(message, media, file, playback, outgoing, onTogglePlay, onCycleSpeed, onSeek)

        media.kind == "image" || media.kind == "sticker" || media.kind == "gif" ->
            ImageContent(media, file, message.pending, onOpen)

        media.kind == "video" -> VideoContent(media, file, message.pending, onOpen)

        media.kind == "audio" ->
            VoiceContent(message, media, file, playback, outgoing, onTogglePlay, onCycleSpeed, onSeek)

        else -> DocumentContent(media, file, outgoing, onOpen)
    }
}

@Composable
private fun ImageContent(media: ChatEnvelope.Media, file: File?, pending: Boolean, onOpen: () -> Unit) {
    // Keep the sender's aspect ratio so the bubble does not resize on arrival;
    // clamp it so a panorama or a tall screenshot stays a reasonable card.
    val ratio = aspectRatio(media)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(enabled = file != null, onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        if (file != null) {
            AsyncImage(
                model = file,
                contentDescription = media.name.ifBlank { "Image" },
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(ratio),
            )
        } else {
            Pending(pending)
        }
    }
}

@Composable
private fun VideoContent(media: ChatEnvelope.Media, file: File?, pending: Boolean, onOpen: () -> Unit) {
    val ratio = aspectRatio(media)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(enabled = file != null, onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        if (file != null) {
            // Coil decodes a frame from a local video file, so the poster is
            // the real first frame rather than a grey rectangle.
            AsyncImage(
                model = file,
                contentDescription = media.name.ifBlank { "Vidéo" },
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(ratio),
            )
            Box(
                Modifier.size(48.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.PlayArrow,
                    contentDescription = "Lire",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
        } else {
            Pending(pending)
        }
        media.duration?.let { seconds ->
            Text(
                text = clock(seconds),
                style = ChatType.BubbleMeta,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Color.Black.copy(alpha = 0.5f))
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            )
        }
    }
}

@Composable
private fun DocumentContent(
    media: ChatEnvelope.Media,
    file: File?,
    outgoing: Boolean,
    onOpen: () -> Unit,
) {
    val palette = ChatTheme.palette
    val onBubble = if (outgoing) palette.onBubbleOut else palette.onBubbleIn
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(if (outgoing) palette.quoteOut else palette.quoteIn)
            .clickable(enabled = file != null, onClick = onOpen)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (file == null) Icons.Filled.Download else Icons.Filled.Description,
            contentDescription = null,
            tint = onBubble,
            modifier = Modifier.size(28.dp),
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = media.name.ifBlank { "Document" },
                style = ChatType.Preview,
                color = onBubble,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = humanSize(media.size),
                style = ChatType.BubbleMeta,
                color = onBubble.copy(alpha = 0.7f),
            )
        }
    }
}

/**
 * A voice message: play button, waveform, duration, speed.
 *
 * The waveform is drawn from the peaks the sender captured while recording, so
 * it is the real shape of the clip — not a decorative pattern. Tapping anywhere
 * on it seeks, which is the whole reason to draw it at that size.
 */
@Composable
private fun VoiceContent(
    message: UiMessage,
    media: ChatEnvelope.Media,
    file: File?,
    playback: MediaPlayback.State,
    outgoing: Boolean,
    onTogglePlay: () -> Unit,
    onCycleSpeed: () -> Unit,
    onSeek: (Float) -> Unit,
) {
    val palette = ChatTheme.palette
    val onBubble = if (outgoing) palette.onBubbleOut else palette.onBubbleIn
    val active = playback.messageId == message.id
    val progress = if (active) playback.progress else 0f
    val peaks = media.waveform.orEmpty()

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(onBubble.copy(alpha = 0.15f))
                .clickable(enabled = file != null || message.pending.not(), onClick = onTogglePlay),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (active && playback.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (active && playback.playing) "Pause" else "Lire",
                tint = onBubble,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.width(8.dp))

        Column(Modifier.weight(1f)) {
            Waveform(
                peaks = peaks,
                progress = progress,
                color = onBubble,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .pointerInput(message.id, file) {
                        detectTapGestures { offset ->
                            if (active) onSeek((offset.x / size.width).coerceIn(0f, 1f))
                        }
                    },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = clock(
                        if (active && playback.durationMs > 0) playback.positionMs / 1000.0
                        else media.duration ?: 0.0
                    ),
                    style = ChatType.BubbleMeta,
                    color = onBubble.copy(alpha = 0.7f),
                )
                if (active) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "×${trimSpeed(playback.speed)}",
                        style = ChatType.BubbleMeta,
                        color = onBubble,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(onBubble.copy(alpha = 0.15f))
                            .clickable(onClick = onCycleSpeed)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
        }
    }
}

/** Bars from the recorded peaks; the played part is solid, the rest faded. */
@Composable
private fun Waveform(
    peaks: List<Float>,
    progress: Float,
    color: Color,
    modifier: Modifier = Modifier,
) {
    // A clip with no captured peaks still needs a shape, or the row collapses
    // into an unreadable sliver; a flat low bar reads as "audio" honestly.
    val bars = if (peaks.isEmpty()) List(BAR_COUNT) { 0.25f } else peaks
    Canvas(modifier) {
        val count = bars.size.coerceAtMost(BAR_COUNT)
        if (count == 0) return@Canvas
        val step = size.width / count
        val barWidth = (step * 0.55f).coerceAtLeast(2f)
        val playedUntil = size.width * progress
        for (index in 0 until count) {
            // Downsample rather than crop: the shape must stay the whole clip.
            val peak = bars[(index * bars.size / count).coerceAtMost(bars.lastIndex)]
            val height = (size.height * peak.coerceIn(0.08f, 1f))
            val x = index * step + (step - barWidth) / 2
            val top = (size.height - height) / 2
            drawRoundRect(
                color = if (x < playedUntil) color else color.copy(alpha = 0.35f),
                topLeft = Offset(x, top),
                size = androidx.compose.ui.geometry.Size(barWidth, height),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(barWidth / 2),
            )
        }
    }
}

@Composable
private fun Pending(uploading: Boolean) {
    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            modifier = Modifier.size(24.dp),
            strokeWidth = 2.dp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun aspectRatio(media: ChatEnvelope.Media): Float {
    val width = media.width ?: 0
    val height = media.height ?: 0
    if (width <= 0 || height <= 0) return 4f / 3f
    return (width.toFloat() / height).coerceIn(0.6f, 1.9f)
}

private fun clock(seconds: Double): String {
    val total = seconds.roundToInt().coerceAtLeast(0)
    return "%d:%02d".format(Locale.getDefault(), total / 60, total % 60)
}

private fun trimSpeed(speed: Float): String =
    if (speed == speed.toInt().toFloat()) "${speed.toInt()}" else "$speed"

private fun humanSize(bytes: Long): String = when {
    bytes >= 1_000_000 -> "%.1f Mo".format(Locale.getDefault(), bytes / 1_000_000.0)
    bytes >= 1_000 -> "%d ko".format(Locale.getDefault(), bytes / 1_000)
    else -> "$bytes o"
}

private const val BAR_COUNT = 48
