package com.kubuno.chat.push

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import com.kubuno.android.account.SharedAccounts
import com.kubuno.chat.net.ChatApi
import com.kubuno.chat.net.ChatClients
import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.ReadReceiptBody
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Handles the notification's own actions: replying and marking as read.
 *
 * Both run entirely in the background — the point of replying from the shade is
 * that the app never comes to the foreground. [goAsync] keeps the receiver
 * alive across the network call, which a BroadcastReceiver otherwise ends the
 * moment onReceive returns.
 */
@AndroidEntryPoint
class ChatReplyReceiver : BroadcastReceiver() {

    @Inject lateinit var sharedAccounts: SharedAccounts
    @Inject lateinit var clients: ChatClients

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        val conversationId = intent.getStringExtra(ChatNotifications.EXTRA_CONVERSATION_ID) ?: return
        val api = sharedAccounts.list().firstOrNull()?.let(clients::api) ?: run {
            Log.w(TAG, "no account to act on")
            return
        }

        when (intent.action) {
            ChatNotifications.ACTION_REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(ChatNotifications.KEY_REPLY_TEXT)
                    ?.toString()
                    ?.trim()
                    .orEmpty()
                if (text.isEmpty()) return
                val pending = goAsync()
                scope.launch {
                    runCatching { api.send(conversationId, ChatEnvelope.encodeText(text)) }
                        .onFailure { Log.w(TAG, "reply from notification failed", it) }
                    dismiss(context, conversationId)
                    pending.finish()
                }
            }

            ChatNotifications.ACTION_MARK_READ -> {
                val pending = goAsync()
                scope.launch {
                    markRead(api, conversationId)
                    dismiss(context, conversationId)
                    pending.finish()
                }
            }
        }
    }

    /**
     * The read receipt needs the id of the newest message, which the push does
     * not carry — so ask for the last one first. A failure here is silent: the
     * notification still goes away, which is what the user asked for.
     */
    private suspend fun markRead(api: ChatApi, conversationId: String) {
        runCatching {
            val newest = api.messages(conversationId, limit = 1).messages.firstOrNull() ?: return
            api.markRead(conversationId, ReadReceiptBody(newest.id))
        }.onFailure { Log.w(TAG, "mark-read from notification failed", it) }
    }

    private fun dismiss(context: Context, conversationId: String) {
        context.getSystemService(NotificationManager::class.java)
            ?.cancel(conversationId.hashCode())
    }

    private companion object {
        const val TAG = "KubunoChatPush"
    }
}
