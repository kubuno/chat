# Kubuno Chat — desktop apps

The native desktop clients of the chat module, one folder per operating system:

| Folder | App | Status |
|---|---|---|
| [`windows/`](windows/README.md) | Kubuno Chat for Windows (`kubuno-chat.exe`, crate `kubuno-chat-desktop`) | alpha |
| [`linux/`](linux/README.md) | Kubuno Chat for Linux | not written yet |
| [`macos/`](macos/README.md) | Kubuno Chat for macOS | not written yet |

Each folder is a Cargo workspace of its own, independent of the server's (the repository root). The apps are built
on the Kubuno desktop framework of [`kubuno/desktop`](https://github.com/kubuno/desktop), taken by git tag
(`desktop-v<version>`) and linked statically: an app builds from this repository alone. At run time it needs
**Kubuno Desktop** (the shell, from `kubuno/desktop`) installed beside it, as a service: the shell's token broker
lends the access tokens to the user's Kubuno accounts over a named pipe; the app holds no refresh token.

The desktop app moved here from `kubuno/desktop` (`windows/src/chat`) with its history in October 2026, when every
module repository started to hold all its clients (server, web frontend, desktop, and later mobile).
