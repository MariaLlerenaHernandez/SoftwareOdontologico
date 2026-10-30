package api

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"sigo-dental/internal/db"
	"sigo-dental/internal/security"
)

// SeedUsers crea las cuentas de demostración (ids 1..7) con contraseña bcrypt.
func SeedUsers(password string) func(ctx context.Context, tx pgx.Tx) error {
	return func(ctx context.Context, tx pgx.Tx) error {
		hash, err := security.HashPassword(password)
		if err != nil {
			return err
		}
		users := []struct{ email, name, role, specialty, license, color string }{
			{"admin@sigodental.com", "Administrador del Sistema", RoleAdmin, "", "", "#475569"},
			{"recepcion@sigodental.com", "Laura Méndez", RoleRecepcion, "", "", "#7c3aed"},
			{"dra.torres@sigodental.com", "Dra. Valeria Torres", RoleOdontologo, "Odontología general y estética", "MSP-ODO-10234", "#0d9488"},
			{"dr.ramirez@sigodental.com", "Dr. Andrés Ramírez", RoleOdontologo, "Endodoncia y cirugía oral", "MSP-ODO-08811", "#2563eb"},
			{"dra.castillo@sigodental.com", "Dra. Camila Castillo", RoleOdontologo, "Ortodoncia y odontopediatría", "MSP-ODO-11570", "#db2777"},
			{"asistente@sigodental.com", "Sofía Vargas", RoleAsistente, "", "", "#ea580c"},
			{"auditor@sigodental.com", "Carlos Ortega", RoleAuditor, "", "", "#65a30d"},
		}
		for i, u := range users {
			_, err := tx.Exec(ctx, `INSERT INTO users (id, email, password_hash, full_name, role, specialty, license_number, color)
				VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8)`,
				i+1, u.email, hash, u.name, u.role, u.specialty, u.license, u.color)
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `SELECT setval('users_id_seq', 7)`)
		return err
	}
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) issueSession(c *Ctx, u map[string]any, mfa bool) error {
	claims := security.Claims{
		UserID: i64(u["id"]), Email: str(u["email"]), Name: str(u["full_name"]), Role: str(u["role"]), MFA: mfa,
	}
	token, err := security.IssueToken(s.cfg.JWTSecret, claims, s.cfg.TokenTTL)
	if err != nil {
		return err
	}
	_, _ = s.db.Exec(c.Context(), `UPDATE users SET last_login_at = now() WHERE id = $1`, claims.UserID)
	c.User = &claims
	c.action = "LOGIN"
	c.Audit(claims.UserID, 0, map[string]any{"mfa": mfa})
	return c.OK(map[string]any{"token": token, "user": publicUser(u, mfa)})
}

func publicUser(u map[string]any, mfa bool) map[string]any {
	return map[string]any{
		"id": u["id"], "email": u["email"], "full_name": u["full_name"], "role": u["role"],
		"specialty": u["specialty"], "color": u["color"], "mfa_enabled": u["mfa_enabled"], "mfa_verified": mfa,
	}
}

func (s *Server) login(c *Ctx) error {
	var req loginReq
	if err := c.Bind(&req); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	key := email + "|" + c.IP()
	if s.limiter.blocked(key) {
		return &HTTPError{Code: 429, Message: "Demasiados intentos fallidos. Intente nuevamente en 15 minutos."}
	}
	u, err := db.Row(c.Context(), s.db, `SELECT * FROM users WHERE email = $1`, email)
	if err != nil || !security.CheckPassword(str(u["password_hash"]), req.Password) || u["active"] != true {
		s.limiter.fail(key)
		s.audit(c, routeOpts{entity: "auth"}, "POST", "LOGIN_FAILED", 401)
		if err == nil && u["active"] != true {
			return &HTTPError{Code: 401, Message: "La cuenta está desactivada"}
		}
		return &HTTPError{Code: 401, Message: "Correo o contraseña incorrectos"}
	}
	s.limiter.reset(key)
	if u["mfa_enabled"] == true {
		pending, err := security.IssueToken(s.cfg.JWTSecret, security.Claims{UserID: i64(u["id"]), Email: email, Role: "mfa_pending"}, 5*time.Minute)
		if err != nil {
			return err
		}
		return c.OK(map[string]any{"mfa_required": true, "mfa_token": pending})
	}
	return s.issueSession(c, u, false)
}

