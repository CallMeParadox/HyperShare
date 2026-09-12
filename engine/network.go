package engine

import (
	"fmt"
	"net"
	"strings"
)

// NetworkInfo contains detected IP addresses and hotspot status.
type NetworkInfo struct {
	PrimaryIP   string   `json:"primary_ip"`
	AllIPs      []string `json:"all_ips"`
	IsHotspot   bool     `json:"is_hotspot"`
	Port        int      `json:"port"`
	ReceiverURL string   `json:"receiver_url"`
}

// GetNetworkInfo detects active IPv4 addresses and identifies hotspot subnets.
func GetNetworkInfo(port int) (*NetworkInfo, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("failed to get network interfaces: %w", err)
	}

	var allIPs []string
	var preferredIP string
	var isHotspot bool

	for _, iface := range interfaces {
		// Skip down and loopback interfaces
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			// Check for IPv4 and not loopback
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}

			ipStr := ip.String()
			allIPs = append(allIPs, ipStr)

			// Standard Android / iOS hotspot IP subnets:
			// 192.168.43.x (Android standard SoftAP)
			// 192.168.49.x (Wi-Fi Direct P2P)
			// 172.20.10.x (iOS Personal Hotspot)
			if strings.HasPrefix(ipStr, "192.168.43.") ||
				strings.HasPrefix(ipStr, "192.168.49.") ||
				strings.HasPrefix(ipStr, "172.20.10.") {
				preferredIP = ipStr
				isHotspot = true
			} else if preferredIP == "" && !strings.HasPrefix(ipStr, "169.254.") {
				// Fallback to any valid private IP
				preferredIP = ipStr
			}
		}
	}

	if preferredIP == "" {
		if len(allIPs) > 0 {
			preferredIP = allIPs[0]
		} else {
			preferredIP = "127.0.0.1"
		}
	}

	url := fmt.Sprintf("http://%s:%d", preferredIP, port)

	return &NetworkInfo{
		PrimaryIP:   preferredIP,
		AllIPs:      allIPs,
		IsHotspot:   isHotspot,
		Port:        port,
		ReceiverURL: url,
	}, nil
}
