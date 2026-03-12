package com.dos.device

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class DosApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createSessionChannel()
    }

    private fun createSessionChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                SESSION_CHANNEL_ID,
                "Session reminders",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alerts when it is time to start a scrolling session."
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    companion object {
        const val SESSION_CHANNEL_ID = "session_reminders"
    }
}

