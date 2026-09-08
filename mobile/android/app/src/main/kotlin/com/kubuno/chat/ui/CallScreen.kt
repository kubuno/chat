package com.kubuno.chat.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kubuno.chat.call.CallEngine
import kotlinx.coroutines.delay
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * The in-call screen.
 *
 * Dark by construction, whatever the app theme: a call is a full-screen video
 * surface, and a light chrome around moving video is unreadable and glaring in
 * the dark, which is where most calls happen.
 */
@Composable
fun CallScreen(
    state: CallEngine.State,
    eglBase: EglBase,
    localTrack: VideoTrack?,
    onToggleMute: () -> Unit,
    onToggleCamera: () -> Unit,
    onSwitchCamera: () -> Unit,
    onToggleHand: () -> Unit,
    onSwitchToVideo: () -> Unit,
    onHangUp: () -> Unit,
    onShareMeeting: () -> Unit = {},
    onEndForAll: () -> Unit = {},
    onParticipantMenu: (String) -> Unit = {},
) {
    var elapsed by remember(state.startedAtMs) { mutableLongStateOf(0L) }
    LaunchedEffect(state.startedAtMs, state.ringing) {
        while (true) {
            elapsed = System.currentTimeMillis() - state.startedAtMs
            delay(1000)
        }
    }

    Box(Modifier.fillMaxSize().background(CALL_BACKDROP)) {

        if (state.participants.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ChatAvatar(title = state.title, url = null, seed = state.room.orEmpty(), size = 96.dp)
                Spacer(Modifier.height(20.dp))
                Text(
                    text = state.title.ifBlank { "Appel" },
                    color = Color.White,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = when {
                        state.error != null -> state.error
                        state.ringing -> "Sonnerie…"
                        else -> "Connexion…"
                    },
                    color = if (state.error != null) Color(0xFFFF8A80) else Color(0xFFB0B6BE),
                    style = ChatType.Preview,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            // One tile per remote participant; two people means one big tile,
            // more means a grid, which is what a mesh call can actually render.
            val columns = if (state.participants.size <= 1) 1 else 2
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(4.dp),
            ) {
                items(state.participants, key = { it.userId }) { participant ->
                    ParticipantTile(
                        participant = participant,
                        eglBase = eglBase,
                        // The host reaches a participant's mute/remove menu by
                        // long-pressing their tile.
                        onLongPress = if (state.isHost) { { onParticipantMenu(participant.userId) } } else null,
                    )
                }
            }
        }

        // Self view, small, top-right — only when we are actually sending video.
        if (state.video && !state.camOff && localTrack != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp)
                    .size(width = 108.dp, height = 152.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Black),
            ) {
                VideoSurface(localTrack, eglBase, mirror = true)
            }
        }

        // Header: who and for how long.
        Column(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(start = 20.dp, top = 24.dp),
        ) {
            Text(
                text = state.title.ifBlank { "Appel" },
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (state.ringing) "Sonnerie…" else duration(elapsed),
                    color = Color(0xFFB0B6BE),
                    style = ChatType.HeaderSub,
                )
                // A meeting says so on the subtitle; a recording announces
                // itself with a red dot, the way a call must.
                if (state.recording) {
                    Spacer(Modifier.width(10.dp))
                    Box(Modifier.size(8.dp).clip(CircleShape).background(Color(0xFFD93025)))
                    Spacer(Modifier.width(4.dp))
                    Text("Enregistrement", color = Color(0xFFFF8A80), style = ChatType.HeaderSub)
                }
            }
            // Meeting actions sit under the title, clear of the self-view that
            // occupies the top-right corner: share the link, and (host) end
            // the meeting for everyone.
            if (state.meeting) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MeetingHeaderButton(Icons.Filled.Share, "Partager le lien", onShareMeeting)
                    if (state.isHost) {
                        MeetingHeaderButton(Icons.Filled.CallEnd, "Terminer pour tous", onEndForAll, danger = true)
                    }
                }
            }
        }

        // Controls.
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CallButton(
                icon = if (state.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                description = if (state.muted) "Réactiver le micro" else "Couper le micro",
                active = state.muted,
                onClick = onToggleMute,
            )
            if (state.video) {
                CallButton(
                    icon = if (state.camOff) Icons.Filled.VideocamOff else Icons.Filled.Videocam,
                    description = if (state.camOff) "Activer la caméra" else "Couper la caméra",
                    active = state.camOff,
                    onClick = onToggleCamera,
                )
                CallButton(
                    icon = Icons.Filled.Cameraswitch,
                    description = "Changer de caméra",
                    active = false,
                    onClick = onSwitchCamera,
                )
            } else {
                // Turning the camera on mid-call is one button, not "hang up
                // and call again with video" — which is what it used to be.
                CallButton(
                    icon = Icons.Filled.Videocam,
                    description = "Passer en vidéo",
                    active = false,
                    onClick = onSwitchToVideo,
                )
                CallButton(
                    icon = Icons.Filled.VolumeUp,
                    description = "Haut-parleur",
                    active = state.speakerOn,
                    onClick = {},
                )
            }
            CallButton(
                icon = Icons.Filled.PanTool,
                description = "Lever la main",
                active = state.handUp,
                onClick = onToggleHand,
            )
            Box(
                modifier = Modifier
                    .size(60.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFD93025))
                    .clickable(onClick = onHangUp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.CallEnd,
                    contentDescription = "Raccrocher",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ParticipantTile(
    participant: CallEngine.Participant,
    eglBase: EglBase,
    onLongPress: (() -> Unit)? = null,
) {
    Box(
        modifier = Modifier
            .padding(4.dp)
            .height(260.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF1A1D21))
            .then(
                if (onLongPress != null) Modifier.combinedClickable(onClick = {}, onLongClick = onLongPress)
                else Modifier
            ),
        contentAlignment = Alignment.Center,
    ) {
        val track = participant.videoTrack
        if (track != null && !participant.camOff) {
            VideoSurface(track, eglBase, mirror = false)
        } else {
            ChatAvatar(title = participant.name, url = null, seed = participant.userId, size = 72.dp)
        }

        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (participant.muted) {
                Icon(
                    Icons.Filled.MicOff,
                    contentDescription = "Micro coupé",
                    tint = Color.White,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(4.dp))
            }
            if (participant.handUp) {
                Icon(
                    Icons.Filled.PanTool,
                    contentDescription = "Main levée",
                    tint = Color(0xFFF2B01E),
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(4.dp))
            }
            Text(
                text = participant.name,
                color = Color.White,
                style = ChatType.BubbleMeta,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (!participant.connected) {
            Text(
                text = "Connexion…",
                color = Color(0xFFB0B6BE),
                style = ChatType.BubbleMeta,
                modifier = Modifier.align(Alignment.TopStart).padding(8.dp),
            )
        }
    }
}

/**
 * A WebRTC video sink.
 *
 * The renderer must be released when it leaves composition, and the track must
 * be un-sunk from it first — otherwise the native layer keeps writing frames
 * into a dead surface and the app dies a few seconds after a call ends.
 */
@Composable
private fun VideoSurface(track: VideoTrack, eglBase: EglBase, mirror: Boolean) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                init(eglBase.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                setMirror(mirror)
                track.addSink(this)
            }
        },
        onRelease = { renderer ->
            runCatching { track.removeSink(renderer) }
            runCatching { renderer.release() }
        },
    )
}

