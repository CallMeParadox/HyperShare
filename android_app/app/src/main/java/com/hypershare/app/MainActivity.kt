package com.hypershare.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Log
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import android.app.DownloadManager
import android.net.wifi.WifiManager
import android.os.Environment
import android.os.PowerManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingSpinner: ProgressBar
    private lateinit var hotspotManager: LocalOnlyHotspotManager
    private lateinit var embeddedServer: EmbeddedServer
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val backgroundExecutor = Executors.newSingleThreadExecutor()

    // File chooser callback for <input type="file"> inside WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Launcher for standard WebView file chooser
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val intent = result.data
            val uris = mutableListOf<Uri>()
            intent?.data?.let { uris.add(it) }
            intent?.clipData?.let { clip ->
                for (i in 0 until clip.itemCount) {
                    uris.add(clip.getItemAt(i).uri)
                }
            }
            filePathCallback?.onReceiveValue(uris.toTypedArray())
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    // Launcher for adding files to the shared folder
    private val pickFilesLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val intent = result.data
            val uris = mutableListOf<Uri>()
            intent?.data?.let { uris.add(it) }
            intent?.clipData?.let { clip ->
                for (i in 0 until clip.itemCount) {
                    uris.add(clip.getItemAt(i).uri)
                }
            }

            if (uris.isNotEmpty()) {
                registerUrisForSharing(uris)
            }
        }
    }

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

        // Ultra-high-performance Wi-Fi Lock and WakeLock to prevent 802.11 power saving throttling
        try {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HyperShare::MainWakeLock")
            wakeLock?.acquire(4 * 60 * 60 * 1000L) // 4 hours max

            val wifiManager = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            wifiLock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "HyperShare::MainWifiLock")
            } else {
                wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "HyperShare::MainWifiLock")
            }
            wifiLock?.acquire()
        } catch (e: Exception) {
            Log.w("HyperShare", "Could not acquire WifiLock: ${e.message}")
        }

        // 1. Start the embedded server (Shared Singleton)
        embeddedServer = EmbeddedServer.getInstance(applicationContext, 8080)
        embeddedServer.start()

        // 2. Setup WebView and permissions
        setupWebView()
        checkAndRequestPermissions()

        // 3. Handle incoming shared files from other apps
        handleSendIntent(intent)

        // 4. Load UI from local server
        mainHandler.postDelayed({
            webView.loadUrl("http://127.0.0.1:8080")
        }, 200)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handleSendIntent(intent)
    }

    private fun checkAndRequestPermissions() {
        val permissionsToRequest = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CAMERA)
        }

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

            // Camera and microphone permission for Web QR scanner
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }

            // CRITICAL FIX: Enables HTML <input type="file"> to open Android file selector!
            override fun onShowFileChooser(
                mWebView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback = filePathCallback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                fileChooserLauncher.launch(Intent.createChooser(intent, "انتخاب فایل‌ها"))
                return true
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                if (url == null || (!url.startsWith("http://") && !url.startsWith("https://"))) {
                    return@setDownloadListener
                }
                val request = DownloadManager.Request(Uri.parse(url))
                val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
                request.setMimeType(mimetype)
                request.addRequestHeader("User-Agent", userAgent)
                request.setDescription("HyperShare Transfer")
                request.setTitle(filename)
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                try {
                    val hsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "HyperShare")
                    if (!hsDir.exists()) hsDir.mkdirs()
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "HyperShare/$filename")
                } catch (e: Exception) {
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                }

                val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "شروع دانلود: $filename در پوشه Downloads", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "خطا در دانلود فایل: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                mainHandler.postDelayed({
                    view?.loadUrl("http://127.0.0.1:8080")
                }, 500)
            }
        }
    }

    private fun handleSendIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val type = intent.type
        val uris = mutableListOf<Uri>()

        if (Intent.ACTION_SEND == action && type != null) {
            (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let {
                uris.add(it)
            }
        } else if (Intent.ACTION_SEND_MULTIPLE == action && type != null) {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { list ->
                uris.addAll(list)
            }
        }

        if (uris.isNotEmpty()) {
            registerUrisForSharing(uris)
        }
    }

    fun openNativeFilePickerForSharing() {
        runOnUiThread {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            pickFilesLauncher.launch(Intent.createChooser(intent, "انتخاب فایل‌ها برای ارسال"))
        }
    }

    private fun registerUrisForSharing(uris: List<Uri>) {
        backgroundExecutor.execute {
            val items = mutableListOf<EmbeddedServer.SharedItem>()
            for (uri in uris) {
                try {
                    val (name, size) = getFileInfo(uri)
                    val cat = getFileCategory(name)
                    val humanSize = embeddedServer.formatBytes(size)

                    try {
                        contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    } catch (e: Exception) {}

                    items.add(
                        EmbeddedServer.SharedItem(
                            name = name,
                            size = size,
                            humanSize = humanSize,
                            category = cat,
                            uri = uri
                        )
                    )
                } catch (e: Exception) {
                    Log.e("HyperShare", "Error processing uri: ${e.message}")
                }
            }

            embeddedServer.addSharedItems(items)

            mainHandler.post {
                Toast.makeText(this, "${items.size} فایل به لیست اضافه شد", Toast.LENGTH_SHORT).show()
                webView.evaluateJavascript("if(window.loadFiles) window.loadFiles();", null)
            }
        }
    }

    private fun getFileInfo(uri: Uri): Pair<String, Long> {
        var name: String? = null
        var size: Long = 0L
        if (uri.scheme == "content") {
            val cursor = contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIdx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx != -1) name = it.getString(nameIdx)
                    val sizeIdx = it.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx != -1) size = it.getLong(sizeIdx)
                }
            }
        }
        if (name == null) {
            name = uri.path?.let { p ->
                val cut = p.lastIndexOf('/')
                if (cut != -1) p.substring(cut + 1) else p
            } ?: "file_${System.currentTimeMillis()}"
        }
        return Pair(name!!, size)
    }

    private fun getFileCategory(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".mp4") || lower.endsWith(".mkv") || lower.endsWith(".mov") || lower.endsWith(".avi") || lower.endsWith(".webm") || lower.endsWith(".3gp") -> "video"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp") || lower.endsWith(".gif") || lower.endsWith(".svg") -> "image"
            lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".wav") || lower.endsWith(".ogg") || lower.endsWith(".flac") || lower.endsWith(".aac") -> "audio"
            lower.endsWith(".apk") || lower.endsWith(".aab") || lower.endsWith(".xapk") -> "app"
            lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z") || lower.endsWith(".tar") || lower.endsWith(".gz") -> "archive"
            else -> "document"
        }
    }

    fun start5GHzHotspot() {
        hotspotManager.startHotspot(object : LocalOnlyHotspotManager.HotspotListener {
            override fun onHotspotStarted(ssid: String, passphrase: String?, is5GHz: Boolean) {
                embeddedServer.activeWifiConfig = "WIFI:T:WPA;S:$ssid;P:${passphrase ?: ""};;"
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
        try {
            wifiLock?.let { if (it.isHeld) it.release() }
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {}
        if (isFinishing) {
            hotspotManager.stopHotspot()
        }
    }
}
