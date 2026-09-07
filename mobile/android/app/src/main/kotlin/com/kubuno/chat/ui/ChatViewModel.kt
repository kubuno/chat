package com.kubuno.chat.ui

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kubuno.android.account.SharedAccount
import com.kubuno.android.account.SharedAccounts
import com.kubuno.chat.net.ChatApi
import com.kubuno.chat.net.ChatClients
import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.ChatSocket
import com.kubuno.chat.net.Member
import com.kubuno.chat.net.MemberSettingsBody
import com.kubuno.chat.net.Message
import com.kubuno.chat.net.ReadReceiptBody
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Drives both chat screens off one socket.
 *
 * The module's hub is per-user, not per-conversation: one connection receives
 * every event about this account, so the list stays live while a conversation
 * is open and there is nothing to subscribe or unsubscribe when navigating.
 */
@HiltViewModel
class ChatViewModel @Inject constructor(
    private val sharedAccounts: SharedAccounts,
    private val clients: ChatClients,
) : ViewModel() {

    data class ListState(
        val loading: Boolean = true,
        val conversations: List<UiConversation> = emptyList(),
        val filter: ChatFilter = ChatFilter.All,
        val query: String = "",
        val showArchived: Boolean = false,
        val connected: Boolean = false,
        val error: String? = null,
    ) {
        val archivedCount: Int get() = conversations.count { it.isArchived }

        /** Pinned first, then most recent — the order WhatsApp shows. */
        val visible: List<UiConversation>
            get() = conversations
                .filter { it.isArchived == showArchived }
                .filter { c ->
                    when (filter) {
                        ChatFilter.All -> true
                        ChatFilter.Unread -> c.isUnread || c.unreadCount > 0
                        ChatFilter.Favorites -> c.isFavorite
                        ChatFilter.Groups -> c.isGroup
                    }
                }
                .filter { c ->
                    query.isBlank() ||
                        c.title.contains(query, ignoreCase = true) ||
                        c.previewText.contains(query, ignoreCase = true)
                }
                .sortedWith(compareByDescending<UiConversation> { it.isPinned }.thenByDescending { it.lastActivityMs })
    }

    private val _accounts = MutableStateFlow<List<SharedAccount>>(emptyList())
    val accounts: StateFlow<List<SharedAccount>> = _accounts.asStateFlow()

    private val _account = MutableStateFlow<SharedAccount?>(null)
    val account: StateFlow<SharedAccount?> = _account.asStateFlow()

    private val _list = MutableStateFlow(ListState())
    val list: StateFlow<ListState> = _list.asStateFlow()

    private val _conversation = MutableStateFlow<ConversationState?>(null)
    val conversation: StateFlow<ConversationState?> = _conversation.asStateFlow()

    private var socket: ChatSocket? = null
    private var socketJob: Job? = null
    private val typingTimers = mutableMapOf<String, Job>()

    private val api: ChatApi?
        get() = _account.value?.let(clients::api)

    private val selfUserId: String
        get() = _account.value?.userId.orEmpty()

    init {
        refreshAccounts()
    }

    fun refreshAccounts() {
        val found = sharedAccounts.list()
        _accounts.value = found
        if (_account.value == null || found.none { it.systemName == _account.value?.systemName }) {
            selectAccount(found.firstOrNull())
        }
    }

    fun selectAccount(account: SharedAccount?) {
        if (account?.systemName == _account.value?.systemName && socket != null) return
        _account.value = account
        _list.value = ListState(loading = account != null)
        _conversation.value = null
        socket?.stop()
        socketJob?.cancel()
        socket = null
        if (account == null) return
        loadConversations()
        openSocket(account)
    }

    // ---------------------------------------------------------------- list

    fun loadConversations() {
        val api = api ?: return
        viewModelScope.launch {
            _list.update { it.copy(loading = it.conversations.isEmpty(), error = null) }
            runCatching { api.conversations() }
                .onSuccess { response ->
                    val now = System.currentTimeMillis()
                    // Show the rows the moment they arrive. The list endpoint
                    // carries no last message, so a preview costs one
                    // page-of-one per conversation; fetching those in series
                    // before painting anything left the screen spinning for
                    // seconds on a real inbox.
                    _list.update {
                        it.copy(
                            loading = false,
                            error = null,
                            conversations = response.conversations.map { s -> s.toUi(null, now) },
                        )
                    }
                    fillPreviews(response.conversations.map { it.conversation.id })
                }
                .onFailure { e ->
                    Log.w(TAG, "conversations failed", e)
                    _list.update { it.copy(loading = false, error = friendly(e)) }
                }
        }
    }

    /**
     * Fills each row's preview, a few conversations at a time. Bounded because
     * the module gives no bulk endpoint for last messages: unbounded fan-out
     * would open one connection per conversation.
     */
    private fun fillPreviews(ids: List<String>) {
        val api = api ?: return
        viewModelScope.launch {
            val gate = Semaphore(PREVIEW_CONCURRENCY)
            coroutineScope {
                ids.map { id ->
                    async {
                        val last = gate.withPermit {
                            runCatching { api.messages(id, limit = 1).messages.firstOrNull() }.getOrNull()
                        } ?: return@async
                        val ui = last.toUi(selfUserId)
                        _list.update { state ->
                            state.copy(conversations = state.conversations.map { row ->
                                if (row.id != id || row.lastMessage != null) row
                                else row.copy(lastMessage = ui, lastActivityMs = ui.createdAtMs)
                            })
                        }
                    }
                }.awaitAll()
            }
        }
    }

    fun setFilter(filter: ChatFilter) = _list.update { it.copy(filter = filter) }
    fun setQuery(query: String) = _list.update { it.copy(query = query) }
    fun setShowArchived(show: Boolean) = _list.update { it.copy(showArchived = show) }

    fun togglePin(id: String) = memberSetting(id) { MemberSettingsBody(pin = !it.isPinned) }
    fun toggleArchive(id: String) = memberSetting(id) { MemberSettingsBody(archive = !it.isArchived) }
    fun toggleFavorite(id: String) = memberSetting(id) { MemberSettingsBody(favorite = !it.isFavorite) }
    fun markUnread(id: String) = memberSetting(id) { MemberSettingsBody(markUnread = true) }

    private fun memberSetting(id: String, body: (UiConversation) -> MemberSettingsBody) {
        val api = api ?: return
        val row = _list.value.conversations.firstOrNull { it.id == id } ?: return
        val payload = body(row)
        // Optimistic: the row moves now, the server confirms after.
        _list.update { state ->
            state.copy(conversations = state.conversations.map { c ->
                if (c.id != id) c else c.copy(
                    isPinned = payload.pin ?: c.isPinned,
                    isArchived = payload.archive ?: c.isArchived,
                    isFavorite = payload.favorite ?: c.isFavorite,
                    isUnread = payload.markUnread ?: c.isUnread,
                )
            })
        }
        viewModelScope.launch {
            runCatching { api.memberSettings(id, payload) }
                .onFailure {
                    Log.w(TAG, "member-settings failed", it)
                    loadConversations()
                }
        }
    }

    // -------------------------------------------------------- conversation

    fun openConversation(id: String) {
        val api = api ?: return
        val row = _list.value.conversations.firstOrNull { it.id == id }
        _conversation.value = ConversationState(
            id = id,
            title = row?.title.orEmpty(),
            isGroup = row?.isGroup ?: false,
            avatarUrl = row?.avatarUrl,
        )
        viewModelScope.launch {
            val detail = runCatching { api.conversation(id) }.getOrNull()
            val members = detail?.members.orEmpty().associateBy { it.userId }
            runCatching { api.messages(id, limit = PAGE) }
                .onSuccess { page ->
                    val messages = merge(emptyList(), page.messages, page.reactions)
                    _conversation.update { state ->
                        state?.takeIf { it.id == id }?.copy(
                            title = detail?.conversation?.name ?: state.title,
                            members = members,
                            messages = messages,
                            loading = false,
                            hasMore = page.messages.size >= PAGE,
                            subtitle = subtitleFor(detail?.members.orEmpty(), row),
                        )
                    }
                    messages.lastOrNull()?.let { acknowledge(id, it.id) }
                }
                .onFailure { e ->
                    Log.w(TAG, "messages failed", e)
                    _conversation.update { it?.takeIf { s -> s.id == id }?.copy(loading = false, error = friendly(e)) }
                }
        }
    }

    fun closeConversation() {
        _conversation.value = null
    }

    fun loadOlder() {
        val api = api ?: return
        val state = _conversation.value ?: return
        if (state.loadingMore || !state.hasMore || state.messages.isEmpty()) return
        val oldest = state.messages.first().id
        _conversation.update { it?.copy(loadingMore = true) }
        viewModelScope.launch {
            runCatching { api.messages(state.id, limit = PAGE, before = oldest) }
                .onSuccess { page ->
                    _conversation.update { current ->
                        current?.takeIf { it.id == state.id }?.copy(
                            messages = merge(current.messages, page.messages, page.reactions),
                            loadingMore = false,
                            hasMore = page.messages.size >= PAGE,
                        )
                    }
                }
                .onFailure {
                    Log.w(TAG, "older page failed", it)
                    _conversation.update { it?.copy(loadingMore = false) }
                }
        }
    }

    fun send(text: String) {
        val api = api ?: return
        val state = _conversation.value ?: return
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return

        val body = ChatEnvelope.encodeText(trimmed)
        // Optimistic row keyed by the nonce, which is also the module's
        // idempotency key — a retry after a dropped POST returns the same
        // message rather than creating a second one.
        val optimistic = UiMessage(
            id = "pending:${body.nonce}",
            conversationId = state.id,
            senderId = selfUserId,
            outgoing = true,
            content = ChatEnvelope.Content(trimmed, null, null, false),
            createdAtMs = System.currentTimeMillis(),
            editedAtMs = null,
            deleted = false,
            pinned = false,
            replyToId = null,
            messageType = "text",
            pending = true,
        )
        _conversation.update { it?.copy(messages = it.messages + optimistic) }

        viewModelScope.launch {
            runCatching { api.send(state.id, body) }
                .onSuccess { response ->
                    val real = response.message.toUi(selfUserId)
                    _conversation.update { current ->
                        current?.copy(messages = current.messages.map { if (it.id == optimistic.id) real else it })
                    }
                    bumpRow(state.id, real)
                }
                .onFailure { e ->
                    Log.w(TAG, "send failed", e)
                    _conversation.update { current ->
                        current?.copy(messages = current.messages.map {
                            if (it.id == optimistic.id) it.copy(pending = false, failed = true) else it
                        })
                    }
                }
        }
    }

    /** Re-sends a bubble that failed, reusing its text (a fresh nonce is fine). */
    fun retry(message: UiMessage) {
        _conversation.update { current ->
            current?.copy(messages = current.messages.filterNot { it.id == message.id })
        }
        send(message.content.text.orEmpty())
    }

    private fun acknowledge(conversationId: String, messageId: String) {
        val api = api ?: return
        viewModelScope.launch {
            runCatching { api.markRead(conversationId, ReadReceiptBody(messageId)) }
            _list.update { state ->
                state.copy(conversations = state.conversations.map {
                    if (it.id == conversationId) it.copy(unreadCount = 0, isUnread = false) else it
                })
            }
        }
    }

    // -------------------------------------------------------------- socket

    private fun openSocket(account: SharedAccount) {
        val fresh = ChatSocket(clients.raw(account))
        socket = fresh
        socketJob = viewModelScope.launch {
            launch { fresh.connected.collect { up -> _list.update { it.copy(connected = up) } } }
            launch { fresh.events.collect(::onEvent) }
        }
        fresh.start()
    }

    private fun onEvent(envelope: ChatSocket.Envelope) {
        val socket = socket ?: return
        when (envelope.event) {
            "new_message" -> {
                val payload = socket.decode(envelope, ChatSocket.NewMessagePayload.serializer()) ?: return
                onIncoming(payload.message)
            }
            "message_updated" -> {
                val payload = socket.decode(envelope, ChatSocket.MessageUpdatedPayload.serializer()) ?: return
                val message = payload.message
                if (message != null) {
                    replace(message.toUi(selfUserId))
                } else if (payload.messageId != null) {
                    _conversation.update { state ->
                        state?.copy(messages = state.messages.map {
                            if (it.id == payload.messageId) it.copy(deleted = true) else it
                        })
                    }
                }
            }
            "typing_start" -> envelope.str("user_id")?.let { markTyping(envelope.str("conversation_id"), it) }
            "typing_stop" -> envelope.str("user_id")?.let { clearTyping(it) }
            "conversation_created" -> loadConversations()
            // reaction_update, presence_update, poll_update, call_signal and the
            // key events are handled in later milestones; ignoring them here is
            // deliberate, not an oversight.
        }
    }

    private fun onIncoming(message: Message) {
        val ui = message.toUi(selfUserId)
        val open = _conversation.value
        if (open != null && open.id == ui.conversationId) {
            _conversation.update { state ->
                if (state == null || state.messages.any { it.id == ui.id }) state
                else state.copy(messages = state.messages + ui)
            }
            if (!ui.outgoing) acknowledge(ui.conversationId, ui.id)
            bumpRow(ui.conversationId, ui, unreadDelta = 0)
        } else {
            bumpRow(ui.conversationId, ui, unreadDelta = if (ui.outgoing) 0 else 1)
        }
    }

    private fun replace(ui: UiMessage) {
        _conversation.update { state ->
            state?.copy(messages = state.messages.map { if (it.id == ui.id) ui else it })
        }
    }

    /** Moves a conversation to the top with its new preview. */
    private fun bumpRow(conversationId: String, last: UiMessage, unreadDelta: Int = 0) {
        val known = _list.value.conversations.any { it.id == conversationId }
        if (!known) { loadConversations(); return }
        _list.update { state ->
            state.copy(conversations = state.conversations.map { row ->
                if (row.id != conversationId) row else row.copy(
                    lastMessage = last,
                    lastActivityMs = last.createdAtMs,
                    unreadCount = (row.unreadCount + unreadDelta).coerceAtLeast(0),
                    isUnread = row.isUnread || unreadDelta > 0,
                )
            })
        }
    }

    private fun markTyping(conversationId: String?, userId: String) {
        if (userId == selfUserId) return
        val open = _conversation.value
        if (open != null && (conversationId == null || conversationId == open.id)) {
            _conversation.update { it?.copy(typingUserIds = it.typingUserIds + userId) }
        }
        typingTimers.remove(userId)?.cancel()
        // The module has no "stopped typing" guarantee; expire it ourselves.
        typingTimers[userId] = viewModelScope.launch {
            delay(TYPING_TIMEOUT_MS)
            clearTyping(userId)
        }
    }

    private fun clearTyping(userId: String) {
        typingTimers.remove(userId)?.cancel()
        _conversation.update { it?.copy(typingUserIds = it.typingUserIds - userId) }
    }

    // --------------------------------------------------------------- utils

    /**
     * Oldest-first, de-duplicated by id. The server returns newest-first pages;
     * a page can overlap the one already held when a message lands mid-fetch.
     */
    private fun merge(
        existing: List<UiMessage>,
        page: List<Message>,
        reactions: List<com.kubuno.chat.net.Reaction>,
    ): List<UiMessage> {
        val counts = reactions.groupBy { it.messageId }
        val fresh = page.map { m ->
            val own = counts[m.id].orEmpty()
            m.toUi(
                selfUserId = selfUserId,
                reactions = own.groupingBy { it.emoji }.eachCount(),
                mine = own.filter { it.userId == selfUserId }.map { it.emoji }.toSet(),
            )
        }
        return (existing + fresh)
            .associateBy { it.id }
            .values
            .sortedBy { it.createdAtMs }
    }

    private fun subtitleFor(members: List<Member>, row: UiConversation?): String? = when {
        row?.isGroup == true && members.isNotEmpty() ->
            members.joinToString(", ") { it.label }.take(SUBTITLE_MAX)
        row?.isGroup == true -> "${row.memberCount} participants"
        else -> null
    }

    private fun friendly(e: Throwable): String = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException -> "Serveur injoignable"
        is java.net.SocketTimeoutException -> "Délai dépassé"
        else -> e.message ?: e.javaClass.simpleName
    }

    override fun onCleared() {
        socket?.stop()
        super.onCleared()
    }

    private companion object {
        const val TAG = "KubunoChatVm"
        const val PAGE = 60
        const val TYPING_TIMEOUT_MS = 6_000L
        const val SUBTITLE_MAX = 80
        const val PREVIEW_CONCURRENCY = 5
    }
}
