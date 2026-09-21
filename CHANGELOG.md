# Changelog

All notable changes to **kubuno-chat** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/). Entries are added under
`[Unreleased]` **as the change is made**; `_tools/release.sh` stamps them under the version
number at release time, and CI publishes that section as the GitHub Release notes.

## [Unreleased]

### Changed

- **Runs on PostgreSQL, MySQL/MariaDB or SQLite.** Chat moves off its
  PostgreSQL-only stack onto the runtime-dispatch kubuno-db 0.6.0 foundation:
  the same binary connects to whichever engine the administrator names in
  `[database] engine`, read at start-up. All queries were rewritten off the
  driver-specific paths — `RETURNING` inserts became a Rust-minted id plus a
  re-select (MySQL has no `RETURNING`), `ON CONFLICT` and case-insensitive
  matching go through the dialect layer, `= ANY(array)` becomes a portable
  `IN (...)`, `NOW()`/`make_interval`/`'-infinity'` are computed in Rust and
  bound, `LEFT JOIN LATERAL` (unsupported by MariaDB/SQLite) becomes a
  correlated subquery, and every integer read is decoded at a width that holds
  on a strict PostgreSQL. Events are published through kubuno-db, which uses
  `pg_notify` on PostgreSQL and a durable outbox the core polls on the other
  engines. The one-time-prekey claim no longer relies on `FOR UPDATE SKIP
  LOCKED`; it is a guarded update proven by its affected-row count.
  (Cross-schema reads of `core.users`/`core.settings` remain PostgreSQL/MySQL
  only, as they touch another module's namespace.)

### Fixed

- **Media downloads no longer fail for recipients.** The access check read a
  `SELECT 1` probe at a width PostgreSQL rejected, so every non-uploader saw a
  database error and a permanent "media unavailable"; the check is now decoded
  portably and passes for anyone in the conversation.

### Security

- **Database driver updated past an unfixable advisory.** The previous line
  pulled in an RSA implementation vulnerable to a timing side-channel
  (RUSTSEC-2023-0071) for which no fix will ever exist. The new line does not
  depend on it at all, and it refuses any SQL string built at run time unless it
  has been audited — the queries here were checked and marked.
- **Input validation library updated.** The version in use carried
  RUSTSEC-2024-0421 through its domain-name parser, which accepted Punycode
  labels that decode to plain ASCII — a mismatch an attacker can use to make two
  different names look like one.

## [0.1.8] - 2026-09-18

### Security

- **HTTP/2 layer updated to a patched release.** `h2` moves from 0.4.15 to
  0.4.19, closing a denial of service through unbounded empty DATA frames
  (RUSTSEC-2026-0258).
- **Error library updated to a patched release.** `anyhow` moves from 1.0.102
  to 1.0.104, closing an unsoundness in `Error::downcast_mut()`
  (RUSTSEC-2026-0190).
- **TLS library updated to a patched release.** The pinned `rustls` carried
  RUSTSEC-2026-0285 (medium). Every outbound HTTPS connection goes through it.

## [0.1.7] - 2026-09-18

### Added

- **Chat offers its two acts wherever a person is shown.** A guest's card on a
  calendar event now carries "Chat" and "Start a meeting", performed by this
  module. Offered only for someone with an account on this instance: there is
  nobody to talk to behind an outside address, and a button that always fails is
  worse than an absent one.

### Added

- **A meeting attached to an event carries that event's title.** Renaming it in
  the meetings list renames the event too, and renaming the event renames the
  meeting — one title in two places instead of two that slowly disagree. Linked
  meetings show a small link mark beside their name, so the consequence is
  visible before you type. A meeting whose event lets it go (the call was taken
  off it, or the event was deleted) keeps its name and becomes its own again;
  its link goes on working.

### Changed

- **Joining the call from an event opens it in a new tab.** The link followed
  in place, so reaching the meeting meant abandoning the event you were in the
  middle of writing. The call also outlives the visit to the event: it belongs
  in a tab of its own.

- **The video-call card in an event carries no camera of its own.** The row's
  gutter already shows this module's mark, and the card says in words who hosts
  the call; a camera an inch away was decoration, not information.

### Added

- **A meeting room attached to an event you never save no longer survives it.**
  Adding a video call to an event has to create its room straight away — the
  link is what gets saved, so it must already point somewhere. Until now that
  room stayed for good, even when the event was abandoned: closing the form
  without saving, or taking the call back off it, left an empty meeting in your
  list that you never knowingly created. A room created that way is now a draft
  and belongs to the form: taking the call off the event or closing the form
  deletes it, saving the event keeps it. Reloading the page, closing the tab,
  losing the network or crashing needs no cooperation either — the room carries
  its own deadline and the server removes it on its own. A draft room never
  shows up in anyone's meeting list while it is one, and a room somebody has
  already joined or written in is never removed by any of this.

- **The Meetings page lets you review and manage each meeting without joining
  it.** Clicking a meeting used to drop you straight into its call. Now a plain
  click opens a details panel on the right instead: the day and time, the member
  list, and a plain transcript of everything said in the meeting — so a past
  meeting can be read back at a glance. Joining is now an explicit **Join**
  button, which appears on a row on hover and also sits at the bottom of the
  panel.

- **Meetings can be deleted from the Meetings page.** Each row now carries a
  delete button (and one in the details panel too), removing the meeting from
  your list after a confirmation. Every row also has a right-click / “⋮” context
  menu — Join, details, copy link, delete — a starting set we will keep
  extending.

- **Select several meetings and act on them at once.** A checkbox appears on
  each row (on hover, or once a selection is under way); Ctrl/Cmd-click toggles
  a row and Shift-click extends a range. A toolbar then shows how many are
  selected, with **Select all**, **Copy links** and **Delete** — the deletion
  asks once for the whole set.

- **A meeting's options no longer look forbidden to the person who owns
  them.** The settings that depend on host management were greyed out until it
  was switched on — which reads as "you may not", and a host quite reasonably
  asked why they were refused their own meeting. Nothing is greyed now: the
  settings can be prepared at any time, and a line under the master switch says
  they take effect once it is on.

- **A meeting can record itself.** Its options gained a second section,
  **Meeting recordings**: the legal warning — recording without everyone's
  permission may be illegal — and one choice, "Record this meeting". Ticked,
  the room starts recording on its own as soon as someone allowed to record is
  in it, and everyone is told as they always were. It starts once per room: a
  reconnection does not start a second one, and a host who stopped it on
  purpose does not see it start again under them. The consent step did not
  disappear — it moved to where the decision is made, under the same warning,
  because asking twice for one decision teaches people to dismiss the asking.

- **A meeting can run ACTIVITIES, and its host decides who may start one.**
  An activity is something one person launches and everyone gets — a file put
  in front of the room, and whatever other modules come to offer: any module
  may register one, and the room lists what it finds. Nothing is hard-wired;
  when nothing is registered there is no activities menu rather than an empty
  one. The host may reserve launching for themselves.

- **The meeting's audio and video have exactly one door, and the host holds
  the key.** The media never touches a server here — it is exchanged directly
  between browsers — so there is one function through which anything else in
  this product could obtain it, and the host's setting is checked at that
  function rather than by whoever calls it.

- **A meeting can be closed to whoever merely holds its link.** Its access type
  is now a choice: **Open** — the link is enough, as it has always been — or
  **Open to trusted people**, where only those the host put in the room walk
  in. Everyone else is refused by the server, and may ask to join when the host
  allows it: they see a page that sends one request and waits, the host sees
  them queued inside the meeting and admits or refuses them in one press, and
  being admitted puts them in the room there and then. Asking twice is asking
  once. **Refused twice, they may not ask again** — a door that can be knocked
  on forever is a way of knocking until someone gives in; from there only the
  host adding them opens it.

- **A meeting's host can set its rules before it starts.** The ⚙ on the event's
  meeting card opens the video call options: host management, who may share a
  screen, who may send reactions, whether participants may write in the
  meeting's chat, and whether the host must arrive before anyone else. Off by
  default — the master switch has to be turned on before any of the others
  apply, so a meeting stays open unless someone decides otherwise. Only the
  host sees the panel, and only the host may save it: the server checks, it
  does not merely hide the button. Chat moderation and "host joins first" are
  refused by the server; screen sharing and reactions are enforced by the room
  itself, because the media travels directly between participants and no
  server stands in its path — each switch says which it is.

- **A calendar event can carry a Kubuno video call, created in place.** When
  this module is installed, the video row of the calendar's event editor is
  its own, and the row's icon becomes this module's logo: one button creates
  the room and attaches its link; the event then
  shows a card naming the call, with its full address, a copy button and a ✕
  that takes it away — an event holds one call at a time. A link pasted from
  elsewhere gets the same card, without the pretence that we host it. The
  room is a conversation anyone holding the link may join; it is not deleted
  when the link is removed, since an edit may be abandoned and a link already
  shared is not cheap to break.

- **The meeting's messaging is the conversation itself.** It was a bare list of
  lines with no author: you could not tell who had written what. It now loads
  the history, so someone joining midway reads what was already said, groups
  messages by author with a picture, a name and a time, and renders them with
  the same component as the rest of the app — attachments, images, polls,
  replies, reactions and link previews all work. Files can be attached and
  emoji picked without leaving the meeting.

- **The meeting shows who is speaking.** The tile of whoever has the floor is
  outlined in blue, tinted with a faint blue veil, and wears a small badge
  whose three bars follow their voice. It is heard from the audio itself, so it
  works for everyone in the meeting, and someone whose microphone is off is
  never shown as speaking.

- **Meetings can be recorded.** The person who holds the meeting can start a
  recording from the meeting menu. Everyone is told when it starts and stops,
  and a red REC indicator with a running time stays visible throughout — a
  recording is never silent. The file captures the presentation when someone is
  sharing and the participants otherwise, with every voice mixed in, and it is
  filed in the recorder's own files when the recording stops, in a "Chat"
  folder created on first use — it belongs to whoever made it. Without a files
  module to write to, it is posted to the meeting's conversation instead so it
  is never lost. It is stopped automatically if the meeting ends, and after two
  hours.

- **A page follows leaving a meeting.** Instead of dropping straight back into
  the app, leaving a meeting now leads to a page offering to rejoin it or go to
  the home screen, and asking how the audio and video quality was. It returns
  home on its own after a minute. The rating is kept, one answer per person and
  per meeting, and a later answer replaces the earlier one.

- **Ending a meeting is now distinct from leaving it.** The host of a meeting —
  whoever owns or administers the room — is offered both when they hang up:
  leaving lets the others carry on, ending closes the meeting for everyone at
  once and the page that follows says so and offers no way back in. Everyone
  else simply leaves.

- **Host moderation.** From the participants panel, a host can mute someone or
  remove them from the meeting. A host can only mute: turning a microphone back
  on stays the person's own decision, and the person is told who muted them.
  Removal is checked by the server, not only hidden in the interface.

### Fixed

- **Ending a meeting now really ends it.** It was only a message sent from one
  browser to the others: a client that missed it stayed in a meeting that was
  over, and anyone could walk straight back in through the link. The room is
  now closed on the server, every member is told over their own connection, and
  a meeting that has been ended can no longer be joined — opening its link says
  so plainly instead of dropping you into an empty room. Its host reopens it
  simply by starting it again.

- **A new presentation replaces the one in progress.** When someone started
  sharing while a screen was already shared, the first one kept the stage and
  the newcomer was never seen. The stage now shows the latest presentation, and
  a presentation that had been set aside does not hide the next one.

- **The person who opened a meeting can always end it for everyone.** Holding
  the meeting was worked out from a single request made while joining; when it
  did not answer, the host silently lost their own actions and the red button
  just left the meeting. Whoever created the room now holds it, read from the
  room itself.

- **Everyone's camera is now sent, not only the first person's.** A connection
  opened before the camera and microphone had finished starting carried no
  outgoing track, and nothing ever added one: that person was seen and heard by
  nobody for the rest of the meeting. The tracks are now attached as soon as
  the devices are ready, and the connection renegotiated.

- **Leaving a meeting no longer ends it for the person left behind.** The last
  participant to remain used to have their window closed. A meeting is a room:
  it stays open, whoever opened it and whoever leaves. Only its host ending it
  closes it for everyone. A plain call still ends when nobody is left.

- **A late arrival now receives what is broadcast.** The room was read once, on
  joining, so anyone who arrived afterwards never received changes of state —
  a raised hand, a muted microphone, a recording starting. Anyone who signals
  is now known.

### Changed

- **Selecting a meeting no longer draws a border.** Opening a meeting's
  details, ticking it, and the bulk-action toolbar now just tint their
  background instead of outlining it.
- **This module now installs as a Kubuno package (`.kbpkg`) only.** Its system
  packages (Debian/RPM and the Windows and macOS installers) are no longer
  built: the module is distributed as one `.kbpkg` per platform (Linux, Windows,
  macOS) that the Kubuno server installs itself — from the admin console, or
  offline with `kubuno modules:install <file>.kbpkg`.
- **Meeting objects now move instead of jumping.** Tiles and the shared screen
  glide and resize to their new place whenever the layout changes: someone
  joins or leaves, a presentation starts or stops, a side panel opens. A tile
  keeps its identity as it moves between the grid and the strip. Dragging the
  window edge is not animated, so the meeting follows the pointer exactly
  rather than trailing behind it.

- **The strip of participants wraps onto another row.** In a narrow meeting —
  a portrait window, or one with a side panel open — the people above a
  presentation now continue on a second row instead of being squeezed into a
  single line. They keep a readable size, and only shrink if the rows would
  otherwise take more than half the meeting.

- **The meeting side panel is never covered.** Tiles moving to their new place
  used to be drawn over the panel for the length of the animation, hiding its
  header and search field. The meeting is now clipped to its own area, the
  panel sits above it, and the strip of participants shrinks to the width it
  has instead of running past it.

- **The meeting side panel stays visible at any window size.** Chat,
  participants, settings and effects no longer get pushed off-screen when the
  window is narrowed, and the panel now sits as a rounded card set in from the
  right edge.

- **Your own presentation is named as yours.** The stage said "Presentation by
  you"; it now reads "Your presentation".

- **Participant tiles are all the same size, and use the room they have.**
  Every tile is identical to the others whether or not the camera is on, and
  when nobody is presenting they grow to take as much of the meeting area as
  they can while all staying visible.

- **A meeting no longer repeats who is presenting.** The presentation already
  names its author on the stage, so the bar above it stays quiet. It only
  offers the way back when the presentation has been set aside.

- **Someone with their camera off now shows their profile picture.** Their tile
  becomes a coloured card with a large round photo in its centre, falling back
  to the initial when no picture is set, instead of a small grey badge.

- **A shared screen is no longer cropped.** The frame around a presentation now
  takes the exact shape of what is being shared, so the whole screen is visible
  and no empty band is left around it. It follows the shape live when the
  shared window is resized.

- **Meeting tiles are rounded squares.** People now appear in square tiles with
  rounded corners, in the grid as well as in the strip beside a presentation.

- **The meeting panels follow the meeting.** The chat, participants, settings
  and effects panels were white against the meeting dark stage; they are now
  dark like it, and the meeting menus use the platform menu component.

- **People search now only shows members of your own organizational unit.**
  Starting a conversation, adding someone to a space, or picking a person to
  invite lists accounts from your organizational unit (and its sub-units), not
  the whole instance. Conversations you already have are unaffected.




- **The RPM package now names the same maintainer as the Debian one.** Its
  changelog entry used a placeholder address on a domain the project does not
  use; it now names the project's designated maintainer on the project's own
  domain, matching the `.deb`. Nothing about what the package installs changes.

- **The package maintainer address moved to the project's own domain.** The
  Debian package's `Maintainer` field now names the project's designated
  maintainer on the project's own domain. Nothing about what the package
  installs changes.

- **Security reports now go to the project's own domain.** The address
  published in `SECURITY.md` moved to the project's own domain; the previous
  one is retired. Reporting through GitHub Security Advisories is unaffected.

- **The README now opens with the module's logo.** The public README on
  GitHub now shows the module's designer logo (the same PNG shown as the
  browser tab icon and in the applications menu) at the top of the page — the
  repository landing now matches the icon a signed-in user sees inside the
  platform. The image ships in-repo, under `.github/logo.png`, so it renders
  even when the repo is browsed offline.

