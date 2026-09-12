package engine

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FileItem represents a shareable file or directory.
type FileItem struct {
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	HumanSize   string    `json:"human_size"`
	Category    string    `json:"category"` // video, image, audio, app, document, archive, other
	MimeType    string    `json:"mime_type"`
	ModTime     time.Time `json:"mod_time"`
	DownloadURL string    `json:"download_url"`
	PreviewURL  string    `json:"preview_url,omitempty"`
}

// CategorizeFile determines file category for UI filtering.
func CategorizeFile(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v", ".wmv":
		return "video"
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".bmp":
		return "image"
	case ".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a":
		return "audio"
	case ".apk", ".xapk", ".apks", ".exe", ".msi", ".dmg":
		return "app"
	case ".pdf", ".docx", ".doc", ".xlsx", ".pptx", ".txt", ".epub":
		return "document"
	case ".zip", ".rar", ".7z", ".tar", ".gz":
		return "archive"
	default:
		return "other"
	}
}

// FormatBytes formats byte sizes into human readable strings.
func FormatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// ListFiles scans the shared folder and returns metadata.
func ListFiles(sharedDir string) ([]FileItem, error) {
	entries, err := os.ReadDir(sharedDir)
	if err != nil {
		return nil, err
	}

	var items []FileItem
	for _, entry := range entries {
		if entry.IsDir() {
			continue // Handle folders separately or recursively
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		name := entry.Name()
		cat := CategorizeFile(name)
		mimeType := mime.TypeByExtension(filepath.Ext(name))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		item := FileItem{
			Name:        name,
			Size:        info.Size(),
			HumanSize:   FormatBytes(info.Size()),
			Category:    cat,
			MimeType:    mimeType,
			ModTime:     info.ModTime(),
			DownloadURL: fmt.Sprintf("/api/download/%s", name),
		}

		if cat == "image" || cat == "video" || cat == "audio" {
			item.PreviewURL = fmt.Sprintf("/api/preview/%s", name)
		}

		items = append(items, item)
	}

	return items, nil
}

// HandleFilesList returns JSON metadata for all files in the shared directory.
func HandleFilesList(sharedDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		files, err := ListFiles(sharedDir)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(files)
	}
}

// HandleFileDownload serves a single file with RFC 7233 HTTP Range support.
// This allows 8+ parallel chunk streams from the receiver for 100+ MB/s speeds.
func HandleFileDownload(sharedDir string, isAttachment bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Range")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
		w.Header().Set("Accept-Ranges", "bytes")

		// Extract filename from URL path
		filename := filepath.Base(r.URL.Path)
		filePath := filepath.Join(sharedDir, filename)

		file, err := os.Open(filePath)
		if err != nil {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		defer file.Close()

		info, err := file.Stat()
		if err != nil {
			http.Error(w, "Cannot stat file", http.StatusInternalServerError)
			return
		}

		if isAttachment {
			w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		}

		// http.ServeContent handles all Range headers, 206 Partial Content,
		// and chunked streaming with high performance.
		http.ServeContent(w, r, filename, info.ModTime(), file)
	}
}

// HandleDownloadAll streams all files as a single zip archive on-the-fly
// without creating a temporary zip file on disk.
func HandleDownloadAll(sharedDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="HyperShare_All_Files.zip"`)

		zipWriter := zip.NewWriter(w)
		defer zipWriter.Close()

		files, err := os.ReadDir(sharedDir)
		if err != nil {
			http.Error(w, "Cannot read directory", http.StatusInternalServerError)
			return
		}

		buf := make([]byte, 2*1024*1024) // 2MB stream buffer

		for _, fileEntry := range files {
			if fileEntry.IsDir() {
				continue
			}

			filePath := filepath.Join(sharedDir, fileEntry.Name())
			file, err := os.Open(filePath)
			if err != nil {
				continue
			}

			info, err := file.Stat()
			if err != nil {
				file.Close()
				continue
			}

			header, err := zip.FileInfoHeader(info)
			if err != nil {
				file.Close()
				continue
			}

			// Store without re-compression for maximum streaming speed
			header.Method = zip.Store
			writer, err := zipWriter.CreateHeader(header)
			if err != nil {
				file.Close()
				continue
			}

			io.CopyBuffer(writer, file, buf)
			file.Close()
		}
	}
}

// HandleFileDelete deletes a specific file or clears all files from shared directory.
func HandleFileDelete(sharedDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		var payload struct {
			Name string `json:"name"`
			All  bool   `json:"all"`
		}
		json.NewDecoder(r.Body).Decode(&payload)

		if payload.All {
			entries, _ := os.ReadDir(sharedDir)
			for _, entry := range entries {
				os.Remove(filepath.Join(sharedDir, entry.Name()))
			}
		} else if payload.Name != "" {
			safeName := filepath.Base(payload.Name)
			os.Remove(filepath.Join(sharedDir, safeName))
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}
