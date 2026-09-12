package com.hypershare.app

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.io.*
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
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
    data class SharedItem(
        val id: String = UUID.randomUUID().toString(),
        val name: String,
        val size: Long,
        val humanSize: String,
        val category: String,
        val uri: Uri? = null,
        val file: File? = null
    )

    private var serverSocket: ServerSocket? = null
    private val threadPool = Executors.newCachedThreadPool()
    @Volatile private var isRunning = false

    // Thread-safe in-memory registry of shared files (zero copy)
    private val memorySharedItems = CopyOnWriteArrayList<SharedItem>()

    // Clipboard storage
    private val clipboardItems = CopyOnWriteArrayList<String>()

    fun addSharedItems(items: List<SharedItem>) {
        for (newItem in items) {
            memorySharedItems.removeAll { it.name == newItem.name }
            memorySharedItems.add(newItem)
        }
    }

    fun removeSharedItem(id: String?, name: String?) {
        if (!id.isNullOrEmpty()) {
            memorySharedItems.removeAll { it.id == id }
        }
        if (!name.isNullOrEmpty()) {
            memorySharedItems.removeAll { it.name == name }
            try {
                val f = File(getSharedDirectory(), name)
                if (f.exists()) f.delete()
            } catch (e: Exception) {}
        }
    }

    fun clearSharedItems() {
        memorySharedItems.clear()
        try {
            val files = getSharedDirectory().listFiles()
            files?.forEach { it.delete() }
        } catch (e: Exception) {}
    }

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

    private fun readAsciiLine(input: InputStream): String? {
        val baos = ByteArrayOutputStream()
        var prev = -1
        while (true) {
            val b = input.read()
            if (b == -1) {
                if (baos.size() == 0) return null
                break
            }
            if (prev == '\r'.code && b == '\n'.code) {
                val bytes = baos.toByteArray()
                return String(bytes, 0, bytes.size - 1, Charsets.US_ASCII)
            }
            baos.write(b)
            prev = b
        }
        return baos.toString("US-ASCII")
    }

    private fun handleClient(socket: Socket) {
        try {
            val input = socket.getInputStream()
            val requestLine = readAsciiLine(input) ?: return

            val parts = requestLine.split(" ")
            if (parts.size < 2) return

            val method = parts[0].uppercase()
            val fullPath = parts[1]
            val path = fullPath.split("?")[0]

            val headers = mutableMapOf<String, String>()
            var line: String? = readAsciiLine(input)
            while (!line.isNullOrEmpty()) {
                val colonIdx = line.indexOf(":")
                if (colonIdx > 0) {
                    val key = line.substring(0, colonIdx).trim().lowercase()
                    val value = line.substring(colonIdx + 1).trim()
                    headers[key] = value
                }
                line = readAsciiLine(input)
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

                path.startsWith("/api/preview/") -> {
                    val filename = java.net.URLDecoder.decode(path.removePrefix("/api/preview/"), "UTF-8")
                    serveFileDownload(filename, headers["range"], output)
                }

                path == "/api/files/delete" -> {
                    val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                    val bodyBytes = ByteArray(contentLength)
                    var readTotal = 0
                    while (readTotal < contentLength) {
                        val r = input.read(bodyBytes, readTotal, contentLength - readTotal)
                        if (r == -1) break
                        readTotal += r
                    }
                    val body = String(bodyBytes, Charsets.UTF_8)
                    if (body.contains("\"all\":true") || body.contains("\"all\": true")) {
                        clearSharedItems()
                    } else {
                        val idMatch = Regex("\"id\":\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1)
                        val nameMatch = Regex("\"name\":\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1)
                        removeSharedItem(idMatch, nameMatch)
                    }
                    sendResponse(output, 200, "OK", "application/json", """{"status":"ok"}""".toByteArray())
                }

                path.startsWith("/api/upload") -> {
                    handleUploadRequest(fullPath, headers, input, output)
                }

                path == "/api/speedtest" -> {
                    serveSpeedTest(output)
                }

                path == "/api/clipboard" -> {
                    if (method == "POST") {
                        val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                        val bodyBytes = ByteArray(contentLength)
                        var readTotal = 0
                        while (readTotal < contentLength) {
                            val r = input.read(bodyBytes, readTotal, contentLength - readTotal)
                            if (r == -1) break
                            readTotal += r
                        }
                        val text = String(bodyBytes, Charsets.UTF_8)
                        val contentMatch = Regex("\"content\":\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1) ?: text
                        clipboardItems.add(contentMatch)
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

    private fun handleUploadRequest(
        fullPath: String,
        headers: Map<String, String>,
        input: InputStream,
        output: OutputStream
    ) {
        val queryParams = fullPath.substringAfter("?", "")
        var queryFilename: String? = null
        for (param in queryParams.split("&")) {
            val kv = param.split("=")
            if (kv.size == 2 && kv[0] == "name") {
                queryFilename = java.net.URLDecoder.decode(kv[1], "UTF-8")
            }
        }

        val contentLength = headers["content-length"]?.toLongOrNull() ?: -1L
        val contentType = headers["content-type"] ?: ""
        val receivedDir = getReceivedDirectory()
        val uploadedNames = mutableListOf<String>()

        try {
            if (!queryFilename.isNullOrEmpty()) {
                val safeName = File(queryFilename).name
                val destFile = File(receivedDir, safeName)
                FileOutputStream(destFile).use { fos ->
                    val buffer = ByteArray(64 * 1024)
                    var remaining = contentLength
                    if (remaining > 0) {
                        while (remaining > 0) {
                            val toRead = if (remaining > buffer.size) buffer.size else remaining.toInt()
                            val r = input.read(buffer, 0, toRead)
                            if (r == -1) break
                            fos.write(buffer, 0, r)
                            remaining -= r
                        }
                    } else {
                        var r: Int
                        while (input.read(buffer).also { r = it } != -1) {
                            fos.write(buffer, 0, r)
                        }
                    }
                }
                uploadedNames.add(safeName)
            } else if (contentType.contains("multipart/form-data")) {
                parseMultipartUpload(input, contentType, contentLength, receivedDir, uploadedNames)
            }

            val resJson = """{"status":"success","count":${uploadedNames.size},"uploaded":${uploadedNames.joinToString(",", "[", "]") { quote(it) }}}"""
            sendResponse(output, 200, "OK", "application/json", resJson.toByteArray())
        } catch (e: Exception) {
            Log.e(TAG, "Upload failed: ${e.message}")
            val errJson = """{"status":"error","message":${quote(e.message ?: "Unknown upload error")}}"""
            sendResponse(output, 500, "Server Error", "application/json", errJson.toByteArray())
        }
    }

    private fun parseMultipartUpload(
        input: InputStream,
        contentType: String,
        contentLength: Long,
        receivedDir: File,
        uploadedNames: MutableList<String>
    ) {
        val boundaryMarker = contentType.substringAfter("boundary=").trim().removeSurrounding("\"")
        val boundary = "--$boundaryMarker"

        val bis = BufferedInputStream(input)
        var line: String?

        while (true) {
            line = readAsciiLine(bis) ?: break
            if (line.startsWith(boundary)) {
                if (line.endsWith("--")) break

                var partHeader = readAsciiLine(bis)
                var filename: String? = null
                while (!partHeader.isNullOrEmpty()) {
                    if (partHeader.lowercase().startsWith("content-disposition")) {
                        val match = Regex("filename=\"([^\"]+)\"").find(partHeader)
                        if (match != null) {
                            filename = match.groupValues[1]
                        }
                    }
                    partHeader = readAsciiLine(bis)
                }

                if (filename != null) {
                    val safeName = File(filename).name
                    val destFile = File(receivedDir, safeName)
                    FileOutputStream(destFile).use { fos ->
                        val bOut = ByteArrayOutputStream()
                        var prevByte = -1

                        while (true) {
                            val b = bis.read()
                            if (b == -1) break
                            if (prevByte == '\r'.code && b == '\n'.code) {
                                val currentBytes = bOut.toByteArray()
                                val lineStr = String(currentBytes, 0, currentBytes.size - 1, Charsets.US_ASCII)
                                if (lineStr.startsWith(boundary)) {
                                    break
                                } else {
                                    fos.write(currentBytes)
                                    bOut.reset()
                                }
                            } else {
                                bOut.write(b)
                            }
                            prevByte = b
                        }
                    }
                    uploadedNames.add(safeName)
                }
            }
        }
    }

    private fun serveFileDownload(filename: String, rangeHeader: String?, output: OutputStream) {
        val memoryItem = memorySharedItems.find { it.name == filename || it.id == filename }
        if (memoryItem != null) {
            serveItemDownload(memoryItem, rangeHeader, output)
            return
        }

        val file = File(getSharedDirectory(), filename)
        if (file.exists() && file.isFile) {
            servePhysicalFile(file, rangeHeader, output)
            return
        }

        val notFound = "File not found"
        sendResponse(output, 404, "Not Found", "text/plain", notFound.toByteArray())
    }

    private fun serveItemDownload(item: SharedItem, rangeHeader: String?, output: OutputStream) {
        val fileSize = item.size
        var pfd: ParcelFileDescriptor? = null
        val stream: InputStream

        try {
            if (item.uri != null) {
                pfd = context.contentResolver.openFileDescriptor(item.uri, "r")
                if (pfd == null) {
                    sendResponse(output, 404, "Not Found", "text/plain", "Cannot open stream".toByteArray())
                    return
                }
                stream = FileInputStream(pfd.fileDescriptor)
            } else if (item.file != null && item.file.exists()) {
                stream = FileInputStream(item.file)
            } else {
                sendResponse(output, 404, "Not Found", "text/plain", "Not Found".toByteArray())
                return
            }

            streamDataWithRange(stream, item.name, fileSize, rangeHeader, output)
        } finally {
            try { pfd?.close() } catch (e: Exception) {}
        }
    }

    private fun servePhysicalFile(file: File, rangeHeader: String?, output: OutputStream) {
        val stream = FileInputStream(file)
        streamDataWithRange(stream, file.name, file.length(), rangeHeader, output)
    }

    private fun streamDataWithRange(
        stream: InputStream,
        filename: String,
        fileSize: Long,
        rangeHeader: String?,
        output: OutputStream
    ) {
        try {
            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                val rangeVal = rangeHeader.removePrefix("bytes=").trim()
                val dashIdx = rangeVal.indexOf("-")
                val start = rangeVal.substring(0, dashIdx).toLongOrNull() ?: 0L
                val end = if (dashIdx < rangeVal.length - 1) {
                    rangeVal.substring(dashIdx + 1).toLongOrNull() ?: (fileSize - 1)
                } else {
                    fileSize - 1
                }

                val length = (end - start) + 1
                if (stream is FileInputStream) {
                    stream.channel.position(start)
                } else {
                    stream.skip(start)
                }

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
                val encodedName = java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
                val headerStr = "HTTP/1.1 200 OK\r\n" +
                        "Content-Type: application/octet-stream\r\n" +
                        "Content-Length: $fileSize\r\n" +
                        "Accept-Ranges: bytes\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Content-Disposition: attachment; filename=\"${filename}\"; filename*=UTF-8''$encodedName\r\n" +
                        "Connection: close\r\n\r\n"

                output.write(headerStr.toByteArray())

                val buffer = ByteArray(64 * 1024)
                var read: Int
                while (stream.read(buffer).also { read = it } != -1) {
                    output.write(buffer, 0, read)
                }
                output.flush()
            }
        } finally {
            try { stream.close() } catch (e: Exception) {}
        }
    }

    private fun listSharedFilesJson(): String {
        val result = mutableListOf<String>()

        for (item in memorySharedItems) {
            val encName = java.net.URLEncoder.encode(item.name, "UTF-8").replace("+", "%20")
            val dlUrl = "/api/download/$encName"
            val prevUrl = if (item.category in listOf("video", "image", "audio")) "/api/preview/$encName" else ""
            result.add("""{"id":${quote(item.id)},"name":${quote(item.name)},"size":${item.size},"human_size":"${item.humanSize}","category":"${item.category}","downloadURL":"$dlUrl","preview_url":${quote(prevUrl)}}""")
        }

        val dir = getSharedDirectory()
        val files = dir.listFiles() ?: emptyArray()
        for (f in files) {
            if (f.isFile && memorySharedItems.none { it.name == f.name }) {
                val size = f.length()
                val humanSize = formatBytes(size)
                val name = f.name
                val cat = getCategory(name)
                val encName = java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20")
                val dlUrl = "/api/download/$encName"
                val prevUrl = if (cat in listOf("video", "image", "audio")) "/api/preview/$encName" else ""
                result.add("""{"id":${quote(name)},"name":${quote(name)},"size":$size,"human_size":"$humanSize","category":"$cat","downloadURL":"$dlUrl","preview_url":${quote(prevUrl)}}""")
            }
        }

        return result.joinToString(",", "[", "]")
    }

    private fun getCategory(name: String): String {
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

    private fun getReceivedDirectory(): File {
        val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val hsDir = File(downloadDir, "HyperShare")
        if (!hsDir.exists()) {
            val ok = hsDir.mkdirs()
            if (ok) return hsDir
        } else {
            return hsDir
        }
        val fallback = File(context.getExternalFilesDir(null), "received")
        if (!fallback.exists()) fallback.mkdirs()
        return fallback
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
