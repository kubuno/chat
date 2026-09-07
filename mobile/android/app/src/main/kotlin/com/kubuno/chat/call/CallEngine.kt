package com.kubuno.chat.call

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate as RtcIceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * One audio or video call, mesh topology, interoperable with the web client.
 *
 * Mesh means one PeerConnection per remote participant: fine for the small
 * calls this module supports, and it is what the browser does, so a phone and a
 * browser negotiate the same way. A real SFU would be a server-side project.
 *
 * ON ICE SERVERS. They come from the instance (GET /chat/config), read fresh at
 * the start of every call, and there is no fallback to anyone else. See
 * useIceServers and iceServers below for why.
 */
@Singleton
class CallEngine @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    data class Participant(
        val userId: String,
        val name: String,
        val videoTrack: VideoTrack? = null,
        val muted: Boolean = false,
        val camOff: Boolean = false,
        val handUp: Boolean = false,
        val connected: Boolean = false,
    )

    data class State(
        val room: String? = null,
        val title: String = "",
        val video: Boolean = false,
        val active: Boolean = false,
        /** True between "we rang" and the first peer answering. */
        val ringing: Boolean = false,
        val muted: Boolean = false,
        val camOff: Boolean = false,
        val speakerOn: Boolean = true,
        val handUp: Boolean = false,
        val participants: List<Participant> = emptyList(),
        val startedAtMs: Long = 0,
        val error: String? = null,
    )

    /** An inbound ring the user has not answered yet. */
    data class Incoming(
        val room: String,
        val fromUserId: String,
        val fromName: String,
        val video: Boolean,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _incoming = MutableStateFlow<Incoming?>(null)
    val incoming: StateFlow<Incoming?> = _incoming.asStateFlow()

    /** Set by the owner so the engine can put signals on the chat socket. */
    var onSignal: ((toUserId: String, signal: CallSignal) -> Unit)? = null
    var myName: String = ""
    var myUserId: String = ""

    val eglBase: EglBase by lazy { EglBase.create() }

    private var factory: PeerConnectionFactory? = null
    private var localAudio: AudioTrack? = null
    private var localVideo: VideoTrack? = null
    private var videoSource: VideoSource? = null
    private var capturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var frontFacing = true

    private val peers = ConcurrentHashMap<String, Peer>()

    /** Everyone we should ring when the call starts (a direct call has one). */
    private var ringTargets: List<Pair<String, String>> = emptyList()

    private class Peer(
        val connection: PeerConnection,
        var name: String,
        val pendingIce: MutableList<RtcIceCandidate> = mutableListOf(),
        var remoteSet: Boolean = false,
    )

    // ------------------------------------------------------------- lifecycle

    private fun ensureFactory(): PeerConnectionFactory {
        factory?.let { return it }
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )
        // The native stack is silent by default, so a failed negotiation shows
        // up only as "FAILED" with no reason. Warnings are cheap and are the
        // only way to tell a DTLS error from an ICE one after the fact.
        org.webrtc.Logging.enableLogToDebugOutput(org.webrtc.Logging.Severity.LS_WARNING)
        val audioModule = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule()
        val created = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioModule)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
        factory = created
        return created
    }

    /**
     * Starts a call in [room]. [ring] is who to ring; passing an empty list
     * joins an existing call instead of starting one.
     */
    fun start(room: String, title: String, video: Boolean, ring: List<Pair<String, String>>) {
        if (_state.value.active) return
        val factory = ensureFactory()
        ringTargets = ring

        if (!openLocalMedia(factory, video)) {
            _state.update { State(error = "Micro ou caméra indisponible") }
            return
        }

        _state.value = State(
            room = room,
            title = title,
            video = video,
            active = true,
            ringing = ring.isNotEmpty(),
            startedAtMs = System.currentTimeMillis(),
        )

        val callType = if (video) "video" else "audio"
        // Ring the people we are calling, then announce ourselves to the room
        // so anyone already in it starts a connection with us.
        ring.forEach { (userId, _) ->
            emit(userId, CallSignal(type = CallSignal.RING, room = room, callType = callType, fromName = myName))
        }
        broadcast(CallSignal(type = CallSignal.JOIN, room = room, callType = callType, fromName = myName))
    }

    /** Accepts the call being rung. */
    fun accept() {
        val call = _incoming.value ?: return
        _incoming.value = null
        start(call.room, call.fromName, call.video, ring = emptyList())
    }

    /** Declines the call being rung. */
    fun decline() {
        val call = _incoming.value ?: return
        _incoming.value = null
        emit(call.fromUserId, CallSignal(type = CallSignal.LEAVE, room = call.room))
    }

    fun hangUp() {
        val room = _state.value.room
        if (room != null) broadcast(CallSignal(type = CallSignal.LEAVE, room = room))
        peers.values.forEach { runCatching { it.connection.close() } }
        peers.clear()
        closeLocalMedia()
        _state.value = State()
    }

    // ---------------------------------------------------------------- toggles

    fun toggleMute() {
        val muted = !_state.value.muted
        localAudio?.setEnabled(!muted)
        _state.update { it.copy(muted = muted) }
        _state.value.room?.let { broadcast(CallSignal(type = CallSignal.STATE, room = it, muted = muted)) }
    }

    fun toggleCamera() {
        val off = !_state.value.camOff
        localVideo?.setEnabled(!off)
        _state.update { it.copy(camOff = off) }
        _state.value.room?.let { broadcast(CallSignal(type = CallSignal.STATE, room = it, camOff = off)) }
    }

    fun toggleHand() {
        val up = !_state.value.handUp
        _state.update { it.copy(handUp = up) }
        _state.value.room?.let { broadcast(CallSignal(type = CallSignal.STATE, room = it, hand = up)) }
    }

    fun switchCamera() {
        (capturer as? org.webrtc.CameraVideoCapturer)?.switchCamera(null)
        frontFacing = !frontFacing
    }

    fun setSpeaker(on: Boolean) {
        _state.update { it.copy(speakerOn = on) }
    }

    val localVideoTrack: VideoTrack? get() = localVideo

    // -------------------------------------------------------------- signalling

    /** Handles one inbound signal from [fromUserId]. */
    fun onSignal(fromUserId: String, signal: CallSignal) {
        if (fromUserId == myUserId) return
        val room = _state.value.room
        Log.d(TAG, "<- ${signal.type} from ${fromUserId.take(8)} room=${signal.room.take(8)} sdp=${signal.sdp?.length ?: 0}")

        when (signal.type) {
            CallSignal.RING -> {
                // Only surface a ring we are not already in a call for.
                if (_state.value.active) return
                _incoming.value = Incoming(
                    room = signal.room,
                    fromUserId = fromUserId,
                    fromName = signal.fromName ?: fromUserId.take(6),
                    video = signal.callType == "video",
                )
            }

            CallSignal.JOIN -> {
                if (room != signal.room) return
                _state.update { it.copy(ringing = false) }
                // Tell the newcomer we are here, then connect — but only one
                // side may offer (see amOfferer).
                emit(fromUserId, CallSignal(type = CallSignal.PRESENT, room = signal.room, fromName = myName))
                val peer = peerFor(fromUserId, signal.fromName)
                if (amOfferer(fromUserId)) offerTo(fromUserId, peer)
            }

            CallSignal.PRESENT -> {
                if (room != signal.room) return
                _state.update { it.copy(ringing = false) }
                val peer = peerFor(fromUserId, signal.fromName)
                if (amOfferer(fromUserId)) offerTo(fromUserId, peer)
            }

            CallSignal.OFFER -> {
                if (room != signal.room || signal.sdp == null) return
                val peer = peerFor(fromUserId, signal.fromName)
                peer.connection.setRemoteDescription(
                    object : SimpleSdpObserver("setRemote(offer)") {
                        override fun onSetSuccess() {
                            peer.remoteSet = true
                            drainIce(peer)
                            answerTo(fromUserId, peer)
                        }
                    },
                    SessionDescription(SessionDescription.Type.OFFER, signal.sdp),
                )
            }

            CallSignal.ANSWER -> {
                if (room != signal.room || signal.sdp == null) return
                val peer = peers[fromUserId] ?: return
                peer.connection.setRemoteDescription(
                    object : SimpleSdpObserver("setRemote(answer)") {
                        override fun onSetSuccess() {
                            peer.remoteSet = true
                            drainIce(peer)
                        }
                    },
                    SessionDescription(SessionDescription.Type.ANSWER, signal.sdp),
                )
            }

            CallSignal.ICE -> {
                val candidate = signal.candidate ?: return
                val peer = peers[fromUserId] ?: return
                val ice = RtcIceCandidate(
                    candidate.sdpMid.orEmpty(),
                    candidate.sdpMLineIndex ?: 0,
                    candidate.candidate,
                )
                // A candidate that arrives before the remote description would
                // be dropped by the native layer; hold it until it can land.
                if (peer.remoteSet) peer.connection.addIceCandidate(ice) else peer.pendingIce += ice
            }

            CallSignal.LEAVE -> {
                if (_incoming.value?.fromUserId == fromUserId) _incoming.value = null
                peers.remove(fromUserId)?.let { runCatching { it.connection.close() } }
                syncParticipants()
                // A one-to-one call is over when the other side leaves.
                if (peers.isEmpty() && _state.value.active && ringTargets.size <= 1) hangUp()
            }

            CallSignal.STATE -> {
                _state.update { current ->
                    current.copy(participants = current.participants.map { participant ->
                        if (participant.userId != fromUserId) participant
                        else participant.copy(
                            muted = signal.muted ?: participant.muted,
                            camOff = signal.camOff ?: participant.camOff,
                            handUp = signal.hand ?: participant.handUp,
                        )
                    })
                }
            }
        }
    }

    // ------------------------------------------------------------------ peers

    /**
     * Which side creates the offer for a given peer.
     *
     * WebRTC has no built-in tie-break: if both ends call createOffer on the
     * same connection you get glare, and the negotiation that survives is
     * whichever arrived last — which is how a call ends up with ICE connected
     * and DTLS failing. The web client settles it by comparing user ids, so
     * this client uses exactly the same comparison; anything else and a phone
     * and a browser would both offer, or neither would.
     */
    private fun amOfferer(other: String): Boolean = myUserId < other

    private fun peerFor(userId: String, name: String?): Peer {
        peers[userId]?.let { existing ->
            if (!name.isNullOrBlank()) existing.name = name
            return existing
        }
        val factory = ensureFactory()
        val config = PeerConnection.RTCConfiguration(iceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val connection = factory.createPeerConnection(
            config,
            object : SimplePeerObserver() {
                override fun onIceCandidate(candidate: RtcIceCandidate) {
                    emit(
                        userId,
                        CallSignal(
                            type = CallSignal.ICE,
                            room = _state.value.room.orEmpty(),
                            candidate = IceCandidate(
                                candidate = candidate.sdp,
                                sdpMid = candidate.sdpMid,
                                sdpMLineIndex = candidate.sdpMLineIndex,
                            ),
                        ),
                    )
                }

                override fun onTrackAdded(receiver: RtpReceiver) {
                    (receiver.track() as? VideoTrack)?.let { track ->
                        _state.update { current ->
                            current.copy(participants = current.participants.map {
                                if (it.userId == userId) it.copy(videoTrack = track) else it
                            })
                        }
                    }
                }

                override fun onIceStateChanged(state: PeerConnection.IceConnectionState) {
                    // Timestamped because the interesting failure is an ICE
                    // that connects and a connection that fails milliseconds
                    // later: without the two clocks side by side the two are
                    // indistinguishable in a log.
                    Log.d(TAG, "ice $state for ${userId.take(8)} at ${System.currentTimeMillis()}")
                }

                override fun onPeerStateChanged(newState: PeerConnection.PeerConnectionState) {
                    Log.d(TAG, "conn $newState for ${userId.take(8)} at ${System.currentTimeMillis()}")
                    val connected = newState == PeerConnection.PeerConnectionState.CONNECTED
                    _state.update { current ->
                        current.copy(
                            ringing = if (connected) false else current.ringing,
                            participants = current.participants.map {
                                if (it.userId == userId) it.copy(connected = connected) else it
                            },
                        )
                    }
                    if (newState == PeerConnection.PeerConnectionState.FAILED ||
                        newState == PeerConnection.PeerConnectionState.CLOSED
                    ) {
                        Log.w(TAG, "peer $userId ended in $newState")
                        // Drop the dead connection rather than leaving a tile
                        // stuck on "connecting" forever, exactly as the web does.
                        peers.remove(userId)?.let { runCatching { it.connection.close() } }
                        syncParticipants()
                        // Do NOT blame TURN here. A failure at this point can be
                        // a missing relay, but it can equally be a DTLS error on
                        // a path ICE did connect, and telling the user the wrong
                        // cause is worse than telling them none.
                        if (peers.isEmpty()) {
                            _state.update { it.copy(error = "Connexion interrompue avec ce participant") }
                        }
                    }
                }
            },
        ) ?: throw IllegalStateException("PeerConnection could not be created")

        localAudio?.let { connection.addTrack(it, listOf(STREAM_ID)) }
        localVideo?.let { connection.addTrack(it, listOf(STREAM_ID)) }

        val peer = Peer(connection, name ?: userId.take(6))
        peers[userId] = peer
        syncParticipants()
        return peer
    }

    private fun offerTo(userId: String, peer: Peer) {
        peer.connection.createOffer(
            object : SimpleSdpObserver("createOffer") {
                override fun onSdpReady(description: SessionDescription) {
                    // Send what the connection actually adopted, once it has
                    // adopted it — see sendLocalDescription.
                    peer.connection.setLocalDescription(
                        object : SimpleSdpObserver("setLocal(offer)") {
                            override fun onSetSuccess() {
                                sendLocalDescription(userId, peer, CallSignal.OFFER, description)
                            }
                        },
                        description,
                    )
                }
            },
            mediaConstraints(),
        )
    }

    /**
     * Emits the SDP the PeerConnection actually holds, after it has taken it.
     *
     * NOT the object createOffer/createAnswer returned. libwebrtc finalises the
     * description in setLocalDescription — including the DTLS fingerprint —
     * so sending the pre-set copy can advertise a certificate the connection
     * does not use. ICE then pairs happily and the DTLS handshake fails a few
     * milliseconds later, which is exactly the failure this call showed.
     */
    private fun sendLocalDescription(
        userId: String,
        peer: Peer,
        type: String,
        fallback: SessionDescription,
    ) {
        val adopted = peer.connection.localDescription?.description ?: fallback.description
        emit(
            userId,
            CallSignal(
                type = type,
                room = _state.value.room.orEmpty(),
                sdp = adopted,
                callType = if (type == CallSignal.OFFER) {
                    if (_state.value.video) "video" else "audio"
                } else null,
                fromName = if (type == CallSignal.OFFER) myName else null,
            ),
        )
    }

    private fun answerTo(userId: String, peer: Peer) {
        peer.connection.createAnswer(
            object : SimpleSdpObserver("createAnswer") {
                override fun onSdpReady(description: SessionDescription) {
                    peer.connection.setLocalDescription(
                        object : SimpleSdpObserver("setLocal(answer)") {
                            override fun onSetSuccess() {
                                sendLocalDescription(userId, peer, CallSignal.ANSWER, description)
                            }
                        },
                        description,
                    )
                }
            },
            // No constraints on an answer: what we receive is decided by the
            // offer's own m-lines, and OfferToReceive* is an offer-side legacy
            // knob. Passing it here is at best ignored and at worst produces an
            // answer the other end cannot use.
            MediaConstraints(),
        )
    }

    private fun drainIce(peer: Peer) {
        peer.pendingIce.forEach { peer.connection.addIceCandidate(it) }
        peer.pendingIce.clear()
    }

    private fun syncParticipants() {
        _state.update { current ->
            current.copy(
                participants = peers.map { (userId, peer) ->
                    current.participants.firstOrNull { it.userId == userId }
                        ?.copy(name = peer.name)
                        ?: Participant(userId = userId, name = peer.name)
                }
            )
        }
    }

    // ------------------------------------------------------------ local media

    private fun openLocalMedia(factory: PeerConnectionFactory, video: Boolean): Boolean {
        val audioSource = runCatching { factory.createAudioSource(MediaConstraints()) }.getOrNull()
            ?: return false
        localAudio = factory.createAudioTrack("audio0", audioSource)

        if (!video) return true

        val enumerator = if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context)
        else Camera1Enumerator(true)
        val deviceName = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull()
            // Audio still works on a device with no camera; degrade rather than fail.
            ?: return true

        val created = enumerator.createCapturer(deviceName, null) ?: return true
        val helper = SurfaceTextureHelper.create("capture", eglBase.eglBaseContext)
        val source = factory.createVideoSource(created.isScreencast)
        created.initialize(helper, context, source.capturerObserver)
        runCatching { created.startCapture(VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS) }
            .onFailure { Log.w(TAG, "camera would not start", it) }

        capturer = created
        surfaceHelper = helper
        videoSource = source
        localVideo = factory.createVideoTrack("video0", source)
        return true
    }

    private fun closeLocalMedia() {
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        capturer = null
        runCatching { surfaceHelper?.dispose() }
        surfaceHelper = null
        runCatching { videoSource?.dispose() }
        videoSource = null
        localVideo = null
        localAudio = null
    }

    private fun mediaConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(
            MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (_state.value.video) "true" else "false")
        )
    }

    /**
     * The ICE servers this call uses, set by the owner from the instance's own
     * configuration right before the call starts.
     *
     * Read fresh every time rather than cached: when the instance runs coturn
     * with a shared secret, the TURN credential is minted per user and expires,
     * so a stale copy stops relaying exactly when a relay is needed.
     */
    fun useIceServers(servers: List<com.kubuno.chat.net.IceServerConfig>) {
        configuredIce = servers.mapNotNull { entry ->
            val urls = entry.urls.filter { it.startsWith("stun:") || it.startsWith("turn") }
            if (urls.isEmpty()) return@mapNotNull null
            PeerConnection.IceServer.builder(urls).apply {
                entry.username?.let { setUsername(it) }
                entry.credential?.let { setPassword(it) }
            }.createIceServer()
        }
    }

    private var configuredIce: List<PeerConnection.IceServer> = emptyList()

    /**
     * What the instance configured, or nothing.
     *
     * NO FALLBACK TO A THIRD PARTY. An instance that has configured no ICE
     * server has said, by saying nothing, that calls must not reach outside it;
     * quietly borrowing someone else's public STUN would contradict that and
     * leak the participants' addresses to a stranger. With an empty list a call
     * still works between peers that can reach each other directly, and fails
     * visibly otherwise — which is the honest outcome.
     */
    private fun iceServers(): List<PeerConnection.IceServer> = configuredIce

    private fun emit(userId: String, signal: CallSignal) {
        Log.d(TAG, "-> ${signal.type} to ${userId.take(8)} sdp=${signal.sdp?.length ?: 0}")
        onSignal?.invoke(userId, signal)
    }

    private fun broadcast(signal: CallSignal) {
        // The hub has no room fan-out for signals, so a broadcast is one
        // addressed signal per known participant — which is what the web does.
        val targets = (peers.keys + ringTargets.map { it.first }).toSet()
        targets.forEach { emit(it, signal) }
    }

    private companion object {
        const val TAG = "KubunoChatCall"
        const val STREAM_ID = "kubuno"
        const val VIDEO_WIDTH = 1280
        const val VIDEO_HEIGHT = 720
        const val VIDEO_FPS = 30
    }
}

