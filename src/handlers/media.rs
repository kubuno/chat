use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, HeaderMap},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

/// POST /media/upload — uploader un média chiffré (blob opaque)
/// Le client envoie des bytes chiffrés — le serveur les stocke sans déchiffrer.
pub async fn upload_media(
    State(st): State<AppState>,
    user: ChatUser,
    mut multipart: Multipart,
) -> ChatResult<Json<Value>> {
    // Instance policy: attachments may be forbidden outright. The bytes are
    // ciphertext, so an all-or-nothing switch is the only file policy the
    // encryption leaves possible — never a filter on the declared file type.
    if !st.instance().allow_file_sharing {
        return Err(ChatError::Forbidden);
    }

    let mut file_data: Option<bytes::Bytes> = None;
    let mut content_type = "application/octet-stream".to_string();
    let mut filename = format!("{}", Uuid::new_v4());

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ChatError::Validation(e.to_string()))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "file" {
            if let Some(ct) = field.content_type() {
                content_type = ct.to_string();
            }
            if let Some(name) = field.file_name() {
                filename = name.to_string();
            }
            let data = field
                .bytes()
                .await
                .map_err(|e| ChatError::Validation(e.to_string()))?;

            // Instance cap on (encrypted) attachment size — a bound on the
            // bytes received, the one media policy E2E leaves possible.
            let max_mb = st.instance().max_media_mb;
            let max_bytes = max_mb as u64 * 1024 * 1024;
            if data.len() as u64 > max_bytes {
                return Err(ChatError::Validation(format!(
                    "Fichier trop volumineux (max {max_mb} MB)"
                )));
            }
            file_data = Some(data);
        }
    }

    let data = file_data.ok_or_else(|| ChatError::Validation("Champ 'file' manquant".into()))?;

    let media_id = Uuid::new_v4();
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let storage_path = format!("chat/{}/{}.{}", user.id, media_id, ext);

    st.storage
        .put(&storage_path, data)
        .await
        .map_err(|e| ChatError::Internal(anyhow::anyhow!(e)))?;

    // Enregistrer les métadonnées
    sqlx::query(
        "INSERT INTO chat.media_files (id, uploader_id, storage_path, original_name, content_type)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(media_id)
    .bind(user.id)
    .bind(&storage_path)
    .bind(&filename)
    .bind(&content_type)
    .execute(&st.db)
    .await?;

    Ok(Json(json!({
        "media_id":    media_id,
        "content_type": content_type,
    })))
}

/// GET /media/:media_id — télécharger un média chiffré
pub async fn download_media(
    State(st): State<AppState>,
    user: ChatUser,
    Path(media_id): Path<Uuid>,
) -> ChatResult<(HeaderMap, Body)> {
    #[derive(sqlx::FromRow)]
    struct MediaRow {
        storage_path:  String,
        original_name: String,
        content_type:  String,
        uploader_id:   uuid::Uuid,
    }

    let row: MediaRow = sqlx::query_as(
        "SELECT storage_path, original_name, content_type, uploader_id
         FROM chat.media_files WHERE id = $1",
    )
    .bind(media_id)
    .fetch_optional(&st.db)
    .await?
    .ok_or_else(|| ChatError::NotFound(media_id.to_string()))?;

    // Vérifier que l'utilisateur a accès (uploader ou membre d'une conv qui contient ce média)
    if row.uploader_id != user.id {
        // `EXISTS` yields a boolean; the previous `SELECT 1` was decoded as i64
        // while Postgres types the literal as int4, so this query failed for
        // every non-uploader — i.e. the recipient of any media saw a database
        // error and a permanent "media unavailable", while the uploader (who
        // skips this check) always saw it fine.
        let has_access: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM chat.messages m
                 JOIN chat.conversation_members cm
                   ON cm.conversation_id = m.conversation_id
                  AND cm.user_id = $2 AND cm.left_at IS NULL
                 WHERE m.media_meta->>'media_id' = $1::text
             )",
        )
        .bind(media_id)
        .bind(user.id)
        .fetch_one(&st.db)
        .await?;

        if !has_access {
            return Err(ChatError::Forbidden);
        }
    }

    let data = st
        .storage
        .get(&row.storage_path)
        .await
        .map_err(|e| ChatError::Internal(anyhow::anyhow!(e)))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        row.content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", row.original_name)
            .parse()
            .unwrap(),
    );

    Ok((headers, Body::from(data)))
}
