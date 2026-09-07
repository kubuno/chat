package com.kubuno.chat.net

import android.util.Base64
import java.io.InputStream
import java.io.OutputStream
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.CipherOutputStream
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Per-blob encryption for attachments, byte-for-byte compatible with the web
 * client (chat/frontend/src/crypto/media.ts).
 *
 * Each attachment gets a fresh AES-256-GCM key and a 12-byte IV; the ciphertext
 * is what the server stores, and the key and IV travel in the message envelope.
 *
 * NOTE ON WHAT THIS DOES AND DOES NOT PROTECT: the envelope carrying the key is
 * itself only base64 today (see [ChatEnvelope]), so the server can read the key
 * and therefore the attachment. This exists for interoperability with the web
 * client, not as a confidentiality guarantee — and it is why the app claims
 * none. The moment the module ships a real envelope, this becomes real too,
 * with no change here.
 *
 * WebCrypto appends the 128-bit GCM tag to the ciphertext, which is exactly what
 * javax.crypto does, so the two agree without any framing of our own.
 */
object MediaCrypto {

    private const val KEY_BITS = 256
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val B64 = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP

    private val random = SecureRandom()

    /** A fresh key/IV pair, already base64url-encoded for the envelope. */
    data class Secret(val key: String, val iv: String) {
        internal val keyBytes: ByteArray get() = Base64.decode(key, B64)
        internal val ivBytes: ByteArray get() = Base64.decode(iv, B64)
    }

    fun newSecret(): Secret {
        val key = ByteArray(KEY_BITS / 8).also(random::nextBytes)
        val iv = ByteArray(IV_BYTES).also(random::nextBytes)
        return Secret(
            key = Base64.encodeToString(key, B64),
            iv = Base64.encodeToString(iv, B64),
        )
    }

    /**
     * Streams [source] into [sink], encrypting as it goes.
     *
     * Streaming rather than encrypting a ByteArray because a video picked from
     * the gallery can be hundreds of megabytes, and holding both plaintext and
     * ciphertext in memory is how a chat app gets killed by the OOM reaper.
     */
    fun encrypt(secret: Secret, source: InputStream, sink: OutputStream): Long {
        val cipher = Cipher.getInstance(TRANSFORM).apply {
            init(
                Cipher.ENCRYPT_MODE,
                SecretKeySpec(secret.keyBytes, "AES"),
                GCMParameterSpec(TAG_BITS, secret.ivBytes),
            )
        }
        var plainBytes = 0L
        CipherOutputStream(sink, cipher).use { out ->
            val buffer = ByteArray(BUFFER)
            while (true) {
                val read = source.read(buffer)
                if (read <= 0) break
                out.write(buffer, 0, read)
                plainBytes += read
            }
        }
        return plainBytes
    }

    /**
     * Decrypts a whole attachment.
     *
     * Deliberately NOT streamed: GCM only authenticates once the tag is read, so
     * a streaming decrypt hands out bytes it has not verified yet. Attachments
     * are capped by the instance anyway, so buffering is the honest choice.
     */
    fun decrypt(key: String, iv: String, cipherText: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORM).apply {
            init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(Base64.decode(key, B64), "AES"),
                GCMParameterSpec(TAG_BITS, Base64.decode(iv, B64)),
            )
        }
        return cipher.doFinal(cipherText)
    }

    private const val BUFFER = 64 * 1024
}
