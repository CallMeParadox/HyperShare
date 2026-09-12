package engine

import (
	"fmt"
	"net/http"
	"strconv"
)

// Pre-allocated reusable 1MB zero chunk for zero-alloc high-speed streaming
var zeroChunk = make([]byte, 1024*1024)

// HandleSpeedTest generates synthetic high-speed data stream in memory.
// Allows users to test the pure wireless 5GHz link speed (up to 150+ MB/s)
// without being limited by slow flash storage or SD cards.
func HandleSpeedTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Content-Type", "application/octet-stream")

	// Default to 100 MB test stream
	sizeMB := 100
	if s := r.URL.Query().Get("size_mb"); s != "" {
		if val, err := strconv.Atoi(s); err == nil && val > 0 && val <= 1000 {
			sizeMB = val
		}
	}

	totalBytes := int64(sizeMB) * 1024 * 1024
	w.Header().Set("Content-Length", strconv.FormatInt(totalBytes, 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="benchmark_%dmb.bin"`, sizeMB))

	flusher, ok := w.(http.Flusher)

	var written int64
	for written < totalBytes {
		remaining := totalBytes - written
		toWrite := int64(len(zeroChunk))
		if remaining < toWrite {
			toWrite = remaining
		}

		n, err := w.Write(zeroChunk[:toWrite])
		if err != nil {
			return
		}
		written += int64(n)

		if ok && written%(16*1024*1024) == 0 {
			flusher.Flush()
		}
	}
}
