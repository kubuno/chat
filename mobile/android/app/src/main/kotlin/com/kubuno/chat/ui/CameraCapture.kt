package com.kubuno.chat.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/**
 * The two places this app hands a file to another app: the camera writes a
 * photo into our own cache, and "open with" hands a decrypted attachment to
 * whatever can display it.
 *
 * Both go through a FileProvider — a raw file:// uri is refused by the platform
 * and would crash the receiving app.
 */
object CameraCapture {

    private const val TAG = "KubunoChatFiles"
    private const val AUTHORITY_SUFFIX = ".fileprovider"

    /** A content uri the camera can write one photo into. */
    fun newTarget(context: Context): Uri? = runCatching {
        val dir = File(context.cacheDir, "camera").apply { mkdirs() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        FileProvider.getUriForFile(context, context.packageName + AUTHORITY_SUFFIX, file)
    }.onFailure { Log.w(TAG, "could not create a camera target", it) }.getOrNull()

    /** Opens a decrypted attachment in whichever app can handle its type. */
    fun open(context: Context, file: File, mime: String) {
        val uri = runCatching {
            FileProvider.getUriForFile(context, context.packageName + AUTHORITY_SUFFIX, file)
        }.getOrNull() ?: return
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime.ifBlank { "*/*" })
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "nothing can open $mime", e)
        }
    }
}
