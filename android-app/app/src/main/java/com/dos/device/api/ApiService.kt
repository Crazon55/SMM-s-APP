package com.dos.device.api

import com.dos.device.api.models.EnrollResponse
import com.dos.device.api.models.TodayPlanResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface ApiService {

    @POST("device/enroll")
    suspend fun enroll(@Body body: EnrollRequest): Response<EnrollResponse>

    @GET("plan/today")
    suspend fun getTodayPlan(@Header("x-device-token") token: String): Response<TodayPlanResponse>

    @POST("logs/session")
    suspend fun postSessionLog(
        @Header("x-device-token") token: String,
        @Body body: SessionLogRequest
    ): Response<LogIdResponse>

    @POST("logs/post")
    suspend fun postPostLog(
        @Header("x-device-token") token: String,
        @Body body: PostLogRequest
    ): Response<LogIdResponse>
}

data class EnrollRequest(val token: String)

data class LogIdResponse(val id: String, val duplicate: Boolean? = null)

data class SessionLogRequest(
    val session_id: String,
    val planned_start: String,
    val planned_duration_min: Int,
    val actual_start: String? = null,
    val actual_end: String? = null,
    val status: String,
    val idempotency_key: String? = null
)

data class PostLogRequest(
    val account_id: String,
    val planned_time_start: String? = null,
    val planned_time_end: String? = null,
    val actual_time: String,
    val status: String,
    val idempotency_key: String? = null
)
