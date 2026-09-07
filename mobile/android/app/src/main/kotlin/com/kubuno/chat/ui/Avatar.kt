package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage

/**
 * Round avatar with a coloured-initials fallback.
 *
 * The chat module has an avatar_path column but exposes no route to fill or
 * read it, so group and channel rows have no picture at all today; initials
 * derived from the title are what the user actually sees, and they must look
 * deliberate rather than broken.
 */
@Composable
fun ChatAvatar(
    title: String,
    url: String?,
    seed: String,
    size: Dp = ChatDims.Avatar,
    online: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.size(size), contentAlignment = Alignment.BottomEnd) {
        if (url.isNullOrBlank()) {
            Box(
                modifier = Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(ChatColors.senderColor(seed).copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initials(title),
                    color = ChatColors.senderColor(seed),
                    fontWeight = FontWeight.SemiBold,
                    fontSize = (size.value * 0.36f).sp,
                )
            }
        } else {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape),
            )
        }
        if (online) {
            Box(
                modifier = Modifier
                    .size(size * 0.26f)
                    .offset(x = 1.dp, y = 1.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(size * 0.20f)
                        .clip(CircleShape)
                        .background(ChatColors.Online),
                )
            }
        }
    }
}

/** One or two letters, skipping the emoji and punctuation a title may start with. */
private fun initials(title: String): String {
    val words = title.split(' ', '-', '_', '.')
        .mapNotNull { word -> word.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words.first().toString()
        else -> "${words.first()}${words[1]}"
    }
}

/** The plain colour a bare avatar uses when nothing else is known. */
val AvatarFallback: Color = Color(0xFF9AA0A6)
