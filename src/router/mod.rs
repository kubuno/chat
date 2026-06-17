use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    handlers::{conversations, keys, media, messages, presence, unfurl, websocket},
    state::AppState,
};

pub fn build(state: AppState) -> Router {
    let chat_routes = Router::new()
        // Conversations
        .route("/conversations",                       get(conversations::list_conversations).post(conversations::create_conversation))
        .route("/conversations/:id",                   get(conversations::get_conversation).patch(conversations::update_conversation))
        .route("/conversations/:id/leave",             post(conversations::leave_conversation))
        .route("/conversations/:id/join",              post(conversations::join_meeting))
        .route("/conversations/:id/member-settings",   patch(conversations::update_member_settings))
        .route("/conversations/:id/clear",             post(conversations::clear_messages))
        .route("/conversations/:id/members",           post(conversations::add_members))
        .route("/conversations/:id/members/:uid",      delete(conversations::remove_member))
        // Messages
        .route("/conversations/:id/messages",          get(messages::list_messages).post(messages::send_message))
        .route("/conversations/:id/read",              post(messages::mark_read))
        .route("/conversations/:id/read-state",        get(messages::read_state))
        .route("/conversations/:id/pinned",            get(messages::list_pinned))
        .route("/unfurl",                              get(unfurl::unfurl))
        .route("/messages/:id",                        patch(messages::edit_message).delete(messages::delete_message))
        .route("/messages/:id/pin",                    post(messages::pin_message))
        .route("/messages/:id/vote",                   post(messages::vote_poll))
        .route("/messages/:id/poll",                   get(messages::poll_results))
        .route("/messages/:id/reactions",              post(messages::add_reaction))
        .route("/messages/:id/reactions/:emoji",       delete(messages::remove_reaction))
        // Keys (X3DH)
        .route("/keys/register",                       post(keys::register_keys))
        .route("/keys/one-time",                       post(keys::upload_one_time_prekeys))
        .route("/keys/status",                         get(keys::key_status))
        .route("/keys/:user_id",                       get(keys::get_prekey_bundle))
        // Présence
        .route("/presence",                            patch(presence::update_presence))
        .route("/presence/:user_id",                   get(presence::get_presence))
        // Média
        .route("/media/upload",                        post(media::upload_media))
        .route("/media/:media_id",                     get(media::download_media))
        // WebSocket
        .route("/ws",                                  get(websocket::ws_handler))
        .with_state(state.clone());

    let health = Router::new()
        .route("/health", get(health_handler))
        .with_state(state);

    Router::new()
        .merge(health)
        .merge(chat_routes)
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100 MB max pour les médias
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok", "module": "chat" }))
}
