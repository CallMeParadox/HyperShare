package com.hypershare.app

/**
 * Helper to build standard Wi-Fi barcode strings recognized automatically
 * by native camera apps on Android and iOS.
 */
object HotspotQrHelper {

    /**
     * Format: WIFI:T:WPA;S:MySSID;P:MyPassword;H:false;;
     */
    fun buildWifiBarcodeString(ssid: String, password: String?): String {
        return if (password.isNullOrEmpty()) {
            "WIFI:T:nopass;S:$ssid;H:false;;"
        } else {
            "WIFI:T:WPA;S:$ssid;P:$password;H:false;;"
        }
    }

    /**
     * Builds the direct web portal receiver URL (e.g. http://192.168.43.1:8080)
     */
    fun buildWebPortalUrl(ipAddress: String, port: Int = 8080): String {
        return "http://$ipAddress:$port"
    }
}
