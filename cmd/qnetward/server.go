package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"qnetward/internal/api"
	"qnetward/internal/platform/cache"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/platform/netguard"
	"qnetward/internal/platform/objectstore"
	"qnetward/internal/platform/secretbox"
	"qnetward/internal/store"
)

func runServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	listen := fs.String("listen", envString("QNETWARD_LISTEN", "127.0.0.1:8080"), "listen address")
	dbDSN := fs.String("db-dsn", envString("QNETWARD_DB_DSN", ""), "postgres/timescaledb DSN")
	dbBatch := fs.Int("db-batch", envInt("QNETWARD_DB_BATCH", 100), "database batch insert size")
	dbFlush := fs.Duration("db-flush", envDuration("QNETWARD_DB_FLUSH", 1*time.Second), "database flush interval")
	dbRetention := fs.Duration("db-retention", envDuration("QNETWARD_DB_RETENTION", 168*time.Hour), "retention duration (0 to disable)")
	dbCleanup := fs.Duration("db-cleanup", envDuration("QNETWARD_DB_CLEANUP", 1*time.Hour), "retention cleanup interval")
	dbMaxOpen := fs.Int("db-max-open", envInt("QNETWARD_DB_MAX_OPEN", 20), "database max open connections")
	dbMaxIdle := fs.Int("db-max-idle", envInt("QNETWARD_DB_MAX_IDLE", 10), "database max idle connections")
	dbConnMaxLifetime := fs.Duration("db-conn-max-lifetime", envDuration("QNETWARD_DB_CONN_MAX_LIFETIME", 30*time.Minute), "database connection max lifetime")
	timescale := fs.Bool("timescale", envBool("QNETWARD_TIMESCALE", false), "require TimescaleDB extension when using postgres")
	redisAddr := fs.String("redis-addr", envString("QNETWARD_REDIS_ADDR", ""), "Redis address for history cache")
	redisPassword := fs.String("redis-password", envString("QNETWARD_REDIS_PASSWORD", ""), "Redis password")
	redisDB := fs.Int("redis-db", envInt("QNETWARD_REDIS_DB", 0), "Redis logical DB")
	redisPrefix := fs.String("redis-prefix", envString("QNETWARD_REDIS_PREFIX", "qnetward"), "Redis key prefix")
	nvdAPIKey := fs.String("nvd-api-key", envString("QNETWARD_NVD_API_KEY", ""), "NVD API key for faster vulnerability lookups (optional)")
	redisTTL := fs.Duration("redis-cache-ttl", envDuration("QNETWARD_REDIS_CACHE_TTL", 3*time.Second), "Redis history cache TTL")
	s3Endpoint := fs.String("s3-endpoint", envString("QNETWARD_S3_ENDPOINT", ""), "S3-compatible endpoint")
	s3AccessKey := fs.String("s3-access-key", envString("QNETWARD_S3_ACCESS_KEY", ""), "S3 access key")
	s3SecretKey := fs.String("s3-secret-key", envString("QNETWARD_S3_SECRET_KEY", ""), "S3 secret key")
	s3Bucket := fs.String("s3-bucket", envString("QNETWARD_S3_BUCKET", ""), "S3 bucket for exports and artifacts")
	s3Region := fs.String("s3-region", envString("QNETWARD_S3_REGION", "us-east-1"), "S3 region")
	s3Prefix := fs.String("s3-prefix", envString("QNETWARD_S3_PREFIX", "qnetward"), "S3 object prefix")
	s3UseSSL := fs.Bool("s3-ssl", envBool("QNETWARD_S3_SSL", false), "use TLS for S3-compatible endpoint")
	resendAPIKey := fs.String("resend-api-key", envString("QNETWARD_RESEND_API_KEY", ""), "Resend API key for transactional email")
	emailFrom := fs.String("email-from", envString("QNETWARD_EMAIL_FROM", ""), "from address for transactional emails")
	emailReplyTo := fs.String("email-reply-to", envString("QNETWARD_EMAIL_REPLY_TO", ""), "reply-to address for transactional emails")
	publicBaseURL := fs.String("public-base-url", envString("QNETWARD_PUBLIC_BASE_URL", ""), "public base URL used in emails, for example https://qnetward.example.com")
	allowedOriginsRaw := fs.String("allowed-origins", envString("QNETWARD_ALLOWED_ORIGINS", ""), "comma-separated additional allowed browser origins, for example http://127.0.0.1:3000")
	demoEnabled := fs.Bool("demo-enabled", envBool("QNETWARD_DEMO_ENABLED", false), "enable shared demo login")
	demoName := fs.String("demo-name", envString("QNETWARD_DEMO_NAME", "Contributor Demo"), "display name for demo access")
	demoEmail := fs.String("demo-email", envString("QNETWARD_DEMO_EMAIL", "demo@qnetward.com"), "display email for demo access")
	uddoktaURL := fs.String("uddoktapay-url", envString("QNETWARD_UDDOKTAPAY_URL", ""), "UddoktaPay installation URL, such as https://pay.example.com or https://sandbox.uddoktapay.com")
	uddoktaKey := fs.String("uddoktapay-api-key", envString("QNETWARD_UDDOKTAPAY_API_KEY", ""), "UddoktaPay API key; without it, plans can't be bought")
	proMonthly := fs.Float64("pro-monthly-bdt", envFloat("QNETWARD_PRO_MONTHLY_BDT", 1500), "price of one month of Pro, in taka")
	proYearly := fs.Float64("pro-yearly-bdt", envFloat("QNETWARD_PRO_YEARLY_BDT", 15000), "price of twelve months of Pro, in taka")
	demoWorkspace := fs.String("demo-workspace", envString("QNETWARD_DEMO_WORKSPACE", "Kestrel Labs"), "name of the demo account's workspace")
	demoFullAccess := fs.Bool("demo-full-access", envBool("QNETWARD_DEMO_FULL_ACCESS", false), "let the demo account do everything a normal owner can; for local testing only")
	allowPrivateTargets := fs.Bool("allow-private-targets", envBool("QNETWARD_ALLOW_PRIVATE_TARGETS", false), "allow probes to loopback, private, and link-local addresses (self-hosted LAN monitoring); cloud metadata endpoints stay blocked")
	encryptionKey := fs.String("encryption-key", envString("QNETWARD_ENCRYPTION_KEY", ""), "base64 32-byte key that encrypts stored secrets such as TOTP seeds (required in production)")
	googleClientID := fs.String("google-client-id", envString("QNETWARD_GOOGLE_CLIENT_ID", ""), "Google OAuth client ID for \"Sign in with Google\"")
	googleClientSecret := fs.String("google-client-secret", envString("QNETWARD_GOOGLE_CLIENT_SECRET", ""), "Google OAuth client secret")
	runMonitors := fs.Bool("monitors", envBool("QNETWARD_MONITORS", true), "run scheduled uptime monitor checks in this process")
	adminEmailsRaw := fs.String("admin-emails", envString("QNETWARD_ADMIN_EMAILS", ""), "comma-separated platform admin emails")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: qnetward serve [flags]")
		fs.PrintDefaults()
	}

	if err := fs.Parse(normalizeArgs(fs, args)); err != nil {
		os.Exit(2)
	}

	allowedOrigins, err := api.ParseAllowedOrigins(*allowedOriginsRaw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	adminEmails, err := api.ParseAdminEmails(*adminEmailsRaw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	st, err := store.OpenConfigured(store.Config{
		DSN:              *dbDSN,
		BatchSize:        *dbBatch,
		FlushInterval:    *dbFlush,
		Retention:        *dbRetention,
		CleanupInterval:  *dbCleanup,
		MaxOpenConns:     *dbMaxOpen,
		MaxIdleConns:     *dbMaxIdle,
		ConnMaxLifetime:  *dbConnMaxLifetime,
		RequireTimescale: *timescale,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer func() {
		_ = st.Close()
	}()

	rc, err := cache.Open(cache.Config{
		Addr:     *redisAddr,
		Password: *redisPassword,
		DB:       *redisDB,
		Prefix:   *redisPrefix,
		TTL:      *redisTTL,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if rc != nil {
		defer func() {
			_ = rc.Close()
		}()
	}

	objStore, err := objectstore.Open(objectstore.Config{
		Endpoint:  *s3Endpoint,
		AccessKey: *s3AccessKey,
		SecretKey: *s3SecretKey,
		Region:    *s3Region,
		Bucket:    *s3Bucket,
		Prefix:    *s3Prefix,
		UseSSL:    *s3UseSSL,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if objStore != nil {
		defer func() {
			_ = objStore.Close()
		}()
	}

	emailClient, err := mailer.Open(mailer.Config{
		APIKey:  *resendAPIKey,
		From:    *emailFrom,
		ReplyTo: *emailReplyTo,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	secrets, err := secretbox.New(*encryptionKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid encryption key: %v\n", err)
		os.Exit(1)
	}
	if !secrets.Encrypts() {
		fmt.Println("Warning: QNETWARD_ENCRYPTION_KEY is not set; two-factor secrets are stored unencrypted. Set it in production.")
	}
	apiServer := api.New(
		api.Deps{Store: st, Cache: rc, Objects: objStore, Mailer: emailClient, Secrets: secrets},
		api.Options{
			PublicBaseURL:    *publicBaseURL,
			AllowedOrigins:   allowedOrigins,
			AdminEmails:      adminEmails,
			DemoEnabled:      *demoEnabled,
			DemoName:         *demoName,
			DemoEmail:        *demoEmail,
			DemoFullAccess:   *demoFullAccess,
			DemoWorkspace:    *demoWorkspace,
			Billing:          api.Billing{UddoktaPayURL: *uddoktaURL, UddoktaPayKey: *uddoktaKey, ProMonthlyBDT: *proMonthly, ProYearlyBDT: *proYearly},
			TargetPolicy:     netguard.Policy{AllowPrivate: *allowPrivateTargets},
			Google:           api.GoogleOAuth(*googleClientID, *googleClientSecret),
			NVDAPIKey:        *nvdAPIKey,
			HistoryRetention: *dbRetention,
		},
	)

	srv := &http.Server{
		Addr:              *listen,
		Handler:           apiServer.Handler(),
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	fmt.Printf("Qnetward UI listening on http://%s\n", *listen)
	fmt.Printf("Database: postgres/timescale\n")
	fmt.Printf("DB batch=%d flush=%s retention=%s max-open=%d max-idle=%d timescale=%t\n", *dbBatch, dbFlush.String(), dbRetention.String(), *dbMaxOpen, *dbMaxIdle, *timescale)
	if rc != nil {
		fmt.Printf("Redis cache: %s db=%d ttl=%s\n", *redisAddr, *redisDB, redisTTL.String())
	}
	if objStore != nil {
		fmt.Printf("Object storage: %s bucket=%s prefix=%s\n", *s3Endpoint, *s3Bucket, *s3Prefix)
	}
	if emailClient != nil {
		fmt.Printf("Email delivery: Resend from=%s\n", *emailFrom)
	}

	monitorsCtx, stopMonitors := context.WithCancel(context.Background())
	defer stopMonitors()
	// Live updates reach consoles on every instance, whether or not this one runs monitors.
	go apiServer.RunEventBus(monitorsCtx)
	// Payments run whether or not this instance checks monitors.
	go apiServer.RunPaymentReconciler(monitorsCtx)
	if *runMonitors {
		go apiServer.RunMonitors(monitorsCtx)
		go apiServer.RunSecurityWatches(monitorsCtx)
		fmt.Println("Uptime monitors and watched domains: running")
	}
	if *demoEnabled && *demoFullAccess {
		fmt.Println("Warning: QNETWARD_DEMO_FULL_ACCESS is on; anyone who opens the demo can change its workspace. Never enable it on a public server.")
	}

	// Handle graceful shutdown on SIGINT/SIGTERM
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\nShutting down gracefully...")
		stopMonitors()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "Shutdown error: %v\n", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
