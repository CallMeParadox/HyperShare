package com.hypershare.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
    private lateinit var embeddedServer: EmbeddedServer

    private val mainHandler = Handler(Looper.getMainLooper())

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

        // 1. Start the embedded high-speed server locally on port 8080
        embeddedServer = EmbeddedServer(applicationContext, 8080)
        embeddedServer.start()

        // 2. Setup WebView and permissions
        setupWebView()
        checkAndRequestPermissions()

        // 3. Load UI from local embedded server (after 200ms warm-up)
        mainHandler.postDelayed({
            webView.loadUrl("http://127.0.0.1:8080")
        }, 200)
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
        settings.allowFileAccess = true
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
                // If local server is still starting up, retry in 500ms
                mainHandler.postDelayed({
                    view?.loadUrl("http://127.0.0.1:8080")
                }, 500)
            }
        }
    }

    fun start5GHzHotspot() {
        hotspotManager.startHotspot(object : LocalOnlyHotspotManager.HotspotListener {
            override fun onHotspotStarted(ssid: String, passphrase: String?, is5GHz: Boolean) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "هات‌اسپات فعال شد: $ssid", Toast.LENGTH_LONG).show()
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
        embeddedServer.stop()
        hotspotManager.stopHotspot()
    }
}
