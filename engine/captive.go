package engine

import (
	"net/http"
	"strings"
)

// HandleCaptivePortal handles OS-level captive portal checks so mobile phones
// stay firmly connected to the offline 5GHz hotspot in the street without dropping Wi-Fi.
func HandleCaptivePortal(w http.ResponseWriter, r *http.Request) bool {
	host := strings.ToLower(r.Host)
	path := strings.ToLower(r.URL.Path)

	// Android / Google connectivity checks
	if strings.Contains(host, "google.com") ||
		strings.Contains(host, "gstatic.com") ||
		strings.Contains(host, "gvt1.com") ||
		strings.Contains(host, "android.com") ||
		strings.Contains(host, "miui.com") ||
		strings.Contains(host, "hicloud.com") ||
		path == "/generate_204" ||
		path == "/gen_204" {
		w.WriteHeader(http.StatusNoContent) // HTTP 204
		return true
	}

	// Apple iOS / macOS connectivity checks
	if strings.Contains(host, "apple.com") ||
		strings.Contains(host, "airport.us") ||
		path == "/hotspot-detect.html" ||
		path == "/success.html" {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"))
		return true
	}

	// Microsoft Windows connectivity checks
	if strings.Contains(host, "msftncsi.com") ||
		strings.Contains(host, "msftconnecttest.com") ||
		path == "/ncsi.txt" {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Microsoft NCSI"))
		return true
	}

	if path == "/connecttest.txt" {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Microsoft Connect Test"))
		return true
	}

	return false
}