- **New Chat logo** — a sky-blue hexagon with a white speech bubble, used as
  the browser-tab icon and in the applications menu. It is now raster (PNG)
  designer artwork.

- **Square corners on chat popups.** Docked conversation popups now have
  square corners, matching the platform's flat floating-window look.

- **Calls no longer contact a third-party STUN service, and can use a self-hosted TURN relay.**
  The web client had two public STUN servers hard-coded, so every call handed
  the participants' addresses to a third party — and, STUN alone not crossing
  symmetric NATs, calls from mobile networks failed anyway. The STUN/TURN
  servers are now an instance setting (new "Calls" page of the chat
  administration): STUN URLs, TURN URLs, and either coturn's shared secret —
  from which the server mints a per-user, 24-hour TURN credential, so the
  secret never reaches a browser — or a static credential. `GET /chat/config`
  exposes them as `ice_servers`, which the web client (and any native client)
  reads when a call starts. With nothing configured, calls only connect between
  hosts that can reach each other directly; the page says so.

- **Classic window glyphs on chat popups and the call window.** Expand is a
  plain square and minimizing a call to its thumbnail uses the
  picture-in-picture glyph, instead of diagonal double arrows.




### Fixed

- **Cameras stay on while someone shares their screen.** Sharing used to take
  the place of the presenter camera on the call, so their face disappeared for
  everyone the moment they presented. The screen is now sent alongside the
  camera rather than instead of it: the people keep their tiles, camera and
  all, while the shared screen has the stage.
