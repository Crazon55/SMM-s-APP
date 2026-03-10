package com.dos.device.storage

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persists pending session/post logs for offline-first sync.
 * In-memory + file backup for simplicity in V1.
 */
class LogQueue(context: Context) {
    private val prefs = context.getSharedPreferences("dos_log_queue", Context.MODE_PRIVATE)
    private val key = "pending_logs"

    fun enqueueSession(log: SessionLogEntry) {
        val list = getList().toMutableList()
        list.add(LogEntry("session", log.toJson()))
        saveList(list)
    }

    fun enqueuePost(log: PostLogEntry) {
        val list = getList().toMutableList()
        list.add(LogEntry("post", log.toJson()))
        saveList(list)
    }

    fun getPending(): List<LogEntry> = getList()

    fun removeAt(index: Int) {
        val list = getList().toMutableList()
        if (index in list.indices) {
            list.removeAt(index)
            saveList(list)
        }
    }

    fun clear() = saveList(emptyList())

    fun replacePending(entries: List<LogEntry>) = saveList(entries)

    private fun getList(): List<LogEntry> {
        val json = prefs.getString(key, "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            LogEntry(o.getString("type"), o.getJSONObject("payload").toString())
        }
    }

    private fun saveList(list: List<LogEntry>) {
        val arr = JSONArray()
        list.forEach { e ->
            val o = JSONObject().apply {
                put("type", e.type)
                put("payload", JSONObject(e.payloadJson))
            }
            arr.put(o)
        }
        prefs.edit().putString(key, arr.toString()).apply()
    }

    data class LogEntry(val type: String, val payloadJson: String)

    data class SessionLogEntry(
        val session_id: String,
        val planned_start: String,
        val planned_duration_min: Int,
        val actual_start: String?,
        val actual_end: String?,
        val status: String,
        val idempotency_key: String
    ) {
        fun toJson() = JSONObject().apply {
            put("session_id", session_id)
            put("planned_start", planned_start)
            put("planned_duration_min", planned_duration_min)
            put("actual_start", actual_start)
            put("actual_end", actual_end)
            put("status", status)
            put("idempotency_key", idempotency_key)
        }.toString()
    }

    data class PostLogEntry(
        val account_id: String,
        val planned_time_start: String?,
        val planned_time_end: String?,
        val actual_time: String,
        val status: String,
        val idempotency_key: String
    ) {
        fun toJson() = JSONObject().apply {
            put("account_id", account_id)
            put("planned_time_start", planned_time_start)
            put("planned_time_end", planned_time_end)
            put("actual_time", actual_time)
            put("status", status)
            put("idempotency_key", idempotency_key)
        }.toString()
    }
}
