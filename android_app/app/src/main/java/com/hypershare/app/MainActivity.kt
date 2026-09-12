package com.hypershare.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingSpinner: ProgressBar
    private lateinit var hotspotManager: LocalOnlyHotspotManager

    // Register modern permission request callback
    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val nearbyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions[Manifest.permission.NEARBY_WIFI_DEVICES] == true
        } else true

        if (nearbyGranted) {
            startHyperShareService()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        loadingSpinner = findViewById(R.id.loadingSpinner)
        hotspotManager = LocalOnlyHotspotManager(this)

        checkAndRequestPermissions()
        setupWebView()
    }

    private fun checkAndRequestPermissions() {
        val permissionsToRequest = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissionsToRequest.isNotEmpty()) {
            requestPermissionsLauncher.launch(permissionsToRequest.toTypedArray())
        } else {
            startHyperShareService()
        }
    }

    private fun startHyperShareService() {
        val intent = Intent(this, HyperShareService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress >= 100) {
                    loadingSpinner.visibility = View.GONE
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                // If local engine is starting up, retry in 1 second
                view?.postDelayed({ view.reload() }, 1000)
            }
        }

        // Load HyperShare Web Portal
        webView.loadUrl("http://127.0.0.1:8080")
    }

    fun start5GHzHotspot() {
        hotspotManager.startHotspot(object : LocalOnlyHotspotManager.HotspotListener {
            override fun onHotspotStarted(ssid: String, passphrase: String?, is5GHz: Boolean) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "هات‌اسپات ۵ گیگاهرتز روشن شد: $ssid", Toast.LENGTH_LONG).show()
                    val js = "javascript:if(window.onHotspotStarted) window.onHotspotStarted('$ssid', '$passphrase', $is5GHz);"
                    webView.evaluateJavascript(js, null)
                }
            }

            override fun onHotspotFailed(reason: Int) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "خطا در ایجاد هات‌اسپات ($reason)", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onHotspotStopped() {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "هات‌اسپات متوقف شد", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    fun stopHotspot() {
        hotspotManager.stopHotspot()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        hotspotManager.stopHotspot()
    }
}
