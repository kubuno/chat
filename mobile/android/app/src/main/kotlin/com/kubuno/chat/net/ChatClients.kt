package com.kubuno.chat.net

import com.kubuno.android.account.BrokeredClient
import com.kubuno.android.account.BrokeredClients
import com.kubuno.android.account.SharedAccount
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Builds a ChatApi per shared account, over that account's borrowed-token
 * client. Like mail and maps, chat is a consumer: it never holds a refresh
 * token, it talks to each instance through the client :core-account brokers.
 */
@Singleton
class ChatClients @Inject constructor(
    private val brokered: BrokeredClients,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val apis = ConcurrentHashMap<String, ChatApi>()

    fun api(account: SharedAccount): ChatApi = apis.computeIfAbsent(account.systemName) {
        val client = brokered.of(account)
        Retrofit.Builder()
            .baseUrl(client.serverUrl + "/")
            .client(client.okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ChatApi::class.java)
    }

    /** The authenticated client itself, for the WebSocket and media byte streams. */
    fun raw(account: SharedAccount): BrokeredClient = brokered.of(account)

    /**
     * Re-authenticates a shared account whose session has expired, then drops
     * the cached ChatApi so the next call binds to the refreshed token. Returns
     * true when a usable session came back.
     */
    suspend fun reauthenticate(activity: android.app.Activity, account: SharedAccount): Boolean {
        val ok = brokered.reauthenticate(activity, account)
        if (ok) apis.remove(account.systemName)
        return ok
    }
}
