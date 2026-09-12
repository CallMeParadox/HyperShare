package engine

import (
	"encoding/json"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// TransferStats represents the live status and speed of an ongoing transfer.
type TransferStats struct {
	IsActive         bool    `json:"is_active"`
	Direction        string  `json:"direction"` // "sending" or "receiving"
	Filename         string  `json:"filename"`
	TotalBytes       int64   `json:"total_bytes"`
	TransferredBytes int64   `json:"transferred_bytes"`
	SpeedMBps        float64 `json:"speed_mbps"`
	Percent          int     `json:"percent"`
}

// TransferTracker monitors active transfer throughput with moving averages.
type TransferTracker struct {
	mu               sync.Mutex
	activeCount      int32
	direction        string
	filename         string
	totalBytes       int64
	transferredBytes int64
	lastSpeedMBps    float64
	lastSampleTime   time.Time
	lastSampleBytes  int64
	lastActivityTime time.Time
}

var GlobalTracker = &TransferTracker{}

func (t *TransferTracker) StartTransfer(filename, direction string, totalBytes int64) {
	t.mu.Lock()
	defer t.mu.Unlock()

	atomic.AddInt32(&t.activeCount, 1)
	t.filename = filename
	t.direction = direction
	t.totalBytes = totalBytes
	t.transferredBytes = 0
	t.lastSpeedMBps = 0.0
	now := time.Now()
	t.lastSampleTime = now
	t.lastSampleBytes = 0
	t.lastActivityTime = now
}

func (t *TransferTracker) UpdateProgress(n int64) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.transferredBytes += n
	now := time.Now()
	t.lastActivityTime = now
	elapsed := now.Sub(t.lastSampleTime).Seconds()
	if elapsed >= 0.35 {
		diffBytes := t.transferredBytes - t.lastSampleBytes
		if elapsed > 0 {
			currentSpeed := (float64(diffBytes) / (1024.0 * 1024.0)) / elapsed
			if t.lastSpeedMBps > 0 {
				t.lastSpeedMBps = (t.lastSpeedMBps * 0.35) + (currentSpeed * 0.65)
			} else {
				t.lastSpeedMBps = currentSpeed
			}
		}
		t.lastSampleTime = now
		t.lastSampleBytes = t.transferredBytes
	}
}

func (t *TransferTracker) EndTransfer() {
	t.mu.Lock()
	defer t.mu.Unlock()

	if atomic.LoadInt32(&t.activeCount) > 0 {
		atomic.AddInt32(&t.activeCount, -1)
	}
	t.lastActivityTime = time.Now()
}

func (t *TransferTracker) GetStats() TransferStats {
	t.mu.Lock()
	defer t.mu.Unlock()

	running := atomic.LoadInt32(&t.activeCount) > 0
	now := time.Now()
	recent := running || (now.Sub(t.lastActivityTime) < 2200*time.Millisecond && t.transferredBytes > 0)

	percent := 0
	if t.totalBytes > 0 {
		percent = int((float64(t.transferredBytes) / float64(t.totalBytes)) * 100)
		if percent > 100 {
			percent = 100
		}
	} else if !running && recent {
		percent = 100
	}

	speed := 0.0
	if running {
		speed = math.Round(t.lastSpeedMBps*10.0) / 10.0
	}

	if !recent {
		return TransferStats{}
	}

	return TransferStats{
		IsActive:         recent,
		Direction:        t.direction,
		Filename:         t.filename,
		TotalBytes:       t.totalBytes,
		TransferredBytes: t.transferredBytes,
		SpeedMBps:        speed,
		Percent:          percent,
	}
}

// TrackingResponseWriter wraps an http.ResponseWriter to track bytes streamed.
type TrackingResponseWriter struct {
	http.ResponseWriter
	Tracker *TransferTracker
}

func (t *TrackingResponseWriter) Write(b []byte) (int, error) {
	n, err := t.ResponseWriter.Write(b)
	if n > 0 && t.Tracker != nil {
		t.Tracker.UpdateProgress(int64(n))
	}
	return n, err
}

// HandleStats returns JSON live transfer metrics for the frontend HUD.
func HandleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GlobalTracker.GetStats())
}
