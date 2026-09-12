package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
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

	// Detect Network and IPs
	netInfo, err := engine.GetNetworkInfo(*portFlag)
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

	// Windows PC File Dialog API
	mux.HandleFunc("/api/pick-pc-files", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodOptions {
			return
		}

		psScript := `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Multiselect = $true; $f.Title = 'انتخاب فایل‌ها برای اشتراک در هایپرشیر'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileNames | ForEach-Object { Write-Output $_ } }`
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psScript)
		out, err := cmd.Output()
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "count": 0, "message": err.Error()})
			return
		}

		lines := strings.Split(strings.TrimSpace(string(out)), "\r\n")
		count := 0
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			dest := filepath.Join(absDir, filepath.Base(line))
			if copyFile(line, dest) == nil {
				count++
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "count": count})
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
	mux.HandleFunc("/api/clipboard", engine.HandleClipboardAPI)
	mux.HandleFunc("/api/upload", engine.HandleUpload(absUpload))

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

	// Auto-launch browser on Windows PC
	go func() {
		time.Sleep(600 * time.Millisecond)
		openURL(fmt.Sprintf("http://localhost:%d", *portFlag))
	}()

	serverAddr := fmt.Sprintf("0.0.0.0:%d", *portFlag)
	log.Printf("HyperShare listening on %s (Opening browser)...", serverAddr)
	if err := http.ListenAndServe(serverAddr, mux); err != nil {
		log.Fatalf("HTTP server error: %v", err)
	}
}

func openURL(url string) {
	if runtime.GOOS == "windows" {
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	} else if runtime.GOOS == "darwin" {
		exec.Command("open", url).Start()
	} else {
		exec.Command("xdg-open", url).Start()
	}
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
