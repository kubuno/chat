package com.kubuno.chat.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import com.kubuno.chat.MainActivity
import com.kubuno.chat.R

/**
 * Chat notifications.
 *
 * Two things make these feel like a messaging app rather than an alert:
 *
 *  - MessagingStyle. The system renders it as a conversation, groups repeated
 *    pushes from the same conversation into one thread, and on Android 11+
 *    promotes it into the conversation section of the shade.
 *  - Direct reply. A RemoteInput action lets the user answer without opening
 *    anything, which is the single most-used notification action in any
 *    messenger.
 *
 * The body never carries message content: the module deliberately sends none,
 * and inventing some by fetching it here would undo that choice.
 */
object ChatNotifications {

    const val CHANNEL_MESSAGES = "chat_messages"
    const val CHANNEL_CALLS = "chat_calls"

    const val DEEP_LINK_SCHEME = "kubuno-chat"
    const val DEEP_LINK_HOST = "conversation"

    const val ACTION_REPLY = "com.kubuno.chat.action.REPLY"
    const val ACTION_MARK_READ = "com.kubuno.chat.action.MARK_READ"
    const val EXTRA_CONVERSATION_ID = "conversation_id"
    const val KEY_REPLY_TEXT = "reply_text"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_MESSAGES,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "Nouveaux messages reçus" }
        )
        manager.createNotificationChannel(
            // A ringing call must be able to interrupt; messages must not.
            NotificationChannel(
                CHANNEL_CALLS,
                "Appels entrants",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Sonnerie des appels entrants"
                setBypassDnd(false)
            }
        )
    }

    fun notify(context: Context, payload: ChatPushPayload) {
        ensureChannels(context)
        if (payload.isCall) notifyCall(context, payload) else notifyMessage(context, payload)
    }

    private fun notifyMessage(context: Context, payload: ChatPushPayload) {
        val who = payload.title?.takeIf { it.isNotBlank() } ?: "Nouveau message"
        val body = payload.body?.takeIf { it.isNotBlank() } ?: "Nouveau message"
        val conversationId = payload.conversationId

        val sender = Person.Builder().setName(who).setKey(payload.senderId ?: who).build()
        val style = NotificationCompat.MessagingStyle(
            Person.Builder().setName("Vous").setKey("self").build()
        ).addMessage(body, System.currentTimeMillis(), sender)

        val builder = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setStyle(style)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)

        if (conversationId != null) {
            builder.setContentIntent(openConversation(context, conversationId))
            builder.addAction(replyAction(context, conversationId))
            builder.addAction(
                NotificationCompat.Action.Builder(
                    R.drawable.ic_notification,
                    "Marquer comme lu",
                    servicePendingIntent(context, ACTION_MARK_READ, conversationId),
                ).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                    .setShowsUserInterface(false)
                    .build()
            )
        }

        // One notification per conversation, updated rather than stacked.
        val id = conversationId?.hashCode() ?: who.hashCode()
        NotificationManagerCompat.from(context).notify(id, builder.build())
    }

    private fun notifyCall(context: Context, payload: ChatPushPayload) {
        val who = payload.title?.takeIf { it.isNotBlank() } ?: "Appel entrant"
        val room = payload.conversationId

        val builder = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(who)
            .setContentText(payload.body ?: "Appel entrant")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            // A ring must be able to take over the screen; the system falls
            // back to a heads-up banner when it may not.
            .apply {
                if (room != null) {
                    val open = openConversation(context, room)
                    setContentIntent(open)
                    setFullScreenIntent(open, true)
                }
            }

        NotificationManagerCompat.from(context)
            .notify(room?.hashCode() ?: who.hashCode(), builder.build())
    }

    private fun replyAction(context: Context, conversationId: String): NotificationCompat.Action {
        val remoteInput = RemoteInput.Builder(KEY_REPLY_TEXT)
            .setLabel("Répondre")
            .build()
        return NotificationCompat.Action.Builder(
            R.drawable.ic_notification,
            "Répondre",
            servicePendingIntent(context, ACTION_REPLY, conversationId),
        )
            .addRemoteInput(remoteInput)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            // Answering must not pull the app to the foreground; that is the
            // whole point of replying from the shade.
            .setShowsUserInterface(false)
            .setAllowGeneratedReplies(true)
            .build()
    }

    /** A broadcast the reply receiver handles without any UI. */
    private fun servicePendingIntent(context: Context, action: String, conversationId: String): PendingIntent {
        val intent = Intent(context, ChatReplyReceiver::class.java).apply {
            this.action = action
            putExtra(EXTRA_CONVERSATION_ID, conversationId)
        }
        // MUTABLE because RemoteInput has to write the typed text into it.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(context, (action + conversationId).hashCode(), intent, flags)
    }

    private fun openConversation(context: Context, conversationId: String): PendingIntent {
        val uri = Uri.Builder()
            .scheme(DEEP_LINK_SCHEME)
            .authority(DEEP_LINK_HOST)
            .appendPath(conversationId)
            .build()
        // Explicit component so no other app can capture the tap, while the
        // data URI still drives MainActivity's deep-link handling.
        val intent = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return PendingIntent.getActivity(
            context,
            conversationId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** Clears the notification for a conversation the user has now opened. */
    fun dismiss(context: Context, conversationId: String) {
        NotificationManagerCompat.from(context).cancel(conversationId.hashCode())
    }
}
