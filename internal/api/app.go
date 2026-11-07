package api

import (
	"crypto/x509"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"qnetward/internal/platform/cache"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/platform/netguard"
	"qnetward/internal/platform/objectstore"
	"qnetward/internal/platform/secretbox"
	"qnetward/internal/platform/uddoktapay"
	"qnetward/internal/store"
)

// Deps are the infrastructure adapters the API needs. Cache, Objects, and
// Mailer are optional: handlers degrade when they are nil.
type Deps struct {
	Store   *store.Store
	Cache   *cache.Cache
	Objects *objectstore.Client
	Mailer  *mailer.Client
	// Secrets encrypts stored secrets such as TOTP seeds. Nil stores them
	// unencrypted, which is only acceptable in development.
	Secrets *secretbox.Box
}

// Options are the request-handling settings read from flags or the environment.
type Options struct {
	PublicBaseURL  string
	AllowedOrigins map[string]struct{}
	AdminEmails    map[string]struct{}
	DemoEnabled    bool
	DemoName       string
	DemoEmail      string
	// DemoFullAccess lifts the demo account's restrictions, for local testing.
	DemoFullAccess bool
	// DemoWorkspace names the demo account's workspace.
	DemoWorkspace string
	// Google enables "Sign in with Google" when its client ID and secret are set.
	Google OAuthProvider
	// Billing configures paid plans; without an UddoktaPay key, nothing can be bought.
	Billing Billing
	// TargetPolicy decides which addresses API-initiated probes may reach.
	// The CLI does not use it: it runs on the operator's own machine.
	TargetPolicy netguard.Policy
}

// Server holds everything the HTTP handlers need. It replaces the package-level
// globals the handlers used to read, so each test can build its own instance.
type Server struct {
	store   *store.Store
	cache   *cache.Cache
	objects *objectstore.Client
	mailer  *mailer.Client
	secrets *secretbox.Box

	publicBaseURL  string
	allowedOrigins map[string]struct{}
	adminEmails    map[string]struct{}
	demoEnabled    bool
	demoName       string
	demoEmail      string
	demoFullAccess bool
	demoWorkspace  string
	demoCreatedAt  time.Time
	targetPolicy   netguard.Policy
	google         OAuthProvider
	webauthn       *webauthn.WebAuthn
	// monitorRootCAs overrides the system roots for HTTPS monitors; tests only.
	monitorRootCAs *x509.CertPool
	billing        Billing
	payments       *uddoktapay.Client
	// telegramAPI overrides the Telegram Bot API base; tests only.
	telegramAPI string
	// pictureTestHost is a host allowed to serve provider pictures; tests only.
	pictureTestHost string

	probeLimiter chan struct{}
	// quotaLimiter counts per-workspace and per-key usage against plan limits.
	quotaLimiter   *rateLimiter
	rejectedProbes atomic.Uint64
	authLimiter    *rateLimiter
}

// New wires a Server from its dependencies and options.
func New(deps Deps, opts Options) *Server {
	srv := &Server{
		store:          deps.Store,
		cache:          deps.Cache,
		objects:        deps.Objects,
		mailer:         deps.Mailer,
		secrets:        deps.Secrets,
		publicBaseURL:  strings.TrimRight(strings.TrimSpace(opts.PublicBaseURL), "/"),
		allowedOrigins: opts.AllowedOrigins,
		adminEmails:    opts.AdminEmails,
		demoEnabled:    opts.DemoEnabled,
		demoName:       strings.TrimSpace(opts.DemoName),
		demoEmail:      strings.TrimSpace(opts.DemoEmail),
		demoFullAccess: opts.DemoFullAccess,
		demoWorkspace:  strings.TrimSpace(opts.DemoWorkspace),
		billing:        opts.Billing,
		payments:       &uddoktapay.Client{BaseURL: strings.TrimSpace(opts.Billing.UddoktaPayURL), APIKey: strings.TrimSpace(opts.Billing.UddoktaPayKey)},
		demoCreatedAt:  time.Now().UTC(),
		targetPolicy:   opts.TargetPolicy,
		google:         opts.Google,
		webauthn:       newWebAuthn(opts.PublicBaseURL),
		probeLimiter:   make(chan struct{}, maxConcurrentProbes),
		authLimiter:    newRateLimiter(),
		quotaLimiter:   newRateLimiter(),
	}
	if srv.demoEnabled {
		if srv.demoName == "" {
			srv.demoName = "Contributor Demo"
		}
		if srv.demoEmail == "" {
			srv.demoEmail = "demo@qnetward.com"
		}
		if srv.demoWorkspace == "" {
			srv.demoWorkspace = "Kestrel Labs"
		}
	}
	return srv
}