- **A tile always shows whether the person can be heard.** The microphone
  indicator had been reduced to a badge that only appeared when someone was
  muted; it is back next to every name, crossed out when the microphone is off.

- **The meeting menu opened behind the meeting.** Menus are drawn at the top of
  the page while the meeting covered the whole screen above them, so the menu
  was present but invisible. The meeting now sits just below the layer menus
  and dialogs use, and they appear over it as they should.

- **Sharing your screen now actually reaches the others.** Sharing only swapped
  an existing camera stream, so from an audio call — where there is no video
  being sent at all — nothing was shared; and with the camera off, the others
  kept showing your avatar instead of your screen. The screen is now added to
  the call when needed, the call renegotiated, and a shared screen is never
  hidden by the camera-off state. Your own tile also shows what you are
  sharing, so you can see that it worked.
- **The meeting interface no longer mixes languages.** Several new meeting and
  call labels only existed in French and showed up untranslated in an English
  interface. They are translated now.

- **Opening a meeting link now reliably starts the call.** Joining a meeting by
  its link opened the room but sometimes left it silent, because the call was
  started after a short delay that the page's own navigation could cancel. The
  call now starts as the room opens.

- **Conversation rows no longer change size when hovered.** The quick actions
  that appear on a conversation when the pointer is over it are taller than the
  text, which grew the whole row on hover; that line now has a fixed height, so
  the row stays the same size whether or not the actions are showing.

