package com.hypershare.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Manages high-speed Local-Only Hotspot using Android's standard public API.
 * Operates without requiring root, tethering subscription, or GPS Location prompts on Android 13+.
 */
class LocalOnlyHotspotManager(private val context: Context) {

    private val wifiManager: WifiManager = 
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    private var reservation: WifiManager.LocalOnlyHotspotReservation? = null

    interface HotspotListener {
        fun onHotspotStarted(ssid: String, passphrase: String?, is5GHz: Boolean)
        fun onHotspotFailed(reason: Int)
        fun onHotspotStopped()
    }

    /**
     * Starts the Local-Only Hotspot using Android's public API.
     */
    fun startHotspot(listener: HotspotListener) {
        try {
            val is5GHzSupported = wifiManager.is5GHzBandSupported

            wifiManager.startLocalOnlyHotspot(
                object : WifiManager.LocalOnlyHotspotCallback() {
                    override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
                        reservation = res
                        
                        @Suppress("DEPRECATION")
                        val config = res.wifiConfiguration
                        val ssid = config?.SSID ?: "HyperShare_P2P"
                        val passphrase = config?.preSharedKey

                        Log.i(TAG, "Local Hotspot started successfully: SSID=$ssid, 5GHz=$is5GHzSupported")
                        listener.onHotspotStarted(ssid, passphrase, is5GHzSupported)
                    }

                    override fun onStopped() {
                        Log.i(TAG, "Local Hotspot stopped")
                        reservation = null
                        listener.onHotspotStopped()
                    }

                    override fun onFailed(reason: Int) {
                        Log.e(TAG, "Local Hotspot failed with reason: $reason")
                        listener.onHotspotFailed(reason)
                    }
                },
                Handler(Looper.getMainLooper())
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException starting hotspot: ${e.message}")
            listener.onHotspotFailed(-1)
        }
    }

    /**
     * Shuts down the hotspot and releases radio hardware.
     */
    fun stopHotspot() {
        reservation?.close()
        reservation = null
    }

    companion object {
        private const val TAG = "LocalOnlyHotspotManager"
    }
}
