package com.dos.device.storage

import android.content.Context
import android.content.SharedPreferences

/**
 * Stores device token. V1: plain SharedPreferences.
 * For production, use EncryptedSharedPreferences or Android Keystore.
 */
class TokenStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var serverBaseUrl: String?
        get() = prefs.getString(KEY_BASE_URL, null)
        set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    fun clear() = prefs.edit().clear().apply()

    companion object {
        private const val PREFS_NAME = "dos_device"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_BASE_URL = "server_base_url"
    }
}
