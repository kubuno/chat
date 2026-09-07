package com.kubuno.chat.ui

import android.net.Uri
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kubuno.android.account.SharedAccount
import com.kubuno.android.account.SharedAccounts
import com.kubuno.chat.call.CallEngine
import com.kubuno.chat.call.CallSignal
import com.kubuno.chat.call.CallSignalEnvelope
import com.kubuno.chat.net.ChatApi
import com.kubuno.chat.net.ChatClients
import com.kubuno.chat.net.ChatEnvelope
import com.kubuno.chat.net.ChatSocket
import com.kubuno.chat.net.CreateConversationBody
import com.kubuno.chat.net.PollResults
import com.kubuno.chat.net.UserSuggestion
import com.kubuno.chat.net.VoteBody
import com.kubuno.chat.net.EditMessageBody
import com.kubuno.chat.net.ReactionBody
import com.kubuno.chat.net.Member
import com.kubuno.chat.net.MemberSettingsBody
import com.kubuno.chat.net.Message
import com.kubuno.chat.net.MediaPlayback
import com.kubuno.chat.net.MediaRepository
import com.kubuno.chat.net.ReadReceiptBody
import com.kubuno.chat.net.VoiceRecorder
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.File
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
    private val media: MediaRepository,
    val voice: VoiceRecorder,
    private val player: MediaPlayback,
    private val calls: CallEngine,
) : ViewModel() {

    /** Call signals are their own little wire format; keep a Json for them. */
    private val callJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; explicitNulls = false }

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

    /** Decrypted attachments, keyed by media id, for the bubbles to render. */
    private val _mediaFiles = MutableStateFlow<Map<String, File>>(emptyMap())
    val mediaFiles: StateFlow<Map<String, File>> = _mediaFiles.asStateFlow()

    /** Playback state of the one voice message that can be playing. */
    val playback: StateFlow<MediaPlayback.State> get() = player.state

    private val mediaInFlight = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private var socket: ChatSocket? = null
    private var socketJob: Job? = null
    private val typingTimers = mutableMapOf<String, Job>()
    @Volatile private var typingSentAtMs = 0L

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
                    _list.update {
                        it.copy(
                            loading = false,
                            error = null,
                            conversations = response.conversations.map { s ->
                                val last = s.lastMessage
                                    ?.asMessage(s.conversation.id)
                                    ?.toUi(selfUserId)
                                s.toUi(last, now)
                            },
                        )
                    }
                    // Instances that predate the last_message field give us
                    // nothing to preview; one page-of-one per row is the
                    // fallback. A single row carrying the field proves the
                    // server has it, so a genuinely empty inbox costs nothing.
                    if (response.conversations.isNotEmpty() &&
                        response.conversations.none { it.lastMessage != null }
                    ) {
                        fillPreviews(response.conversations.map { it.conversation.id })
                    }
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
    private fun fillPreviews(ids: List<String>, force: Boolean = false) {
        val api = api ?: return
        viewModelScope.launch {
            val gate = Semaphore(PREVIEW_CONCURRENCY)
            coroutineScope {
                ids.map { id ->
                    async {
                        val last = gate.withPermit {
                            runCatching { api.messages(id, limit = 1).messages.firstOrNull() }.getOrNull()
                        }
                        val ui = last?.toUi(selfUserId)
                        _list.update { state ->
                            state.copy(conversations = state.conversations.map { row ->
                                if (row.id != id || (!force && row.lastMessage != null)) row
                                else row.copy(
                                    lastMessage = ui,
                                    lastActivityMs = ui?.createdAtMs ?: row.lastActivityMs,
                                )
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
                    // A direct conversation has no name of its own, so when the
                    // list row is not there yet — a conversation just created,
                    // or one opened from a notification — the title has to come
                    // from the member list, or the header stays blank.
                    val resolvedTitle = detail?.conversation?.name
                        ?: row?.title?.takeIf { it.isNotBlank() }
                        ?: detail?.members
                            ?.firstOrNull { it.userId != selfUserId }
                            ?.label
                        ?: ""
                    _conversation.update { state ->
                        state?.takeIf { it.id == id }?.copy(
                            title = resolvedTitle,
                            isGroup = detail?.conversation?.convType?.let { it != "direct" } ?: state.isGroup,
                            members = members,
                            messages = messages,
                            loading = false,
                            hasMore = page.messages.size >= PAGE,
                            subtitle = subtitleFor(detail?.members.orEmpty(), row),
                        )
                    }
                    // Now that we know who is in this conversation, the list row
                    // can prefix its preview with the speaker's name.
                    if (members.isNotEmpty()) {
                        val names = members.mapValues { (_, member) -> member.label }
                        _list.update { listState ->
                            listState.copy(conversations = listState.conversations.map { conv ->
                                if (conv.id == id) conv.copy(senderNames = names) else conv
                            })
                        }
                    }
                    messages.lastOrNull()?.let { acknowledge(id, it.id) }
                    loadPinned(id)
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

    // ------------------------------------------------------- compose targets

    fun startReply(message: UiMessage) =
        _conversation.update { it?.copy(replyTo = message, editing = null, actionTarget = null) }

    fun startEdit(message: UiMessage) =
        _conversation.update { it?.copy(editing = message, replyTo = null, actionTarget = null) }

    fun cancelCompose() = _conversation.update { it?.copy(replyTo = null, editing = null) }

    fun openActions(message: UiMessage) = _conversation.update { it?.copy(actionTarget = message) }

    fun closeActions() = _conversation.update { it?.copy(actionTarget = null) }

    // ----------------------------------------------------------- multi-select

    fun toggleSelect(message: UiMessage) = _conversation.update { state ->
        state ?: return@update null
        val next = if (message.id in state.selection) state.selection - message.id
        else state.selection + message.id
        state.copy(selection = next, actionTarget = null)
    }

    fun clearSelection() = _conversation.update { it?.copy(selection = emptySet()) }

    // ---------------------------------------------------------------- search

    fun openSearch() = _conversation.update { it?.copy(search = "") }

    fun closeSearch() =
        _conversation.update { it?.copy(search = null, searchMatches = emptyList(), searchIndex = 0) }

    fun setSearch(query: String) = _conversation.update { state ->
        state ?: return@update null
        // Local only: the module has no message-search route, and the history
        // already in memory is what the user is looking through.
        val matches = if (query.isBlank()) emptyList() else state.messages
            .filter { !it.deleted && it.preview().contains(query, ignoreCase = true) }
            .map { it.id }
            .reversed()
        state.copy(search = query, searchMatches = matches, searchIndex = 0)
    }

    fun stepSearch(forward: Boolean) = _conversation.update { state ->
        state ?: return@update null
        if (state.searchMatches.isEmpty()) return@update state
        val size = state.searchMatches.size
        val next = (state.searchIndex + if (forward) 1 else -1 + size) % size
        state.copy(searchIndex = next)
    }

    // -------------------------------------------------------------- messaging

    /** How long messages sent from this conversation survive; null = forever. */
    fun setEphemeral(seconds: Long?) =
        _conversation.update { it?.copy(ephemeralSeconds = seconds) }

    /**
     * Offers members whose name matches the @mention being typed.
     *
     * Matching on the token after the last "@" of the draft, and only while it
     * has no space: once the user typed a space the mention is finished, and
     * keeping the list open would cover the conversation for nothing.
     */
    private fun updateMentions(text: String) {
        val state = _conversation.value ?: return
        if (!state.isGroup) return
        val at = text.lastIndexOf('@')
        val token = if (at < 0) null else text.substring(at + 1)
        val matches = when {
            token == null || token.contains(' ') || token.length > MENTION_MAX -> emptyList()
            else -> state.members.values
                .filter { it.userId != selfUserId }
                .filter { token.isEmpty() || it.label.contains(token, ignoreCase = true) }
                .take(MENTION_SUGGESTIONS)
        }
        _conversation.update { it?.copy(mentionSuggestions = matches) }
    }

    /** Signals typing on the socket; harmless to call on every keystroke. */
    fun onDraftChanged(text: String) {
        updateMentions(text)
        val state = _conversation.value ?: return
        val socket = socket ?: return
        val now = System.currentTimeMillis()
        if (text.isBlank()) {
            if (typingSentAtMs != 0L) {
                socket.typing(state.id, started = false)
                typingSentAtMs = 0L
            }
            return
        }
        // The module re-broadcasts every frame, so throttle rather than spam.
        if (now - typingSentAtMs < TYPING_THROTTLE_MS) return
        typingSentAtMs = now
        socket.typing(state.id, started = true)
    }

    fun send(text: String) {
        val api = api ?: return
        val state = _conversation.value ?: return
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return

        // An edit in progress rewrites the message instead of sending a new one.
        state.editing?.let { target ->
            submitEdit(target, trimmed)
            return
        }

        val replyTo = state.replyTo
        val body = ChatEnvelope.encodeText(trimmed).copy(
            replyToId = replyTo?.id,
            expiresInSecs = state.ephemeralSeconds,
        )
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
            replyToId = replyTo?.id,
            messageType = "text",
            pending = true,
        )
        _conversation.update { it?.copy(messages = it.messages + optimistic, replyTo = null, mentionSuggestions = emptyList()) }
        socket?.typing(state.id, started = false)
        typingSentAtMs = 0L

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

    // ---------------------------------------------------------------- media

    /**
     * Sends one or more picked files. Each is encrypted, uploaded, then
     * announced as a message; an optimistic bubble shows the upload in flight
     * so a slow attachment never looks like a dropped one.
     */
    fun sendMedia(uris: List<Uri>, caption: String? = null, forcedKind: String? = null) {
        val api = api ?: return
        val conversationId = _conversation.value?.id ?: return
        viewModelScope.launch {
            for (uri in uris) {
                val local = media.inspect(uri, forcedKind) ?: continue
                sendAttachment(api, conversationId, local, caption)
            }
        }
    }

    /** Sends a finished voice recording. */
    fun sendVoice(result: VoiceRecorder.Result) {
        val api = api ?: return
        val conversationId = _conversation.value?.id ?: return
        viewModelScope.launch {
            val local = MediaRepository.LocalFile(
                uri = Uri.fromFile(result.file),
                name = "message-vocal.m4a",
                mime = "audio/mp4",
                size = result.file.length(),
                kind = "audio",
                durationSeconds = result.durationSeconds,
            )
            sendAttachment(api, conversationId, local, caption = null, waveform = result.waveform, voice = true)
            result.file.delete()
        }
    }

    private suspend fun sendAttachment(
        api: ChatApi,
        conversationId: String,
        local: MediaRepository.LocalFile,
        caption: String?,
        waveform: List<Float>? = null,
        voice: Boolean = false,
    ) {
        val placeholderId = "pending:${ChatEnvelope.newNonce()}"
        val placeholder = UiMessage(
            id = placeholderId,
            conversationId = conversationId,
            senderId = selfUserId,
            outgoing = true,
            content = ChatEnvelope.Content(
                text = caption,
                media = ChatEnvelope.Media(
                    mediaId = "",
                    mime = local.mime,
                    name = local.name,
                    size = local.size,
                    kind = local.kind,
                    width = local.width,
                    height = local.height,
                    duration = local.durationSeconds,
                    voice = voice,
                    waveform = waveform,
                ),
                poll = null,
                hasCard = false,
            ),
            createdAtMs = System.currentTimeMillis(),
            editedAtMs = null,
            deleted = false,
            pinned = false,
            replyToId = null,
            messageType = local.kind,
            pending = true,
        )
        _conversation.update { it?.copy(messages = it.messages + placeholder) }

        val uploaded = media.upload(api, local)?.copy(voice = voice, waveform = waveform)
        if (uploaded == null) {
            _conversation.update { state ->
                state?.copy(messages = state.messages.map {
                    if (it.id == placeholderId) it.copy(pending = false, failed = true) else it
                })
            }
            return
        }

        runCatching { api.send(conversationId, ChatEnvelope.encodeMedia(uploaded, caption)) }
            .onSuccess { response ->
                val real = response.message.toUi(selfUserId)
                _conversation.update { state ->
                    state?.copy(messages = state.messages.map { if (it.id == placeholderId) real else it })
                }
                bumpRow(conversationId, real)
            }
            .onFailure { e ->
                Log.w(TAG, "media send failed", e)
                _conversation.update { state ->
                    state?.copy(messages = state.messages.map {
                        if (it.id == placeholderId) it.copy(pending = false, failed = true) else it
                    })
                }
            }
    }

    /**
     * Downloads and decrypts an attachment once, publishing the local file so
     * every bubble showing it can render. Safe to call from composition: a
     * second call for the same media is a no-op while the first is in flight.
     */
    fun requestMedia(item: ChatEnvelope.Media) {
        val api = api ?: return
        if (item.mediaId.isBlank()) return
        if (_mediaFiles.value.containsKey(item.mediaId)) return
        if (!mediaInFlight.add(item.mediaId)) return
        viewModelScope.launch {
            val file = media.localCopy(api, item)
            mediaInFlight.remove(item.mediaId)
            if (file != null) {
                _mediaFiles.update { it + (item.mediaId to file) }
            }
        }
    }

    /** Plays or pauses a voice message, downloading it first if needed. */
    fun toggleVoice(message: UiMessage) {
        val item = message.content.media ?: return
        val api = api ?: return
        viewModelScope.launch {
            val file = _mediaFiles.value[item.mediaId] ?: media.localCopy(api, item)?.also { local ->
                _mediaFiles.update { it + (item.mediaId to local) }
            } ?: return@launch
            player.toggle(message.id, file)
        }
    }

    fun startRecording() {
        // Stop any playback first: recording while a voice note plays would
        // capture the speaker.
        player.stop()
        voice.start()
    }

    fun finishRecording() {
        val result = voice.stop() ?: return
        sendVoice(result)
    }

    fun cancelRecording() = voice.cancel()

    // ------------------------------------------------------------- new chat

    data class NewChatState(
        val open: Boolean = false,
        val query: String = "",
        val results: List<UserSuggestion> = emptyList(),
        val searching: Boolean = false,
        val groupMode: Boolean = false,
        val groupName: String = "",
        val selected: List<UserSuggestion> = emptyList(),
        val creating: Boolean = false,
    )

    private val _newChat = MutableStateFlow(NewChatState())
    val newChat: StateFlow<NewChatState> = _newChat.asStateFlow()

    private var searchJob: Job? = null

    fun openNewChat() = _newChat.update { NewChatState(open = true) }
    fun closeNewChat() = _newChat.update { NewChatState() }
    fun setGroupMode(on: Boolean) = _newChat.update { it.copy(groupMode = on) }
    fun setGroupName(name: String) = _newChat.update { it.copy(groupName = name) }

    fun toggleMember(person: UserSuggestion) = _newChat.update { state ->
        val already = state.selected.any { it.id == person.id }
        state.copy(
            selected = if (already) state.selected.filterNot { it.id == person.id }
            else state.selected + person
        )
    }

    fun searchPeople(query: String) {
        _newChat.update { it.copy(query = query) }
        searchJob?.cancel()
        if (query.isBlank()) {
            _newChat.update { it.copy(results = emptyList(), searching = false) }
            return
        }
        val api = api ?: return
        searchJob = viewModelScope.launch {
            // Debounced: the core searches on every keystroke otherwise, and a
            // fast typist would queue a request per letter.
            delay(SEARCH_DEBOUNCE_MS)
            _newChat.update { it.copy(searching = true) }
            val found = runCatching { api.searchUsers(query, limit = 20).users }
                .onFailure { Log.w(TAG, "user search failed", it) }
                .getOrDefault(emptyList())
                .filter { it.id != selfUserId }
            _newChat.update { it.copy(results = found, searching = false) }
        }
    }

    /** Opens (or creates) the direct conversation with [person]. */
    fun startDirect(person: UserSuggestion) {
        val api = api ?: return
        viewModelScope.launch {
            _newChat.update { it.copy(creating = true) }
            val created = runCatching {
                api.createConversation(
                    CreateConversationBody(convType = "direct", targetUser = person.id)
                )
            }.onFailure { Log.w(TAG, "direct conversation failed", it) }.getOrNull()
            _newChat.update { NewChatState() }
            if (created != null) {
                loadConversations()
                openConversation(created.conversation.id)
            }
        }
    }

    fun createGroup() {
        val api = api ?: return
        val state = _newChat.value
        if (state.groupName.isBlank() || state.selected.isEmpty()) return
        viewModelScope.launch {
            _newChat.update { it.copy(creating = true) }
            val created = runCatching {
                api.createConversation(
                    CreateConversationBody(
                        convType = "group",
                        name = state.groupName.trim(),
                        memberIds = state.selected.map { it.id },
                    )
                )
            }.onFailure { Log.w(TAG, "group creation failed", it) }.getOrNull()
            _newChat.update { NewChatState() }
            if (created != null) {
                loadConversations()
                openConversation(created.conversation.id)
            }
        }
    }

    // ---------------------------------------------------------------- polls

    /** Poll tallies by message id, refreshed when a vote lands. */
    private val _polls = MutableStateFlow<Map<String, PollResults>>(emptyMap())
    val polls: StateFlow<Map<String, PollResults>> = _polls.asStateFlow()

    fun loadPoll(messageId: String) {
        val api = api ?: return
        if (_polls.value.containsKey(messageId)) return
        viewModelScope.launch {
            runCatching { api.pollResults(messageId) }
                .onSuccess { results -> _polls.update { it + (messageId to results) } }
        }
    }

    fun vote(messageId: String, optionIndex: Int) {
        val api = api ?: return
        viewModelScope.launch {
            runCatching { api.vote(messageId, VoteBody(optionIndex)) }
                .onSuccess { results -> _polls.update { it + (messageId to results) } }
                .onFailure { Log.w(TAG, "vote failed", it) }
        }
    }

    /** Sends a poll: the question and options ride in the envelope. */
    fun sendPoll(question: String, options: List<String>) {
        val api = api ?: return
        val conversationId = _conversation.value?.id ?: return
        val clean = options.map { it.trim() }.filter { it.isNotBlank() }
        if (question.isBlank() || clean.size < 2) return
        viewModelScope.launch {
            runCatching { api.send(conversationId, ChatEnvelope.encodePoll(question.trim(), clean)) }
                .onSuccess { response ->
                    val ui = response.message.toUi(selfUserId)
                    _conversation.update { it?.copy(messages = it.messages + ui) }
                    bumpRow(conversationId, ui)
                }
                .onFailure { Log.w(TAG, "poll send failed", it) }
        }
    }

    // ---------------------------------------------------------------- calls

    val callState: StateFlow<CallEngine.State> get() = calls.state
    val incomingCall: StateFlow<CallEngine.Incoming?> get() = calls.incoming
    val callEngine: CallEngine get() = calls

    /**
     * Rings a conversation. The room is the conversation id, which is what the
     * web client uses too, so a call started on a phone rings in a browser.
     */
    /**
     * Pulls the instance's ICE servers, then runs [then].
     *
     * Always before a call, never cached: a coturn credential minted from a
     * shared secret expires, and the module re-reads its own settings about
     * once a minute, so the freshest answer is the one taken now.
     */
    private fun withIceServers(then: () -> Unit) {
        val api = api
        if (api == null) { then(); return }
        viewModelScope.launch {
            val config = runCatching { api.config() }.getOrNull()
            calls.useIceServers(config?.iceServers.orEmpty())
            if (config?.iceServers.isNullOrEmpty()) {
                Log.i(TAG, "instance configured no ICE server: direct connections only")
            }
            then()
        }
    }

    fun startCall(conversation: UiConversation, video: Boolean) {
        val targets = conversation.senderNames
            .filterKeys { it != selfUserId }
            .map { (id, name) -> id to name }
            .ifEmpty {
                // A direct conversation whose members we never fetched still has
                // the other party in the row's own identity.
                conversation.otherUserId?.let { listOf(it to conversation.title) }.orEmpty()
            }
        if (targets.isEmpty()) {
            // Nobody to ring: fetch the members, then try again.
            viewModelScope.launch {
                val api = api ?: return@launch
                val detail = runCatching { api.conversation(conversation.id) }.getOrNull() ?: return@launch
                val members = detail.members
                    .filter { it.userId != selfUserId }
                    .map { it.userId to it.label }
                if (members.isNotEmpty()) {
                    withIceServers { calls.start(conversation.id, conversation.title, video, members) }
                }
            }
            return
        }
        withIceServers { calls.start(conversation.id, conversation.title, video, targets) }
    }

    /** Rings whoever is on the other side of the conversation on screen. */
    fun startCallHere(video: Boolean) {
        val open = _conversation.value ?: return
        val row = _list.value.conversations.firstOrNull { it.id == open.id }
        val targets = open.members.keys
            .filter { it != selfUserId }
            .map { id -> id to (open.members[id]?.label ?: id.take(6)) }
        if (targets.isEmpty()) {
            row?.let { startCall(it, video) }
            return
        }
        withIceServers { calls.start(open.id, open.title, video, targets) }
    }

    /** Answering also needs the instance ICE list; it is a call like any other. */
    fun acceptCall() = withIceServers { calls.accept() }
    fun declineCall() = calls.decline()
    fun hangUp() = calls.hangUp()
    fun toggleCallMute() = calls.toggleMute()
    fun toggleCallCamera() = calls.toggleCamera()
    fun switchCallCamera() = calls.switchCamera()
    fun toggleCallHand() = calls.toggleHand()

    fun cycleVoiceSpeed() = player.cycleSpeed()

    fun seekVoice(fraction: Float) = player.seekTo(fraction)

    /**
     * Rewrites a message the user sent. The module allows this on any of your
     * own messages with no time limit, so the app imposes none either — an
     * artificial window would only take away something the platform offers.
     */
    private fun submitEdit(target: UiMessage, text: String) {
        val api = api ?: return
        val conversationId = target.conversationId
        val body = ChatEnvelope.encodeText(text)
        _conversation.update { state ->
            state?.copy(
                editing = null,
                messages = state.messages.map {
                    if (it.id != target.id) it
                    else it.copy(
                        content = ChatEnvelope.Content(text, it.content.media, it.content.poll, it.content.hasCard),
                        editedAtMs = System.currentTimeMillis(),
                    )
                },
            )
        }
        viewModelScope.launch {
            runCatching { api.edit(target.id, EditMessageBody(body.encryptedData, body.nonce)) }
                .onSuccess { response ->
                    val ui = response.message.toUi(selfUserId)
                    replace(ui)
                    refreshRowPreview(conversationId, ui)
                }
                .onFailure { e ->
                    Log.w(TAG, "edit failed", e)
                    // Put the original text back rather than leave a lie on screen.
                    replace(target)
                }
        }
    }

    /**
     * Deletes for everyone — the only kind the module implements. It keeps a
     * tombstone (deleted_at) and tells the other members, so the bubble becomes
     * "this message was deleted" rather than vanishing mid-conversation.
     */
    fun deleteMessage(message: UiMessage) {
        val api = api ?: return
        _conversation.update { state ->
            state?.copy(
                actionTarget = null,
                selection = state.selection - message.id,
                messages = state.messages.map { if (it.id == message.id) it.copy(deleted = true) else it },
            )
        }
        viewModelScope.launch {
            runCatching { api.delete(message.id) }
                .onFailure {
                    Log.w(TAG, "delete failed", it)
                    replace(message)
                }
            markRowDeleted(message.conversationId, message.id)
        }
    }

    /** Adds or removes one of my reactions on a message. */
    fun toggleReaction(message: UiMessage, emoji: String) {
        val api = api ?: return
        val mine = emoji in message.myReactions
        val counts = message.reactions.toMutableMap()
        val next = (counts[emoji] ?: 0) + if (mine) -1 else 1
        if (next <= 0) counts.remove(emoji) else counts[emoji] = next
        replace(
            message.copy(
                reactions = counts,
                myReactions = if (mine) message.myReactions - emoji else message.myReactions + emoji,
            )
        )
        closeActions()
        viewModelScope.launch {
            runCatching {
                if (mine) api.removeReaction(message.id, emoji) else api.addReaction(message.id, ReactionBody(emoji))
            }.onFailure {
                Log.w(TAG, "reaction failed", it)
                replace(message)
            }
        }
    }

    /** Pins or unpins a message (the module toggles server-side). */
    fun togglePinMessage(message: UiMessage) {
        val api = api ?: return
        val conversationId = message.conversationId
        closeActions()
        viewModelScope.launch {
            runCatching { api.pinMessage(message.id) }
                .onSuccess {
                    replace(it.message.toUi(selfUserId))
                    loadPinned(conversationId)
                }
                .onFailure { Log.w(TAG, "pin failed", it) }
        }
    }

    /** Refreshes the pinned banner for a conversation. */
    fun loadPinned(conversationId: String) {
        val api = api ?: return
        viewModelScope.launch {
            runCatching { api.pinned(conversationId).messages }
                .onSuccess { messages ->
                    val ui = messages.map { it.toUi(selfUserId) }
                    _conversation.update { state ->
                        state?.takeIf { it.id == conversationId }
                            ?.copy(pinned = ui, pinnedIndex = 0)
                    }
                }
                .onFailure { Log.w(TAG, "pinned list failed", it) }
        }
    }

    /** Cycles through pinned messages when the banner is tapped. */
    fun stepPinned() = _conversation.update { state ->
        state ?: return@update null
        if (state.pinned.isEmpty()) return@update state
        state.copy(pinnedIndex = (state.pinnedIndex + 1) % state.pinned.size)
    }

    /**
     * Forwards messages to another conversation.
     *
     * The module has no forward route, so this re-sends each envelope as a new
     * message. That is what the web would have to do too; the only thing lost
     * is the "forwarded" provenance, which nothing on the wire can carry today.
     */
    fun forward(messages: List<UiMessage>, toConversationId: String) {
        val api = api ?: return
        clearSelection()
        closeActions()
        viewModelScope.launch {
            for (message in messages.sortedBy { it.createdAtMs }) {
                val text = message.content.text ?: continue
                runCatching { api.send(toConversationId, ChatEnvelope.encodeText(text)) }
                    .onFailure { Log.w(TAG, "forward failed", it) }
            }
            loadConversations()
        }
    }

    /** The conversations a forward can target, most recent first. */
    fun forwardTargets(): List<UiConversation> =
        _list.value.conversations
            .filter { it.id != _conversation.value?.id }
            .sortedByDescending { it.lastActivityMs }

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
        // The engine knows nothing about transports: it hands us a signal and
        // we put it on whichever socket is current.
        calls.myUserId = account.userId
        calls.myName = account.label
        calls.onSignal = { toUserId, signal ->
            fresh.callSignal(toUserId, callJson.encodeToJsonElement(CallSignal.serializer(), signal))
        }
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
                // Two payload shapes: an edit carries the whole message, a
                // deletion carries only its id.
                val message = payload.message
                if (message != null) {
                    val ui = message.toUi(selfUserId)
                    replace(ui)
                    refreshRowPreview(ui.conversationId, ui)
                } else if (payload.messageId != null) {
                    _conversation.update { state ->
                        state?.copy(messages = state.messages.map {
                            if (it.id == payload.messageId) it.copy(deleted = true) else it
                        })
                    }
                    payload.conversationId?.let { markRowDeleted(it, payload.messageId) }
                }
            }
            "typing_start" -> envelope.str("user_id")?.let { markTyping(envelope.str("conversation_id"), it) }
            "typing_stop" -> envelope.str("user_id")?.let { clearTyping(it) }
            "conversation_created" -> loadConversations()
            "call_signal" -> {
                val payload = socket.decode(envelope, CallSignalEnvelope.serializer()) ?: return
                val body = payload.signal ?: return
                val signal = runCatching { callJson.decodeFromJsonElement(CallSignal.serializer(), body) }
                    .getOrNull() ?: return
                calls.onSignal(payload.fromUserId, signal)
            }
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

    /** Keeps a row's preview honest when its last message is edited. */
    private fun refreshRowPreview(conversationId: String, message: UiMessage) {
        _list.update { state ->
            state.copy(conversations = state.conversations.map { row ->
                if (row.id != conversationId || row.lastMessage?.id != message.id) row
                else row.copy(lastMessage = message)
            })
        }
    }

    /**
     * A deleted last message leaves the row showing text that no longer
     * exists. The event carries no replacement, so ask the server what the row
     * should say now.
     */
    private fun markRowDeleted(conversationId: String, messageId: String) {
        val stale = _list.value.conversations
            .firstOrNull { it.id == conversationId }
            ?.lastMessage?.id == messageId
        if (stale) fillPreviews(listOf(conversationId), force = true)
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
        const val TYPING_THROTTLE_MS = 3_000L
        const val SEARCH_DEBOUNCE_MS = 250L
        const val MENTION_SUGGESTIONS = 6
        const val MENTION_MAX = 24
    }
}
