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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.kubuno.android.ui.components.KubunoButton
import com.kubuno.android.ui.components.KubunoButtonSize
import com.kubuno.android.ui.components.KubunoButtonVariant
import com.kubuno.android.ui.components.KubunoTextField
import com.kubuno.chat.push.PushPrefs
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
    openMeetingId: String? = null,
    onMeetingHandled: () -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val accounts by viewModel.accounts.collectAsStateWithLifecycle()
    val list by viewModel.list.collectAsStateWithLifecycle()
    val conversation by viewModel.conversation.collectAsStateWithLifecycle()

    val context = LocalContext.current
    // The re-authentication launches a sign-in screen, which needs an Activity.
    val activity = remember(context) { context.findActivity() }
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
    var pendingMeetingName by remember { mutableStateOf<String?>(null) }
    var pendingJoinMeeting by remember { mutableStateOf<String?>(null) }
    var showNewMeeting by remember { mutableStateOf(false) }

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
    val callHistory by viewModel.callLog.collectAsStateWithLifecycle()
    val missedCalls by viewModel.missedCalls.collectAsStateWithLifecycle()

    /** The conversation whose "Options" sheet is open, if any. */
    var optionsFor by remember { mutableStateOf<UiConversation?>(null) }
    /** The conversation the clear confirmation is about, if any. */
    var confirmClearOne by remember { mutableStateOf<UiConversation?>(null) }
    /** Which "Vous" detail sheet is open, if any. */
    var youSheet by remember { mutableStateOf<YouSheet?>(null) }
    /** Whether the channel explorer sheet is open. */
    var showExplorer by remember { mutableStateOf(false) }
    /** The participant whose host-action sheet is open in a meeting, if any. */
    var hostTarget by remember { mutableStateOf<String?>(null) }
    /** A meeting created and waiting for its link to be shared, if any. */
    var meetingToShare by remember { mutableStateOf<String?>(null) }
    /** Whether the in-call meeting chat panel is open. */
    var showCallChat by remember { mutableStateOf(false) }
    /** Whether chat's own sign-in flow is showing (no account, or re-auth). */
    var showOnboarding by remember { mutableStateOf(false) }
    val pushEnabled = remember(accounts) { PushPrefs.registrationId(context) != null }

    // Opening the Appels tab is what clears its badge, exactly as looking at a
    // missed call on a phone does.
    LaunchedEffect(tab) { if (tab == ChatTab.Calls) viewModel.markCallsSeen() }

    // The in-call chat belongs to the call; it closes when the call does.
    LaunchedEffect(callState.active) { if (!callState.active) showCallChat = false }

    val askCameraForCall = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) viewModel.switchCallToVideo() }

    // A call takes the whole screen and nothing else may be reached from it.
    // The result map only contains the permissions that were ASKED FOR. Testing
    // one by name misses the common case where it was already granted and so
    // never requested — which is how a video call silently did nothing once the
    // microphone had been allowed earlier.
    val askCallPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        if (granted.values.all { it }) {
            pendingCall?.let { (row, video) -> viewModel.startCall(row, video) }
            pendingHereCall?.let { viewModel.startCallHere(it) }
            pendingMeetingName?.let { viewModel.createMeeting(it) }
            pendingJoinMeeting?.let { viewModel.joinMeeting(it) }
        }
        pendingCall = null
        pendingHereCall = null
        pendingMeetingName = null
        pendingJoinMeeting = null
    }

    // A meeting joins a video call, so it needs the same camera+mic grant. The
    // name (create) or the room id (join by link) waits for it.
    fun withCallPermissions(onGranted: () -> Unit, stash: () -> Unit) {
        val needed = arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) onGranted() else { stash(); askCallPermissions.launch(missing.toTypedArray()) }
    }

    fun createMeeting(name: String) =
        withCallPermissions({ viewModel.createMeeting(name) }, { pendingMeetingName = name })

    fun joinMeeting(room: String) =
        withCallPermissions({ viewModel.joinMeeting(room) }, { pendingJoinMeeting = room })

    // A meeting link (kubuno-chat://meet/<id>) joins that room once, then is
    // cleared so a recomposition does not rejoin it.
    LaunchedEffect(openMeetingId) {
        val room = openMeetingId ?: return@LaunchedEffect
        joinMeeting(room)
        onMeetingHandled()
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
            askCallPermissions.launch(missing.toTypedArray())
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

    // Switching an audio call to video needs the camera, which the call did
    // not ask for when it started.
    fun switchToVideo() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            viewModel.switchCallToVideo()
        } else {
            askCameraForCall.launch(Manifest.permission.CAMERA)
        }
    }

    // Chat signs in on its own — the same flow as the other Kubuno apps —
    // rather than sending the user to Drive. Success registers the account with
    // the system, where the sibling apps reuse it.
    if (showOnboarding) {
        BackHandler(enabled = accounts.isNotEmpty()) { showOnboarding = false }
        com.kubuno.chat.ui.onboarding.OnboardingScreen(
            onDone = { showOnboarding = false; viewModel.onSignedIn() },
        )
        return
    }

    if (callState.active) {
        BackHandler { if (showCallChat) showCallChat = false else viewModel.hangUp() }
        CallScreen(
            state = callState,
            eglBase = viewModel.callEngine.eglBase,
            localTrack = viewModel.callEngine.localVideoTrack,
            onToggleMute = viewModel::toggleCallMute,
            onToggleCamera = viewModel::toggleCallCamera,
            onSwitchCamera = viewModel::switchCallCamera,
            onToggleHand = viewModel::toggleCallHand,
            onSwitchToVideo = ::switchToVideo,
            onHangUp = viewModel::hangUp,
            onShareMeeting = { shareText(context, viewModel.meetingLink(callState.room.orEmpty())) },
            onEndForAll = viewModel::endMeeting,
            onParticipantMenu = { hostTarget = it },
            // The meeting's chat, alongside the video — same conversation, so
            // same group capabilities (who sent what, live).
            onOpenChat = {
                callState.room?.let { viewModel.openConversation(it) }
                showCallChat = true
            },
        )
        if (showCallChat) {
            InCallChatPanel(
                state = conversation,
                onSend = viewModel::send,
                onDismiss = { showCallChat = false },
            )
        }
        hostTarget?.let { userId ->
            val name = callState.participants.firstOrNull { it.userId == userId }?.name ?: "Ce participant"
            MeetingHostSheet(
                name = name,
                onMute = { viewModel.muteParticipant(userId); hostTarget = null },
                onRemove = { viewModel.removeParticipant(userId); hostTarget = null },
                onDismiss = { hostTarget = null },
            )
        }
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
                    missedCalls = missedCalls,
                    onSelect = { tab = it },
                )
            }
        },
    ) { padding ->
        // Scaffold already insets for the status bar under enableEdgeToEdge;
        // adding statusBarsPadding() on top of it would double the gap.
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                accounts.isEmpty() -> NoAccount(onSignIn = { showOnboarding = true })

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
                        onNewMeeting = { showNewMeeting = true },
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
                        onEphemeral = viewModel::setEphemeral,
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
                        if (list.selecting) {
                            BackHandler { viewModel.clearListSelection() }
                        }
                        ConversationListScreen(
                            state = list,
                            onOpen = viewModel::openConversation,
                            onFilter = viewModel::setFilter,
                            onQuery = viewModel::setQuery,
                            onShowArchived = viewModel::setShowArchived,
                            onTogglePin = viewModel::togglePin,
                            onMarkUnread = viewModel::markUnread,
                            onArchive = viewModel::toggleArchive,
                            onOptions = { optionsFor = it },
                            onToggleSelected = viewModel::toggleSelected,
                            onStartSelection = viewModel::startSelection,
                            onEndSelection = viewModel::clearListSelection,
                            onMarkAllRead = viewModel::markAllRead,
                            onArchiveSelected = viewModel::archiveSelected,
                            onReadSelected = viewModel::readSelected,
                            onClearSelected = viewModel::clearSelected,
                            onRetry = viewModel::loadConversations,
                            // Re-sign-in through chat's own flow, not another app.
                            onReauth = { showOnboarding = true },
                            onNewChat = viewModel::openNewChat,
                            onCamera = ::openCamera,
                        )
                    }

                    ChatTab.Calls -> CallsScreen(
                        history = callHistory,
                        conversations = list.conversations,
                        onCall = { row, video -> placeCall(row, video) },
                    )

                    ChatTab.You -> YouScreen(
                        account = viewModel.account.collectAsStateWithLifecycle().value ?: accounts.firstOrNull(),
                        accountCount = accounts.size,
                        pushEnabled = pushEnabled,
                        onOpenAccount = { youSheet = YouSheet.Account },
                        onSwitchAccount = { youSheet = YouSheet.SwitchAccount },
                        onOpenDevices = { youSheet = YouSheet.Devices },
                        onOpenNotifications = { youSheet = YouSheet.Notifications },
                        onOpenAppearance = { youSheet = YouSheet.Appearance },
                        onOpenStorage = { youSheet = YouSheet.Storage },
                        onOpenAbout = { youSheet = YouSheet.About },
                    )

                    ChatTab.Updates -> ActusScreen(
                        account = viewModel.account.collectAsStateWithLifecycle().value ?: accounts.firstOrNull(),
                        channels = list.conversations.filter { it.isChannel },
                        onOpenChannel = viewModel::openConversation,
                        onExplore = { showExplorer = true; viewModel.browseChannels("") },
                    )

                    else -> NotYetScreen(tab)
                }
            }
        }
    }

    optionsFor?.let { row ->
        ConversationOptionsSheet(
            row = row,
            onDismiss = { optionsFor = null },
            onTogglePin = { viewModel.togglePin(row.id) },
            onToggleFavorite = { viewModel.toggleFavorite(row.id) },
            onToggleMute = { viewModel.toggleMute(row.id) },
            onMarkUnread = { viewModel.markUnread(row.id) },
            onArchive = { viewModel.toggleArchive(row.id) },
            onClear = { confirmClearOne = row },
        )
    }

    confirmClearOne?.let { row ->
        ClearOneConversationDialog(
            title = row.title,
            onDismiss = { confirmClearOne = null },
            onConfirm = { viewModel.clearConversation(row.id); confirmClearOne = null },
        )
    }

    if (showNewMeeting) {
        NewMeetingDialog(
            onDismiss = { showNewMeeting = false },
            onCreate = { name ->
                showNewMeeting = false
                viewModel.closeNewChat()
                createMeeting(name)
            },
        )
    }

    if (showExplorer) {
        val explorer by viewModel.explorer.collectAsStateWithLifecycle()
        ChannelExplorerSheet(
            state = explorer,
            onQuery = viewModel::browseChannels,
            onJoin = viewModel::joinChannel,
            onDismiss = { showExplorer = false },
        )
    }

    youSheet?.let { sheet ->
        YouDetailSheet(
            sheet = sheet,
            account = viewModel.account.collectAsStateWithLifecycle().value ?: accounts.firstOrNull(),
            accounts = accounts,
            pushEnabled = pushEnabled,
            context = context,
            onSelectAccount = { viewModel.selectAccount(it); youSheet = null },
            onDismiss = { youSheet = null },
        )
    }
}

