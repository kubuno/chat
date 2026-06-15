use crate::errors::{ChatError, ChatResult};
use sqlx::PgPool;
use uuid::Uuid;

/// Vérifier qu'un user est membre d'une conversation
pub async fn assert_member(db: &PgPool, conv_id: Uuid, user_id: Uuid) -> ChatResult<()> {
    let ok: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM chat.conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
    )
    .bind(conv_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    if ok.is_none() {
        return Err(ChatError::Forbidden);
    }
    Ok(())
}

/// Récupérer les user_ids de tous les membres actifs d'une conversation
pub async fn get_member_ids(db: &PgPool, conv_id: Uuid) -> ChatResult<Vec<Uuid>> {
    let rows: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM chat.conversation_members
         WHERE conversation_id = $1 AND left_at IS NULL",
    )
    .bind(conv_id)
    .fetch_all(db)
    .await?;

    Ok(rows)
}

/// Marquer les messages comme délivrés pour un user dans une conversation
pub async fn mark_delivered(db: &PgPool, conv_id: Uuid, user_id: Uuid) -> ChatResult<()> {
    sqlx::query(
        "UPDATE chat.messages SET status = 'delivered'
         WHERE conversation_id = $1
           AND sender_id != $2
           AND status = 'sent'",
    )
    .bind(conv_id)
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(())
}