- **A message you send from one device now appears live on your other
  devices.** The live connection groups all of a user's tabs and devices on one
  channel, and a new message was broadcast to the conversation while excluding
  its sender — which silenced that whole channel, so the sender's other devices
  learned of the message only on reload. New messages (and read receipts) now
  reach every device of every member, including the sender's own; the tab that
  sent the message still shows it once. Edits, deletions, reactions and pins
  already behaved this way.

- **Shared photos and files showed "Media unavailable" to everyone but the
  sender.** Downloading an attachment ran an access check whose result was read
  back with the wrong integer type, so it failed with a database error for
  anyone who was not the person who uploaded the file — that is, every
  recipient, for every image, video, voice message and file. The sender always
  saw their own media, which is why it looked intermittent. The check is fixed;
  media now loads for all members of the conversation, and non-members are
  still refused.


- **A withdrawn dependency is no longer used.** A crate deep in the tree
  (`spin` 0.9.8, pulled in through the HTTP stack) was yanked by its authors.
  No vulnerability was announced, but a withdrawn crate has no business in a
  release; the lockfile now takes the version that replaced it.
- **The package could not be built where `zip` is absent.** The Windows job of
  the continuous integration has no `zip`, so the Windows package was simply lost
  the first time it was attempted — a script failure, not a build failure. The
  builder now falls back to 7-Zip, then to PowerShell.
