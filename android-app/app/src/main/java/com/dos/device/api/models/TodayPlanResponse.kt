package com.dos.device.api.models

data class TodayPlanResponse(
    val plan_id: String,
    val plan_date: String,
    val persona_name: String,
    val active_window: ActiveWindow,
    val daily_mode: String,
    val session_count: Int,
    val sessions: List<PlanSession>,
    val posting_tasks: List<PostingTask>,
    val server_time_iso: String
)

data class PlanSession(
    val id: String,
    val planned_start: String,
    val planned_duration_min: Int,
    val sort_order: Int,
    val dominant_accounts: List<FocusAccount> = emptyList(),
    val secondary_accounts: List<FocusAccount> = emptyList()
)

data class FocusAccount(
    val account_id: String,
    val account_display_name: String
)

data class PostingTask(
    val id: String,
    val account_id: String,
    val account_display_name: String,
    val planned_time_window_start: String,
    val planned_time_window_end: String,
    val variance_min: Int,
    val variance_max: Int
)
