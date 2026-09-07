package com.kubuno.chat

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import com.kubuno.android.ui.theme.KubunoTheme
import com.kubuno.chat.ui.ChatApp
import dagger.hilt.android.AndroidEntryPoint

// AppCompatActivity so per-app locales keep working down to minSdk, matching
// the drive, mail and maps apps.
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KubunoTheme {
                ChatApp()
            }
        }
    }
}
