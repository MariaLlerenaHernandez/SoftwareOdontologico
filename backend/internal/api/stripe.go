package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
)

// ------------------------------------- Pasarela de pagos (sección 7.1)
//
// Cobro con tarjeta mediante Stripe Checkout: la API crea una sesión de pago,
// el navegador del cajero redirige a la página segura de Stripe y, al volver,
// la API verifica la sesión directamente con Stripe antes de registrar el pago.
// Los datos de la tarjeta nunca pasan por SIGO-Dental.

var stripeAPI = "https://api.stripe.com/v1" // variable para poder probar contra un servidor falso

type stripeSession struct {
	ID            string            `json:"id"`
	URL           string            `json:"url"`
	PaymentStatus string            `json:"payment_status"`
	AmountTotal   int64             `json:"amount_total"`
	PaymentIntent string            `json:"payment_intent"`
	Metadata      map[string]string `json:"metadata"`
	Error         *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (s *Server) stripeCall(ctx context.Context, method, path string, form url.Values) (*stripeSession, error) {
	var body *strings.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	} else {
		body = strings.NewReader("")
	}
	req, err := http.NewRequestWithContext(ctx, method, stripeAPI+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.StripeKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out stripeSession
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out.Error != nil {
		return nil, errors.New("Stripe: " + out.Error.Message)
	}
	return &out, nil
}

func (s *Server) stripeCheckout(c *Ctx) error {
	if s.cfg.StripeKey == "" {
		return badRequest("La pasarela de pagos no está configurada (STRIPE_SECRET_KEY)")
	}
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Amount    float64 `json:"amount"`
		ReturnURL string  `json:"return_url"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	ret, err := url.Parse(r.ReturnURL)
	if err != nil || (ret.Scheme != "http" && ret.Scheme != "https") || ret.Host == "" {
		return badRequest("URL de retorno inválida")
	}
	inv, err := db.Row(c.Context(), s.db, `SELECT i.*, p.email FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id=$1`, id)
	if err != nil {
		return err
	}
	if inv["status"] == "anulada" || inv["status"] == "pagada" {
		return conflict("La factura no tiene saldo pendiente")
	}
	balance := domain.Round2(num(inv["total"]) - num(inv["paid"]))
	if r.Amount <= 0 || r.Amount > balance+0.001 {
		return badRequest(fmt.Sprintf("El monto debe estar entre 0,01 y el saldo (%.2f)", balance))
	}
	cents := int64(math.Round(r.Amount * 100))
	base := ret.Scheme + "://" + ret.Host + ret.Path
	form := url.Values{
		"mode":                                   {"payment"},
		"success_url":                            {fmt.Sprintf("%s?stripe_session={CHECKOUT_SESSION_ID}&invoice=%d", base, id)},
		"cancel_url":                             {fmt.Sprintf("%s?stripe_cancel=1&invoice=%d", base, id)},
		"client_reference_id":                    {fmt.Sprint(id)},
		"metadata[invoice_id]":                   {fmt.Sprint(id)},
		"line_items[0][quantity]":                {"1"},
		"line_items[0][price_data][currency]":    {strings.ToLower(s.settings.Get("moneda"))},
		"line_items[0][price_data][unit_amount]": {fmt.Sprint(cents)},
		"line_items[0][price_data][product_data][name]":        {"Factura " + str(inv["number"]) + " · " + s.settings.Get("clinica_nombre")},
		"line_items[0][price_data][product_data][description]": {"Servicios odontológicos — " + str(inv["customer_name"])},
	}
	if e := str(inv["email"]); e != "" {
		form.Set("customer_email", e)
	}
	sess, err := s.stripeCall(c.Context(), http.MethodPost, "/checkout/sessions", form)
	if err != nil {
		return &HTTPError{Code: 502, Message: err.Error()}
	}
	c.Audit(id, i64(inv["patient_id"]), map[string]any{"stripe_session": sess.ID, "amount": r.Amount})
	return c.OK(map[string]any{"url": sess.URL, "session_id": sess.ID})
}

// stripeConfirm verifica con Stripe que la sesión fue pagada y registra el pago una sola vez.
func (s *Server) stripeConfirm(c *Ctx) error {
	if s.cfg.StripeKey == "" {
		return badRequest("La pasarela de pagos no está configurada")
	}
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		SessionID string `json:"session_id"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if !strings.HasPrefix(r.SessionID, "cs_") {
		return badRequest("Sesión de pago inválida")
	}
	sess, err := s.stripeCall(c.Context(), http.MethodGet, "/checkout/sessions/"+url.PathEscape(r.SessionID), nil)
	if err != nil {
		return &HTTPError{Code: 502, Message: err.Error()}
	}
	if sess.Metadata["invoice_id"] != fmt.Sprint(id) {
		return badRequest("La sesión de pago no corresponde a esta factura")
	}
	if sess.PaymentStatus != "paid" {
		return conflict("Stripe aún no confirma el pago (estado: " + sess.PaymentStatus + ")")
	}
	ref := "STRIPE " + sess.PaymentIntent
	var patientID int64
	already := false
	err = s.inTx(c.Context(), func(q db.Querier) error {
		inv, err := db.Row(c.Context(), q, `SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, id)
		if err != nil {
			return err
		}
		patientID = i64(inv["patient_id"])
		if err := q.QueryRow(c.Context(), `SELECT EXISTS (SELECT 1 FROM payments WHERE reference=$1)`, ref).Scan(&already); err != nil || already {
			return err
		}
		amount := float64(sess.AmountTotal) / 100
		paid, err := s.insertPayments(c.Context(), q, c, id, patientID, num(inv["total"])-num(inv["paid"]), []paymentReq{{Method: "tarjeta_credito", Amount: amount, Reference: ref}})
		if err != nil {
			return err
		}
		newPaid := domain.Round2(num(inv["paid"]) + paid)
		_, err = q.Exec(c.Context(), `UPDATE invoices SET paid=$2, status=$3 WHERE id=$1`, id, newPaid, domain.InvoiceStatus(num(inv["total"]), newPaid))
		return err
	})
	if err != nil {
		return err
	}
	if !already {
		c.Audit(id, patientID, map[string]any{"stripe_payment_intent": sess.PaymentIntent, "amount": float64(sess.AmountTotal) / 100})
	}
	inv, err := s.loadInvoice(c.Context(), id)
	if err != nil {
		return err
	}
	inv["already_registered"] = already
	return c.OK(inv)
}
