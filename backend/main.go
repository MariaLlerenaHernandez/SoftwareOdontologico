// SIGO-Dental · API REST del Sistema Integral de Gestión Odontológica.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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

func main() {
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
	srv := api.New(pool, api.Config{
		JWTSecret:     []byte(secret),
		TokenTTL:      8 * time.Hour,
		UploadDir:     env("UPLOAD_DIR", "./uploads"),
		AllowedOrigin: env("CORS_ORIGIN", "http://localhost:5173"),
		StaticDir:     env("STATIC_DIR", ""),
		Location:      loc,
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
