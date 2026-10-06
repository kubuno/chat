# Kubuno Chat for Windows

`kubuno-chat.exe`: two-pane messaging for the chat module, a native Win32 application (Direct2D / DirectWrite) written
with the Kubuno desktop programming model — Windows Forms-like views (`.kbview` forms, `.kbcontrol` user controls)
that the Visual Studio designer of vskubuno opens and edits.

## Layout

| Path | Holds |
|---|---|
| `src/main.rs` | the `Program.cs`: splash screen, single instance, `kubuno://` protocol, `Application::run(ChatWindow)` |
| `src/lib.rs` | everything the designer links to render the views |
| `src/views/` | the main form, `ChatWindow` (`chat_window.kbview` + code-behind) |
| `src/pages/` | the user controls: conversation list, conversation row, conversation pane |
| `src/controls/` | the `MessageThread` custom control |
| `src/model/`, `src/services/`, `src/platform/` | state and view model, the `/api/v1/chat/*` client, the `kubuno://` handler |
| `src/resources/` | the `.kbres` string and icon resources (English, French) |

## Build

From this folder (Windows, Rust stable with the MSVC toolchain):

```powershell
cargo build --release          # → target\release\kubuno-chat.exe
cargo test
cargo clippy --all-targets -- -D warnings
```

The framework crates come from `https://github.com/kubuno/desktop` at the tag named in `Cargo.toml`
(`[workspace.dependencies]`, one tag for all of them); `Cargo.lock` pins the exact commit. To move to a newer
framework, change the tag of every `kubuno-desktop*` dependency together and run `cargo update`. Everything is
linked statically: the exe needs no DLL beside it.

## Run

```powershell
target\release\kubuno-chat.exe --sample          # offline sample data, no broker, no network
target\release\kubuno-chat.exe [--dark] [--culture fr|en] [--no-splash] [kubuno://chat/<id>]
```

Without `--sample`, the app borrows its access tokens from the token broker of **Kubuno Desktop**, which must be
installed beside it (`kubuno-desktop.exe` in the same folder); the app starts it in the background when it is not
running. Set `KUBUNO_SANDBOX_DIR` to a folder to run the app and the shell with a throw-away profile (no registry,
no `kubuno://` registration, a broker of its own).

## Visual Studio

`Kubuno.Chat.Desktop.rsproj` is in the repository's solution, `Kubuno.Chat.slnx`, under the **Desktop** folder. The
`.kbview` / `.kbcontrol` files open in the Kubuno views designer.

## License

[AGPL-3.0-or-later](../../LICENSE) © Kubuno contributors.
