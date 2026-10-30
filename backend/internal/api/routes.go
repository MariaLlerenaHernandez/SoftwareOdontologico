package api

import (
	_ "embed"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed openapi.yaml
var openAPISpec []byte

const swaggerHTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SIGO-Dental · API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:'/api/openapi.yaml',dom_id:'#ui',persistAuthorization:true});</script></body></html>`

func (s *Server) routes() {
	const (
		A = RoleAdmin
		R = RoleRecepcion
		O = RoleOdontologo
		S = RoleAsistente
		U = RoleAuditor
	)
	h := s.handle

	// Salud y documentación
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := s.db.Ping(r.Context()); err != nil {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"status":"db_down"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok","service":"sigo-dental-api","version":"1.0.0"}`))
	})
	s.mux.HandleFunc("GET /api/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		_, _ = w.Write(openAPISpec)
	})
	s.mux.HandleFunc("GET /api/docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(swaggerHTML))
	})

	// Autenticación y MFA (RNF-05)
	h("POST /api/auth/login", s.login, public(), entity("auth"))
	h("POST /api/auth/mfa/verify", s.loginMFA, public(), entity("auth"))
	h("GET /api/auth/me", s.me)
	h("POST /api/auth/change-password", s.changePassword, entity("auth"))
	h("POST /api/auth/mfa/setup", s.mfaSetup, entity("mfa"))
	h("POST /api/auth/mfa/enable", s.mfaEnable, entity("mfa"))
	h("POST /api/auth/mfa/disable", s.mfaDisable, entity("mfa"))

	// Administración
	h("GET /api/settings/public", s.getPublicSettings)
	h("GET /api/settings", s.listSettings, roles(A))
	h("PUT /api/settings", s.updateSettings, roles(A), entity("settings"))
	h("GET /api/users", s.listUsers, roles(A))
	h("POST /api/users", s.createUser, roles(A), entity("usuario"))
	h("PUT /api/users/{id}", s.updateUser, roles(A), entity("usuario"))
	h("POST /api/users/{id}/reset-password", s.resetUserPassword, roles(A), entity("usuario"))
	h("GET /api/staff", s.listStaff)
	h("GET /api/catalog/{name}", s.listCatalog)
	h("POST /api/catalog/{name}", s.saveCatalog, roles(A), entity("catalogo"))
	h("PUT /api/catalog/{name}/{id}", s.saveCatalog, roles(A), entity("catalogo"))
	h("GET /api/audit", s.listAudit, roles(A, U), entity("auditoria"))
	h("GET /api/admin/backup", s.backup, roles(A), entity("respaldo"))

	// Pacientes y anamnesis (RF-01, RF-02)
	h("GET /api/patients", s.listPatients)
	h("POST /api/patients", s.createPatient, roles(A, R, O), entity("paciente"))
	h("GET /api/patients/{id}", s.getPatient, entity("paciente"), auditRead())
	h("PUT /api/patients/{id}", s.updatePatient, roles(A, R, O), entity("paciente"))
	h("GET /api/patients/{id}/history", s.getHistory, with(sensitive("anamnesis"), roles(A, R, O, S))...)
	h("PUT /api/patients/{id}/history", s.saveHistory, with(sensitive("anamnesis"), roles(R, O, S))...)
	h("GET /api/patients/{id}/vitals", s.listVitals, with(sensitive("signos_vitales"), roles(A, O, S))...)
	h("POST /api/patients/{id}/vitals", s.createVitals, with(sensitive("signos_vitales"), roles(O, S))...)
	h("GET /api/patients/{id}/appointments", s.patientAppointments, roles(A, R, O, S))

	// Expediente clínico (RF-03..RF-06)
	h("GET /api/patients/{id}/odontogram", s.getOdontogram, with(sensitive("odontograma"), roles(A, O, S))...)
	h("POST /api/patients/{id}/odontogram", s.addFinding, with(sensitive("odontograma"), roles(O))...)
	h("PATCH /api/odontogram/{id}", s.updateFinding, with(sensitive("odontograma"), roles(O))...)
	h("DELETE /api/odontogram/{id}", s.deleteFinding, with(sensitive("odontograma"), roles(O))...)
	h("GET /api/patients/{id}/perio", s.listPerio, with(sensitive("periodontograma"), roles(A, O, S))...)
	h("POST /api/patients/{id}/perio", s.createPerio, with(sensitive("periodontograma"), roles(O, S))...)
	h("GET /api/patients/{id}/notes", s.listNotes, with(sensitive("nota_soep"), roles(A, O, S))...)
	h("POST /api/patients/{id}/notes", s.createNote, with(sensitive("nota_soep"), roles(O, S))...)
	h("PUT /api/notes/{id}", s.updateNote, with(sensitive("nota_soep"), roles(O, S))...)
	h("POST /api/notes/{id}/sign", s.signNote, with(sensitive("nota_soep"), roles(O))...)
	h("GET /api/patients/{id}/consents", s.listConsents, with(sensitive("consentimiento"), roles(A, R, O, S))...)
	h("POST /api/patients/{id}/consents", s.createConsent, with(sensitive("consentimiento"), roles(R, O, S))...)
	h("POST /api/consents/{id}/sign", s.signConsent, with(sensitive("consentimiento"), roles(R, O, S))...)
	h("POST /api/consents/{id}/otp", s.sendConsentOTP, with(sensitive("consentimiento"), roles(R, O, S))...)
	h("POST /api/consents/{id}/verify-otp", s.verifyConsentOTP, with(sensitive("consentimiento"), roles(R, O, S))...)
	h("POST /api/consents/{id}/revoke", s.revokeConsent, with(sensitive("consentimiento"), roles(O))...)
	h("GET /api/patients/{id}/prescriptions", s.listPrescriptions, with(sensitive("receta"), roles(A, O, S))...)
	h("POST /api/patients/{id}/prescriptions", s.createPrescription, with(sensitive("receta"), roles(O))...)
	h("GET /api/patients/{id}/files", s.listFiles, with(sensitive("archivo"), roles(A, R, O, S))...)
	h("POST /api/patients/{id}/files", s.uploadFile, with(sensitive("archivo"), roles(R, O, S))...)
	h("GET /api/files/{id}", s.downloadFile, with(sensitive("archivo"), roles(A, R, O, S))...)

	// Planes y presupuestos (RF-07, RF-08)
	h("GET /api/patients/{id}/plans", s.listPlans, with(sensitive("plan_tratamiento"), roles(A, R, O, S, U))...)
	h("POST /api/patients/{id}/plans", s.createPlan, with(sensitive("plan_tratamiento"), roles(O))...)
	h("GET /api/patients/{id}/billable", s.billableItems, roles(A, R, U), entity("plan_tratamiento"))
	h("GET /api/plans/{id}", s.getPlan, with(sensitive("plan_tratamiento"), roles(A, R, O, S, U))...)
	h("PUT /api/plans/{id}", s.updatePlan, with(sensitive("plan_tratamiento"), roles(A, O))...)
	h("POST /api/plans/{id}/items", s.addPlanItem, with(sensitive("plan_tratamiento"), roles(O))...)
	h("POST /api/plans/{id}/present", s.presentPlan, with(sensitive("plan_tratamiento"), roles(O))...)
	h("POST /api/plans/{id}/approve", s.approvePlan, with(sensitive("plan_tratamiento"), roles(R, O))...)
	h("DELETE /api/plan-items/{id}", s.deletePlanItem, with(sensitive("plan_tratamiento"), roles(O))...)
	h("POST /api/plan-items/{id}/complete", s.completePlanItem, with(sensitive("plan_tratamiento"), roles(O))...)

	// Agenda y notificaciones (RF-09..RF-11)
	h("GET /api/appointments", s.listAppointments)
	h("POST /api/appointments", s.createAppointment, roles(A, R, O), entity("cita"))
	h("PUT /api/appointments/{id}", s.updateAppointment, roles(A, R, O), entity("cita"))
	h("POST /api/appointments/{id}/status", s.changeAppointmentStatus, roles(A, R, O, S), entity("cita"))
	h("GET /api/appointments/{id}/log", s.appointmentLog, roles(A, R, O, S, U), entity("cita"))
	h("GET /api/notifications", s.listNotifications, roles(A, R))
	h("POST /api/notifications/run", s.runRemindersNow, roles(A), entity("notificacion"))

	// Facturación, caja y honorarios (RF-12, RF-13, RN-02)
	h("GET /api/invoices", s.listInvoices, roles(A, R, U))
	h("POST /api/invoices", s.createInvoice, roles(A, R), entity("factura"))
	h("GET /api/invoices/{id}", s.getInvoice, roles(A, R, U), entity("factura"))
	h("POST /api/invoices/{id}/payments", s.addPayment, roles(A, R), entity("pago"))
	h("POST /api/invoices/{id}/void", s.voidInvoice, roles(A), entity("factura"))
	h("GET /api/invoices/{id}/xml", s.invoiceXML, roles(A, R, U), entity("factura"))
	h("POST /api/invoices/{id}/stripe-checkout", s.stripeCheckout, roles(A, R), entity("pago"))
	h("POST /api/invoices/{id}/stripe-confirm", s.stripeConfirm, roles(A, R), entity("pago"))
	h("GET /api/integrations", s.integrations)
	h("GET /api/cash/current", s.currentCash, roles(A, R))
	h("POST /api/cash/open", s.openCash, roles(A, R), entity("caja"))
	h("POST /api/cash/close", s.closeCash, roles(A, R), entity("caja"))
	h("GET /api/cash/sessions", s.listCashSessions, roles(A, R, U))
	h("GET /api/commissions/rules", s.listCommissionRules, roles(A, U))
	h("POST /api/commissions/rules", s.saveCommissionRule, roles(A), entity("regla_honorario"))
	h("PUT /api/commissions/rules/{id}", s.saveCommissionRule, roles(A), entity("regla_honorario"))
	h("GET /api/commissions/report", s.commissionReport, roles(A, U, O))
	h("GET /api/commissions/settlements", s.listSettlements, roles(A, U, O))
	h("POST /api/commissions/settlements", s.createSettlement, roles(A, U), entity("liquidacion"))

	// Inventario (RF-14)
	h("GET /api/supplies", s.listSupplies, roles(A, O, S, U))
	h("POST /api/supplies", s.createSupply, roles(A, S), entity("insumo"))
	h("PUT /api/supplies/{id}", s.updateSupply, roles(A), entity("insumo"))
	h("POST /api/supplies/{id}/movements", s.createMovement, roles(A, S), entity("movimiento_stock"))
	h("GET /api/stock-movements", s.listMovements, roles(A, O, S, U))
	h("GET /api/procedures/{id}/recipe", s.getRecipe)
	h("PUT /api/procedures/{id}/recipe", s.saveRecipe, roles(A), entity("receta_consumo"))

	// Reportes
	h("GET /api/reports/dashboard", s.dashboard)
	h("GET /api/reports/revenue", s.revenueReport, roles(A, U))
	h("GET /api/reports/appointments", s.appointmentsReport, roles(A, R, U))
	h("GET /api/reports/inventory", s.inventoryReport, roles(A, U))

	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"Recurso inexistente"}`))
	})

	if s.cfg.StaticDir != "" {
		s.mux.Handle("/", spaHandler(s.cfg.StaticDir))
	}
}

// spaHandler sirve el frontend compilado con fallback a index.html.
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			if !strings.Contains(filepath.Base(r.URL.Path), ".") {
				http.ServeFile(w, r, filepath.Join(dir, "index.html"))
				return
			}
		}
		fs.ServeHTTP(w, r)
	})
}