func (s *Server) loginMFA(c *Ctx) error {
	var req struct {
		Token string `json:"mfa_token"`
		Code  string `json:"code"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}
	claims, err := security.ParseToken(s.cfg.JWTSecret, req.Token)
	if err != nil || claims.Role != "mfa_pending" {
		return &HTTPError{Code: 401, Message: "La verificación expiró. Inicie sesión nuevamente."}
	}
	key := "mfa|" + claims.Email
	if s.limiter.blocked(key) {
		return &HTTPError{Code: 429, Message: "Demasiados códigos inválidos. Intente más tarde."}
	}
	u, err := db.Row(c.Context(), s.db, `SELECT * FROM users WHERE id = $1 AND active`, claims.UserID)
	if err != nil {
		return err
	}
	if !security.VerifyTOTP(str(u["mfa_secret"]), req.Code) {
		s.limiter.fail(key)
		return &HTTPError{Code: 401, Message: "Código de verificación incorrecto"}
	}
	s.limiter.reset(key)
	return s.issueSession(c, u, true)
}

func (s *Server) me(c *Ctx) error {
	u, err := db.Row(c.Context(), s.db, `SELECT * FROM users WHERE id = $1`, c.User.UserID)
	if err != nil {
		return err
	}
	return c.OK(publicUser(u, c.User.MFA))
}

func (s *Server) changePassword(c *Ctx) error {
	var req struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}
	if err := security.ValidatePasswordPolicy(req.New); err != nil {
		return badRequest(err.Error())
	}
	u, err := db.Row(c.Context(), s.db, `SELECT password_hash FROM users WHERE id = $1`, c.User.UserID)
	if err != nil {
		return err
	}
	if !security.CheckPassword(str(u["password_hash"]), req.Current) {
		return badRequest("La contraseña actual es incorrecta")
	}
	hash, err := security.HashPassword(req.New)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(c.Context(), `UPDATE users SET password_hash = $1 WHERE id = $2`, hash, c.User.UserID)
	if err != nil {
		return err
	}
	return c.OK(map[string]any{"ok": true})
}

func (s *Server) mfaSetup(c *Ctx) error {
	secret := security.NewTOTPSecret()
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET mfa_secret = $1, mfa_enabled = FALSE WHERE id = $2`, secret, c.User.UserID); err != nil {
		return err
	}
	return c.OK(map[string]any{
		"secret":      secret,
		"otpauth_url": security.TOTPURL("SIGO-Dental", c.User.Email, secret),
	})
}

func (s *Server) mfaEnable(c *Ctx) error {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}
	u, err := db.Row(c.Context(), s.db, `SELECT * FROM users WHERE id = $1`, c.User.UserID)
	if err != nil {
		return err
	}
	if str(u["mfa_secret"]) == "" {
		return badRequest("Primero genere el código QR")
	}
	if !security.VerifyTOTP(str(u["mfa_secret"]), req.Code) {
		return badRequest("Código incorrecto. Verifique la hora de su teléfono e intente de nuevo.")
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET mfa_enabled = TRUE WHERE id = $1`, c.User.UserID); err != nil {
		return err
	}
	u["mfa_enabled"] = true
	return s.issueSession(c, u, true)
}

func (s *Server) mfaDisable(c *Ctx) error {
	var req struct {
		Password string `json:"password"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}
	u, err := db.Row(c.Context(), s.db, `SELECT * FROM users WHERE id = $1`, c.User.UserID)
	if err != nil {
		return err
	}
	if !security.CheckPassword(str(u["password_hash"]), req.Password) {
		return badRequest("Contraseña incorrecta")
	}
	if s.settings.Bool("mfa_obligatorio") && c.User.Role != RoleAdmin {
		return forbidden("La política de la clínica exige MFA; no puede desactivarlo")
	}
	_, err = s.db.Exec(c.Context(), `UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1`, c.User.UserID)
	if err != nil {
		return err
	}
	u["mfa_enabled"] = false
	return s.issueSession(c, u, false)
}

// verifyPassword se usa para firmar documentos clínicos (re-autenticación).
func (s *Server) verifyPassword(ctx context.Context, userID int64, pw string) bool {
	u, err := db.Row(ctx, s.db, `SELECT password_hash FROM users WHERE id = $1`, userID)
	return err == nil && security.CheckPassword(str(u["password_hash"]), pw)
}
