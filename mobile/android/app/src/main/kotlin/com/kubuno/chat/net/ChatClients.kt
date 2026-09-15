package com.kubuno.chat.net

import com.kubuno.android.account.AccountClients
import com.kubuno.android.account.AccountRegistry
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
 * Builds a ChatApi per account, over that account's authenticated client.
 *
 * Chat now handles both kinds of account the same list can hold:
 *  - one it OWNS (signed in from chat itself): it holds the refresh token, so
 *    it talks over that account's own [AccountClients] client and refreshes and
 *    re-authenticates on its own, independent of any other app;
 *  - one a SIBLING owns (drive signed it in): chat is a consumer, borrowing
 *    15-minute access tokens through [BrokeredClients].
 *
 * The account is the same shared account either way — whichever app registered
 * it, all of them can use it — the difference is only which app holds its
 * refresh token, and therefore which client serves the calls.
 */
@Singleton
class ChatClients @Inject constructor(
    private val brokered: BrokeredClients,
    private val owned: AccountClients,
    private val registry: AccountRegistry,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val apis = ConcurrentHashMap<String, ChatApi>()

    /**
     * Accounts whose OWN session turned out to be dead. The account itself is
     * still signed in on this device — a sibling app holds a live session for
     * it — so we borrow from now on instead of declaring the user signed out.
     */
    private val borrowInstead = ConcurrentHashMap.newKeySet<String>()

    fun api(account: SharedAccount): ChatApi = apis.computeIfAbsent(account.systemName) {
        val client = raw(account)
        Retrofit.Builder()
            .baseUrl(client.serverUrl + "/")
            .client(client.okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ChatApi::class.java)
    }

    /**
     * The authenticated client for [account], for the WebSocket and media byte
     * streams. An account chat owns is served by its own tokens; otherwise it
     * is borrowed from the owning app.
     */
    fun raw(account: SharedAccount): BrokeredClient {
        if (account.systemName !in borrowInstead) {
            ownedClient(account)?.let { return it }
        }
        return brokered.of(account)
    }

    /**
     * Our own session for [account] is dead. Before telling the user to sign in
     * again, fall back to the access token the system authenticator can still
     * borrow from whichever sibling app holds a live session for the SAME
     * account — the account is shared, only the refresh token is not.
     *
     * Returns true when that fallback is newly available, i.e. we were serving
     * this account from our own session until now; false when we were already
     * borrowing, in which case the session really is gone.
     */
    fun demoteToBorrowed(account: SharedAccount): Boolean {
        if (ownedClient(account) == null) return false
        if (!borrowInstead.add(account.systemName)) return false
        evict(account)
        brokered.reset(account)
        return true
    }

    /** Drops the cached ChatApi so the next call rebinds (after a re-auth). */
    fun evict(account: SharedAccount) {
        apis.remove(account.systemName)
    }

    /** A fresh sign-in of our own supersedes any borrowing fallback. */
    fun promoteToOwned(account: SharedAccount) {
        borrowInstead.remove(account.systemName)
        evict(account)
    }

    /**
     * A client backed by chat's OWN session for [account], when chat is the app
     * that signed it in — recognised by a registry record for the same user on
     * the same server. Reuses the account's [com.kubuno.android.api.KubunoClient],
     * whose OkHttp client already refreshes with the owned refresh token and
     * whose TokenManager is the bearer the WebSocket needs.
     */
    private fun ownedClient(account: SharedAccount): BrokeredClient? {
        val record = registry.accounts.value.firstOrNull {
            it.userId == account.userId && sameHost(it.serverUrl, account.serverUrl)
        } ?: return null
        val client = owned.of(record.id) ?: return null
        return BrokeredClient(client.baseUrl.trimEnd('/'), client.okHttpClient, client.tokenManager)
    }

    private fun sameHost(a: String, b: String): Boolean =
        a.substringAfter("://").substringBefore('/').equals(
            b.substringAfter("://").substringBefore('/'),
            ignoreCase = true,
        )
}
