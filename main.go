package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"hypershare/engine"
)

//go:embed web/*
var webFiles embed.FS

func main() {
	// Command Line Flags
	dirFlag := flag.String("dir", "./shared", "Directory of files to share")
	uploadFlag := flag.String("upload", "./received", "Directory where uploaded files are saved")
	portFlag := flag.Int("port", 8080, "HTTP server port")
	ssidFlag := flag.String("ssid", "HyperShare_5G", "Wi-Fi Hotspot SSID name")
	passFlag := flag.String("pass", "hyper1234", "Wi-Fi Hotspot password (min 8 chars)")
	flag.Parse()

	// Ensure directories exist
	absDir, err := filepath.Abs(*dirFlag)
	if err != nil {
		log.Fatalf("Invalid share directory: %v", err)
	}
	os.MkdirAll(absDir, 0755)

	absUpload, err := filepath.Abs(*uploadFlag)
	if err != nil {
		log.Fatalf("Invalid upload directory: %v", err)
	}
	os.MkdirAll(absUpload, 0755)

	// Automatically find an available port if preferred is busy
	actualPort, listener, err := findFreePort(*portFlag)
	if err != nil {
		fmt.Printf("❌ خطا در انتخاب پورت شبکه: %v\n", err)
		fmt.Println("کلید اینتر را بزنید...")
		bufio.NewReader(os.Stdin).ReadBytes('\n')
		return
	}
	defer listener.Close()

	// Detect Network and IPs
	netInfo, err := engine.GetNetworkInfo(actualPort)
	if err != nil {
		log.Printf("Warning: failed to detect network info: %v", err)
	}

	// Prepare Wi-Fi configuration string
	wifiConfig := engine.GenerateWifiConfigString(*ssidFlag, *passFlag)

	// Display Startup Banner
	fmt.Println("==================================================================")
	fmt.Println("⚡ HyperShare v2.0 - Ultra-Fast 5GHz Offline P2P Transfer Engine")
	fmt.Println("==================================================================")
	fmt.Printf("📁 Sharing Directory : %s\n", absDir)
	fmt.Printf("📥 Received Directory: %s\n", absUpload)
	fmt.Printf("🌐 Direct Web Link   : %s\n", netInfo.ReceiverURL)
	fmt.Printf("📶 5GHz Hotspot SSID : %s\n", *ssidFlag)
	fmt.Printf("🔑 Hotspot Password  : %s\n", *passFlag)
	fmt.Println("------------------------------------------------------------------")
	fmt.Println("📱 اسکن بارکد زیر با دوربین گوشی برای باز شدن مستقیم صفحه دریافت:")
	engine.PrintTerminalQR(netInfo.ReceiverURL)
	fmt.Println("==================================================================")

	// Setup Web Assets Sub-FS
	webSubFS, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatalf("Failed to load embedded web assets: %v", err)
	}
	fileServer := http.FileServer(http.FS(webSubFS))

	// Setup Router
	mux := http.NewServeMux()

	// API Endpoints
	mux.HandleFunc("/api/network", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"primary_ip":"%s","receiver_url":"%s","is_hotspot":%t}`,
			netInfo.PrimaryIP, netInfo.ReceiverURL, netInfo.IsHotspot)
	})

	mux.HandleFunc("/api/files", engine.HandleFilesList(absDir))
	mux.HandleFunc("/api/files/delete", engine.HandleFileDelete(absDir))

	// Desktop File Dialog API (Cross-Platform)
	mux.HandleFunc("/api/pick-pc-files", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodOptions {
			return
		}
		handlePickFilesPlatform(w, r, absDir)
	})

	// Desktop Open Folder API (Cross-Platform)
	mux.HandleFunc("/api/open-folder", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		folder := r.URL.Query().Get("type")
		target := absUpload
		if folder == "shared" {
			target = absDir
		}
		handleOpenFolderPlatform(target)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	})

	// Auto-discovery of sender on local network / hotspot gateway
	mux.HandleFunc("/api/find-sender", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		candidates := []string{
			"192.168.43.1:8080",  // Android default Wi-Fi Hotspot
			"192.168.137.1:8080", // Windows default Wi-Fi Hotspot
			"192.168.1.1:8080",
			"192.168.0.1:8080",
			"172.20.10.1:8080",  // iOS default Hotspot
		}

		client := http.Client{Timeout: 600 * time.Millisecond}
		for _, host := range candidates {
			testURL := fmt.Sprintf("http://%s/api/network", host)
			resp, err := client.Get(testURL)
			if err == nil && resp.StatusCode == 200 {
				resp.Body.Close()
				json.NewEncoder(w).Encode(map[string]interface{}{
					"found":      true,
					"sender_url": fmt.Sprintf("http://%s", host),
					"host":       host,
				})
				return
			}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"found": false})
	})

	mux.HandleFunc("/api/download/", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/download")
		engine.HandleFileDownload(absDir, true)(w, r)
	})
	mux.HandleFunc("/api/preview/", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/preview")
		engine.HandleFileDownload(absDir, false)(w, r)
	})
	mux.HandleFunc("/api/download-all", engine.HandleDownloadAll(absDir))
	mux.HandleFunc("/api/speedtest", engine.HandleSpeedTest)
	mux.HandleFunc("/api/stats", engine.HandleStats)
	mux.HandleFunc("/api/disconnect", engine.HandleDisconnect)
	mux.HandleFunc("/api/cancel-transfer", engine.HandleDisconnect)
	mux.HandleFunc("/api/clipboard", engine.HandleClipboardAPI)
	mux.HandleFunc("/api/upload", engine.HandleUpload(absUpload, absDir))

	// Dynamic QR Code Endpoints
	mux.HandleFunc("/api/qr/url", engine.HandleQRCodePNG(func() string {
		return netInfo.ReceiverURL
	}))
	mux.HandleFunc("/api/qr/wifi", engine.HandleQRCodePNG(func() string {
		return wifiConfig
	}))

	// Static Web Assets & Captive Portal Interceptor
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if engine.HandleCaptivePortal(w, r) {
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	targetURL := fmt.Sprintf("http://127.0.0.1:%d", actualPort)

	// Start HTTP Server in background
	server := &http.Server{Handler: mux}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("Server stopped: %v", err)
		}
	}()

	// Launch Native Desktop Window or Browser (Cross-Platform)
	launchPlatformWindow(targetURL, server)
}

func openURL(url string) {
	if runtime.GOOS == "windows" {
		chromePath := findChromePath()
		if chromePath != "" {
			cmd := exec.Command(chromePath, "--app="+url)
			if err := cmd.Start(); err == nil {
				return
			}
		}
		// Fallback to system default browser
		exec.Command("cmd", "/c", "start", "", url).Start()
	} else if runtime.GOOS == "darwin" {
		exec.Command("open", url).Start()
	} else {
		exec.Command("xdg-open", url).Start()
	}
}

func findChromePath() string {
	candidates := []string{
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		os.Getenv("LOCALAPPDATA") + `\Google\Chrome\Application\chrome.exe`,
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func findFreePort(preferred int) (int, net.Listener, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", preferred))
	if err == nil {
		return preferred, ln, nil
	}
	for p := 8081; p <= 8099; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", p))
		if err == nil {
			return p, ln, nil
		}
	}
	ln, err = net.Listen("tcp", "0.0.0.0:0")
	if err == nil {
		p := ln.Addr().(*net.TCPAddr).Port
		return p, ln, nil
	}
	return 0, nil, err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
