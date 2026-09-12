package com.hypershare.app

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.widget.Toast

class WebAppInterface(private val activity: MainActivity) {

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun vibrate(milliseconds: Long) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(milliseconds)
        }
    }

    @JavascriptInterface
    fun pickFilesForSharing() {
        activity.openNativeFilePickerForSharing()
    }

    @JavascriptInterface
    fun startNative5GHzHotspot() {
        activity.runOnUiThread {
            activity.start5GHzHotspot()
        }
    }

    @JavascriptInterface
    fun stopNativeHotspot() {
        activity.runOnUiThread {
            activity.stopHotspot()
        }
    }

    @JavascriptInterface
    fun openHotspotSettings() {
        activity.runOnUiThread {
            try {
                val intent = android.content.Intent().apply {
                    setClassName("com.android.settings", "com.android.settings.TetherSettings")
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.startActivity(intent)
            } catch (e: Exception) {
                try {
                    val intent = android.content.Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS).apply {
                        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    activity.startActivity(intent)
                } catch (e2: Exception) {
                    Toast.makeText(activity, "تنظیمات هات‌اسپات باز نشد. لطفاً دستی وارد تنظیمات شوید.", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    @JavascriptInterface
    fun getWifiFrequency(): Int {
        val wifiManager = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
        return wifiManager?.connectionInfo?.frequency ?: 0
    }
}
