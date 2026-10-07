use axum::{
    extract::{FromRequestParts, Request, State},
    http::{request::Parts, StatusCode},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::{errors::ChatError, state::AppState};

/// This module's id, used as the token audience.
const MODULE_ID: &str = "chat";

/// Caller identity, resolved from the signed `X-Kubuno-Auth` token.
#[derive(Debug, Clone)]
pub struct ChatUser {
    pub id:    Uuid,
    pub role:  String,
    pub email: String,
}

/// Authenticate from the signed token the core mints with this module's internal
/// secret (see `kubuno-modauth`) instead of trusting the plain `X-Kubuno-User-*`
/// headers, which any process reaching this module's loopback port could forge to
/// impersonate any user. Specialised to `AppState` because verification needs the
/// module's internal secret.
#[axum::async_trait]
impl FromRequestParts<AppState> for ChatUser {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(kubuno_modauth::TOKEN_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let user = kubuno_modauth::verify(
            state.settings.core.internal_secret.as_bytes(),
            token,
            MODULE_ID,
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

        Ok(ChatUser {
            id: user.id,
            role: user.role,
            email: user.email,
        })
    }
}

/// Guard for the routes the CORE calls directly, bypassing its own proxy.
///
/// Those carry no user: the core is speaking for itself (delivering an event it
/// has fanned out), so the per-user token that guards everything else does not
/// apply and the shared internal secret does. Vendored rather than shared: a
/// module never links another module, nor the core.
pub async fn require_internal_secret(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> std::result::Result<Response, ChatError> {
    let expected = state.settings.core.internal_secret.as_str();
    if expected.is_empty() {
        tracing::error!(
            "chat: core.internal_secret vide — route interne refusée. \
             Renseignez KUBUNO_INTERNAL_SECRET."
        );
        return Err(ChatError::Forbidden);
    }
    let provided = req
        .headers()
        .get("x-internal-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return Err(ChatError::Forbidden);
    }
    Ok(next.run(req).await)
}

/// Byte comparison whose duration does not depend on where the first difference
/// is. The length check leaks the length, which is not a secret.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
