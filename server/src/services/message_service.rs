use crate::errors::{ChatError, ChatResult};
use kubuno_db::dialect::SqlType;
use kubuno_db::{params, DbPool};
use uuid::Uuid;

/// Vérifier qu'un user est membre d'une conversation
pub async fn assert_member(db: &DbPool, conv_id: Uuid, user_id: Uuid) -> ChatResult<()> {
    // A bare `SELECT 1` literal is int4 on PostgreSQL and will not decode as
    // i64, so cast it to a portable width; the row's presence is the answer.
    let sql = format!(
        "SELECT {} FROM chat.conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1",
        db.backend().cast("1", SqlType::BigInt)
    );
    let ok: Option<i64> = db.fetch_optional_scalar(&sql, params![conv_id, user_id]).await?;

    if ok.is_none() {
        return Err(ChatError::Forbidden);
    }
    Ok(())
}

/// Récupérer les user_ids de tous les membres actifs d'une conversation
pub async fn get_member_ids(db: &DbPool, conv_id: Uuid) -> ChatResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = db
        .fetch_all_as(
            "SELECT user_id FROM chat.conversation_members
             WHERE conversation_id = $1 AND left_at IS NULL",
            params![conv_id],
        )
        .await?;

    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Marquer les messages comme délivrés pour un user dans une conversation
pub async fn mark_delivered(db: &DbPool, conv_id: Uuid, user_id: Uuid) -> ChatResult<()> {
    db.execute(
        "UPDATE chat.messages SET status = 'delivered'
         WHERE conversation_id = $1
           AND sender_id != $2
           AND status = 'sent'",
        params![conv_id, user_id],
    )
    .await?;
    Ok(())
}
