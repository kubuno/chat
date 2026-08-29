use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use uuid::Uuid;

use crate::state::AppState;

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
