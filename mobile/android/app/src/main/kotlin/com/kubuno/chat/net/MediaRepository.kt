package com.kubuno.chat.net

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.core.net.toUri
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody

/**
 * Attachment plumbing: encrypt-and-upload on the way out, download-and-decrypt
 * on the way in, with a small on-disk cache of plaintext.
 *
 * The cache exists because the UI needs a *file* to hand to the image loader
 * and the media player, and because scrolling past the same photo three times
 * should not download and decrypt it three times.
 */
@Singleton
class MediaRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    /** What the picker learned about a file before it was encrypted. */
    data class LocalFile(
        val uri: Uri,
        val name: String,
        val mime: String,
        val size: Long,
        val kind: String,
        val width: Int? = null,
        val height: Int? = null,
        val durationSeconds: Double? = null,
    )

    private val cacheDir: File by lazy {
        File(context.cacheDir, "chat-media").apply { mkdirs() }
    }

    // One download per media id, however many bubbles ask at once.
    private val locks = ConcurrentHashMap<String, Mutex>()

    /** Reads name, size and mime for a picked content Uri, and classifies it. */
    suspend fun inspect(uri: Uri, forcedKind: String? = null): LocalFile? = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        var name = uri.lastPathSegment ?: "fichier"
        var size = 0L
        runCatching {
            resolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        .takeIf { it >= 0 }
                        ?.let { name = cursor.getString(it) ?: name }
                    cursor.getColumnIndex(OpenableColumns.SIZE)
                        .takeIf { it >= 0 && !cursor.isNull(it) }
                        ?.let { size = cursor.getLong(it) }
                }
            }
        }
        if (size == 0L) {
            size = runCatching {
                resolver.openFileDescriptor(uri, "r")?.use { it.statSize.coerceAtLeast(0) } ?: 0L
            }.getOrDefault(0L)
        }

        val kind = forcedKind ?: when {
            mime.startsWith("image/") -> "image"
            mime.startsWith("video/") -> "video"
            mime.startsWith("audio/") -> "audio"
            else -> "file"
        }

        var width: Int? = null
        var height: Int? = null
        var duration: Double? = null
        if (kind == "video" || kind == "audio") {
            // Dimensions and duration are non-secret metadata: they let the
            // recipient size the bubble before the blob has finished
            // downloading, which is why the web sends them too.
            runCatching {
                MediaMetadataRetriever().use { retriever ->
                    retriever.setDataSource(context, uri)
                    duration = retriever
                        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                        ?.toLongOrNull()
                        ?.let { it / 1000.0 }
                    if (kind == "video") {
                        width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                        height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                    }
                }
            }.onFailure { Log.w(TAG, "could not read media metadata", it) }
        }
        if (kind == "image") {
            runCatching {
                val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                resolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, options) }
                if (options.outWidth > 0) width = options.outWidth
                if (options.outHeight > 0) height = options.outHeight
            }.onFailure { Log.w(TAG, "could not read image bounds", it) }
        }

        LocalFile(uri, name, mime, size, kind, width, height, duration)
    }

    /**
     * Encrypts [file] to a temporary blob, uploads it, and returns the envelope
     * half describing it. The temporary blob is always deleted, including when
     * the upload fails.
     */
    suspend fun upload(api: ChatApi, file: LocalFile): ChatEnvelope.Media? = withContext(Dispatchers.IO) {
        val secret = MediaCrypto.newSecret()
        val encrypted = File.createTempFile("kubuno-", ".enc", context.cacheDir)
        try {
            val plainBytes = context.contentResolver.openInputStream(file.uri)?.use { source ->
                encrypted.outputStream().use { sink -> MediaCrypto.encrypt(secret, source, sink) }
            } ?: return@withContext null

            val part = MultipartBody.Part.createFormData(
                name = "file",
                // The server derives its stored extension from this name, and
                // the bytes are ciphertext, so anything else would be a lie.
                filename = "${java.util.UUID.randomUUID()}.enc",
                body = encrypted.asRequestBody("application/octet-stream".toMediaType()),
            )
            val response = api.uploadMedia(part)

            ChatEnvelope.Media(
                mediaId = response.mediaId,
                key = secret.key,
                iv = secret.iv,
                mime = file.mime,
                name = file.name,
                size = if (file.size > 0) file.size else plainBytes,
                kind = file.kind,
                width = file.width,
                height = file.height,
                duration = file.durationSeconds,
            )
        } catch (e: Exception) {
            Log.w(TAG, "upload failed", e)
            null
        } finally {
            encrypted.delete()
        }
    }

    /**
     * The plaintext attachment as a local file, downloading and decrypting it
     * once. Returns null when the blob is gone or the key does not match.
     */
    suspend fun localCopy(api: ChatApi, media: ChatEnvelope.Media): File? {
        val target = File(cacheDir, media.mediaId + extensionFor(media))
        if (target.exists() && target.length() > 0) return target

        val lock = locks.getOrPut(media.mediaId) { Mutex() }
        return lock.withLock {
            if (target.exists() && target.length() > 0) return@withLock target
            withContext(Dispatchers.IO) {
                runCatching {
                    val cipherText = api.downloadMedia(media.mediaId).use { it.bytes() }
                    val plain = MediaCrypto.decrypt(media.key, media.iv, cipherText)
                    val partial = File(target.absolutePath + ".part")
                    partial.writeBytes(plain)
                    // Rename last: a reader must never find a half-written file
                    // under the final name and cache it as complete.
                    partial.renameTo(target)
                    target
                }.onFailure { Log.w(TAG, "media ${media.mediaId} unavailable", it) }
                    .getOrNull()
            }
        }
    }

    /** A content:// uri other apps can open, for "share" and "open with". */
    fun shareUri(file: File): Uri = file.toUri()

    private fun extensionFor(media: ChatEnvelope.Media): String {
        val fromName = media.name.substringAfterLast('.', "")
        if (fromName.isNotBlank() && fromName.length <= 5) return ".$fromName"
        return when (media.kind) {
            "image" -> ".jpg"
            "video" -> ".mp4"
            "audio" -> ".m4a"
            else -> ".bin"
        }
    }

    private companion object {
        const val TAG = "KubunoChatMedia"
    }
}
