package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/probe"
	"qnetward/internal/store"
)

func parseHistoryQuery(values url.Values) (string, string, int, int, error) {
	reqType := strings.ToLower(strings.TrimSpace(values.Get("type")))
	host := strings.TrimSpace(values.Get("host"))
	portStr := strings.TrimSpace(values.Get("port"))
	limitStr := strings.TrimSpace(values.Get("limit"))

	if reqType != "ping" && reqType != "tcpping" {
		return "", "", 0, 0, fmt.Errorf("type must be ping or tcpping")
	}
	if host == "" {
		return "", "", 0, 0, fmt.Errorf("host is required")
	}

	port := 0
	if reqType == "tcpping" {
		if parsedHost, parsedPort, ok := probe.SplitHostPort(host); ok {
			host = parsedHost
			if port == 0 {
				port = parsedPort
			}
		}
	}
	if normalizedHost, err := probe.NormalizeHost(host); err != nil {
		return "", "", 0, 0, err
	} else {
		host = normalizedHost
	}

	if portStr != "" {
		p, err := probe.ParsePort(portStr)
		if err != nil {
			return "", "", 0, 0, fmt.Errorf("invalid port")
		}
		port = p
	}

	limit := 120
	if limitStr != "" {
		var parsed int
		if _, err := fmt.Sscanf(limitStr, "%d", &parsed); err != nil || parsed < 1 || parsed > maxHistoryLimit {
			return "", "", 0, 0, fmt.Errorf("limit must be 1-%d", maxHistoryLimit)
		}
		limit = parsed
	}

	return reqType, host, port, limit, nil
}

func parseRecentHistoryTargetsLimit(values url.Values) (int, error) {
	limitStr := strings.TrimSpace(values.Get("limit"))
	if limitStr == "" {
		return 12, nil
	}

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 50 {
		return 0, fmt.Errorf("limit must be 1-50")
	}
	return limit, nil
}

func parseHistoryExportRequest(req historyExportRequest) (string, string, int, int, string, string, error) {
	values := url.Values{}
	values.Set("type", req.Type)
	values.Set("host", req.Host)
	if req.Port > 0 {
		values.Set("port", strconv.Itoa(req.Port))
	}
	if req.Limit > 0 {
		values.Set("limit", strconv.Itoa(req.Limit))
	}
	reqType, host, port, limit, err := parseHistoryQuery(values)
	if err != nil {
		return "", "", 0, 0, "", "", err
	}

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "csv" {
		return "", "", 0, 0, "", "", fmt.Errorf("format must be json or csv")
	}

	destination := strings.ToLower(strings.TrimSpace(req.Destination))
	if destination == "" {
		destination = "download"
	}
	if destination != "download" && destination != "s3" {
		return "", "", 0, 0, "", "", fmt.Errorf("destination must be download or s3")
	}

	return reqType, host, port, limit, format, destination, nil
}

func historyCacheKey(workspaceID int64, reqType, host string, port, limit int) string {
	return fmt.Sprintf("history:w%d:%s:%s:%d:%d", workspaceID, reqType, host, port, limit)
}

func exportFileName(reqType, host string, port int, format string) string {
	baseHost := strings.NewReplacer(":", "_", "/", "_", "\\", "_", " ", "_").Replace(host)
	if port > 0 {
		baseHost = fmt.Sprintf("%s_%d", baseHost, port)
	}
	return fmt.Sprintf("%s_%s.%s", reqType, baseHost, format)
}

func buildExportObjectKey(userID int64, reqType, host string, port int, format string) string {
	return fmt.Sprintf("exports/%d/%s/%d/%s", userID, reqType, time.Now().UTC().UnixNano(), exportFileName(reqType, host, port, format))
}

func historyCSVRows(points []store.HistoryPoint) [][]string {
	rows := make([][]string, 0, len(points)+1)
	rows = append(rows, []string{"timestamp_ms", "sequence", "rtt_ms", "error"})
	for _, point := range points {
		rtt := ""
		if point.RttMs != nil {
			rtt = fmt.Sprintf("%.3f", *point.RttMs)
		}
		rows = append(rows, []string{
			strconv.FormatInt(point.Ts, 10),
			strconv.Itoa(point.Seq),
			rtt,
			point.Error,
		})
	}
	return rows
}

type historyExportRequest struct {
	Type        string `json:"type"`
	Host        string `json:"host"`
	Port        int    `json:"port,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	Format      string `json:"format,omitempty"`
	Destination string `json:"destination,omitempty"`
}

func (srv *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	reqType, host, port, limit, err := parseHistoryQuery(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	cacheKey := historyCacheKey(user.WorkspaceID, reqType, host, port, limit)
	if srv.cache != nil {
		var cached []store.HistoryPoint
		ctx, cancel := context.WithTimeout(r.Context(), 250*time.Millisecond)
		hit, cacheErr := srv.cache.GetJSON(ctx, cacheKey, &cached)
		cancel()
		if cacheErr == nil && hit {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	points, err := srv.store.QueryHistory(user.WorkspaceID, reqType, host, port, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if srv.cache != nil && len(points) > 0 {
		ctx, cancel := context.WithTimeout(r.Context(), 250*time.Millisecond)
		_ = srv.cache.SetJSON(ctx, cacheKey, points)
		cancel()
	}
	writeJSON(w, http.StatusOK, points)
}

func (srv *Server) handleRecentHistoryTargets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}

	limit, err := parseRecentHistoryTargetsLimit(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	targets, err := srv.store.QueryRecentHistoryTargets(user.WorkspaceID, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, targets)
}

func (srv *Server) handleHistoryExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	// A POST, but it only reads, so API keys need the read scope.
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req historyExportRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	reqType, host, port, limit, format, destination, err := parseHistoryExportRequest(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	points, err := srv.store.QueryHistory(user.WorkspaceID, reqType, host, port, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	label := host
	if port > 0 {
		label = fmt.Sprintf("%s:%d", host, port)
	}
	srv.recordAudit(r, user.WorkspaceID, user.User, "history.exported", auditTarget{Type: "target", ID: label, Label: label},
		map[string]any{"protocol": reqType, "format": format, "destination": destination, "points": len(points)})

	if destination == "s3" {
		if srv.objects == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "object storage not configured"})
			return
		}
		key := buildExportObjectKey(user.ID, reqType, host, port, format)
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		var objectKey string
		if format == "csv" {
			objectKey, err = srv.objects.UploadCSV(ctx, key, historyCSVRows(points))
		} else {
			objectKey, err = srv.objects.UploadJSON(ctx, key, points)
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		presignedURL, err := srv.objects.PresignedGetURL(ctx, objectKey, 15*time.Minute)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":     true,
			"key":    objectKey,
			"url":    presignedURL,
			"format": format,
			"count":  len(points),
		})
		return
	}

	filename := exportFileName(reqType, host, port, format)
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		cw := csv.NewWriter(w)
		if err := cw.WriteAll(historyCSVRows(points)); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
	default:
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(points)
	}
}
