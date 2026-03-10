package com.dos.device.api.models

data class EnrollResponse(
    val device_id: String,
    val device_name: String,
    val persona_id: String,
    val persona_name: String,
    val active_window: ActiveWindow,
    val server_time_iso: String
)

data class ActiveWindow(val start: String, val end: String)
