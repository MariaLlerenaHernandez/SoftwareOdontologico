// SIGO-Dental · API REST del Sistema Integral de Gestión Odontológica.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"sigo-dental/internal/api"
	"sigo-dental/internal/db"
	"sigo-dental/internal/security"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// loadDotEnv carga variables desde .env (raíz del proyecto o carpeta actual)
// sin sobrescribir las que ya existen en el entorno.
func loadDotEnv() {
	for _, p := range []string{".env", "../.env"} {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			k, v, ok := strings.Cut(line, "=")
			if !ok || strings.HasPrefix(line, "#") {
				continue
			}
			k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
			if _, exists := os.LookupEnv(k); !exists && v != "" {
				os.Setenv(k, v)
			}
		}
		return
	}
}

func main() {
	loadDotEnv()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	tz := env("APP_TIMEZONE", "America/Guayaquil")
	loc, err := time.LoadLocation(tz)
	if err != nil {
		slog.Warn("zona horaria no disponible, se usa UTC-5 fija", "tz", tz)
		loc = time.FixedZone("UTC-5", -5*3600)
	}
	time.Local = loc

	secret := env("JWT_SECRET", "")
	if secret == "" {
		secret = "dev-only-secret-change-me-in-production-0123456789"
		slog.Warn("JWT_SECRET no definido: usando secreto de desarrollo")
	}
	fileKey := env("FILE_ENCRYPTION_KEY", secret)

	pool, err := db.Connect(ctx, env("DATABASE_URL", "postgres://sigo:sigo_dental_2026@localhost:5435/sigo_dental?sslmode=disable"), tz)
	if err != nil {
		slog.Error("base de datos", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	created, err := db.Migrate(ctx, pool, api.SeedUsers(env("DEMO_PASSWORD", "Sigo2026!")))
	if err != nil {
		slog.Error("migración", "err", err)
		os.Exit(1)
	}
	if created {
		slog.Info("base de datos inicializada con esquema y datos de demostración")
	}

	cipher, err := security.NewFileCipher(fileKey)
	if err != nil {
		slog.Error("cifrado", "err", err)
		os.Exit(1)
	}
	var smtpCfg *api.SMTPConfig
	if os.Getenv("SMTP_USER") != "" && os.Getenv("SMTP_PASSWORD") != "" {
		smtpCfg = &api.SMTPConfig{Host: env("SMTP_HOST", "smtp.gmail.com"), Port: env("SMTP_PORT", "587"), User: os.Getenv("SMTP_USER"),
			Password: os.Getenv("SMTP_PASSWORD"), From: os.Getenv("SMTP_FROM"), FromName: env("SMTP_FROM_NAME", "SIGO-Dental")}
	}
	var twilioCfg *api.TwilioConfig
	if os.Getenv("TWILIO_ACCOUNT_SID") != "" && os.Getenv("TWILIO_AUTH_TOKEN") != "" {
		twilioCfg = &api.TwilioConfig{AccountSID: os.Getenv("TWILIO_ACCOUNT_SID"), AuthToken: os.Getenv("TWILIO_AUTH_TOKEN"),
			SMSFrom: os.Getenv("TWILIO_SMS_FROM"), WhatsAppFrom: os.Getenv("TWILIO_WHATSAPP_FROM"), DefaultCountryCode: env("DEFAULT_COUNTRY_CODE", "+593")}
	}
	notifier := api.NewGatewayNotifier(smtpCfg, twilioCfg)
	for _, ch := range []string{"email", "sms", "whatsapp"} {
		slog.Info("canal de notificación", "canal", ch, "real", notifier.Live(ch))
	}
	slog.Info("pasarela de pagos Stripe", "activa", os.Getenv("STRIPE_SECRET_KEY") != "")

	srv := api.New(pool, api.Config{
		JWTSecret:     []byte(secret),
		TokenTTL:      8 * time.Hour,
		UploadDir:     env("UPLOAD_DIR", "./uploads"),
		AllowedOrigin: env("CORS_ORIGIN", "http://localhost:5173"),
		StaticDir:     env("STATIC_DIR", ""),
		Location:      loc,
		Notifier:      notifier,
		StripeKey:     os.Getenv("STRIPE_SECRET_KEY"),
	}, cipher)
	if err := srv.LoadSettings(ctx); err != nil {
		slog.Error("configuración", "err", err)
		os.Exit(1)
	}
	srv.StartReminderWorker(ctx)

	httpSrv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		slog.Info("API escuchando", "addr", httpSrv.Addr, "docs", "/api/docs")
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("servidor", "err", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdown)
	slog.Info("servidor detenido")
}
