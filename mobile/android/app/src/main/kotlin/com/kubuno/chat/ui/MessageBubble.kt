package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent

/**
 * One message bubble.
 *
 * Two details carry the whole "this is a messaging app" feel, and both are
 * reproduced here rather than approximated:
 *
 *  - the tail. The bubble squares the bottom corner on its own side and
 *    softens the opposite top corner for the follow-ups of a run, which is
 *    what groups consecutive messages visually (see ChatShapes).
 *  - the metadata. Time and ticks sit INSIDE the bubble, trailing the text on
 *    its last line when there is room and dropping to their own line when
 *    there is not. That is an inline placeholder in the text layout, not a
 *    Row after it — a Row would always take a second line.
 */
@Composable
fun MessageBubble(
    message: UiMessage,
    runStart: Boolean,
    showSender: Boolean,
    senderName: String?,
    deliveryState: DeliveryState,
    modifier: Modifier = Modifier,
) {
    val palette = ChatTheme.palette
    val outgoing = message.outgoing
    val maxWidth = LocalConfiguration.current.screenWidthDp.dp * ChatDims.BubbleMaxWidthFraction

    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp),
        horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = maxWidth)
                .clip(ChatShapes.bubble(outgoing, runStart))
                .background(if (outgoing) palette.bubbleOut else palette.bubbleIn)
                .then(
                    if (outgoing) Modifier
                    else Modifier.border(
                        width = 1.dp,
                        color = palette.bubbleInBorder,
                        shape = ChatShapes.bubble(false, runStart),
                    )
                )
                .padding(horizontal = 12.dp, vertical = 7.dp),
        ) {
            if (showSender && senderName != null && !outgoing) {
                Text(
                    text = senderName,
                    style = ChatType.SenderName,
                    color = ChatColors.senderColor(message.senderId),
                )
                Spacer(Modifier.height(2.dp))
            }

            BubbleText(
                message = message,
                outgoing = outgoing,
                deliveryState = deliveryState,
                palette = palette,
            )

            if (message.reactions.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Reactions(message, outgoing, palette)
            }
        }
    }
}

@Composable
private fun BubbleText(
    message: UiMessage,
    outgoing: Boolean,
    deliveryState: DeliveryState,
    palette: ChatPalette,
) {
    val onBubble = if (outgoing) palette.onBubbleOut else palette.onBubbleIn
    val body = when {
        message.deleted -> UiMessage.DELETED
        else -> message.preview()
    }

    // The placeholder reserves room for what actually goes in it: "HH:mm",
    // plus the tick pair when outgoing, plus the "modifié" marker when the
    // message was edited. Under-reserving does not wrap — it CLIPS, which is
    // how the clock silently vanished from edited bubbles. Sized in sp so it
    // scales with the user's font setting.
    val metaWidth = (
        BASE_META_SP +
            (if (outgoing) TICKS_SP else 0f) +
            (if (message.editedAtMs != null) EDITED_SP else 0f)
        ).sp
    val annotated = buildAnnotatedString {
        append(body)
        appendInlineContent(META, " ")
    }
    val inline = mapOf(
        META to InlineTextContent(
            Placeholder(metaWidth, 14.sp, PlaceholderVerticalAlign.TextBottom)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.Bottom,
            ) {
                if (message.editedAtMs != null) {
                    Text(
                        "modifié",
                        style = ChatType.BubbleMeta,
                        color = onBubble.copy(alpha = 0.6f),
                    )
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    Timestamps.clock(message.createdAtMs),
                    style = ChatType.BubbleMeta,
                    color = onBubble.copy(alpha = 0.7f),
                )
                if (outgoing) {
                    Spacer(Modifier.width(3.dp))
                    DeliveryTicks(deliveryState, palette, onBubble)
                }
            }
        }
    )

    Text(
        text = annotated,
        inlineContent = inline,
        style = ChatType.Body,
        color = if (message.deleted) onBubble.copy(alpha = 0.6f) else onBubble,
        fontStyle = if (message.deleted) FontStyle.Italic else FontStyle.Normal,
    )
}

@Composable
private fun Reactions(message: UiMessage, outgoing: Boolean, palette: ChatPalette) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        message.reactions.forEach { (emoji, count) ->
            val mine = emoji in message.myReactions
            Row(
                modifier = Modifier
                    .clip(ChatShapes.Chip)
                    .background(
                        if (outgoing) palette.quoteOut
                        else MaterialTheme.colorScheme.surfaceContainer
                    )
                    .border(
                        width = if (mine) 1.dp else 0.dp,
                        color = if (mine) MaterialTheme.colorScheme.primary else Color.Transparent,
                        shape = ChatShapes.Chip,
                    )
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(emoji, style = ChatType.BubbleMeta, fontSize = 13.sp)
                if (count > 1) {
                    Spacer(Modifier.width(3.dp))
                    Text(
                        "$count",
                        style = ChatType.BubbleMeta,
                        color = if (outgoing) palette.onBubbleOut else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * Sent / delivered / read, drawn the way every messenger draws it: one tick,
 * two ticks, two coloured ticks. The chat module tracks a message `status` and
 * per-member read positions, so the state is real, not decorative.
 */
@Composable
fun DeliveryTicks(
    state: DeliveryState,
    palette: ChatPalette,
    baseColor: Color = palette.tickSent,
) {
    val size = 15.dp
    when (state) {
        DeliveryState.Pending -> Icon(
            Icons.Filled.Schedule,
            contentDescription = "En attente",
            tint = baseColor.copy(alpha = 0.7f),
            modifier = Modifier.size(size),
        )
        DeliveryState.Failed -> Icon(
            Icons.Filled.ErrorOutline,
            contentDescription = "Échec de l'envoi",
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(size),
        )
        DeliveryState.Sent -> Icon(
            Icons.Filled.Check,
            contentDescription = "Envoyé",
            tint = baseColor.copy(alpha = 0.7f),
            modifier = Modifier.size(size),
        )
        DeliveryState.Delivered -> Icon(
            Icons.Filled.DoneAll,
            contentDescription = "Remis",
            tint = baseColor.copy(alpha = 0.7f),
            modifier = Modifier.size(size),
        )
        DeliveryState.Read -> Icon(
            Icons.Filled.DoneAll,
            contentDescription = "Lu",
            tint = palette.tickRead,
            modifier = Modifier.size(size),
        )
    }
}

/** The centred "AUJOURD'HUI" / "12 mars 2026" separator between two days. */
@Composable
fun DateSeparator(timestampMs: Long) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = Timestamps.datePill(timestampMs).uppercase(),
            style = ChatType.DatePill,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .clip(ChatShapes.DatePill)
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f))
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

private const val META = "meta"

// Widths of the pieces that live in the trailing metadata placeholder, in sp.
private const val BASE_META_SP = 36f    // "HH:mm" plus its left gap
private const val TICKS_SP = 20f        // the delivery ticks (outgoing only)
private const val EDITED_SP = 44f       // the "modifié" marker
