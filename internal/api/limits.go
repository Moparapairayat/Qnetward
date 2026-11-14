package api

import "time"

// Request, session, and rate-limit bounds for the HTTP API.
const (
	wsWriteTimeout       = 10 * time.Second
	wsReadTimeout        = 60 * time.Second
	maxJSONBodyBytes     = 8 << 10
	maxWSMessageBytes    = 4 << 10
	maxHistoryLimit      = 1000
	maxConcurrentProbes  = 8
	authCookieName       = "qnetward_session"
	defaultSessionTTL    = 30 * 24 * time.Hour
	defaultResetTTL      = 30 * time.Minute
	defaultVerifyCodeTTL = 10 * time.Minute
	// loginFailureLimit wrong passwords for one account within loginFailureWindow,
	// from any number of addresses, pause sign-in to it.
	loginFailureLimit    = 20
	loginFailureWindow   = time.Hour
	verifyResendCooldown = 60 * time.Second
	resetIssueCooldown   = 60 * time.Second
	rateLimitSweepEvery  = 5 * time.Minute
	rateLimitBucketTTL   = 30 * time.Minute
	maxRateLimitBuckets  = 8192
	minPasswordLength    = 8
	maxPasswordLength    = 72
	maxNameLength        = 80
)
