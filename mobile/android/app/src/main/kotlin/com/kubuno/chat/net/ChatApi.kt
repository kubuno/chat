package com.kubuno.chat.net

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/**
 * The chat module's HTTP surface, proxied by the core under /api/v1/chat.
 * The client authenticates to the CORE with the account's borrowed bearer
 * token; the module itself is reached only through that proxy.
 */
interface ChatApi {

    /** Instance policy, including the ICE servers a call must use. */
    @GET("api/v1/chat/config")
    suspend fun config(): ChatConfig

    @GET("api/v1/chat/conversations")
    suspend fun conversations(): ConversationListResponse

    @POST("api/v1/chat/conversations")
    suspend fun createConversation(@Body body: CreateConversationBody): ConversationCreated

    @GET("api/v1/chat/conversations/{id}")
    suspend fun conversation(@Path("id") id: String): ConversationDetail

    /** Casts or changes this user's vote; the module upserts on (message, user). */
    @POST("api/v1/chat/messages/{id}/vote")
    suspend fun vote(@Path("id") id: String, @Body body: VoteBody): PollResults

    @GET("api/v1/chat/messages/{id}/poll")
    suspend fun pollResults(@Path("id") id: String): PollResults

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

    /**
     * Empties a conversation.
     *
     * The module deletes the messages for EVERY member, not just for the
     * caller: there is no per-member "delete my copy". Anything that offers
     * this has to say so first.
     */
    @POST("api/v1/chat/conversations/{id}/clear")
    suspend fun clearConversation(@Path("id") id: String)

    /**
     * Uploads one already-encrypted blob. The server stores opaque bytes and
     * never sees the plaintext; the returned media_id is what the message
     * envelope and media_meta both reference.
     */
    @Multipart
    @POST("api/v1/chat/media/upload")
    suspend fun uploadMedia(@Part file: MultipartBody.Part): MediaUploadResponse

    /** The ciphertext back. Streamed so a large attachment never lands whole in memory twice. */
    @Streaming
    @GET("api/v1/chat/media/{id}")
    suspend fun downloadMedia(@Path("id") id: String): ResponseBody

    /** Core route (not the chat module): names people the module only identifies by uuid. */
    @GET("api/v1/users/search")
    suspend fun searchUsers(
        @Query("q") q: String,
        @Query("limit") limit: Int = 8,
    ): UserSearchResponse
}
