package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.PollResults

/**
 * A poll inside a bubble.
 *
 * The bars are the visible part of a real guarantee: the server stores only
 * option INDICES, so it can count votes without ever learning what the options
 * say. That is why the question and the choices live in the envelope and the
 * tallies come back keyed by option index.
 */
@Composable
fun PollContent(
    message: UiMessage,
    poll: ChatEnvelope.Poll,
    results: PollResults?,
    outgoing: Boolean,
    onLoad: () -> Unit,
    onVote: (Int) -> Unit,
) {
    LaunchedEffect(message.id) { onLoad() }

    val palette = ChatTheme.palette
    val onBubble = if (outgoing) palette.onBubbleOut else palette.onBubbleIn
    val total = results?.total ?: 0
    val myVote = results?.myVote

    Column(Modifier.fillMaxWidth()) {
        Text(
            text = poll.question,
            style = ChatType.Body,
            fontWeight = FontWeight.SemiBold,
            color = onBubble,
        )
        Spacer(Modifier.height(8.dp))

        poll.options.forEachIndexed { index, option ->
            val votes = results?.votesFor(index) ?: 0
            val share = if (total == 0) 0f else votes.toFloat() / total
            val mine = myVote == index

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 3.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (outgoing) palette.quoteOut else palette.quoteIn)
                    .clickable { onVote(index) },
            ) {
                // The filled part is the tally; drawing it behind the label
                // keeps the row one line tall however long the option is.
                Box(
                    Modifier
                        .fillMaxWidth(share)
                        .height(36.dp)
                        .background(
                            if (outgoing) onBubble.copy(alpha = 0.22f)
                            else MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
                        )
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(36.dp)
                        .padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (mine) {
                        Box(
                            Modifier
                                .size(16.dp)
                                .clip(CircleShape)
                                .background(
                                    if (outgoing) onBubble else MaterialTheme.colorScheme.primary
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = "Votre vote",
                                tint = if (outgoing) palette.bubbleOut else MaterialTheme.colorScheme.onPrimary,
                                modifier = Modifier.size(11.dp),
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        text = option,
                        style = ChatType.Preview,
                        color = onBubble,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = "$votes",
                        style = ChatType.BubbleMeta,
                        color = onBubble.copy(alpha = 0.7f),
                    )
                }
            }
        }

        Spacer(Modifier.height(4.dp))
        Text(
            text = if (total == 0) "Aucun vote" else "$total vote${if (total > 1) "s" else ""}",
            style = ChatType.BubbleMeta,
            color = onBubble.copy(alpha = 0.7f),
        )
    }
}