### Added

- **A presentation carries its own controls.** Over the shared screen: take it
  off your main screen so it becomes a tile among the others, mute or unmute
  its sound, and a menu offering to set it aside (a viewer is told plainly that
  they cannot end someone else presentation). In its corner: a zoom you can
  then drag around, opening it in a window of its own that floats above other
  applications, and enlarging it to the full screen. Sharing a screen now also
  offers to carry its sound, and never proposes the meeting own tab as a
  source.

- **A meeting rearranges itself around a shared screen.** When someone
  presents, the people shrink to a strip along the top and the shared screen
  takes the stage, with a banner naming who is presenting. The presentation
  carries its own controls: full screen, a corner window, and a menu to stop
  presenting or to set it aside; a presentation set aside comes back from that
  same banner. The participants panel lists the presentation as its own entry
  under its author, the way a second stream would be.

- **Being added to a meeting now rings you.** Someone invited from the
  participants panel of a running meeting gets the same incoming-call screen as
  a direct call, naming who invited them and which meeting, with accept and
  decline. Accepting opens the meeting lobby, so their camera and microphone
  still only start when they say so.

- **A fuller participants panel, and a way back into a meeting after a reload.**
  The panel lists everyone under a collapsible group with the count, searches
  the people present, gives each of them a menu, and lets you invite someone
  from your organizational unit without leaving the meeting. Refreshing the page
  no longer drops you out for good either: the tab remembers the meeting it was
  in and offers to rejoin in one click, through the lobby, so the camera and
  microphone still only start when you say so. Hanging up clears the offer and
  closing the tab forgets it.