/**
 * The single-conversation clear confirmation. Same warning as the bulk one:
 * clearing empties the conversation for everyone, since the module has no
 * per-member delete.
 */
@Composable
private fun ClearOneConversationDialog(title: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Effacer « $title » ?") },
        text = {
            Text(
                "Les messages seront supprimés pour tous les participants, pas seulement " +
                    "pour vous : votre instance ne propose pas d'effacement local. " +
                    "Cette action est définitive.",
            )
        },
        confirmButton = {
            KubunoButton("Effacer", onClick = onConfirm, variant = KubunoButtonVariant.TEXT_DANGER, size = KubunoButtonSize.SM)
        },
        dismissButton = {
            KubunoButton("Annuler", onClick = onDismiss, variant = KubunoButtonVariant.GHOST, size = KubunoButtonSize.SM)
        },
    )
}

/**
 * No account yet. Chat signs one in on its own — like the other Kubuno apps —
 * and the account it registers is shared with them through the system
 * AccountManager, so it need not be created from Drive or Mail first.
 */
@Composable
private fun NoAccount(onSignIn: () -> Unit) {
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
            "Connectez-vous à votre instance ; le compte sera partagé avec les autres applications Kubuno.",
            style = ChatType.Preview,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        KubunoButton("Se connecter", onClick = onSignIn, size = KubunoButtonSize.LG)
    }
}

/** The photo picker caps a single selection; ten is what fits one message run. */
private const val MAX_ATTACHMENTS = 10

/** Walks the ContextWrapper chain to the hosting Activity, if any. */
private tailrec fun android.content.Context.findActivity(): android.app.Activity? = when (this) {
    is android.app.Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}
