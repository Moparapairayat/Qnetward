package api

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type rateLimitConfig struct {
	Limit  int
	Window time.Duration
}

type rateLimitBucket struct {
	hits     []time.Time
	lastSeen time.Time
}

type rateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*rateLimitBucket
	lastSweep time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{
		buckets:   make(map[string]*rateLimitBucket),
		lastSweep: time.Now(),
	}
}

func (rl *rateLimiter) Allow(key string, cfg rateLimitConfig) (bool, time.Duration) {
	if rl == nil {
		return true, 0
	}
	now := time.Now()
	cutoff := now.Add(-cfg.Window)

	rl.mu.Lock()
	defer rl.mu.Unlock()

	if len(rl.buckets) > maxRateLimitBuckets || now.Sub(rl.lastSweep) >= rateLimitSweepEvery {
		rl.sweep(now)
	}

	bucket := rl.buckets[key]
	if bucket == nil {
		bucket = &rateLimitBucket{}
		rl.buckets[key] = bucket
	}

	filtered := bucket.hits[:0]
	for _, hit := range bucket.hits {
		if hit.After(cutoff) {
			filtered = append(filtered, hit)
		}
	}
	bucket.hits = filtered
	bucket.lastSeen = now

	if len(bucket.hits) >= cfg.Limit {
		retryAfter := bucket.hits[0].Add(cfg.Window).Sub(now)
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		return false, retryAfter
	}

	bucket.hits = append(bucket.hits, now)
	return true, 0
}

// Count returns how many hits key has within window, without adding one.
func (rl *rateLimiter) Count(key string, window time.Duration) int {
	if rl == nil {
		return 0
	}
	cutoff := time.Now().Add(-window)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	bucket := rl.buckets[key]
	if bucket == nil {
		return 0
	}
	n := 0
	for _, hit := range bucket.hits {
		if hit.After(cutoff) {
			n++
		}
	}
	return n
}

func (rl *rateLimiter) sweep(now time.Time) {
	cutoff := now.Add(-rateLimitBucketTTL)
	for key, bucket := range rl.buckets {
		filtered := bucket.hits[:0]
		for _, hit := range bucket.hits {
			if hit.After(cutoff) {
				filtered = append(filtered, hit)
			}
		}
		bucket.hits = filtered
		if len(bucket.hits) == 0 && bucket.lastSeen.Before(cutoff) {
			delete(rl.buckets, key)
		}
	}
	rl.lastSweep = now
}

func (srv *Server) enforceRateLimit(w http.ResponseWriter, r *http.Request, action, subject string, cfg rateLimitConfig) bool {
	key := buildRateLimitKey(r, action, subject)
	allowed, retryAfter := srv.authLimiter.Allow(key, cfg)
	if allowed {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())))
	writeJSON(w, http.StatusTooManyRequests, apiError{Error: "too many requests, try again later"})
	return false
}

func buildRateLimitKey(r *http.Request, action, subject string) string {
	ip := clientIPFromRequest(r)
	subject = strings.ToLower(strings.TrimSpace(subject))
	if subject == "" {
		return action + "|" + ip
	}
	return action + "|" + ip + "|" + subject
}
