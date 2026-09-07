package com.kubuno.chat.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Two screens, one back stack step: the list, and a conversation on top of it.
 * Deliberately not Navigation Compose — the whole app is list ⇄ conversation,
 * and the socket lives in the shared ViewModel either way.
 */
@Composable
fun ChatApp(
    openConversationId: String? = null,
    onDeepLinkHandled: () -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val accounts by viewModel.accounts.collectAsStateWithLifecycle()
    val list by viewModel.list.collectAsStateWithLifecycle()
    val conversation by viewModel.conversation.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val mediaFiles by viewModel.mediaFiles.collectAsStateWithLifecycle()
    val playback by viewModel.playback.collectAsStateWithLifecycle()
    val recording by viewModel.voice.state.collectAsStateWithLifecycle()
    val polls by viewModel.polls.collectAsStateWithLifecycle()
    val newChat by viewModel.newChat.collectAsStateWithLifecycle()

    // Which messages a forward is about: the long-pressed one, or the selection.
    var forwarding by remember { mutableStateOf<List<UiMessage>>(emptyList()) }
    var attaching by remember { mutableStateOf(false) }
    var composingPoll by remember { mutableStateOf(false) }
    var pendingCall by remember { mutableStateOf<Pair<UiConversation, Boolean>?>(null) }
    var pendingHereCall by remember { mutableStateOf<Boolean?>(null) }

    // Gallery uses the photo picker, which needs no storage permission at all:
    // the system UI hands back exactly what the user chose.
    val pickVisual = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_ATTACHMENTS)
    ) { uris -> if (uris.isNotEmpty()) viewModel.sendMedia(uris) }

    val pickDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { viewModel.sendMedia(listOf(it), forcedKind = "file") } }

    val pickAudio = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { viewModel.sendMedia(listOf(it), forcedKind = "audio") } }

    // The camera writes into a file we own, so the picture comes back as a
    // content:// uri we can read without any storage permission.
    var cameraTarget by remember { mutableStateOf<Uri?>(null) }
    val takePicture = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { taken -> if (taken) cameraTarget?.let { viewModel.sendMedia(listOf(it), forcedKind = "image") } }

    fun openCamera() {
        val uri = CameraCapture.newTarget(context) ?: return
        cameraTarget = uri
        takePicture.launch(uri)
    }

    val askMicrophone = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) viewModel.startRecording() }

    fun startRecording() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) {
            viewModel.startRecording()
        } else {
            askMicrophone.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // A notification tap names a conversation; open it once, then forget it,
    // or every recomposition would fight the user trying to leave.
    LaunchedEffect(openConversationId) {
        val id = openConversationId ?: return@LaunchedEffect
        viewModel.openConversation(id)
        onDeepLinkHandled()
    }

    // Android 13+ posts nothing without this, and a chat app with silent
    // notifications is a chat app with no notifications.
    val askNotifications = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val callState by viewModel.callState.collectAsStateWithLifecycle()
    val incoming by viewModel.incomingCall.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(ChatTab.Chats) }

    val askHereCallPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) {
            pendingHereCall?.let { viewModel.startCallHere(it) }
        }
        pendingHereCall = null
    }

    // A call takes the whole screen and nothing else may be reached from it.
    val askCallPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) pendingCall?.let { (row, video) ->
            viewModel.startCall(row, video)
        }
        pendingCall = null
    }

    fun placeCallHere(video: Boolean) {
        val needed = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (video) add(Manifest.permission.CAMERA)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) viewModel.startCallHere(video)
        else {
            pendingHereCall = video
            askHereCallPermissions.launch(missing.toTypedArray())
        }
    }

    fun placeCall(row: UiConversation, video: Boolean) {
        val needed = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (video) add(Manifest.permission.CAMERA)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            viewModel.startCall(row, video)
        } else {
            pendingCall = row to video
            askCallPermissions.launch(missing.toTypedArray())
        }
    }

    if (callState.active) {
        BackHandler { viewModel.hangUp() }
        CallScreen(
            state = callState,
            eglBase = viewModel.callEngine.eglBase,
            localTrack = viewModel.callEngine.localVideoTrack,
            onToggleMute = viewModel::toggleCallMute,
            onToggleCamera = viewModel::toggleCallCamera,
            onSwitchCamera = viewModel::switchCallCamera,
            onToggleHand = viewModel::toggleCallHand,
            onHangUp = viewModel::hangUp,
        )
        return
    }

    incoming?.let { call ->
        BackHandler { viewModel.declineCall() }
        IncomingCallOverlay(
            call = call,
            onAccept = viewModel::acceptCall,
            onDecline = viewModel::declineCall,
        )
        return
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            // The bar belongs to the list level; inside a conversation the
            // composer owns the bottom of the screen.
            if (accounts.isNotEmpty() && conversation == null && !newChat.open && !list.showArchived) {
                ChatBottomBar(
                    selected = tab,
                    unread = list.conversations.sumOf { it.unreadCount },
                    onSelect = { tab = it },
                )
            }
        },
    ) { padding ->
        // Scaffold already insets for the status bar under enableEdgeToEdge;
        // adding statusBarsPadding() on top of it would double the gap.
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                accounts.isEmpty() -> NoAccount()

                newChat.open -> {
                    BackHandler { viewModel.closeNewChat() }
                    NewChatScreen(
                        state = newChat,
                        onBack = viewModel::closeNewChat,
                        onQuery = viewModel::searchPeople,
                        onPickDirect = viewModel::startDirect,
                        onToggleMember = viewModel::toggleMember,
                        onSetGroupMode = viewModel::setGroupMode,
                        onGroupName = viewModel::setGroupName,
                        onCreateGroup = viewModel::createGroup,
                    )
                }

                conversation != null -> {
                    val state = conversation!!
                    // Back peels one layer at a time, innermost first.
                    BackHandler {
                        when {
                            state.selecting -> viewModel.clearSelection()
                            state.search != null -> viewModel.closeSearch()
                            state.replyTo != null || state.editing != null -> viewModel.cancelCompose()
                            else -> viewModel.closeConversation()
                        }
                    }
                    ConversationScreen(
                        state = state,
                        onBack = viewModel::closeConversation,
                        onSend = viewModel::send,
                        onDraftChanged = viewModel::onDraftChanged,
                        onLoadOlder = viewModel::loadOlder,
                        onRetry = viewModel::retry,
                        onLongPress = viewModel::openActions,
                        onReply = viewModel::startReply,
                        onToggleSelect = viewModel::toggleSelect,
                        onClearSelection = viewModel::clearSelection,
                        onCancelCompose = viewModel::cancelCompose,
                        onDeleteSelected = {
                            state.messages.filter { it.id in state.selection }.forEach(viewModel::deleteMessage)
                            viewModel.clearSelection()
                        },
                        onForwardSelected = {
                            forwarding = state.messages.filter { it.id in state.selection }
                        },
                        onOpenSearch = viewModel::openSearch,
                        onCloseSearch = viewModel::closeSearch,
                        onSearch = viewModel::setSearch,
                        onStepSearch = viewModel::stepSearch,
                        recording = recording,
                        mediaFiles = mediaFiles,
                        playback = playback,
                        onAttach = { attaching = true },
                        onCamera = ::openCamera,
                        onStartRecording = ::startRecording,
                        onFinishRecording = viewModel::finishRecording,
                        onCancelRecording = viewModel::cancelRecording,
                        onRequestMedia = viewModel::requestMedia,
                        onOpenMedia = { message ->
                            message.content.media
                                ?.let { mediaFiles[it.mediaId] }
                                ?.let { file -> CameraCapture.open(context, file, message.content.media.mime) }
                        },
                        onTogglePlay = viewModel::toggleVoice,
                        onCycleSpeed = viewModel::cycleVoiceSpeed,
                        onSeek = viewModel::seekVoice,
                        onAudioCall = { placeCallHere(false) },
                        onVideoCall = { placeCallHere(true) },
                        polls = polls,
                        onLoadPoll = viewModel::loadPoll,
                        onVote = viewModel::vote,
                        onStepPinned = viewModel::stepPinned,
                    )

                    if (attaching) {
                        AttachmentSheet(
                            onDismiss = { attaching = false },
                            onPick = { kind ->
                                attaching = false
                                when (kind) {
                                    AttachmentKind.Gallery -> pickVisual.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                                    )
                                    AttachmentKind.Camera -> openCamera()
                                    AttachmentKind.Document -> pickDocument.launch(arrayOf("*/*"))
                                    AttachmentKind.Audio -> pickAudio.launch(arrayOf("audio/*"))
                                    AttachmentKind.Poll -> composingPoll = true
                                    AttachmentKind.Contact -> Unit
                                }
                            },
                        )
                    }

                    state.actionTarget?.let { target ->
                        MessageActionsOverlay(
                            message = target,
                            canEdit = target.outgoing && !target.deleted,
                            canDelete = target.outgoing && !target.deleted,
                            onDismiss = viewModel::closeActions,
                            onReact = { viewModel.toggleReaction(target, it) },
                            onReply = { viewModel.startReply(target) },
                            onEdit = { viewModel.startEdit(target) },
                            onDelete = { viewModel.deleteMessage(target) },
                            onForward = {
                                viewModel.closeActions()
                                forwarding = listOf(target)
                            },
                            onPin = { viewModel.togglePinMessage(target) },
                            onSelect = { viewModel.toggleSelect(target) },
                        )
                    }

                    if (composingPoll) {
                        PollComposer(
                            onDismiss = { composingPoll = false },
                            onSend = { question, options ->
                                composingPoll = false
                                viewModel.sendPoll(question, options)
                            },
                        )
                    }

                    if (forwarding.isNotEmpty()) {
                        ForwardSheet(
                            count = forwarding.size,
                            targets = viewModel.forwardTargets(),
                            onDismiss = { forwarding = emptyList() },
                            onPick = { target ->
                                viewModel.forward(forwarding, target)
                                forwarding = emptyList()
                            },
                        )
                    }
                }

                else -> when (tab) {
                    ChatTab.Chats -> {
                        if (list.showArchived) {
                            BackHandler { viewModel.setShowArchived(false) }
                        }
                        ConversationListScreen(
                            state = list,
                            onOpen = viewModel::openConversation,
                            onFilter = viewModel::setFilter,
                            onQuery = viewModel::setQuery,
                            onShowArchived = viewModel::setShowArchived,
                            onTogglePin = viewModel::togglePin,
                            onRetry = viewModel::loadConversations,
                            onNewChat = viewModel::openNewChat,
                            onCamera = ::openCamera,
                            onOverflow = { },
                        )
                    }

                    ChatTab.Calls -> CallsScreen(
                        conversations = list.conversations,
                        onCall = { row, video -> placeCall(row, video) },
                    )

                    ChatTab.You -> YouScreen(account = accounts.firstOrNull())

                    else -> NotYetScreen(tab)
                }
            }
        }
    }
}

/**
 * Chat is a consumer app: it never signs anyone in, it borrows the accounts a
 * sibling Kubuno app already registered with the system AccountManager.
 */
@Composable
private fun NoAccount() {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Aucun compte Kubuno sur cet appareil",
            style = ChatType.ConversationTitle,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Ouvrez Kubuno Drive ou Mail pour ajouter un compte, puis revenez.",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** The photo picker caps a single selection; ten is what fits one message run. */
private const val MAX_ATTACHMENTS = 10
