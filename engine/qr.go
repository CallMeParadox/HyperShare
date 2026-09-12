package engine

import (
	"fmt"
	"net/http"

	qrcode "github.com/skip2/go-qrcode"
)

// GenerateWifiConfigString creates the standard Wi-Fi configuration format
// recognizable by all iOS and Android camera apps.
func GenerateWifiConfigString(ssid, password string) string {
	if password == "" {
		return fmt.Sprintf("WIFI:T:nopass;S:%s;;", ssid)
	}
	return fmt.Sprintf("WIFI:T:WPA;S:%s;P:%s;;", ssid, password)
}

// PrintTerminalQR prints an ASCII QR code directly into the terminal.
func PrintTerminalQR(content string) {
	qr, err := qrcode.New(content, qrcode.Medium)
	if err != nil {
		fmt.Printf("Error creating terminal QR: %v\n", err)
		return
	}
	fmt.Println(qr.ToSmallString(false))
}

// HandleQRCodePNG returns an HTTP handler serving a PNG QR code image.
func HandleQRCodePNG(contentGetter func() string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content := contentGetter()
		png, err := qrcode.Encode(content, qrcode.Medium, 256)
		if err != nil {
			http.Error(w, "Failed to generate QR code", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(png)
	}
}
