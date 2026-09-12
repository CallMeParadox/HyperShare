package com.hypershare.app

import android.content.Context
import android.graphics.Bitmap
import android.net.wifi.WifiManager
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.io.*
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.regex.Pattern

/**
 * High-performance embedded HTTP server for Android.
 * Runs completely locally on the device (port 8080).
 * Serves bundled Web UI, handles RFC 7233 Range requests,
 * generates QR codes, and processes file transfers without external servers.
 */
class EmbeddedServer(
    private val context: Context,
    private val port: Int = 8080
) {
    private var serverSocket: ServerSocket? = null
    private val threadPool = Executors.newCachedThreadPool()
    @Volatile private var isRunning = false

    // Clipboard storage
    private val clipboardItems = CopyOnWriteArrayList<String>()

    fun start() {
        if (isRunning) return
        isRunning = true

        threadPool.execute {
            try {
                serverSocket = ServerSocket(port, 100, InetAddress.getByName("0.0.0.0"))
                Log.i(TAG, "HyperShare Embedded Server started on port $port")

                while (isRunning) {
                    val client = serverSocket?.accept() ?: break
                    threadPool.execute {
                        handleClient(client)
                    }
                }
            } catch (e: Exception) {
                if (isRunning) {
                    Log.e(TAG, "Server error: ${e.message}")
                }
            }
        }
    }

    fun stop() {
        isRunning = false
        try {
            serverSocket?.close()
            serverSocket = null
        } catch (e: Exception) {}
    }

    private fun handleClient(socket: Socket) {
        try {
            val input = socket.getInputStream()
            val reader = BufferedReader(InputStreamReader(input))
            val requestLine = reader.readLine() ?: return

            val parts = requestLine.split(" ")
            if (parts.size < 2) return

            val method = parts[0]
            val fullPath = parts[1]
            val path = fullPath.split("?")[0]

            val headers = mutableMapOf<String, String>()
            var line: String? = reader.readLine()
            while (!line.isNullOrEmpty()) {
                val colonIdx = line.indexOf(":")
                if (colonIdx > 0) {
                    val key = line.substring(0, colonIdx).trim().lowercase()
                    val value = line.substring(colonIdx + 1).trim()
                    headers[key] = value
                }
                line = reader.readLine()
            }

            val output = socket.getOutputStream()

            // Captive portal probes
            if (path == "/generate_204" || path == "/gen_204") {
                output.write("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".toByteArray())
                output.flush()
                return
            }

            if (path == "/hotspot-detect.html" || path == "/success.html") {
                val body = "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"
                sendResponse(output, 200, "OK", "text/html", body.toByteArray())
                return
            }

            // APIs
            when {
                path == "/api/network" -> {
                    val ip = getLocalIpAddress()
                    val json = """{"primary_ip":"$ip","receiver_url":"http://$ip:$port","is_hotspot":true}"""
                    sendResponse(output, 200, "OK", "application/json", json.toByteArray())
                }

                path == "/api/files" -> {
                    val filesJson = listSharedFilesJson()
                    sendResponse(output, 200, "OK", "application/json", filesJson.toByteArray())
                }

                path.startsWith("/api/download/") -> {
                    val filename = java.net.URLDecoder.decode(path.removePrefix("/api/download/"), "UTF-8")
                    serveFileDownload(filename, headers["range"], output)
                }

                path == "/api/speedtest" -> {
                    serveSpeedTest(output)
                }

                path == "/api/clipboard" -> {
                    if (method == "POST") {
                        val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                        val body = CharArray(contentLength)
                        reader.read(body, 0, contentLength)
                        val text = String(body)
                        clipboardItems.add(text)
                        sendResponse(output, 200, "OK", "application/json", """{"status":"ok"}""".toByteArray())
                    } else {
                        val itemsJson = clipboardItems.joinToString(",", "[", "]") {
                            """{"id":${System.currentTimeMillis()},"content":${quote(it)},"sender":"Mobile"}"""
                        }
                        sendResponse(output, 200, "OK", "application/json", itemsJson.toByteArray())
                    }
                }

                path == "/api/qr/url" || path == "/api/qr/wifi" -> {
                    val ip = getLocalIpAddress()
                    val content = if (path.contains("wifi")) {
                        "WIFI:T:WPA;S:HyperShare_5G;P:hyper1234;;"
                    } else {
                        "http://$ip:$port"
                    }
                    serveQrPng(content, output)
                }

                // Static Web Assets from app assets
                else -> {
                    serveAsset(path, output)
                }
            }
        } catch (e: Exception) {
            // Socket or connection error
        } finally {
            try { socket.close() } catch (e: Exception) {}
        }
    }

    private fun serveAsset(path: String, output: OutputStream) {
        val assetPath = when (path) {
            "/", "/index.html" -> "web/index.html"
            "/style.css" -> "web/style.css"
            "/app.js" -> "web/app.js"
            else -> "web" + (if (path.startsWith("/")) path else "/$path")
        }

        val contentType = when {
            assetPath.endsWith(".html") -> "text/html; charset=utf-8"
            assetPath.endsWith(".css") -> "text/css; charset=utf-8"
            assetPath.endsWith(".js") -> "application/javascript; charset=utf-8"
            assetPath.endsWith(".png") -> "image/png"
            assetPath.endsWith(".svg") -> "image/svg+xml"
            else -> "application/octet-stream"
        }

        try {
            context.assets.open(assetPath).use { input ->
                val bytes = input.readBytes()
                sendResponse(output, 200, "OK", contentType, bytes)
            }
        } catch (e: FileNotFoundException) {
            val notFound = "404 Not Found"
            sendResponse(output, 404, "Not Found", "text/plain", notFound.toByteArray())
        }
    }

    private fun serveFileDownload(filename: String, rangeHeader: String?, output: OutputStream) {
        val sharedDir = getSharedDirectory()
        val file = File(sharedDir, filename)

        if (!file.exists() || !file.isFile) {
            val notFound = "File not found"
            sendResponse(output, 404, "Not Found", "text/plain", notFound.toByteArray())
            return
        }

        val fileSize = file.length()
        val stream = FileInputStream(file)

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            // Handle RFC 7233 Range: bytes=start-end
            val rangeVal = rangeHeader.removePrefix("bytes=").trim()
            val dashIdx = rangeVal.indexOf("-")
            val start = rangeVal.substring(0, dashIdx).toLongOrNull() ?: 0L
            val end = if (dashIdx < rangeVal.length - 1) {
                rangeVal.substring(dashIdx + 1).toLongOrNull() ?: (fileSize - 1)
            } else {
                fileSize - 1
            }

            val length = (end - start) + 1
            stream.skip(start)

            val headerStr = "HTTP/1.1 206 Partial Content\r\n" +
                    "Content-Type: application/octet-stream\r\n" +
                    "Content-Length: $length\r\n" +
                    "Content-Range: bytes $start-$end/$fileSize\r\n" +
                    "Accept-Ranges: bytes\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Connection: close\r\n\r\n"

            output.write(headerStr.toByteArray())

            val buffer = ByteArray(64 * 1024)
            var remaining = length
            while (remaining > 0) {
                val toRead = if (remaining > buffer.size) buffer.size else remaining.toInt()
                val read = stream.read(buffer, 0, toRead)
                if (read == -1) break
                output.write(buffer, 0, read)
                remaining -= read
            }
            output.flush()
        } else {
            // Full file transfer
            val headerStr = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: application/octet-stream\r\n" +
                    "Content-Length: $fileSize\r\n" +
                    "Accept-Ranges: bytes\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Content-Disposition: attachment; filename=\"${file.name}\"\r\n" +
                    "Connection: close\r\n\r\n"

            output.write(headerStr.toByteArray())

            val buffer = ByteArray(64 * 1024)
            var read: Int
            while (stream.read(buffer).also { read = it } != -1) {
                output.write(buffer, 0, read)
            }
            output.flush()
        }
        stream.close()
    }

    private fun serveSpeedTest(output: OutputStream) {
        val totalBytes = 50 * 1024 * 1024L // 50MB benchmark
        val headerStr = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/octet-stream\r\n" +
                "Content-Length: $totalBytes\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: close\r\n\r\n"

        output.write(headerStr.toByteArray())

        val zeroChunk = ByteArray(64 * 1024)
        var written = 0L
        while (written < totalBytes) {
            output.write(zeroChunk)
            written += zeroChunk.size
        }
        output.flush()
    }

    private fun serveQrPng(content: String, output: OutputStream) {
        try {
            val writer = QRCodeWriter()
            val bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, 256, 256)
            val width = bitMatrix.width
            val height = bitMatrix.height
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)

            for (x in 0 until width) {
                for (y in 0 until height) {
                    bitmap.setPixel(x, y, if (bitMatrix.get(x, y)) -0x1000000 else -0x1)
                }
            }

            val baos = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos)
            val pngBytes = baos.toByteArray()

            sendResponse(output, 200, "OK", "image/png", pngBytes)
        } catch (e: Exception) {
            val err = "QR generation error"
            sendResponse(output, 500, "Error", "text/plain", err.toByteArray())
        }
    }

    private fun listSharedFilesJson(): String {
        val dir = getSharedDirectory()
        val files = dir.listFiles() ?: emptyArray()

        if (files.isEmpty()) {
            // Create a welcome file
            val welcome = File(dir, "Welcome_to_HyperShare.txt")
            if (!welcome.exists()) {
                welcome.writeText("🎉 به هایپرشیر خوش آمدید!\nاین فایل به‌صورت آفلاین و با سرعت فضایی ۵ گیگاهرتز منتقل شده است.")
            }
        }

        val allFiles = dir.listFiles() ?: emptyArray()
        val items = allFiles.filter { it.isFile }.map { f ->
            val size = f.length()
            val humanSize = formatBytes(size)
            val name = f.name
            val cat = when {
                name.endsWith(".mp4", true) || name.endsWith(".mkv", true) -> "video"
                name.endsWith(".jpg", true) || name.endsWith(".png", true) -> "image"
                name.endsWith(".mp3", true) -> "audio"
                name.endsWith(".apk", true) -> "app"
                else -> "document"
            }
            """{"name":${quote(name)},"size":$size,"human_size":"$humanSize","category":"$cat","downloadURL":"/api/download/${java.net.URLEncoder.encode(name, "UTF-8")}"}"""
        }

        return items.joinToString(",", "[", "]")
    }

    private fun getSharedDirectory(): File {
        val dir = File(context.getExternalFilesDir(null), "shared")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun sendResponse(output: OutputStream, code: Int, status: String, contentType: String, body: ByteArray) {
        val header = "HTTP/1.1 $code $status\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: close\r\n\r\n"
        output.write(header.toByteArray())
        output.write(body)
        output.flush()
    }

    private fun getLocalIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        val host = addr.hostAddress ?: ""
                        if (host.startsWith("192.168.43.") || host.startsWith("192.168.49.") || host.startsWith("172.")) {
                            return host
                        }
                    }
                }
            }

            // Fallback to standard wlan0
            val interfaces2 = NetworkInterface.getNetworkInterfaces()
            while (interfaces2.hasMoreElements()) {
                val iface = interfaces2.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        return addr.hostAddress ?: "127.0.0.1"
                    }
                }
            }
        } catch (e: Exception) {}
        return "127.0.0.1"
    }

    private fun formatBytes(bytes: Long): String {
        val kb = bytes / 1024.0
        val mb = kb / 1024.0
        val gb = mb / 1024.0
        return when {
            gb >= 1 -> String.format("%.1f GB", gb)
            mb >= 1 -> String.format("%.1f MB", mb)
            kb >= 1 -> String.format("%.1f KB", kb)
            else -> "$bytes B"
        }
    }

    private fun quote(string: String): String {
        return "\"" + string.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r") + "\""
    }

    companion object {
        private const val TAG = "HyperShare::Server"
    }
}
