//! Kubuno Chat for mobile — the app, portable (no OS, no window system).
//!
//! The app is a set of `.kbview` screens (`views/`, edited in Visual Studio like every Kubuno view) rendered by the
//! shared Kubuno mobile renderer (`kubuno-mobile-render`, core repository). The Android and iOS entry points
//! (`../android`, `../ios`) hand [`APP`] to the shared shell of their OS.
//!
//! Migration status: the screens are converted; the app's behaviour (its data and server calls) is still to be
//! migrated from the reference Kotlin app that lived in `mobile/` before this layout (kept in the git history).

use kubuno_mobile_render::App;

/// The `conversationlist.kbview` screen.
pub const CONVERSATIONLIST: &str = include_str!("views/conversationlist.kbview");
/// The `actus.kbview` screen.
pub const ACTUS: &str = include_str!("views/actus.kbview");
/// The `call.kbview` screen.
pub const CALL: &str = include_str!("views/call.kbview");
/// The `conversation.kbview` screen.
pub const CONVERSATION: &str = include_str!("views/conversation.kbview");
/// The `newchat.kbview` screen.
pub const NEWCHAT: &str = include_str!("views/newchat.kbview");
/// The `onboarding.kbview` screen.
pub const ONBOARDING: &str = include_str!("views/onboarding.kbview");
/// The `you.kbview` screen.
pub const YOU: &str = include_str!("views/you.kbview");

/// Every screen, in a tap-to-advance order (the home screen first).
pub const VIEWS: &[&str] = &[CONVERSATIONLIST, ACTUS, CALL, CONVERSATION, NEWCHAT, ONBOARDING, YOU];

/// Register what the app's screens need from the renderer (its host controls and images) — nothing yet. The shell
/// calls it once, on its UI thread, before the first frame (through [`APP`]).
pub fn setup() {}

/// The Kubuno Chat app, as the shells run it.
pub const APP: App = App { id: "chat", label: "Kubuno Chat", views: VIEWS, setup };

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_screen_renders() {
        setup();
        for src in VIEWS {
            assert!(kubuno_mobile_render::render_view(src, 1080, 2340, None, None).is_some());
        }
    }
}
