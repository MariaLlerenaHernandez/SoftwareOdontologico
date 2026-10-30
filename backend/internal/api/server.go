// Package api expone la API REST de SIGO-Dental.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"sigo-dental/internal/db"
	"sigo-dental/internal/security"
)

// Roles del sistema (sección 3 del SRS).
const (
	RoleAdmin      = "admin"
	RoleRecepcion  = "recepcion"
	RoleOdontologo = "odontologo"
	RoleAsistente  = "asistente"
	RoleAuditor    = "auditor"
)

var allRoles = []string{RoleAdmin, RoleRecepcion, RoleOdontologo, RoleAsistente, RoleAuditor}

type Config struct {
	JWTSecret     []byte
	TokenTTL      time.Duration
	UploadDir     string
	AllowedOrigin string
	StaticDir     string
	Location      *time.Location
}

type Server struct {
	db       *pgxpool.Pool
	cfg      Config
	files    *security.FileCipher
	settings *settingsCache
	limiter  *loginLimiter
	notifier Notifier
	mux      *http.ServeMux
}

func New(pool *pgxpool.Pool, cfg Config, files *security.FileCipher) *Server {
	s := &Server{
		db:       pool,
		cfg:      cfg,
		files:    files,
		settings: &settingsCache{},
		limiter:  newLoginLimiter(),
		notifier: SimulatedNotifier{},
		mux:      http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.recoverer(s.securityHeaders(s.cors(s.mux)))
}

// ------------------------------------------------------------ contexto

// Ctx agrupa la petición, la respuesta y el usuario autenticado.
type Ctx struct {
	W         http.ResponseWriter
	R         *http.Request
	User      *security.Claims
	s         *Server
	status    int
	entityID  string
	patientID int64
	details   map[string]any
	action    string
}

func (c *Ctx) Context() context.Context { return c.R.Context() }

func (c *Ctx) JSON(code int, v any) error {
	c.status = code
	c.W.Header().Set("Content-Type", "application/json; charset=utf-8")
	c.W.WriteHeader(code)
	return json.NewEncoder(c.W).Encode(v)
}

func (c *Ctx) OK(v any) error { return c.JSON(http.StatusOK, v) }

func (c *Ctx) Created(v any) error { return c.JSON(http.StatusCreated, v) }

func (c *Ctx) Bind(v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(c.W, c.R.Body, 4<<20))
	if err := dec.Decode(v); err != nil {
		return badRequest("JSON inválido: " + err.Error())
	}
	return nil
}

func (c *Ctx) PathID(name string) (int64, error) {
	id, err := strconv.ParseInt(c.R.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, badRequest("identificador inválido")
	}
	return id, nil
}

func (c *Ctx) Query(name string) string { return strings.TrimSpace(c.R.URL.Query().Get(name)) }

func (c *Ctx) QueryInt(name string, def int64) int64 {
	if v, err := strconv.ParseInt(c.Query(name), 10, 64); err == nil {
		return v
	}
	return def
}

func (c *Ctx) Is(roles ...string) bool {
	for _, r := range roles {
		if c.User.Role == r {
			return true
		}
	}
	return false
}

// Audit permite a un handler enriquecer el registro de auditoría.
func (c *Ctx) Audit(entityID any, patientID int64, details map[string]any) {
	if entityID != nil {
		c.entityID = fmt.Sprint(entityID)
	}
	if patientID > 0 {
		c.patientID = patientID
	}
	if details != nil {
		c.details = details
	}
}

func (c *Ctx) IP() string {
	if f := c.R.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	host, _, err := net.SplitHostPort(c.R.RemoteAddr)
	if err != nil {
		return c.R.RemoteAddr
	}
	return host
}

// -------------------------------------------------------------- errores

type HTTPError struct {
	Code    int    `json:"-"`
	Message string `json:"error"`
	Reason  string `json:"code,omitempty"`
}

func (e *HTTPError) Error() string { return e.Message }

func badRequest(msg string) error { return &HTTPError{Code: 400, Message: msg} }
func forbidden(msg string) error  { return &HTTPError{Code: 403, Message: msg} }
func notFound(msg string) error   { return &HTTPError{Code: 404, Message: msg} }
func conflict(msg string) error   { return &HTTPError{Code: 409, Message: msg} }

func (s *Server) writeError(c *Ctx, err error) {
	var he *HTTPError
	var pg *pgconn.PgError
	switch {
	case errors.As(err, &he):
	case errors.Is(err, db.ErrNotFound):
		he = &HTTPError{Code: 404, Message: "Registro no encontrado"}
	case errors.As(err, &pg):
		he = pgToHTTP(pg)
	default:
		slog.Error("error interno", "path", c.R.URL.Path, "err", err)
		he = &HTTPError{Code: 500, Message: "Error interno del servidor"}
	}
	_ = c.JSON(he.Code, he)
}

