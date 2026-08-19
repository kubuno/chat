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
    _user: ChatUser,
) -> ChatResult<Json<Value>> {
    Ok(Json(st.instance().public_flags()))
}
