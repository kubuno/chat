<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Kubuno Chat

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)

**Kubuno Chat — messagerie chiffrée de bout en bout**

A module for [Kubuno](https://github.com/kubuno/core), the self-hosted, libre (AGPLv3) cloud platform.

## Features

- **End-to-end encrypted messaging** — direct messages and group spaces (channels), with per-message encryption that also covers every piece of shared media. Device keys never leave the browser.
- **Modern messaging layout** — a sidebar organized into Shortcuts, Direct messages and Spaces; a central Home view; dedicated Mentions and Starred views; and a browse page to discover and join public spaces. Every view and conversation is addressable through a real, shareable URL.
- **Rich composer** — an expression panel with three tabs: the full Unicode emoji catalogue (localized keyword search, recently-used row), GIF search through a server-side GIPHY proxy (the API key is an admin-only instance setting and never reaches the browser; a sent GIF is re-encrypted end to end), and a personal sticker pack.
- **Sticker Studio** — turn any picture into a transparent square sticker. The pack lives on the device (IndexedDB) and never reaches the server; sending a sticker encrypts it per-message like any other media.
- **Camera capture** — take a photo or record a clip straight from the composer; the result goes through the regular encrypt-and-upload pipeline.
- **Presence & status** — Active / Away / Do not disturb plus a free-text status, picked from the platform top bar and broadcast live to contacts over WebSocket; a manually chosen status survives reconnects.
- **Conversation management** — pin, archive, mute, favorite, mark as unread, clear or delete from a single shared action menu, plus a per-conversation shared-files panel built client-side from decrypted messages (no server-side index, by design).
- **Pop-up conversations** — small floating chat windows docked to a corner of the screen that keep running while you browse other Kubuno modules.
- **Cross-module data cards** — content copied from another Kubuno module (a map location, a drawing…) pastes as a rich card rendered by the producer module, with a graceful generic fallback.
- **Calls** — audio/video calls with a global overlay that follows you across modules.

## Architecture

A standalone Rust process that registers with the [core](https://github.com/kubuno/core) at startup; the core proxies its routes (`/api/v1/chat/*`) and serves its runtime-loaded React frontend bundle.

- **Backend** — `src/`: Axum + SQLx (PostgreSQL, schema `chat`); migrations in `migrations/`.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@kubuno/ui` and `@kubuno/drive` from npm (provided by the host at runtime via the import map).

## Install

This module ships in the **all-in-one [Kubuno](https://github.com/kubuno/core) Docker image** (`ghcr.io/kubuno/kubuno`) — the easiest way to self-host a full Kubuno instance (core + every module). See **[kubuno/docker](https://github.com/kubuno/docker)** for `docker compose` instructions.

Native packages for other platforms — **RPM** (Fedora/RHEL/openSUSE), a **Windows installer** (NSIS) and a **macOS package** (.pkg) — are built by CI and attached, alongside the Debian package, to every [GitHub Release](https://github.com/kubuno/chat/releases).

To build this module from source, see below.

## Build

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, PostgreSQL 16.

```bash
cargo build --release                     # → target/release/kubuno-chat
cd frontend && npm ci && npm run build     # → dist/{entry.js, entry.css}
bash build_deb.sh                          # → dist/kubuno-chat_*.deb
```

Other package formats (same installed layout, auto-detected from `Cargo.toml`):

```bash
bash build_rpm.sh        # → dist/kubuno-chat-*.rpm            (Fedora/RHEL/openSUSE)
bash build_windows.sh    # → dist/kubuno-chat-setup-*-x64.exe  (NSIS; cross-compiles from Linux via cargo-xwin)
bash build_macos.sh      # → dist/kubuno-chat-*-arm64.pkg      (run on a Mac; UNIVERSAL=1 for a fat binary)
```

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui`, `@kubuno/drive` from the `@kubuno` npm scope.

## License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
