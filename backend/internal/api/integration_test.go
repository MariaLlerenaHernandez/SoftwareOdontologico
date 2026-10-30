package api

// Pruebas de integración de los endpoints críticos contra PostgreSQL real.
// Se ejecutan solo si TEST_DATABASE_URL apunta a una base desechable:
//
//	TEST_DATABASE_URL=postgres://sigo:sigo_dental_2026@localhost:5435/sigo_test?sslmode=disable go test ./...
//
// ¡La base indicada se reinicia por completo!

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/security"
)

type client struct {
	t   *testing.T
	h   http.Handler
	tok string
}

func (c client) do(method, path string, body any) (int, map[string]any, []any) {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/api"+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if c.tok != "" {
		req.Header.Set("Authorization", "Bearer "+c.tok)
	}
	rr := httptest.NewRecorder()
	c.h.ServeHTTP(rr, req)
	var obj map[string]any
	var arr []any
	raw := rr.Body.Bytes()
	if len(raw) > 0 && raw[0] == '[' {
		_ = json.Unmarshal(raw, &arr)
	} else {
		_ = json.Unmarshal(raw, &obj)
	}
	return rr.Code, obj, arr
}

func setup(t *testing.T) (http.Handler, func(email string) client) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL no definido: se omiten las pruebas de integración")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url, "America/Guayaquil")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Migrate(ctx, pool, SeedUsers("Sigo2026!")); err != nil {
		t.Fatal(err)
	}
	fc, _ := security.NewFileCipher("test")
	loc, _ := time.LoadLocation("America/Guayaquil")
	if loc == nil {
		loc = time.FixedZone("UTC-5", -5*3600)
	}
	s := New(pool, Config{JWTSecret: []byte("test-secret"), TokenTTL: time.Hour, UploadDir: t.TempDir(), Location: loc}, fc)
	if err := s.LoadSettings(ctx); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	login := func(email string) client {
		code, r, _ := client{t: t, h: h}.do("POST", "/auth/login", map[string]any{"email": email, "password": "Sigo2026!"})
		if code != 200 {
			t.Fatalf("login %s: %d %v", email, code, r)
		}
		return client{t: t, h: h, tok: r["token"].(string)}
	}
	return h, login
}

func expect(t *testing.T, name string, got, want int, body any) {
	t.Helper()
	if got != want {
		t.Errorf("%s: HTTP %d, se esperaba %d (%v)", name, got, want, body)
	}
}

