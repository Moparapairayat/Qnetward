package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// lookupEnv reads key and, for QNETWARD_* keys, falls back to the legacy
// NETWATCHER_* name so deployments configured before the rename keep working.
func lookupEnv(key string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	if suffix, ok := strings.CutPrefix(key, "QNETWARD_"); ok {
		return strings.TrimSpace(os.Getenv("NETWATCHER_" + suffix))
	}
	return ""
}

func envString(key, fallback string) string {
	if value := lookupEnv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := lookupEnv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(key string, fallback bool) bool {
	value := lookupEnv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envFloat(key string, fallback float64) float64 {
	value := lookupEnv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value := lookupEnv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
