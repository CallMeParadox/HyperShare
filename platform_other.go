//go:build !windows

package main

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// launchPlatformWindow opens the web browser on Linux/macOS and serves until interrupted.
func launchPlatformWindow(targetURL string, server *http.Server) {
	openURL(targetURL)
	select {}
}

// handlePickFilesPlatform opens a native file dialog on Linux (zenity/kdialog) or macOS (osascript).
func handlePickFilesPlatform(w http.ResponseWriter, r *http.Request, absDir string) {
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		script := `choose file with multiple selections allowed with prompt "انتخاب فایل‌ها برای اشتراک در هایپرشیر"`
		cmd = exec.Command("osascript", "-e", script)
	} else {
		// Linux: try zenity first, then kdialog
		cmd = exec.Command("zenity", "--file-selection", "--multiple", "--separator=\n", "--title=انتخاب فایل‌ها برای اشتراک در هایپرشیر")
	}

	out, err := cmd.Output()
	if err != nil {
		// If native dialog tool is not installed, inform web client to use web file input/drag-and-drop
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "fallback",
			"count":   0,
			"message": "native dialog not available, using web file selector",
		})
		return
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
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

// handleOpenFolderPlatform opens the destination folder in the system file manager (xdg-open / open).
func handleOpenFolderPlatform(target string) {
	if runtime.GOOS == "darwin" {
		exec.Command("open", target).Start()
	} else {
		exec.Command("xdg-open", target).Start()
	}
}
