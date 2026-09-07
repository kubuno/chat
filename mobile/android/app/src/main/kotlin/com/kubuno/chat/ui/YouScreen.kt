package com.kubuno.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Contrast
import androidx.compose.material.icons.filled.DonutLarge
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kubuno.android.account.SharedAccount

/**
 * The "Vous" tab, in the anatomy of WhatsApp's redesigned profile tab: a
 * centred profile header sitting on a cover band, then settings grouped into
 * rounded cards of icon + label + value/chevron rows.
 *
 * Every row here maps to something Kubuno actually has. WhatsApp's own tab ends
 * on Meta products (Instagram, Facebook, Threads, Accounts Center) — those have
 * no equivalent and are deliberately absent rather than faked. The two honest
 * notes this build must carry — the account is owned by the sibling apps, and
 * the module does not encrypt end-to-end yet — live inside the Compte and
 * "Aide et à propos" rows they belong to.
 */
@Composable
fun YouScreen(
    account: SharedAccount?,
    accountCount: Int,
    pushEnabled: Boolean,
    onOpenAccount: () -> Unit,
    onSwitchAccount: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenAppearance: () -> Unit,
    onOpenStorage: () -> Unit,
    onOpenAbout: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(YouColors.page())
            .verticalScroll(rememberScrollState()),
    ) {
        TopBar()
        ProfileHeader(account)
        Spacer(Modifier.height(20.dp))

        SettingsCard {
            SettingRow(
                icon = Icons.Filled.Person,
                label = "Compte",
                value = account?.email ?: account?.host,
                onClick = onOpenAccount,
            )
            RowDivider()
            SettingRow(
                icon = Icons.Filled.Devices,
                label = "Appareils connectés",
                onClick = onOpenDevices,
            )
            if (accountCount > 1) {
                RowDivider()
                SettingRow(
                    icon = Icons.Filled.SwapHoriz,
                    label = "Changer de compte",
                    onClick = onSwitchAccount,
                )
            }
        }

        SettingsCard {
            SettingRow(
                icon = Icons.Filled.Notifications,
                label = "Notifications",
                value = if (pushEnabled) "Activées" else "Désactivées",
                onClick = onOpenNotifications,
            )
            RowDivider()
            SettingRow(
                icon = Icons.Filled.Contrast,
                label = "Apparence",
                value = "Système",
                onClick = onOpenAppearance,
            )
            RowDivider()
            SettingRow(
                icon = Icons.Filled.DonutLarge,
                label = "Stockage et données",
                onClick = onOpenStorage,
            )
        }

        SettingsCard {
            SettingRow(
                icon = Icons.Filled.Lock,
                label = "Confidentialité et chiffrement",
                onClick = onOpenAbout,
            )
            RowDivider()
            SettingRow(
                icon = Icons.AutoMirrored.Filled.HelpOutline,
                label = "Aide et à propos",
                onClick = onOpenAbout,
            )
        }

        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun TopBar() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = ChatDims.Gutter, end = 12.dp, top = 14.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Vous",
            fontSize = 32.sp,
            lineHeight = 38.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.weight(1f))
        // WhatsApp carries a search and a QR button here. Search into settings
        // and a shareable profile QR are not built yet, so they are left out
        // rather than shown as dead chrome.
    }
}

@Composable
private fun ProfileHeader(account: SharedAccount?) {
    val handle = account?.email?.substringBefore('@')?.takeIf { it.isNotBlank() }

    Box(Modifier.fillMaxWidth()) {
        // Cover band — a plain gradient, like WhatsApp's default cover.
        Box(
            Modifier
                .fillMaxWidth()
                .height(112.dp)
                .background(
                    Brush.verticalGradient(
                        listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.45f),
                        )
                    )
                ),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = 56.dp)
                .padding(bottom = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // The avatar overlaps the cover, ringed by the page colour.
            Box(
                Modifier
                    .size(112.dp)
                    .clip(CircleShape)
                    .background(YouColors.page())
                    .padding(4.dp),
            ) {
                ChatAvatar(
                    title = account?.label.orEmpty().ifBlank { "?" },
                    url = null,
                    seed = account?.userId.orEmpty(),
                    size = 104.dp,
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                text = account?.label.orEmpty().ifBlank { "Compte Kubuno" },
                fontSize = 24.sp,
                lineHeight = 30.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = handle?.let { "@$it" } ?: account?.host.orEmpty(),
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
        }
    }
    // Reserve the height the offset avatar overhangs into.
    Spacer(Modifier.height(56.dp))
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = ChatDims.Gutter, vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface),
    ) {
        content()
    }
}

@Composable
private fun SettingRow(
    icon: ImageVector,
    label: String,
    value: String? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.width(20.dp))
        Text(
            text = label,
            style = ChatType.ConversationTitle,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (value != null) {
            Text(
                text = value,
                style = ChatType.Preview,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(6.dp))
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun RowDivider() {
    // Inset to the label, as WhatsApp draws it — never under the icon.
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 60.dp)
            .height(0.5.dp)
            .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)),
    )
}

/** Page background: the light grey WhatsApp sits its cards on. */
private object YouColors {
    @Composable
    fun page(): Color =
        if (androidx.compose.foundation.isSystemInDarkTheme()) Color(0xFF0D1117)
        else Color(0xFFF0F2F5)
}
