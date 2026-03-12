package com.dos.device

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
    private var serverBaseUrl: String = "http://16.112.55.75/"

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
            val url = if (baseUrl.isNotBlank()) baseUrl else "http://16.112.55.75/"
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
        // Schedule local alarms for each upcoming session
        scheduleSessionAlarms(p)

        p.sessions.sortedBy { it.sort_order }.forEach { s ->
            val timeRange = formatSessionTimeRange(s.planned_start, s.planned_duration_min)
            val row = layoutInflater.inflate(android.R.layout.simple_list_item_2, sessionsContainer, false)
            (row.findViewById(android.R.id.text1) as TextView).text = "$timeRange (${s.planned_duration_min} min)"
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

            val startBtn = Button(this).apply {
                text = "Start"
                setOnClickListener { markSessionStart(s.id, s.planned_start, s.planned_duration_min) }
            }
            val endBtn = Button(this).apply {
                text = "End"
                setOnClickListener { markSessionEnd(s) }
            }
            sessionsContainer.addView(row)
            sessionsContainer.addView(startBtn)
            sessionsContainer.addView(endBtn)
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
        val idempotencyKey = "session-start-${sessionId}-${System.currentTimeMillis()}"
        val entry = LogQueue.SessionLogEntry(
            session_id = sessionId,
            planned_start = plannedStart,
            planned_duration_min = durationMin,
            actual_start = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date()),
            actual_end = null,
            status = "started",
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

    private fun markSessionEnd(session: com.dos.device.api.models.PlanSession) {
        val idempotencyKey = "session-end-${session.id}-${System.currentTimeMillis()}"
        val now = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date())
        val entry = LogQueue.SessionLogEntry(
            session_id = session.id,
            planned_start = session.planned_start,
            planned_duration_min = session.planned_duration_min,
            actual_start = null,
            actual_end = now,
            status = "completed",
            idempotency_key = idempotencyKey
        )
        logQueue.enqueueSession(entry)
        Toast.makeText(this, "Session end logged (pending sync)", Toast.LENGTH_SHORT).show()
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

    private fun scheduleSessionAlarms(p: TodayPlanResponse) {
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        val sdf = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US)

        p.sessions.forEach { s ->
            try {
                val timePart = if (s.planned_start.length >= 5) s.planned_start.takeLast(5) else s.planned_start
                val cal = java.util.Calendar.getInstance().apply {
                    timeInMillis = now
                    val parsed = sdf.parse(timePart)
                    if (parsed != null) {
                        val hhmm = java.util.Calendar.getInstance().apply { time = parsed }
                        set(java.util.Calendar.HOUR_OF_DAY, hhmm.get(java.util.Calendar.HOUR_OF_DAY))
                        set(java.util.Calendar.MINUTE, hhmm.get(java.util.Calendar.MINUTE))
                        set(java.util.Calendar.SECOND, 0)
                        set(java.util.Calendar.MILLISECOND, 0)
                    }
                    // If this time has already passed today, skip scheduling.
                    if (timeInMillis <= now) return@forEach
                }

                val intent = Intent(this, SessionAlarmReceiver::class.java).apply {
                    putExtra("title", "${p.persona_name} · ${p.daily_mode}")
                    putExtra("text", "Session at ${s.planned_start} starting now")
                    putExtra("session_id", s.id)
                }
                val requestCode = s.id.hashCode()
                val pending = PendingIntent.getBroadcast(
                    this,
                    requestCode,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pending)
            } catch (_: Exception) {
                // ignore bad time formats
            }
        }
    }

    private fun formatSessionTimeRange(start: String, durationMin: Int): String {
        return try {
            // Expecting times like "18:32" or full ISO, so take the last 5 chars as HH:mm
            val timePart = if (start.length >= 5) start.takeLast(5) else start
            val sdf = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US)
            val date = sdf.parse(timePart) ?: return start
            val cal = java.util.Calendar.getInstance().apply {
                time = date
                add(java.util.Calendar.MINUTE, durationMin)
            }
            val end = sdf.format(cal.time)
            "$timePart–$end"
        } catch (_: Exception) {
            start
        }
    }
}
