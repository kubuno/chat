package com.kubuno.chat.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Chat-specific design tokens.
 *
 * ANATOMY from WhatsApp (bubble with a squared tail corner, metadata trailing
 * the text inside the bubble, 72dp conversation rows, filter chips, a morphing
 * mic/send button); SKIN from Kubuno — the values below are transcribed from
 * the web module, which is the source of truth:
 *
 *   chat/frontend/src/MessageBubble.tsx
 *     outgoing  bg-blue-600 (#2563EB), white text
 *     incoming  white, border gray-100, gray-900 text
 *     rounded-2xl (16dp) everywhere EXCEPT the bottom corner on the tail side
 *     (0), and 6dp on the top tail-side corner for the follow-ups of a run
 *     quote block  rgba(255,255,255,.16) outgoing / rgba(15,23,42,.05) incoming
 *
 * Nothing here invents a shade; when the web changes, this file follows.
 */
object ChatColors {
    // Bubbles — the web's blue-600 / white pair.
    val BubbleOut = Color(0xFF2563EB)
    val OnBubbleOut = Color(0xFFFFFFFF)
    val BubbleIn = Color(0xFFFFFFFF)
    val OnBubbleIn = Color(0xFF111827)          // gray-900
    val BubbleInBorder = Color(0xFFF3F4F6)      // gray-100
    val QuoteOut = Color(0x29FFFFFF)            // rgba(255,255,255,.16)
    val QuoteIn = Color(0x0D0F172A)             // rgba(15,23,42,.05)
    val OnQuoteOut = Color(0xFFDBEAFE)          // blue-100
    val OnQuoteIn = Color(0xFF6B7280)           // gray-500

    // The conversation backdrop. The web ships a doodle pattern
    // (chat/frontend/src/chatPattern.ts, fill #F0F8FB) that it does not apply
    // yet; until it does, the flat tint it was drawn on is the honest match.
    val ChatBackdrop = Color(0xFFEFF4F8)
    val DarkChatBackdrop = Color(0xFF0D1117)

    val DarkBubbleOut = Color(0xFF1E40AF)       // blue-800, readable on the dark backdrop
    val DarkBubbleIn = Color(0xFF1F2937)        // gray-800
    val OnDarkBubble = Color(0xFFE8EAED)
    val DarkBubbleInBorder = Color(0xFF2B3442)

    // Status marks. Read receipts borrow the web's blue rather than inventing one.
    val TickSent = Color(0xFF9AA0A6)
    val TickRead = Color(0xFF2563EB)
    val DarkTickRead = Color(0xFF8AB4F8)
    val Online = Color(0xFF1E8E3E)

    /** Sender colours for group bubbles, picked by hashing the user id. */
    val SenderPalette = listOf(
        Color(0xFF1A73E8), Color(0xFFD93025), Color(0xFF1E8E3E), Color(0xFF9334E6),
        Color(0xFFE8710A), Color(0xFF0B8043), Color(0xFFC5221F), Color(0xFF3949AB),
        Color(0xFF00838F), Color(0xFFAD1457),
    )

    fun senderColor(userId: String): Color =
        SenderPalette[(userId.hashCode().let { if (it == Int.MIN_VALUE) 0 else kotlin.math.abs(it) }) % SenderPalette.size]
}

/** Resolved against the current light/dark setting. */
data class ChatPalette(
    val bubbleOut: Color,
    val onBubbleOut: Color,
    val bubbleIn: Color,
    val onBubbleIn: Color,
    val bubbleInBorder: Color,
    val quoteOut: Color,
    val quoteIn: Color,
    val onQuoteOut: Color,
    val onQuoteIn: Color,
    val backdrop: Color,
    val tickSent: Color,
    val tickRead: Color,
)

object ChatTheme {
    val palette: ChatPalette
        @Composable @ReadOnlyComposable get() = if (isSystemInDarkTheme()) Dark else Light

    private val Light = ChatPalette(
        bubbleOut = ChatColors.BubbleOut,
        onBubbleOut = ChatColors.OnBubbleOut,
        bubbleIn = ChatColors.BubbleIn,
        onBubbleIn = ChatColors.OnBubbleIn,
        bubbleInBorder = ChatColors.BubbleInBorder,
        quoteOut = ChatColors.QuoteOut,
        quoteIn = ChatColors.QuoteIn,
        onQuoteOut = ChatColors.OnQuoteOut,
        onQuoteIn = ChatColors.OnQuoteIn,
        backdrop = ChatColors.ChatBackdrop,
        tickSent = ChatColors.TickSent,
        tickRead = ChatColors.TickRead,
    )

    private val Dark = ChatPalette(
        bubbleOut = ChatColors.DarkBubbleOut,
        onBubbleOut = ChatColors.OnDarkBubble,
        bubbleIn = ChatColors.DarkBubbleIn,
        onBubbleIn = ChatColors.OnDarkBubble,
        bubbleInBorder = ChatColors.DarkBubbleInBorder,
        quoteOut = ChatColors.QuoteOut,
        quoteIn = Color(0x1AFFFFFF),
        onQuoteOut = ChatColors.OnQuoteOut,
        onQuoteIn = Color(0xFF9AA0A6),
        backdrop = ChatColors.DarkChatBackdrop,
        tickSent = ChatColors.TickSent,
        tickRead = ChatColors.DarkTickRead,
    )
}

/**
 * Bubble corners. The web squares the bottom corner on the tail side for every
 * bubble, and softens the top tail-side corner to 6dp for the follow-ups of a
 * run — that is what visually groups consecutive messages.
 */
object ChatShapes {
    private val R = 16.dp
    private val FollowUp = 6.dp

    fun bubble(outgoing: Boolean, runStart: Boolean): Shape = when {
        outgoing && runStart -> RoundedCornerShape(R, R, 0.dp, R)
        outgoing -> RoundedCornerShape(R, FollowUp, 0.dp, R)
        runStart -> RoundedCornerShape(R, R, R, 0.dp)
        else -> RoundedCornerShape(FollowUp, R, R, 0.dp)
    }

    val Chip = RoundedCornerShape(50)
    val Composer = RoundedCornerShape(24.dp)
    val Sheet = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    val DatePill = RoundedCornerShape(8.dp)
}

/** Type scale for the chat surfaces (sizes calibrated on WhatsApp's density). */
object ChatType {
    val ConversationTitle = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)
    val ConversationTitleUnread = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val Preview = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    val RowTime = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal)
    val Body = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Normal)
    val BubbleMeta = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Normal)
    val SenderName = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
    val HeaderTitle = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)
    val HeaderSub = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal)
    val DatePill = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
}

/** Densities WhatsApp uses and that the eye reads as "a messaging app". */
object ChatDims {
    val RowHeight = 72.dp
    val Avatar = 50.dp
    val AvatarSmall = 40.dp
    val HeaderHeight = 56.dp
    val Gutter = 16.dp
    val BubbleMaxWidthFraction = 0.82f
    val RunGap = 2.dp        // between messages of one sender
    val GroupGap = 8.dp      // between senders
}