- **The meeting's "more" menu is complete, with side panels.** It offers the
  layout switch, full screen, picture-in-picture, backgrounds and effects, a
  phone dial-in and settings. Settings and effects open as panels on the right
  of the meeting, the way the chat and participants panels do: settings picks
  the microphone, speaker and camera without leaving the call; effects carries
  the backgrounds, filters and appearance tabs. Two entries state plainly what
  this instance cannot do rather than pretending: a phone dial-in needs a
  telephony gateway, and backgrounds and filters need a person-segmentation
  model that is not installed.

- **A meeting now looks and behaves like a meeting.** It fills the screen with
  a dark stage: a bar across the top showing the elapsed time, the meeting's
  name and how many people are in it; a grid of participants where each tile
  carries the person's name, a badge when they are muted, and a pin control to
  put them front and centre; and, past nine people, one tile standing for
  everyone else. The controls at the bottom follow the same shape as any
  meeting tool: microphone and camera each with their own device picker,
  present, reactions, raise hand, a "more" menu (spotlight or grid, full
  screen, corner window, devices) and, set apart from them, the red leave
  button. On the right of the bar, the chat and a new participants panel that
  lists everyone with their microphone state.

- **Joining a meeting now goes through a lobby.** Before a meeting's call
  starts, a preview screen shows your camera and microphone, lets you turn
  either off and pick your input and output devices, then a "Join the meeting"
  button enters the call with those choices. Every way into a meeting — the
  instant meeting, a meeting card, a shared meeting link — passes through it.