func TestIntegrationCriticalFlows(t *testing.T) {
	h, login := setup(t)
	anon := client{t: t, h: h}
	dr := login("dra.torres@sigodental.com")
	dr4 := login("dr.ramirez@sigodental.com")
	rec := login("recepcion@sigodental.com")
	asis := login("asistente@sigodental.com")
	adm := login("admin@sigodental.com")
	aud := login("auditor@sigodental.com")

	t.Run("autenticación y RBAC", func(t *testing.T) {
		c, r, _ := anon.do("POST", "/auth/login", map[string]any{"email": "admin@sigodental.com", "password": "x"})
		expect(t, "login inválido", c, 401, r)
		c, _, _ = anon.do("GET", "/patients", nil)
		expect(t, "sin token", c, 401, nil)
		c, _, _ = asis.do("GET", "/invoices", nil)
		expect(t, "asistente → facturas", c, 403, nil)
		c, _, _ = rec.do("GET", "/patients/1/notes", nil)
		expect(t, "recepción → notas", c, 403, nil)
		c, _, _ = dr.do("GET", "/users", nil)
		expect(t, "odontólogo → usuarios", c, 403, nil)
		c, r, _ = dr.do("GET", "/auth/me", nil)
		expect(t, "me", c, 200, r)
	})

	t.Run("pacientes y anamnesis", func(t *testing.T) {
		c, r, _ := rec.do("POST", "/patients", map[string]any{"first_name": "Ana", "last_name": "Prueba", "document_number": "0999999999",
			"birth_date": time.Now().AddDate(-10, 0, 0).Format("2006-01-02"), "sex": "F", "phone": "0999"})
		expect(t, "menor sin tutor", c, 400, r)
		c, r, _ = rec.do("POST", "/patients", map[string]any{"first_name": "Ana", "last_name": "Prueba", "document_number": "0999999999",
			"birth_date": "1990-01-01", "sex": "F", "phone": "0999"})
		expect(t, "alta de paciente", c, 201, r)
		id := int(r["id"].(float64))
		c, r, _ = rec.do("POST", "/patients", map[string]any{"first_name": "X", "last_name": "Y", "document_number": "0999999999", "birth_date": "1990-01-01", "sex": "F", "phone": "1"})
		expect(t, "documento duplicado", c, 409, r)
		c, r, _ = dr.do("PUT", fmt.Sprintf("/patients/%d/history", id), map[string]any{"penicillin_allergy": true, "anticoagulated": true})
		expect(t, "anamnesis", c, 200, r)
		c, r, _ = dr.do("GET", fmt.Sprintf("/patients/%d", id), nil)
		if alerts, _ := r["alerts"].([]any); c != 200 || len(alerts) != 2 {
			t.Errorf("alertas críticas: %v", r["alerts"])
		}
		c, r, _ = asis.do("POST", fmt.Sprintf("/patients/%d/vitals", id), map[string]any{"systolic": 120, "diastolic": 80, "spo2": 98})
		expect(t, "signos vitales", c, 201, r)
	})

	t.Run("odontograma y periodontograma", func(t *testing.T) {
		c, r, _ := dr.do("POST", "/patients/3/odontogram", map[string]any{"tooth": 99, "condition": "caries", "surface": "O"})
		expect(t, "pieza inválida", c, 400, r)
		c, r, _ = dr.do("POST", "/patients/3/odontogram", map[string]any{"tooth": 85, "condition": "caries", "surface": "O"})
		expect(t, "pieza temporal", c, 201, r)
		c, r, _ = dr.do("DELETE", fmt.Sprintf("/odontogram/%v", r["id"]), nil)
		expect(t, "borrar no realizado", c, 200, r)
		teeth := map[string]any{"16": map[string]any{"pd": []int{3, 2, 5, 4, 3, 3}, "gm": []int{0, 0, 1, 0, 0, 0}, "bleeding": []bool{true, false, false, false, false, false}}}
		c, r, _ = dr.do("POST", "/patients/3/perio", map[string]any{"teeth": teeth})
		expect(t, "periodontograma", c, 201, r)
	})

	t.Run("agenda RN-03 y estados", func(t *testing.T) {
		start := time.Now().Add(72 * time.Hour).Truncate(time.Hour)
		body := map[string]any{"patient_id": 5, "dentist_id": 3, "chair_id": 2, "starts_at": start, "ends_at": start.Add(time.Hour), "notify": true}
		c, r, _ := rec.do("POST", "/appointments", body)
		expect(t, "agendar", c, 201, r)
		apptID := r["id"]
		body["dentist_id"], body["starts_at"], body["ends_at"] = 5, start.Add(30*time.Minute), start.Add(90*time.Minute)
		c, r, _ = rec.do("POST", "/appointments", body)
		expect(t, "RN-03 sillón ocupado", c, 409, r)
		if r["code"] != "chair_overlap" {
			t.Errorf("código esperado chair_overlap: %v", r)
		}
		body["chair_id"] = 3
		c, r, _ = rec.do("POST", "/appointments", body)
		expect(t, "mismo horario otro sillón", c, 201, r)
		c, r, _ = rec.do("POST", fmt.Sprintf("/appointments/%v/status", apptID), map[string]any{"status": "atendido"})
		expect(t, "transición inválida", c, 409, r)
		c, r, _ = rec.do("POST", fmt.Sprintf("/appointments/%v/status", apptID), map[string]any{"status": "cancelado"})
		expect(t, "cancelar sin motivo", c, 400, r)
		c, r, _ = rec.do("POST", fmt.Sprintf("/appointments/%v/status", apptID), map[string]any{"status": "confirmado"})
		expect(t, "confirmar", c, 200, r)
		c, _, list := adm.do("GET", "/notifications", nil)
		if c != 200 || len(list) == 0 {
			t.Error("debe registrarse la notificación de confirmación")
		}
	})

	t.Run("plan, inventario, factura y caja", func(t *testing.T) {
		c, plan, _ := dr4.do("GET", "/plans/2", nil)
		expect(t, "plan", c, 200, plan)
		var exo, rx float64
		for _, it := range plan["items"].([]any) {
			m := it.(map[string]any)
			switch m["procedure_code"] {
			case "EXO-02":
				exo = m["id"].(float64)
			case "RX-02":
				rx = m["id"].(float64)
			}
		}
		c, r, _ := rec.do("POST", "/plans/2/approve", map[string]any{"item_ids": []float64{exo, rx}, "approved_by_name": "Paciente"})
		expect(t, "aprobación parcial", c, 200, r)
		if r["status"] != "aprobado_parcial" {
			t.Errorf("estado del plan: %v", r["status"])
		}
		_, before, _ := dr.do("GET", "/supplies", nil)
		_ = before
		c, r, _ = dr4.do("POST", fmt.Sprintf("/plan-items/%v/complete", exo), nil)
		expect(t, "realizar procedimiento", c, 200, r)
		if consumed, _ := r["consumed"].([]any); len(consumed) == 0 {
			t.Error("debe descontar insumos de la receta")
		}
		c, _, odo := dr.do("GET", "/patients/2/odontogram", nil)
		var doneID float64
		for _, f := range odo {
			m := f.(map[string]any)
			if m["status"] == "realizado" && m["tooth"].(float64) == 18 {
				doneID = m["id"].(float64)
			}
		}
		c, r, _ = dr.do("DELETE", fmt.Sprintf("/odontogram/%v", doneID), nil)
		expect(t, "RN-01 realizado inmutable", c, 409, r)

		c, r, _ = rec.do("POST", "/invoices", map[string]any{"patient_id": 2, "items": []any{map[string]any{"plan_item_id": exo}},
			"payments": []any{map[string]any{"method": "efectivo", "amount": 150}}})
		expect(t, "efectivo sin caja abierta", c, 409, r)
		c, r, _ = rec.do("POST", "/cash/open", map[string]any{"opening_amount": 20})
		expect(t, "abrir caja", c, 201, r)
		c, cur, _ := rec.do("GET", "/cash/current", nil)
		if _, leaked := cur["expected_cash"]; c != 200 || leaked {
			t.Error("RN-02: la caja abierta no debe exponer el total teórico")
		}
		c, r, _ = rec.do("POST", "/invoices", map[string]any{"patient_id": 2, "items": []any{map[string]any{"plan_item_id": exo}},
			"payments": []any{map[string]any{"method": "efectivo", "amount": 100}, map[string]any{"method": "tarjeta_credito", "amount": 50}}})
		expect(t, "tarjeta sin referencia", c, 400, r)
		c, inv, _ := rec.do("POST", "/invoices", map[string]any{"patient_id": 2, "items": []any{map[string]any{"plan_item_id": exo}},
			"payments": []any{map[string]any{"method": "efectivo", "amount": 100}}})
		expect(t, "factura", c, 201, inv)
		if inv["status"] != "parcial" || len(inv["access_key"].(string)) != 49 {
			t.Errorf("factura: %v %v", inv["status"], inv["access_key"])
		}
		c, r, _ = rec.do("POST", fmt.Sprintf("/invoices/%v/payments", inv["id"]), map[string]any{"method": "transferencia", "amount": 50, "reference": "TRX-1"})
		expect(t, "abono", c, 200, r)
		if r["status"] != "pagada" {
			t.Errorf("tras abono debe quedar pagada: %v", r["status"])
		}
		c, r, _ = rec.do("POST", fmt.Sprintf("/invoices/%v/payments", inv["id"]), map[string]any{"method": "efectivo", "amount": 1})
		expect(t, "pago sobre factura pagada", c, 409, r)
		c, r, _ = rec.do("POST", "/cash/close", map[string]any{"counted_cash": 115})
		expect(t, "cierre ciego", c, 200, r)
		if r["expected_cash"].(float64) != 120 || r["difference"].(float64) != -5 {
			t.Errorf("cierre: esperado %v diferencia %v", r["expected_cash"], r["difference"])
		}
		c, rep, _ := aud.do("GET", "/commissions/report?dentist_id=4&from="+time.Now().Format("2006-01-02")+"&to="+time.Now().Format("2006-01-02"), nil)
		expect(t, "honorarios", c, 200, rep)
		c, r, _ = adm.do("POST", fmt.Sprintf("/invoices/%v/void", inv["id"]), map[string]any{"reason": "Error de digitación"})
		expect(t, "anular", c, 200, r)
	})

	t.Run("notas SOEP, recetas y consentimientos", func(t *testing.T) {
		c, n, _ := dr.do("POST", "/patients/4/notes", map[string]any{"subjective": "Dolor", "plan": "Control"})
		expect(t, "nota", c, 201, n)
		c, r, _ := dr.do("POST", fmt.Sprintf("/notes/%v/sign", n["id"]), map[string]any{"password": "mala"})
		expect(t, "firma con clave incorrecta", c, 400, r)
		c, r, _ = dr4.do("POST", fmt.Sprintf("/notes/%v/sign", n["id"]), map[string]any{"password": "Sigo2026!"})
		expect(t, "firma por otro profesional", c, 403, r)
		c, r, _ = dr.do("POST", fmt.Sprintf("/notes/%v/sign", n["id"]), map[string]any{"password": "Sigo2026!"})
		expect(t, "firma", c, 200, r)
		c, r, _ = dr.do("PUT", fmt.Sprintf("/notes/%v", n["id"]), map[string]any{"plan": "otro"})
		expect(t, "editar firmada", c, 409, r)
		c, r, _ = dr.do("POST", "/patients/4/notes", map[string]any{"parent_note_id": n["id"], "plan": "Adenda"})
		expect(t, "adenda", c, 201, r)

		rx := map[string]any{"items": []any{map[string]any{"medicamento": "Amoxicilina 500 mg", "dosis": "1", "frecuencia": "c/8h", "duracion": "7 días"}}}
		c, r, _ = dr.do("POST", "/patients/1/prescriptions", rx)
		expect(t, "alergia a penicilina", c, 409, r)
		rx["override_allergy"] = true
		c, r, _ = dr.do("POST", "/patients/1/prescriptions", rx)
		expect(t, "receta con criterio clínico", c, 201, r)

		c, k, _ := rec.do("POST", "/patients/2/consents", map[string]any{"template_id": 1})
		expect(t, "consentimiento", c, 201, k)
		c, otp, _ := rec.do("POST", fmt.Sprintf("/consents/%v/otp", k["id"]), nil)
		expect(t, "OTP", c, 200, otp)
		signer := map[string]any{"signer_name": "Juan", "signer_document": "1709876543", "code": "abc"}
		c, r, _ = rec.do("POST", fmt.Sprintf("/consents/%v/verify-otp", k["id"]), signer)
		expect(t, "OTP incorrecto", c, 400, r)
		signer["code"] = otp["demo_code"]
		c, r, _ = rec.do("POST", fmt.Sprintf("/consents/%v/verify-otp", k["id"]), signer)
		expect(t, "OTP correcto", c, 200, r)
		c, r, _ = rec.do("POST", fmt.Sprintf("/consents/%v/verify-otp", k["id"]), signer)
		expect(t, "consentimiento ya firmado", c, 409, r)
	})

	t.Run("administración, reportes y auditoría", func(t *testing.T) {
		c, r, _ := dr.do("POST", "/patients/5/plans", map[string]any{"title": "x", "discount_pct": 40})
		expect(t, "descuento sin autorización", c, 403, r)
		c, r, _ = adm.do("PUT", "/settings", map[string]string{"iva_pct": "200"})
		expect(t, "configuración fuera de rango", c, 400, r)
		c, r, _ = adm.do("POST", "/users", map[string]any{"email": "nuevo@sigodental.com", "full_name": "Nuevo", "role": "asistente", "password": "debil"})
		expect(t, "política de contraseñas", c, 400, r)
		for _, p := range []string{"/reports/dashboard", "/reports/revenue", "/reports/appointments", "/reports/inventory", "/audit", "/cash/sessions", "/commissions/rules", "/stock-movements"} {
			c, _, _ = aud.do("GET", p, nil)
			expect(t, p, c, 200, nil)
		}
		c, _, logs := aud.do("GET", "/audit?action=READ", nil)
		if c != 200 || len(logs) == 0 {
			t.Error("la lectura de expedientes debe auditarse")
		}
		c, r, _ = adm.do("GET", "/admin/backup", nil)
		expect(t, "respaldo", c, 200, nil)
	})
}