// Handler returns the API's routes wrapped in the security headers middleware.
func (srv *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", srv.handleHealthz)
	mux.HandleFunc("/api/healthz", srv.handleHealthz)
	mux.HandleFunc("/api/auth/session", srv.handleAuthSession)
	mux.HandleFunc("/api/auth/account-context", srv.handleAuthAccountContext)
	mux.HandleFunc("/api/auth/demo-login", srv.handleAuthDemoLogin)
	mux.HandleFunc("/api/auth/signup", srv.handleAuthSignup)
	mux.HandleFunc("/api/auth/login", srv.handleAuthLogin)
	mux.HandleFunc("/api/auth/logout", srv.handleAuthLogout)
	mux.HandleFunc("/api/auth/profile", srv.handleAuthProfile)
	mux.HandleFunc("/api/auth/verify-email", srv.handleAuthVerifyEmail)
	mux.HandleFunc("/api/auth/resend-verification", srv.handleAuthResendVerification)
	mux.HandleFunc("/api/auth/forgot-password", srv.handleAuthForgotPassword)
	mux.HandleFunc("/api/auth/reset-password", srv.handleAuthResetPassword)
	mux.HandleFunc("/api/account/profile", srv.handleAccountProfile)
	mux.HandleFunc("/api/account/password", srv.handleAccountPassword)
	mux.HandleFunc("/api/account/sessions", srv.handleAccountSessions)
	mux.HandleFunc("/api/account/avatar", srv.handleAccountAvatar)
	mux.HandleFunc("/api/account/activity", srv.handleAccountActivity)
	mux.HandleFunc("/api/account/mfa", srv.handleAccountMFA)
	mux.HandleFunc("/api/account/mfa/setup", srv.handleAccountMFASetup)
	mux.HandleFunc("/api/account/mfa/enable", srv.handleAccountMFAEnable)
	mux.HandleFunc("/api/account/mfa/disable", srv.handleAccountMFADisable)
	mux.HandleFunc("/api/account/mfa/recovery-codes", srv.handleAccountMFARecovery)
	mux.HandleFunc("/api/auth/mfa", srv.handleAuthMFA)
	mux.HandleFunc("/api/auth/providers", srv.handleAuthProviders)
	mux.HandleFunc("/api/auth/google/start", srv.handleGoogleStart)
	mux.HandleFunc("/api/auth/google/callback", srv.handleGoogleCallback)
	mux.HandleFunc("/api/auth/passkey/begin", srv.handlePasskeyLoginBegin)
	mux.HandleFunc("/api/auth/passkey/finish", srv.handlePasskeyLoginFinish)
	mux.HandleFunc("/api/account/passkeys", srv.handleAccountPasskeys)
	mux.HandleFunc("/api/account/passkeys/begin", srv.handlePasskeyRegisterBegin)
	mux.HandleFunc("/api/account/passkeys/finish", srv.handlePasskeyRegisterFinish)
	mux.HandleFunc("/api/account", srv.handleAccountDelete)
	mux.HandleFunc("GET /api/avatars/{id}", srv.handleAvatarImage)
	mux.HandleFunc("/api/workspaces", srv.handleWorkspaces)
	mux.HandleFunc("/api/workspace", srv.handleWorkspaceGeneral)
	mux.HandleFunc("/api/billing", srv.handleBilling)
	mux.HandleFunc("/api/billing/checkout", srv.handleBillingCheckout)
	mux.HandleFunc("/api/billing/uddoktapay/return", srv.handleUddoktaPayReturn)
	mux.HandleFunc("/api/billing/uddoktapay/webhook", srv.handleUddoktaPayWebhook)
	mux.HandleFunc("/api/workspace/team", srv.handleWorkspaceTeam)
	mux.HandleFunc("/api/workspace/invitations", srv.handleWorkspaceInvitations)
	mux.HandleFunc("/api/workspace/audit", srv.handleWorkspaceAudit)
	mux.HandleFunc("/api/workspace/api-keys", srv.handleWorkspaceAPIKeys)
	mux.HandleFunc("/api/workspace/usage", srv.handleWorkspaceUsage)
	mux.HandleFunc("/api/admin/overview", srv.handleAdminOverview)
	mux.HandleFunc("/api/admin/users", srv.handleAdminUsers)
	mux.HandleFunc("/api/admin/workspaces", srv.handleAdminWorkspaces)
	mux.HandleFunc("/api/admin/workspaces/plan", srv.handleAdminWorkspacePlan)
	mux.HandleFunc("/api/admin/system", srv.handleAdminSystem)
	mux.HandleFunc("/api/ping", srv.handlePing)
	mux.HandleFunc("/api/tcpping", srv.handleTCPPing)
	mux.HandleFunc("/api/portscan", srv.handlePortScan)
	mux.HandleFunc("/api/dnslookup", srv.handleDNSLookup)
	mux.HandleFunc("/api/history", srv.handleHistory)
	mux.HandleFunc("/api/history/recent-targets", srv.handleRecentHistoryTargets)
	mux.HandleFunc("/api/export/history", srv.handleHistoryExport)
	mux.HandleFunc("/api/alerts/rules", srv.handleAlertRules)
	mux.HandleFunc("/api/monitors", srv.handleMonitors)
	mux.HandleFunc("/api/monitors/series", srv.handleMonitorSeries)
	mux.HandleFunc("/api/status-pages", srv.handleStatusPages)
	mux.HandleFunc("GET /api/public/status/{slug}", srv.handlePublicStatusPage)
	mux.HandleFunc("/api/workspace/channels", srv.handleChannels)
	mux.HandleFunc("/api/workspace/channels/test", srv.handleChannelTest)
	mux.HandleFunc("/ws", srv.handleWS)
	mux.Handle("/", newBackendFallbackHandler())
	return withSecurityHeaders(mux)
}
