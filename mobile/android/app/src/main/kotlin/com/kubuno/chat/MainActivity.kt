package com.kubuno.chat

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.kubuno.android.ui.theme.KubunoTheme
import com.kubuno.chat.push.ChatNotifications
import com.kubuno.chat.ui.ChatApp
import dagger.hilt.android.AndroidEntryPoint

// AppCompatActivity so per-app locales keep working down to minSdk, matching
// the drive, mail and maps apps.
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    /**
     * The conversation a notification asked for, if any.
     *
     * Held as state rather than read once: a tap while the app is already open
     * arrives through onNewIntent, not through the intent this activity was
     * created with, and reading only the latter silently ignores it.
     */
    private var pendingConversation by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingConversation = conversationFrom(intent)
        setContent {
            KubunoTheme {
                ChatApp(
                    openConversationId = pendingConversation,
                    onDeepLinkHandled = { pendingConversation = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        conversationFrom(intent)?.let { pendingConversation = it }
    }

    /** Reads `kubuno-chat://conversation/<id>` and dismisses its notification. */
    private fun conversationFrom(intent: Intent?): String? {
        val uri: Uri = intent?.data ?: return null
        if (uri.scheme != ChatNotifications.DEEP_LINK_SCHEME) return null
        if (uri.host != ChatNotifications.DEEP_LINK_HOST) return null
        val id = uri.pathSegments.firstOrNull()?.takeIf { it.isNotBlank() } ?: return null
        // Opening the conversation is the same as reading it, so the shade
        // should not keep claiming there is something new.
        ChatNotifications.dismiss(this, id)
        return id
    }
}
