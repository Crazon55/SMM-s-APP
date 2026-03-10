package com.dos.device

import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.dos.device.api.RetrofitModule
import com.dos.device.api.models.TodayPlanResponse
import com.dos.device.storage.LogQueue
import com.dos.device.storage.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var tokenStore: TokenStore
    private lateinit var logQueue: LogQueue
    private var plan: TodayPlanResponse? = null
    private var serverBaseUrl: String = "http://10.0.2.2:3000/"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tokenStore = TokenStore(this)
        logQueue = LogQueue(this)
        serverBaseUrl = tokenStore.serverBaseUrl ?: serverBaseUrl

        if (tokenStore.token.isNullOrBlank()) {
            showEnrollScreen()
        } else {
            loadPlan()
        }
    }

    private fun showEnrollScreen() {
        setContentView(R.layout.screen_enroll)
        findViewById<Button>(R.id.btn_enroll).setOnClickListener {
            val token = findViewById<EditText>(R.id.edit_token).text.toString().trim()
            val baseUrl = findViewById<EditText>(R.id.edit_base_url).text.toString().trim()
            if (token.isBlank()) {
                Toast.makeText(this, "Enter device token", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val url = if (baseUrl.isNotBlank()) baseUrl else "http://10.0.2.2:3000/"
            tokenStore.serverBaseUrl = url
            lifecycleScope.launch {
                enroll(token, url)
            }
        }
    }

    private suspend fun enroll(token: String, baseUrl: String) {
        withContext(Dispatchers.IO) {
            try {
                val api = RetrofitModule.createApi(baseUrl)
                val res = api.enroll(com.dos.device.api.EnrollRequest(token))
                withContext(Dispatchers.Main) {
                    if (res.isSuccessful) {
                        tokenStore.token = token
                        Toast.makeText(this@MainActivity, "Enrolled", Toast.LENGTH_SHORT).show()
                        setContentView(R.layout.activity_main)
                        loadPlan()
                    } else {
                        Toast.makeText(this@MainActivity, "Enroll failed: ${res.code()}", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun loadPlan() {
        setContentView(R.layout.activity_main)
        val token = tokenStore.token ?: return
        val api = RetrofitModule.createApi(serverBaseUrl)

        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val res = api.getTodayPlan(token)
                    withContext(Dispatchers.Main) {
                        if (res.isSuccessful) {
                            plan = res.body()
                            renderPlan(res.body()!!)
                        } else {
                            findViewById<TextView>(R.id.plan_content).text = "No plan for today or error: ${res.code()}"
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        findViewById<TextView>(R.id.plan_content).text = "Offline or error: ${e.message}. Sync when online."
                        plan?.let { renderPlan(it) }
                    }
                }
            }
        }

        findViewById<Button>(R.id.btn_refresh).setOnClickListener { loadPlan() }
        findViewById<Button>(R.id.btn_sync_logs).setOnClickListener { syncPendingLogs() }
    }

    private fun renderPlan(p: TodayPlanResponse) {
        val content = findViewById<TextView>(R.id.plan_content)
        val sessionsContainer = findViewById<LinearLayout>(R.id.sessions_container)
        val postsContainer = findViewById<LinearLayout>(R.id.posts_container)

        content.text = "${p.persona_name} · ${p.daily_mode}\nWindow: ${p.active_window.start}–${p.active_window.end}"

        sessionsContainer.removeAllViews()
        p.sessions.sortedBy { it.sort_order }.forEach { s ->
            val row = layoutInflater.inflate(android.R.layout.simple_list_item_2, sessionsContainer, false)
            (row.findViewById(android.R.id.text1) as TextView).text = "${s.planned_start} (${s.planned_duration_min} min)"
            val focusLine = buildString {
                if (s.dominant_accounts.isNotEmpty()) {
                    append("Focus: ")
                    append(s.dominant_accounts.joinToString(", ") { it.account_display_name })
                }
                if (s.secondary_accounts.isNotEmpty()) {
                    if (isNotEmpty()) append(" · ")
                    append("Light: ")
                    append(s.secondary_accounts.joinToString(", ") { it.account_display_name })
                }
            }.ifEmpty { "Session" }
            (row.findViewById(android.R.id.text2) as TextView).text = focusLine
            val btn = Button(this).apply {
                text = "Start"
                setOnClickListener { markSessionStart(s.id, s.planned_start, s.planned_duration_min) }
            }
            sessionsContainer.addView(row)
            sessionsContainer.addView(btn)
        }

        postsContainer.removeAllViews()
        p.posting_tasks.forEach { t ->
            val row = layoutInflater.inflate(android.R.layout.simple_list_item_2, postsContainer, false)
            (row.findViewById(android.R.id.text1) as TextView).text = t.account_display_name
            (row.findViewById(android.R.id.text2) as TextView).text = "${t.planned_time_window_start}–${t.planned_time_window_end}"
            val btn = Button(this).apply {
                text = "Mark done"
                setOnClickListener { markPostDone(t.id, t.account_id, t.planned_time_window_start, t.planned_time_window_end) }
            }
            postsContainer.addView(row)
            postsContainer.addView(btn)
        }
    }

    private fun markSessionStart(sessionId: String, plannedStart: String, durationMin: Int) {
        val idempotencyKey = "session-${sessionId}-${System.currentTimeMillis()}"
        val entry = LogQueue.SessionLogEntry(
            session_id = sessionId,
            planned_start = plannedStart,
            planned_duration_min = durationMin,
            actual_start = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date()),
            actual_end = null,
            status = "completed",
            idempotency_key = idempotencyKey
        )
        logQueue.enqueueSession(entry)
        Toast.makeText(this, "Session logged (pending sync)", Toast.LENGTH_SHORT).show()
        syncPendingLogs()
    }

    private fun markPostDone(taskId: String, accountId: String, windowStart: String, windowEnd: String) {
        val now = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date())
        val idempotencyKey = "post-${accountId}-${now}-${System.currentTimeMillis()}"
        val entry = LogQueue.PostLogEntry(
            account_id = accountId,
            planned_time_start = windowStart,
            planned_time_end = windowEnd,
            actual_time = now,
            status = "completed",
            idempotency_key = idempotencyKey
        )
        logQueue.enqueuePost(entry)
        Toast.makeText(this, "Post logged (pending sync)", Toast.LENGTH_SHORT).show()
        syncPendingLogs()
    }

    private fun syncPendingLogs() {
        val token = tokenStore.token ?: return
        val api = RetrofitModule.createApi(serverBaseUrl)
        val pending = logQueue.getPending()
        if (pending.isEmpty()) {
            Toast.makeText(this, "Nothing to sync", Toast.LENGTH_SHORT).show()
            return
        }

        lifecycleScope.launch {
            val stillPending = withContext(Dispatchers.IO) {
                pending.filter { entry ->
                    try {
                        when (entry.type) {
                            "session" -> {
                                val j = org.json.JSONObject(entry.payloadJson)
                                val req = com.dos.device.api.SessionLogRequest(
                                    session_id = j.getString("session_id"),
                                    planned_start = j.getString("planned_start"),
                                    planned_duration_min = j.getInt("planned_duration_min"),
                                    actual_start = if (j.isNull("actual_start")) null else j.getString("actual_start"),
                                    actual_end = if (j.isNull("actual_end")) null else j.getString("actual_end"),
                                    status = j.getString("status"),
                                    idempotency_key = j.getString("idempotency_key")
                                )
                                !api.postSessionLog(token, req).isSuccessful
                            }
                            "post" -> {
                                val j = org.json.JSONObject(entry.payloadJson)
                                val req = com.dos.device.api.PostLogRequest(
                                    account_id = j.getString("account_id"),
                                    planned_time_start = if (j.isNull("planned_time_start")) null else j.getString("planned_time_start"),
                                    planned_time_end = if (j.isNull("planned_time_end")) null else j.getString("planned_time_end"),
                                    actual_time = j.getString("actual_time"),
                                    status = j.getString("status"),
                                    idempotency_key = j.getString("idempotency_key")
                                )
                                !api.postPostLog(token, req).isSuccessful
                            }
                            else -> true
                        }
                    } catch (_: Exception) { true }
                }
            }
            logQueue.replacePending(stillPending)
            withContext(Dispatchers.Main) {
                Toast.makeText(this@MainActivity, if (stillPending.isEmpty()) "Sync done" else "Some logs failed; will retry later", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
