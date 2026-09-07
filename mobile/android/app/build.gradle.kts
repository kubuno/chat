// The Kubuno chat client. A fourth app on the shared core: it consumes the chat
// module's HTTP API (proxied under /api/v1/chat) plus the module's OWN
// WebSocket, and reuses :core-account (accounts, sessions, the com.kubuno
// authenticator) and :core-ui (design tokens).
//
// NOTE ON ENCRYPTION: the chat module does not encrypt message bodies today —
// `encrypted_data` carries base64url(JSON), and the X3DH prekeys it publishes
// are never consumed. This client therefore makes NO end-to-end-encryption
// claim anywhere in its UI, and deliberately neither publishes nor fetches
// keys (a second key registration would overwrite the browser's).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.kubuno.chat"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kubuno.chat.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    // Release signing is opt-in: pass -PkubunoKeystore=… (and the passwords) to
    // sign, otherwise the release APK is unsigned (what the CI publishes). EVERY
    // Kubuno app MUST be signed with the SAME certificate — the shared-account
    // model grants access by matching signature.
    val keystorePath = (findProperty("kubunoKeystore") as String?)?.takeIf { it.isNotBlank() }
    val keystoreFile = keystorePath?.let { rootProject.file(it) }
    signingConfigs {
        if (keystoreFile != null && keystoreFile.exists()) {
            create("release") {
                storeFile = keystoreFile
                storePassword = findProperty("kubunoKeystorePassword") as String?
                keyAlias = findProperty("kubunoKeyAlias") as String?
                keyPassword = findProperty("kubunoKeyPassword") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core-api"))
    implementation(project(":core-account"))
    implementation(project(":core-ui"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    // Audio and video calls.
    implementation(libs.webrtc)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
