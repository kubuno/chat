//! The instance policy, as the browser is allowed to see it.
//!
//! The interface uses it to hide what the server would refuse anyway (an attach
//! button that always errors is worse than no attach button). It is a courtesy,
//! never the control: every flag returned here is enforced again in the handler
//! that owns the action. No secret is exposed — the GIPHY key stays server-side
//! and has its own `/gifs/status` endpoint.

use axum::{extract::State, Json};
use serde_json::Value;

use crate::errors::ChatResult;
use crate::middleware::ChatUser;
use crate::state::AppState;

/// GET /config — public flags of the instance settings.
pub async fn get_config(
    State(st): State<AppState>,
    user: ChatUser,
) -> ChatResult<Json<Value>> {
    let cfg = st.instance();
    let mut flags = cfg.public_flags();
    // ICE servers are per caller: a TURN credential is minted for this user
    // and lives one day, so a client re-reads the config when a call starts.
    flags["ice_servers"] = Value::Array(cfg.ice_servers(user.id, chrono::Utc::now().timestamp(), 24 * 3600));
    Ok(Json(flags))
}