- **A "Meetings" page.** A new "Meetings" entry in the sidebar opens a
  full-width page with a day header and a navigable week strip, the day's
  meetings grouped into "Upcoming" and "Past" (each shown with its time and
  title, with a "Join" button) and a field to join a meeting by its link.
  Creating a meeting stays on the sidebar's "New" button. It is the home for
  the chat's meeting rooms.

- **The "New" button now starts meetings.** Alongside "New message", it offers
  "Start an instant meeting" (creates a meeting room and drops you straight into
  its video call), "Create a meeting for later" (creates the room and hands you
  a shareable link, copied to the clipboard), and "Schedule a meeting" (opens
  the calendar), the last shown only when the calendar module is installed.

- **This module now ships a `.kbpkg`** — the single package format a Kubuno
  server installs by itself, the same file on Linux, Windows and macOS. It
  carries the same binary, interface and manifest as the system packages,
  arranged the way the server expects to find a module on disk, plus a
  `SHA256SUMS` so a copy carried offline can be checked without the catalogue.
  Nothing changes for existing installations: the `.deb`, `.rpm`, `.exe` and
  `.pkg` are still published, and a catalogue that sees both simply prefers the
  new one. It is also the only format the server can unpack without an external
  tool, which is what makes one-click installation possible away from
  Debian-like systems.
### Fixed

- **A built package could be thrown away instead of published.** The job that
  attaches a package to the release waited ten minutes for another workflow to
  create that release, then gave up with "release never appeared — build.yml
  likely failed". The diagnosis was wrong: on a repository whose `.deb` takes
  longer than ten minutes to build, the release simply did not exist yet, and a
  package that had built perfectly was discarded. Four modules reached v0.1.6
  with packages missing for some systems because of it. The job now creates the
  release itself when it is missing, so it no longer depends on another workflow
  finishing first.

- **Loading older messages could skip or repeat some.** The "load more" cursor
  compared message identifiers, which are random, while the history is ordered
  by date — so a page boundary could land anywhere and a long history was
  walked non-deterministically. The cursor now resolves to the pivot message's
  date and identifier, and pages are strictly older than it in the very order
  they are displayed. The API is unchanged for clients.
- **Retrying an interrupted send no longer fails.** When the network dropped
  in the middle of a send and the client retried with the same nonce, the
  server answered "nonce already used" and the client showed an error for a
  message that had in fact been stored. A retry by the same author now returns
  the existing message (flagged `duplicate`) — the nonce acts as an idempotency
  key, which is also what an offline relay re-injecting the same envelope
  needs. A nonce reused by *another* user is still refused as a replay.
- **A deleted message no longer vanishes from the thread on reload.** Live,
  a deleted message showed "Message deleted" in its place; after reopening the
  conversation it was simply gone, leaving the reader to wonder what had been
  there. Deleted messages now come back as empty placeholders (type `deleted`,
  no content), like every mainstream messenger. Messages removed automatically
  — expired ephemeral ones, or those past the instance retention — stay
  hidden, as before.
