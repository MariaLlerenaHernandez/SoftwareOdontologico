package api

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizePhone(t *testing.T) {
	g := NewGatewayNotifier(nil, &TwilioConfig{DefaultCountryCode: "+593"})
	cases := map[string]string{
		"+593 99 123 4567": "+593991234567",
		"0991234567":       "+593991234567",
		"(099) 123-4567":   "+593991234567",
		"+1 415 523 8886":  "+14155238886",
	}
	for in, want := range cases {
		if got := g.normalizePhone(in); got != want {
			t.Errorf("normalizePhone(%q) = %q, se esperaba %q", in, got, want)
		}
	}
}

func TestGatewayFallsBackToSimulated(t *testing.T) {
	g := NewGatewayNotifier(nil, nil)
	if g.Live("email") || g.Live("sms") || g.Live("whatsapp") {
		t.Fatal("sin configuración ningún canal debe ser real")
	}
	provider, ref, err := g.Send(context.Background(), "email", "a@b.com", "x", "y")
	if err != nil || !strings.Contains(provider, "simulado") || !strings.HasPrefix(ref, "SIM-") {
		t.Errorf("debe usar el modo simulado: %s %s %v", provider, ref, err)
	}
	g = NewGatewayNotifier(&SMTPConfig{Host: "smtp.example.com"}, &TwilioConfig{AccountSID: "AC", SMSFrom: "+1"})
	if !g.Live("email") || !g.Live("sms") || g.Live("whatsapp") {
		t.Error("los canales configurados deben marcarse como reales")
	}
}

func TestTwilioRequest(t *testing.T) {
	var got map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		user, _, _ := r.BasicAuth()
		got = map[string]string{"to": r.Form.Get("To"), "from": r.Form.Get("From"), "user": user, "path": r.URL.Path}
		_ = json.NewEncoder(w).Encode(map[string]string{"sid": "SM123"})
	}))
	defer srv.Close()
	g := NewGatewayNotifier(nil, &TwilioConfig{AccountSID: "AC1", AuthToken: "tok", WhatsAppFrom: "+14155238886"})
	g.http = srv.Client()
	g.http.Transport = rewrite{srv.URL}
	provider, ref, err := g.Send(context.Background(), "whatsapp", "+593 99 111 2222", "s", "hola")
	if err != nil || ref != "SM123" || provider != "twilio-whatsapp" {
		t.Fatalf("envío: %s %s %v", provider, ref, err)
	}
	if got["to"] != "whatsapp:+593991112222" || got["from"] != "whatsapp:+14155238886" || got["user"] != "AC1" {
		t.Errorf("petición a Twilio incorrecta: %v", got)
	}
}

// rewrite redirige las peticiones HTTP salientes al servidor de prueba.
type rewrite struct{ base string }

func (rw rewrite) RoundTrip(r *http.Request) (*http.Response, error) {
	r2 := r.Clone(r.Context())
	u := strings.TrimPrefix(rw.base, "http://")
	r2.URL.Scheme, r2.URL.Host = "http", u
	return http.DefaultTransport.RoundTrip(r2)
}

func TestIntegrationStripeAndSRI(t *testing.T) {
	paid := false
	invoiceID := ""
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk_test_fake" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"message":"Invalid API Key"}}`))
			return
		}
		_ = r.ParseForm()
		if v := r.Form.Get("metadata[invoice_id]"); v != "" {
			invoiceID = v
		}
		status := "unpaid"
		if paid {
			status = "paid"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cs_test_1", "url": "https://checkout.stripe.com/pay/cs_test_1", "payment_status": status,
			"amount_total": 2500, "payment_intent": "pi_123", "metadata": map[string]string{"invoice_id": invoiceID},
		})
	}))
	defer fake.Close()
	old := stripeAPI
	stripeAPI = fake.URL
	defer func() { stripeAPI = old }()

	_, login := setup(t, func(c *Config) { c.StripeKey = "sk_test_fake" })
	rec := login("recepcion@sigodental.com")

	c, integ, _ := rec.do("GET", "/integrations", nil)
	if c != 200 || integ["stripe"] != true || integ["email"] != false {
		t.Fatalf("estado de integraciones: %v", integ)
	}
	// Se crea una factura con saldo pendiente para el paciente 1.
	c, inv, _ := rec.do("POST", "/invoices", map[string]any{"patient_id": 1, "items": []any{map[string]any{"description": "Consulta", "unit_price": 40}}})
	expect(t, "factura", c, 201, inv)
	id := inv["id"]

	c, r, _ := rec.do("POST", fmt.Sprintf("/invoices/%v/stripe-checkout", id), map[string]any{"amount": 25, "return_url": "http://localhost:5173/facturacion"})
	expect(t, "crear checkout", c, 200, r)
	if !strings.HasPrefix(fmt.Sprint(r["url"]), "https://checkout.stripe.com/") {
		t.Errorf("url de checkout: %v", r["url"])
	}
	c, r, _ = rec.do("POST", fmt.Sprintf("/invoices/%v/stripe-checkout", id), map[string]any{"amount": 999, "return_url": "http://localhost"})
	expect(t, "monto mayor al saldo", c, 400, r)
	c, r, _ = rec.do("POST", fmt.Sprintf("/invoices/%v/stripe-confirm", id), map[string]any{"session_id": "cs_test_1"})
	expect(t, "pago no confirmado", c, 409, r)

	paid = true
	c, r, _ = rec.do("POST", fmt.Sprintf("/invoices/%v/stripe-confirm", id), map[string]any{"session_id": "cs_test_1"})
	expect(t, "confirmar pago", c, 200, r)
	if r["paid"].(float64) != 25 || r["status"] != "parcial" {
		t.Errorf("pago registrado: paid=%v status=%v", r["paid"], r["status"])
	}
	c, r, _ = rec.do("POST", fmt.Sprintf("/invoices/%v/stripe-confirm", id), map[string]any{"session_id": "cs_test_1"})
	if c != 200 || r["already_registered"] != true || r["paid"].(float64) != 25 {
		t.Errorf("la confirmación repetida no debe duplicar el pago: %v %v", r["paid"], r["already_registered"])
	}

	// XML del comprobante según el esquema del SRI
	req := httptest.NewRequest("GET", fmt.Sprintf("/api/invoices/%v/xml", id), nil)
	req.Header.Set("Authorization", "Bearer "+rec.tok)
	rr := httptest.NewRecorder()
	rec.h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("xml: %d %s", rr.Code, rr.Body.String())
	}
	var f sriFactura
	if err := xml.Unmarshal(rr.Body.Bytes(), &f); err != nil {
		t.Fatal(err)
	}
	if f.Version != "1.1.0" || len(f.InfoTributaria.ClaveAcceso) != 49 || f.InfoTributaria.CodDoc != "01" ||
		f.InfoFactura.ImporteTotal != "40.00" || len(f.Detalles) != 1 || f.InfoFactura.Pagos[0].FormaPago != "19" {
		t.Errorf("XML SRI incompleto: %+v", f)
	}
}
