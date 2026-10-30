package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/smtp"
	"net/url"
	"strings"
	"time"
)

// ------------------------------------------------ Mensajería (RF-11)

// Notifier abstrae el gateway de mensajería (SMTP, Twilio, Meta Cloud API…).
type Notifier interface {
	Send(ctx context.Context, channel, recipient, subject, message string) (provider, ref string, err error)
	// Live indica si el canal envía mensajes reales (no simulados).
	Live(channel string) bool
}

// SimulatedNotifier registra el envío sin contactar proveedores externos.
type SimulatedNotifier struct{}

func (SimulatedNotifier) Send(_ context.Context, channel, _, _, _ string) (string, string, error) {
	provider := map[string]string{
		"whatsapp": "whatsapp (simulado)",
		"sms":      "sms (simulado)",
		"email":    "email (simulado)",
	}[channel]
	return provider, fmt.Sprintf("SIM-%d", time.Now().UnixNano()%1_000_000_000), nil
}

func (SimulatedNotifier) Live(string) bool { return false }

// SMTPConfig configura el envío de correo real (p. ej. Gmail con contraseña de aplicación).
type SMTPConfig struct {
	Host, Port, User, Password, From, FromName string
}

// TwilioConfig configura SMS y WhatsApp mediante la API REST de Twilio.
type TwilioConfig struct {
	AccountSID, AuthToken, SMSFrom, WhatsAppFrom, DefaultCountryCode string
}

// GatewayNotifier usa proveedores reales cuando están configurados y, si no,
// recurre al modo simulado para que el sistema siga operando.
type GatewayNotifier struct {
	SMTP   *SMTPConfig
	Twilio *TwilioConfig
	http   *http.Client
	sim    SimulatedNotifier
}

func NewGatewayNotifier(smtpCfg *SMTPConfig, tw *TwilioConfig) *GatewayNotifier {
	return &GatewayNotifier{SMTP: smtpCfg, Twilio: tw, http: &http.Client{Timeout: 15 * time.Second}}
}

func (g *GatewayNotifier) Live(channel string) bool {
	switch channel {
	case "email":
		return g.SMTP != nil
	case "sms":
		return g.Twilio != nil && g.Twilio.SMSFrom != ""
	case "whatsapp":
		return g.Twilio != nil && g.Twilio.WhatsAppFrom != ""
	}
	return false
}

func (g *GatewayNotifier) Send(ctx context.Context, channel, recipient, subject, message string) (string, string, error) {
	if !g.Live(channel) {
		return g.sim.Send(ctx, channel, recipient, subject, message)
	}
	switch channel {
	case "email":
		return "smtp " + g.SMTP.Host, "", g.sendEmail(recipient, subject, message)
	case "sms":
		ref, err := g.sendTwilio(ctx, g.normalizePhone(recipient), g.Twilio.SMSFrom, message)
		return "twilio-sms", ref, err
	default:
		ref, err := g.sendTwilio(ctx, "whatsapp:"+g.normalizePhone(recipient), "whatsapp:"+strings.TrimPrefix(g.Twilio.WhatsAppFrom, "whatsapp:"), message)
		return "twilio-whatsapp", ref, err
	}
}

func (g *GatewayNotifier) sendEmail(to, subject, body string) error {
	c := g.SMTP
	from := c.From
	if from == "" {
		from = c.User
	}
	headers := []string{
		"From: " + mime.QEncoding.Encode("utf-8", c.FromName) + " <" + from + ">",
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("utf-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"Date: " + time.Now().Format(time.RFC1123Z),
	}
	msg := strings.Join(headers, "\r\n") + "\r\n\r\n" + body + "\r\n\r\n--\r\n" + c.FromName + "\r\nMensaje automático, por favor no responda a este correo.\r\n"
	auth := smtp.PlainAuth("", c.User, c.Password, c.Host)
	// net/smtp negocia STARTTLS automáticamente (puerto 587).
	return smtp.SendMail(c.Host+":"+c.Port, auth, from, []string{to}, []byte(msg))
}

func (g *GatewayNotifier) sendTwilio(ctx context.Context, to, from, body string) (string, error) {
	t := g.Twilio
	form := url.Values{"To": {to}, "From": {from}, "Body": {body}}
	endpoint := "https://api.twilio.com/2010-04-01/Accounts/" + t.AccountSID + "/Messages.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(t.AccountSID, t.AuthToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := g.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		SID     string `json:"sid"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode >= 300 {
		if out.Message == "" {
			out.Message = res.Status
		}
		return "", errors.New("Twilio: " + out.Message)
	}
	return out.SID, nil
}

// normalizePhone deja solo dígitos con prefijo internacional (+593…).
func (g *GatewayNotifier) normalizePhone(p string) string {
	var b strings.Builder
	for i, r := range strings.TrimSpace(p) {
		if (r >= '0' && r <= '9') || (r == '+' && i == 0) {
			b.WriteRune(r)
		}
	}
	n := b.String()
	if strings.HasPrefix(n, "+") {
		return n
	}
	cc := g.Twilio.DefaultCountryCode
	if cc == "" {
		cc = "+593"
	}
	return cc + strings.TrimPrefix(n, "0")
}

var notificationSubjects = map[string]string{
	"confirmacion":     "Confirmación de su cita",
	"recordatorio_48h": "Recordatorio: su cita es en 2 días",
	"recordatorio_24h": "Recordatorio: su cita es mañana",
	"cancelacion":      "Su cita fue cancelada",
	"otp":              "Código para firmar su consentimiento informado",
	"general":          "Mensaje de su clínica dental",
}

// integrations informa al frontend qué conectores están activos.
func (s *Server) integrations(c *Ctx) error {
	return c.OK(map[string]any{
		"email":    s.notifier.Live("email"),
		"sms":      s.notifier.Live("sms"),
		"whatsapp": s.notifier.Live("whatsapp"),
		"stripe":   s.cfg.StripeKey != "",
	})
}
