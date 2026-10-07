-- 000004_chat_media.up.sql
-- Métadonnées des médias chiffrés (blobs opaques stockés dans kubuno-storage)

CREATE TABLE chat.media_files (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploader_id     UUID NOT NULL,
    storage_path    TEXT NOT NULL,
    original_name   VARCHAR(500) NOT NULL DEFAULT 'file',
    content_type    VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    -- Taille du blob chiffré (pas du fichier clair)
    encrypted_size  BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_media_uploader ON chat.media_files(uploader_id);