func pgToHTTP(pg *pgconn.PgError) *HTTPError {
	switch pg.Code {
	case "23P01":
		return &HTTPError{Code: 409, Reason: "chair_overlap",
			Message: "El sillón ya tiene una cita en ese horario (RN-03). Elija otro sillón u horario."}
	case "23505":
		msg := "Ya existe un registro con esos datos únicos"
		if strings.Contains(pg.ConstraintName, "document") {
			msg = "Ya existe un paciente con ese número de documento"
		} else if strings.Contains(pg.ConstraintName, "email") {
			msg = "Ya existe un usuario con ese correo"
		} else if strings.Contains(pg.ConstraintName, "cash_open") {
			msg = "Ya tiene una caja abierta"
		}
		return &HTTPError{Code: 409, Message: msg}
	case "23503":
		return &HTTPError{Code: 400, Message: "Referencia inválida a un registro relacionado"}
	case "23514":
		return &HTTPError{Code: 400, Message: "Valor fuera del rango permitido (" + pg.ConstraintName + ")"}
	case "23502":
		return &HTTPError{Code: 400, Message: "Falta un campo obligatorio: " + pg.ColumnName}
	case "22P02", "22007", "22008":
		return &HTTPError{Code: 400, Message: "Formato de dato inválido"}
	case "P0001":
		msg := strings.TrimPrefix(pg.Message, "IMMUTABLE: ")
		return &HTTPError{Code: 409, Reason: "immutable", Message: strings.ToUpper(msg[:1]) + msg[1:]}
	}
	slog.Error("error de base de datos", "code", pg.Code, "msg", pg.Message)
	return &HTTPError{Code: 500, Message: "Error de base de datos"}
}

// ------------------------------------------------------------- rutas

type HandlerFunc func(c *Ctx) error

type routeOpts struct {
	public    bool
	roles     []string
	entity    string
	auditRead bool
	clinical  bool
}

type opt func(*routeOpts)

func roles(r ...string) opt        { return func(o *routeOpts) { o.roles = r } }
func entity(e string) opt          { return func(o *routeOpts) { o.entity = e } }
func auditRead() opt               { return func(o *routeOpts) { o.auditRead = true } }
func public() opt                  { return func(o *routeOpts) { o.public = true } }
func clinical() opt                { return func(o *routeOpts) { o.clinical = true } }
func sensitive(e string) []opt     { return []opt{entity(e), auditRead(), clinical()} }
func with(base []opt, o ...opt) []opt { return append(append([]opt{}, base...), o...) }

// handle registra una ruta aplicando autenticación, RBAC, MFA y auditoría.
func (s *Server) handle(pattern string, h HandlerFunc, opts ...opt) {
	o := routeOpts{roles: allRoles}
	for _, f := range opts {
		f(&o)
	}
	method, path, _ := strings.Cut(pattern, " ")
	if o.entity == "" {
		o.entity = guessEntity(path)
	}
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		c := &Ctx{W: w, R: r, s: s}
		if !o.public {
			claims, err := s.authenticate(r)
			if err != nil {
				_ = c.JSON(401, &HTTPError{Message: "Sesión inválida o expirada", Reason: "unauthorized"})
				return
			}
			c.User = claims
			if !c.Is(o.roles...) {
				s.audit(c, o, method, "DENIED", 403)
				_ = c.JSON(403, &HTTPError{Message: "Su rol no tiene permiso para esta operación", Reason: "forbidden"})
				return
			}
			if (o.clinical || isFinancial(path)) && s.settings.Bool("mfa_obligatorio") && !claims.MFA {
				_ = c.JSON(403, &HTTPError{Message: "Debe activar y validar MFA para acceder a esta información", Reason: "mfa_required"})
				return
			}
		}
		if err := h(c); err != nil {
			s.writeError(c, err)
		}
		if c.status == 0 {
			c.status = 200
		}
		if c.User != nil && (method != http.MethodGet || o.auditRead || c.action != "") {
			s.audit(c, o, method, "", c.status)
		}
	})
}

func guessEntity(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i := len(parts) - 1; i >= 1; i-- {
		if !strings.HasPrefix(parts[i], "{") && parts[i] != "api" {
			return parts[i]
		}
	}
	return path
}