- **Every event arrived once per hour the tab stayed open.** The chat's live
  connection was re-established each time the session token was renewed, but
  the previous connection's closing handler fired after the new one had
  started and reconnected on its own — so a tab open for an hour held four
  connections and received four copies of every message, typing indicator and
  call signal. Duplicate call signals made the browser renegotiate the same
  call several times, which is why a call could show "Connecting…" forever
  even when the network path was fine. Each connection now only ever
  reconnects itself.
- **The call window closes by itself when the last other participant hangs
  up.** It used to stay open on an empty call, leaving the user to hang up on
  nobody. It now closes as soon as nobody else is left — also when the person
  you were ringing declines. The initiator of a meeting room who has not been
  joined yet keeps the window open, since that call has not started.
- **Declining a call now tells the caller.** Tapping the red button on an
  incoming call only closed the overlay; the caller kept ringing until they
  gave up. The caller's window now closes at once.
- **An audio call can turn into a video call without hanging up.** The camera
  button now works during an audio call: it opens the camera, adds the video
  to everyone in the call and switches the window to the video layout. It
  turns to video for the others too the moment anyone's camera comes on, and a
  participant who keeps their camera off shows their avatar rather than a black
  frame.
### Added

- **Security policy and CI quality gate.** A `SECURITY.md` documents how to
  report vulnerabilities, and a CI workflow enforces `clippy -D warnings`, a
  dependency-vulnerability audit (`cargo audit`) and the frontend typecheck/tests.

- **Push notifications for new messages and incoming calls.** When a message
  becomes visible to the other members of a conversation (sent now, or
  delivered by the scheduler), Chat now asks the core to notify their
  registered devices (UnifiedPush) — so a phone with the app asleep still
  learns that something arrived. The notification carries *who* wrote, never
  *what*: the title is the sender's name (or the group's name, with the sender
  in the body), the body is generic, and it links to the conversation. Members
  who muted the conversation or set themselves to "Do not disturb" are not
  notified, and each user's per-module push preferences in the core still
  apply. An incoming call rings the callee's devices the same way
  (`chat.call_ring`), so a native client can show its full-screen call UI.
- **The conversation list now carries each conversation's latest message.**
  Every entry of `GET /conversations` includes a `last_message` preview (the
  newest message the caller may see, in the same envelope as the message
  list), so a client can show a preview per row in one request instead of one
  per conversation.

### Security

- **Chat now authenticates proxied requests from a signed token instead of
  trusting plain headers.** Requests must carry a valid `X-Kubuno-Auth` token
  minted by the core with this module's internal secret (see `kubuno-modauth`),
  rather than reading `X-Kubuno-User-*` headers at face value — which any process
  reaching Chat's loopback port could otherwise forge to act as any user.

## [0.1.6] - 2026-08-19

### Changed

- **Pill-shaped buttons are gone from the interface.** Filter chips, view
  segments, tab selectors and action buttons that were drawn as pills now use the
  same 4 px corner radius as every other button — the shape set them apart for no
  reason other than habit. Round buttons that hold a lone icon, avatars, status
  dots and non-clickable badges keep their shape: a circle around a single glyph
  is not a pill.

- Theme tokens: two colours for navigation labels (`--color-text-nav`,
  `--color-text-nav-active`). Every module carries the same token sheet, so the
  values must match across them — whichever bundle loads last would otherwise
  win. No visible change inside this module.

### Added

- A **mini-panel for the shell's right rail**: conversations with their unread counts,
  to see who is waiting and jump into the thread.

### Changed

- Default application background token aligned with the core (`--body-bg` `#f8fafd`). Only
  visible when the module runs standalone: inside the shell the active theme sets it.

[Unreleased]: https://github.com/kubuno/chat/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/kubuno/chat/releases/tag/v0.1.8
[0.1.7]: https://github.com/kubuno/chat/releases/tag/v0.1.7
[0.1.6]: https://github.com/kubuno/chat/releases/tag/v0.1.6
