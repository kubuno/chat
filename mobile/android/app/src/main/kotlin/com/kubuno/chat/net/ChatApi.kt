package com.kubuno.chat.net

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The chat module's HTTP surface, proxied by the core under /api/v1/chat.
 * The client authenticates to the CORE with the account's borrowed bearer
 * token; the module itself is reached only through that proxy.
 */
interface ChatApi {

    @GET("api/v1/chat/conversations")
    suspend fun conversations(): ConversationListResponse

    @GET("api/v1/chat/conversations/{id}")
    suspend fun conversation(@Path("id") id: String): ConversationDetail

    /**
     * Newest first. "before" is the id of the oldest message already held.
     *
     * The module used to compare that id as a raw UUIDv4 while ordering by
     * created_at, which made backwards paging non-deterministic; it now
     * resolves the pivot to (created_at, id) and orders on the same pair, so
     * the cursor is safe to trust. The client still de-duplicates by id when
     * merging a page, since an insert can race a fetch.
     */
    @GET("api/v1/chat/conversations/{id}/messages")
    suspend fun messages(
        @Path("id") id: String,
        @Query("limit") limit: Int = 60,
        @Query("before") before: String? = null,
    ): MessagesResponse

    @POST("api/v1/chat/conversations/{id}/messages")
    suspend fun send(@Path("id") id: String, @Body body: SendMessageBody): MessageResponse

    @PATCH("api/v1/chat/messages/{id}")
    suspend fun edit(@Path("id") id: String, @Body body: EditMessageBody): MessageResponse

    @DELETE("api/v1/chat/messages/{id}")
    suspend fun delete(@Path("id") id: String)

    /** Toggles the pin server-side; the response carries the new state. */
    @POST("api/v1/chat/messages/{id}/pin")
    suspend fun pinMessage(@Path("id") id: String): MessageResponse

    @POST("api/v1/chat/messages/{id}/reactions")
    suspend fun addReaction(@Path("id") id: String, @Body body: ReactionBody)

    @DELETE("api/v1/chat/messages/{id}/reactions/{emoji}")
    suspend fun removeReaction(@Path("id") id: String, @Path("emoji") emoji: String)

    @POST("api/v1/chat/conversations/{id}/read")
    suspend fun markRead(@Path("id") id: String, @Body body: ReadReceiptBody)

    @GET("api/v1/chat/conversations/{id}/read-state")
    suspend fun readState(@Path("id") id: String): ReadStateResponse

    @GET("api/v1/chat/conversations/{id}/pinned")
    suspend fun pinned(@Path("id") id: String): MessagesResponse

    @PATCH("api/v1/chat/conversations/{id}/member-settings")
    suspend fun memberSettings(@Path("id") id: String, @Body body: MemberSettingsBody)

    /** Core route (not the chat module): names people the module only identifies by uuid. */
    @GET("api/v1/users/search")
    suspend fun searchUsers(
        @Query("q") q: String,
        @Query("limit") limit: Int = 8,
    ): UserSearchResponse
}
