package engine

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// ClipboardItem represents shared text or URL snippet.
type ClipboardItem struct {
	ID        int64     `json:"id"`
	Content   string    `json:"content"`
	Sender    string    `json:"sender"`
	Timestamp time.Time `json:"timestamp"`
}

type ClipboardStore struct {
	mu    sync.RWMutex
	items []ClipboardItem
}

var globalClipboard = &ClipboardStore{
	items: make([]ClipboardItem, 0),
}

// AddItem adds new shared text.
func (c *ClipboardStore) Add(content, sender string) ClipboardItem {
	c.mu.Lock()
	defer c.mu.Unlock()

	item := ClipboardItem{
		ID:        time.Now().UnixNano(),
		Content:   content,
		Sender:    sender,
		Timestamp: time.Now(),
	}

	// Keep last 50 items
	if len(c.items) >= 50 {
		c.items = c.items[1:]
	}
	c.items = append(c.items, item)
	return item
}

// GetAll returns all shared text items.
func (c *ClipboardStore) GetAll() []ClipboardItem {
	c.mu.RLock()
	defer c.mu.RUnlock()

	res := make([]ClipboardItem, len(c.items))
	copy(res, c.items)
	return res
}

// HandleClipboardAPI handles GET and POST requests for clipboard data.
func HandleClipboardAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			Content string `json:"content"`
			Sender  string `json:"sender"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" {
			http.Error(w, `{"error":"invalid content"}`, http.StatusBadRequest)
			return
		}
		if req.Sender == "" {
			req.Sender = "Anonymous Peer"
		}
		item := globalClipboard.Add(req.Content, req.Sender)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(item)
		return
	}

	// GET
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(globalClipboard.GetAll())
}