/** Only the callbacks this engine acts on; the rest are noise. */
private abstract class SimplePeerObserver : PeerConnection.Observer {
    override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
        if (state != null) onIceStateChanged(state)
    }
    open fun onIceStateChanged(state: PeerConnection.IceConnectionState) = Unit
    override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
    override fun onIceCandidatesRemoved(candidates: Array<out RtcIceCandidate>?) = Unit
    override fun onAddStream(stream: MediaStream?) = Unit
    override fun onRemoveStream(stream: MediaStream?) = Unit
    override fun onDataChannel(channel: org.webrtc.DataChannel?) = Unit
    override fun onRenegotiationNeeded() = Unit
    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
        if (receiver != null) onTrackAdded(receiver)
    }
    open fun onTrackAdded(receiver: RtpReceiver) = Unit
    override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
        if (newState != null) onPeerStateChanged(newState)
    }
    open fun onPeerStateChanged(newState: PeerConnection.PeerConnectionState) = Unit
}

private open class SimpleSdpObserver(private val what: String) : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription?) {
        if (description != null) onSdpReady(description)
    }
    open fun onSdpReady(description: SessionDescription) = Unit
    override fun onSetSuccess() = Unit

    override fun onCreateFailure(error: String?) {
        Log.w("KubunoChatCall", "$what failed: $error")
    }
    override fun onSetFailure(error: String?) {
        Log.w("KubunoChatCall", "$what failed: $error")
    }
}