func isFinancial(path string) bool {
	for _, p := range []string{"/api/invoices", "/api/cash", "/api/commissions", "/api/reports/revenue"} {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func actionFor(method string) string {
	switch method {
	case http.MethodGet:
		return "READ"
	case http.MethodPost:
		return "CREATE"
	case http.MethodPut, http.MethodPatch:
		return "UPDATE"
	case http.MethodDelete:
		return "DELETE"
	}
	return method
}

// audit inserta en el log inmutable (RNF-06). Nunca interrumpe la respuesta.
func (s *Server) audit(c *Ctx, o routeOpts, method, forced string, status int) {
	action := actionFor(method)
	if c.action != "" {
		action = c.action
	}
	if forced != "" {
		action = forced
	}
	if status >= 400 && forced == "" {
		action += "_FAILED"
	}
	entityID := c.entityID
	if entityID == "" {
		entityID = c.R.PathValue("id")
	}
	patientID := c.patientID
	if patientID == 0 && strings.HasPrefix(c.R.Pattern, method+" /api/patients/{id}") {
		patientID, _ = strconv.ParseInt(c.R.PathValue("id"), 10, 64)
	}
	var details []byte
	if c.details != nil {
		details, _ = json.Marshal(c.details)
	}
	var uid any
	email, role := "", ""
	if c.User != nil {
		uid, email, role = c.User.UserID, c.User.Email, c.User.Role
	}
	_, err := s.db.Exec(context.Background(), `
		INSERT INTO audit_log (user_id, user_email, role, action, entity, entity_id, patient_id, ip, user_agent, method, path, status, details)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,0),$8,$9,$10,$11,$12,$13)`,
		uid, email, role, action, o.entity, entityID, patientID, c.IP(), truncate(c.R.UserAgent(), 250),
		method, c.R.URL.Path, status, nullJSON(details))
	if err != nil {
		slog.Error("no se pudo registrar auditoría", "err", err)
	}
}

func nullJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (s *Server) authenticate(r *http.Request) (*security.Claims, error) {
	h := r.Header.Get("Authorization")
	token := strings.TrimPrefix(h, "Bearer ")
	if token == "" || token == h {
		token = r.URL.Query().Get("token") // descargas de archivos e impresiones
	}
	if token == "" {
		return nil, errors.New("sin token")
	}
	claims, err := security.ParseToken(s.cfg.JWTSecret, token)
	if err != nil {
		return nil, err
	}
	if claims.Role == "mfa_pending" {
		return nil, errors.New("MFA pendiente")
	}
	return claims, nil
}

// --------------------------------------------------------- middleware

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic", "path", r.URL.Path, "err", rec)
				w.WriteHeader(500)
				_, _ = w.Write([]byte(`{"error":"Error interno del servidor"}`))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && (s.cfg.AllowedOrigin == "*" || origin == s.cfg.AllowedOrigin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ------------------------------------------------- caché de configuración

type settingsCache struct {
	mu   sync.RWMutex
	vals map[string]string
}

func (s *Server) LoadSettings(ctx context.Context) error {
	rows, err := db.Rows(ctx, s.db, `SELECT key, value FROM settings`)
	if err != nil {
		return err
	}
	m := map[string]string{}
	for _, r := range rows {
		m[r["key"].(string)] = r["value"].(string)
	}
	s.settings.mu.Lock()
	s.settings.vals = m
	s.settings.mu.Unlock()
	return nil
}

func (sc *settingsCache) Get(k string) string {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.vals[k]
}

func (sc *settingsCache) Bool(k string) bool { return sc.Get(k) == "true" }

func (sc *settingsCache) Float(k string, def float64) float64 {
	if v, err := strconv.ParseFloat(sc.Get(k), 64); err == nil {
		return v
	}
	return def
}

func (sc *settingsCache) Int(k string, def int) int {
	if v, err := strconv.Atoi(sc.Get(k)); err == nil {
		return v
	}
	return def
}

// ------------------------------------------- limitador de intentos de login

type loginLimiter struct {
	mu       sync.Mutex
	failures map[string][]time.Time
}

func newLoginLimiter() *loginLimiter { return &loginLimiter{failures: map[string][]time.Time{}} }

const (
	maxLoginFailures = 5
	loginWindow      = 15 * time.Minute
)

func (l *loginLimiter) blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	recent := l.prune(key)
	return len(recent) >= maxLoginFailures
}

func (l *loginLimiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures[key] = append(l.prune(key), time.Now())
}

func (l *loginLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}

func (l *loginLimiter) prune(key string) []time.Time {
	var keep []time.Time
	for _, t := range l.failures[key] {
		if time.Since(t) < loginWindow {
			keep = append(keep, t)
		}
	}
	l.failures[key] = keep
	return keep
}

// ------------------------------------------------------------- utilidades

// inTx ejecuta fn dentro de una transacción.
func (s *Server) inTx(ctx context.Context, fn func(q db.Querier) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func num(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int64:
		return float64(n)
	case int32:
		return float64(n)
	case int:
		return float64(n)
	}
	return 0
}

func i64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int32:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func emptyToNil(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}