/** Full-screen incoming call, the one thing that must interrupt everything. */
@Composable
fun IncomingCallOverlay(
    call: CallEngine.Incoming,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(CALL_BACKDROP), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            ChatAvatar(title = call.fromName, url = null, seed = call.fromUserId, size = 108.dp)
            Spacer(Modifier.height(20.dp))
            Text(
                text = call.fromName,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (call.video) "Appel vidéo entrant" else "Appel entrant",
                color = Color(0xFFB0B6BE),
                style = ChatType.Preview,
            )
            Spacer(Modifier.height(48.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(48.dp)) {
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFD93025))
                        .clickable(onClick = onDecline),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.CallEnd,
                        contentDescription = "Refuser",
                        tint = Color.White,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF1E8E3E))
                        .clickable(onClick = onAccept),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (call.video) Icons.Filled.Videocam else Icons.Filled.Mic,
                        contentDescription = "Répondre",
                        tint = Color.White,
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun CallButton(
    icon: ImageVector,
    description: String,
    active: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(52.dp)
            .clip(CircleShape)
            .background(if (active) Color.White else Color(0x33FFFFFF))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = if (active) Color(0xFF17181B) else Color.White,
            modifier = Modifier.size(24.dp),
        )
    }
}

@Composable
private fun MeetingHeaderButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    danger: Boolean = false,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (danger) Color(0x33D93025) else Color(0x33FFFFFF))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = if (danger) Color(0xFFFF8A80) else Color.White,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            description,
            color = if (danger) Color(0xFFFF8A80) else Color.White,
            style = ChatType.HeaderSub,
        )
    }
}

private fun duration(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val minutes = total / 60
    val seconds = total % 60
    return if (minutes >= 60) "%d:%02d:%02d".format(minutes / 60, minutes % 60, seconds)
    else "%d:%02d".format(minutes, seconds)
}

private val CALL_BACKDROP = Color(0xFF0E1013)
