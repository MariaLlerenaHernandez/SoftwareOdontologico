package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"sigo-dental/internal/security"
)

func TestValidTooth(t *testing.T) {
	for _, ok := range []int{11, 18, 28, 38, 48, 51, 55, 65, 75, 85} {
		if !validTooth(ok) {
			t.Errorf("%d debería ser válida", ok)
		}
	}
	for _, bad := range []int{10, 19, 49, 56, 86, 91, 0, 100} {
		if validTooth(bad) {
			t.Errorf("%d no debería ser válida", bad)
		}
	}
}

func TestPgErrorMapping(t *testing.T) {
	cases := map[string]int{"23P01": 409, "23505": 409, "23503": 400, "23514": 400, "P0001": 409}
	for code, want := range cases {
		he := pgToHTTP(&pgconn.PgError{Code: code, Message: "IMMUTABLE: prueba"})
		if he.Code != want {
			t.Errorf("%s → %d, se esperaba %d", code, he.Code, want)
		}
	}
	if he := pgToHTTP(&pgconn.PgError{Code: "23P01"}); he.Reason != "chair_overlap" {
		t.Error("la exclusión de sillón debe identificarse como RN-03")
	}
}

func TestHelpers(t *testing.T) {
	if guessEntity("/api/patients/{id}/notes") != "notes" || guessEntity("/api/invoices/{id}") != "invoices" {
		t.Error("guessEntity")
	}
	if !isFinancial("/api/invoices/3") || isFinancial("/api/patients") {
		t.Error("isFinancial")
	}
	if actionFor("GET") != "READ" || actionFor("DELETE") != "DELETE" || actionFor("PATCH") != "UPDATE" {
		t.Error("actionFor")
	}
}

func TestLoginLimiter(t *testing.T) {
	l := newLoginLimiter()
	for i := 0; i < maxLoginFailures; i++ {
		if l.blocked("x") {
			t.Fatal("bloqueado antes de tiempo")
		}
		l.fail("x")
	}
	if !l.blocked("x") {
		t.Error("debe bloquear tras 5 intentos")
	}
	l.reset("x")
	if l.blocked("x") {
		t.Error("reset debe desbloquear")
	}
}

// Las rutas protegidas responden 401 sin token y 403 si el rol no está autorizado,
// sin llegar a tocar la base de datos.
func TestRBACMiddleware(t *testing.T) {
	secret := []byte("test")
	s := &Server{cfg: Config{JWTSecret: secret}, settings: &settingsCache{vals: map[string]string{}}, mux: http.NewServeMux()}
	called := false
	s.mux.HandleFunc("GET /api/secure", func(w http.ResponseWriter, r *http.Request) {
		c := &Ctx{W: w, R: r, s: s}
		claims, err := s.authenticate(r)
		if err != nil {
			_ = c.JSON(401, &HTTPError{Message: "x"})
			return
		}
		c.User = claims
		if !c.Is(RoleAdmin) {
			_ = c.JSON(403, &HTTPError{Message: "x"})
			return
		}
		called = true
		_ = c.OK(map[string]any{"ok": true})
	})
	do := func(token string) int {
		req := httptest.NewRequest("GET", "/api/secure", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rr := httptest.NewRecorder()
		s.mux.ServeHTTP(rr, req)
		return rr.Code
	}
	if do("") != 401 {
		t.Error("sin token debe ser 401")
	}
	tok, _ := security.IssueToken(secret, security.Claims{UserID: 2, Role: RoleRecepcion}, time.Minute)
	if do(tok) != 403 {
		t.Error("rol no autorizado debe ser 403")
	}
	pending, _ := security.IssueToken(secret, security.Claims{UserID: 2, Role: "mfa_pending"}, time.Minute)
	if do(pending) != 401 {
		t.Error("token MFA pendiente no da acceso")
	}
	adm, _ := security.IssueToken(secret, security.Claims{UserID: 1, Role: RoleAdmin}, time.Minute)
	if do(adm) != 200 || !called {
		t.Error("admin debe acceder")
	}
}
