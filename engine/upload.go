package engine

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// HandleUpload handles bidirectional file uploads from web client or receiver app.
func HandleUpload(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Ensure target directory exists
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create upload dir: %v", err), http.StatusInternalServerError)
			return
		}

		// Parse multipart form (up to 64MB in RAM, rest to disk temp files)
		reader, err := r.MultipartReader()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to read multipart: %v", err), http.StatusBadRequest)
			return
		}

		var uploadedFiles []string

		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				http.Error(w, fmt.Sprintf("Error reading part: %v", err), http.StatusBadRequest)
				return
			}

			filename := part.FileName()
			if filename == "" {
				continue
			}

			// Sanitize filename to prevent path traversal
			filename = filepath.Base(filename)
			destPath := filepath.Join(uploadDir, filename)

			destFile, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to open file for write: %v", err), http.StatusInternalServerError)
				return
			}

			// Use 4MB buffer for maximum disk write speed
			buf := make([]byte, 4*1024*1024)
			_, copyErr := io.CopyBuffer(destFile, part, buf)
			destFile.Close()

			if copyErr != nil {
				http.Error(w, fmt.Sprintf("Failed to save file: %v", copyErr), http.StatusInternalServerError)
				return
			}

			uploadedFiles = append(uploadedFiles, filename)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":   "success",
			"uploaded": uploadedFiles,
			"count":    len(uploadedFiles),
		})
	}
}
