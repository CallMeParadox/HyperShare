//go:build windows

package main

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/jchv/go-webview2"
)

// launchPlatformWindow runs a standalone native WebView2 window on Windows.
func launchPlatformWindow(targetURL string, server *http.Server) {
	opts := webview2.WebViewOptions{
		Debug: false,
		WindowOptions: webview2.WindowOptions{
			Title:  "⚡ HyperShare PC - انتقال پرسرعت بی‌سیم (آفلاین)",
			Width:  1060,
			Height: 740,
			Center: true,
		},
	}
	w := webview2.NewWithOptions(opts)
	if w != nil {
		defer w.Destroy()
		w.Navigate(targetURL)
		w.Run()
		// Clean exit when desktop window is closed
		server.Close()
		return
	}

	// Fallback to browser if WebView2 runtime is not available
	openURL(targetURL)
	select {}
}

// handlePickFilesPlatform opens the native Windows file picker dialog.
func handlePickFilesPlatform(w http.ResponseWriter, r *http.Request, absDir string) {
	psScript := `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Multiselect = $true; $f.Title = 'انتخاب فایل‌ها برای اشتراک در هایپرشیر'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileNames | ForEach-Object { [Console]::WriteLine($_) } }`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command", psScript)
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
}

// handleOpenFolderPlatform opens the destination directory in Windows Explorer.
func handleOpenFolderPlatform(target string) {
	exec.Command("explorer.exe", target).Start()
}
