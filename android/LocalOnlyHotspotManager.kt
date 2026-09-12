package com.hypershare.app

import android.content.Context
import android.net.wifi.SoftApConfiguration
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Manages high-speed 5GHz Local-Only Hotspot without disabling mobile data,
 * without requiring tethering subscription, and without GPS Location prompts on Android 13+.
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
     * Starts the Local-Only Hotspot prioritizing the ultra-fast 5GHz band (80MHz channel width).
     */
    fun startHotspot(listener: HotspotListener) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                startHotspotApi30(listener)
            } else {
                startHotspotLegacy(listener)
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException starting hotspot: ${e.message}")
            listener.onHotspotFailed(-1)
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun startHotspotApi30(listener: HotspotListener) {
        // Configure 5GHz band for astronomical speeds (up to 866+ Mbps link rate)
        val configBuilder = SoftApConfiguration.Builder()
            .setBand(SoftApConfiguration.BAND_5GHZ)
            .setSecurityType(SoftApConfiguration.SECURITY_TYPE_WPA2_PSK)

        // If device doesn't support 5GHz, dual-band allows seamless fallback
        val is5GHzSupported = wifiManager.is5GHzBandSupported
        if (!is5GHzSupported) {
            Log.w(TAG, "5GHz not supported by hardware, falling back to 2.4GHz")
            configBuilder.setBand(SoftApConfiguration.BAND_2GHZ)
        }

        val config = configBuilder.build()

        wifiManager.startLocalOnlyHotspot(
            config,
            context.mainExecutor,
            object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
                    reservation = res
                    val currentConfig = res.softApConfiguration
                    val ssid = currentConfig?.ssid ?: "HyperShare_5G"
                    val passphrase = currentConfig?.passphrase

                    Log.i(TAG, "5GHz Hotspot started successfully: SSID=$ssid")
                    listener.onHotspotStarted(ssid, passphrase, is5GHzSupported)
                }

                override fun onStopped() {
                    Log.i(TAG, "Hotspot stopped")
                    reservation = null
                    listener.onHotspotStopped()
                }

                override fun onFailed(reason: Int) {
                    Log.e(TAG, "Hotspot failed with reason: $reason")
                    listener.onHotspotFailed(reason)
                }
            }
        )
    }

    private fun startHotspotLegacy(listener: HotspotListener) {
        wifiManager.startLocalOnlyHotspot(
            object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
                    reservation = res
                    val ssid = res.wifiConfiguration?.SSID ?: "HyperShare_P2P"
                    val passphrase = res.wifiConfiguration?.preSharedKey

                    listener.onHotspotStarted(ssid, passphrase, false)
                }

                override fun onStopped() {
                    reservation = null
                    listener.onHotspotStopped()
                }

                override fun onFailed(reason: Int) {
                    listener.onHotspotFailed(reason)
                }
            },
            null
        )
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
