use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("Non authentifié")]
    Unauthorized,
    #[error("Accès refusé")]
    Forbidden,
    #[error("Ressource introuvable: {0}")]
    NotFound(String),
    #[error("Données invalides: {0}")]
    Validation(String),
    #[error("Conflit: {0}")]
    Conflict(String),
    #[error("Trop de requêtes")]
    TooManyRequests,
    #[error("Erreur base de données")]
    Database(#[from] sqlx::Error),
    #[error("Erreur interne")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for ChatError {
    fn into_response(self) -> Response {
        let (status, code, msg) = match &self {
            ChatError::Unauthorized      => (StatusCode::UNAUTHORIZED,           "UNAUTHORIZED",        self.to_string()),
            ChatError::Forbidden         => (StatusCode::FORBIDDEN,              "FORBIDDEN",           self.to_string()),
            ChatError::NotFound(m)       => (StatusCode::NOT_FOUND,              "NOT_FOUND",           m.clone()),
            ChatError::Validation(m)     => (StatusCode::UNPROCESSABLE_ENTITY,   "VALIDATION_ERROR",    m.clone()),
            ChatError::Conflict(m)       => (StatusCode::CONFLICT,               "CONFLICT",            m.clone()),
            ChatError::TooManyRequests   => (StatusCode::TOO_MANY_REQUESTS,      "TOO_MANY_REQUESTS",   self.to_string()),
            ChatError::Database(e)       => {
                tracing::error!(error = %e, "Erreur DB chat");
                (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Erreur base de données".into())
            }
            ChatError::Internal(e)       => {
                tracing::error!(error = %e, "Erreur interne chat");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Erreur interne".into())
            }
        };
        (status, Json(json!({ "error": code, "message": msg }))).into_response()
    }
}

pub type ChatResult<T> = Result<T, ChatError>;
