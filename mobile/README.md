# Kubuno Chat — mobile apps

The mobile clients of the Chat module: **Kubuno Messages** (Android, `com.kubuno.chat.android`), an iOS version to come.

This app used to live in the shared `kubuno/mobile` repository; it moved here in October 2026 with its history.
The libraries every Kubuno app shares (API client, device accounts, UI components, viewers) live in the core
repository, `core/mobile`, and are consumed as published Maven artifacts `com.kubuno.mobile:*`.

## Layout

```
mobile/
  settings.gradle.kts, build.gradle.kts, gradle/   the Gradle root
  common/    the complete app, shared by Android and iOS (Kotlin Multiplatform + Compose Multiplatform, phase 2)
  android/   only what Android does differently, and its entry point; today the whole app (android/app)
  ios/       only what iOS does differently, and its entry point (phase 2)
```

Today the app is still a plain Android (Jetpack Compose) app, so all of it sits in `android/app`. The conversion
to Kotlin Multiplatform moves the screens, view models and repositories to `common/` and leaves `android/` with
the entry point and the Android-only services; the plan is in `core/mobile/README.md` ("Phase 2").

## Kubuno Messages

A native client for the Kubuno chat module: conversations, groups and channels, with the
anatomy people already know from mainstream messengers and the Kubuno design system's own
skin.

- **Live by default** — one WebSocket to the chat module (`/api/v1/chat/ws`) carries every
  event about your account, so the list and the open conversation update together without
  polling and without per-conversation subscriptions.
- **Idempotent sending** — each message carries a client nonce that the module treats as an
  idempotency key, so a send interrupted mid-flight is retried without ever duplicating.
- **Notifications** — over [UnifiedPush](https://unifiedpush.org/), like every other Kubuno
  app. The payload is content-free by design: it names the sender or the group, never the
  message.

> **On encryption.** The chat module advertises Signal-style end-to-end encryption, but it
> does not implement it yet: message bodies travel as base64-encoded JSON, and the prekeys
> the module publishes are never consumed. This app therefore makes **no** encryption claim
> in its interface, and deliberately neither publishes nor fetches keys — registering a
> second key set would overwrite the one the web client uses. When the module ships a real
> protocol, the envelope encode/decode pair (`ChatEnvelope`) is the only place that changes.

### Milestones

| Milestone | Scope | Status |
|---|---|---|
| M1 | Conversation list (filters, archive, pin, unread), conversation reader, live socket, optimistic send | Done |
| M2 | Reply, edit, delete, forward, reactions, receipts, typing, in-chat search | Done |
| M3 | Media: gallery, camera, documents, voice messages | Done |
| M4 | New conversations and groups, mentions, polls, pinning, ephemeral messages, UnifiedPush | Done |
| M5a | Audio and video calls (WebRTC, mesh, interoperable with the web client) | Done |
| M5b | Offline Bluetooth relay between nearby devices | not started — see below |

**Calls** need the instance to publish ICE servers (`GET /chat/config`), and a
TURN relay for anything behind a real NAT. This client uses what the instance
configures and nothing else: with an empty list a call still connects between
directly reachable peers and fails visibly otherwise. It never falls back to a
third party's public STUN, which would hand the participants' addresses to a
stranger the instance did not choose.

> **A current browser cannot yet call an Android client.** Chrome 152 negotiates
> DTLS 1.3, and no published build of the Android WebRTC library completes that
> handshake with it: M125, M137 and M144 fail with `UNSUPPORTED_PROTOCOL`, and
> M150 — the only one that speaks DTLS 1.3 — gets through HelloRetryRequest and
> then fails inside BoringSSL with `WRONG_CURVE`. With DTLS 1.3 disabled in the
> browser the same call connects immediately, so everything above the handshake
> is proven: ICE pairs, the signalling is single-copy and correctly ordered, and
> the phone takes the answerer role. This is not specific to Kubuno — mobile
> WebRTC libraries trail Chrome — but until it clears upstream, calls between
> the web client and a phone should not be advertised as working. The library is
> pinned to M150 for that reason, and must be kept close to current: the peer at
> the other end of a call is a browser that updates itself.

**The Bluetooth relay is not started, deliberately.** Carrying messages through
a stranger's phone is only defensible once the module encrypts them, and today
it does not (see the encryption note above). The transport design is settled —
BLE dual-role advertising and GATT, controlled flooding with a TTL, a
store-and-forward queue — but it waits on a real protocol rather than shipping a
relay for plaintext.

## Build

Requirements: JDK 17+ (21 recommended), the Android SDK (platform 36, build-tools 35) with `ANDROID_HOME` set,
and read access to the Kubuno Maven registry for the shared libraries: a token in your **user** Gradle properties
(`kubunoGitlabToken=…` in `~/.gradle/gradle.properties`, or `KUBUNO_GITLAB_TOKEN`), see `core/mobile/README.md`.

```bash
cd mobile
./gradlew assembleDebug            # debug APK: android/app/build/outputs/apk/debug/
./gradlew test                     # unit tests
./gradlew :app:assembleRelease     # R8-minified release APK (unsigned unless -PkubunoKeystore=… is given)
```

The version of the shared libraries is pinned in `gradle/libs.versions.toml` (`kubunoMobile`). To build against a
core checkout instead (to try a change of the shared libraries before it is published), point Gradle at it:

```bash
./gradlew assembleDebug -Pkubuno.coreMobile=../../core/mobile    # or KUBUNO_CORE_MOBILE=…
```

## Releases

The app is versioned on its own (`versionName` / `versionCode` in `android/app/build.gradle.kts`), independently
of the module's server. A tag `mobile-v<versionName>` on this repository builds the release APK and attaches it to a
release; the module's own `v*` tags keep releasing the server package. The workflow `.github/workflows/mobile.yml`
builds and tests the app on every change under `mobile/`, against the shared libraries checked out from the core at
the tag `mobile-v<kubunoMobile>`.
