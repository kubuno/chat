package com.kubuno.chat.call

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The call signalling envelope, relayed peer-to-peer through the chat module's
 * WebSocket hub.
 *
 * Shapes copied exactly from the web client (chat/frontend/src/CallWindow.tsx)
 * so a phone and a browser can be in the same call. Every signal carries the
 * `room` — the conversation id — because one client can be in several.
 *
 * SDP and ICE are addressed to one peer; ring, join, leave, state and reactions
 * are broadcast to the room.
 */
@Serializable
data class CallSignal(
    val type: String,
    val room: String,
    @SerialName("call_type") val callType: String? = null,
    @SerialName("from_name") val fromName: String? = null,
    val sdp: String? = null,
    val candidate: IceCandidate? = null,
    val hand: Boolean? = null,
    val muted: Boolean? = null,
    @SerialName("cam_off") val camOff: Boolean? = null,
    val emoji: String? = null,
    /** Announced on call_state while a participant is recording the meeting. */
    val recording: Boolean? = null,
) {
    companion object {
        const val RING = "call_ring"
        const val JOIN = "call_join"
        const val PRESENT = "call_present"
        const val OFFER = "call_offer"
        const val ANSWER = "call_answer"
        const val ICE = "call_ice"
        const val LEAVE = "call_leave"
        const val STATE = "call_state"
        const val REACTION = "call_reaction"

        // Host actions in a meeting, mirrored from the web client. All three
        // travel over the same call_signal channel; none needs a server route.
        /** The host ends the meeting for everyone at once (broadcast). */
        const val END = "call_end"
        /** The host removes one participant (targeted). */
        const val KICK = "call_kick"
        /** The host mutes one participant (targeted); a host mutes, never unmutes. */
        const val MUTE = "call_mute"
    }
}

/** WebRTC's RTCIceCandidateInit, as the browser serialises it. */
@Serializable
data class IceCandidate(
    val candidate: String,
    @SerialName("sdpMid") val sdpMid: String? = null,
    @SerialName("sdpMLineIndex") val sdpMLineIndex: Int? = null,
)

/** An inbound `call_signal` event as the hub delivers it. */
@Serializable
data class CallSignalEnvelope(
    @SerialName("from_user_id") val fromUserId: String,
    val signal: JsonObject? = null,
)
