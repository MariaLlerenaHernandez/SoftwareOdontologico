package api

import (
	"fmt"
	"strings"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/security"
)

// ------------------------------------------------------------- usuarios

func (s *Server) listUsers(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT id, email, full_name, role, specialty, license_number, phone, color, mfa_enabled, active, last_login_at, created_at
		  FROM users ORDER BY active DESC, role, full_name`)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) listStaff(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT id, full_name, role, specialty, license_number, color FROM users WHERE active ORDER BY role, full_name`)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

type userReq struct {
	Email         string `json:"email"`
	FullName      string `json:"full_name"`
	Role          string `json:"role"`
	Password      string `json:"password"`
	Specialty     string `json:"specialty"`
	LicenseNumber string `json:"license_number"`
	Phone         string `json:"phone"`
	Color         string `json:"color"`
	Active        *bool  `json:"active"`
}

func validRole(r string) bool {
	for _, x := range allRoles {
		if x == r {
			return true
		}
	}
	return false
}

func (s *Server) createUser(c *Ctx) error {
	var req userReq
	if err := c.Bind(&req); err != nil {
		return err
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" || strings.TrimSpace(req.FullName) == "" || !validRole(req.Role) {
		return badRequest("Correo, nombre y rol válido son obligatorios")
	}
	if err := security.ValidatePasswordPolicy(req.Password); err != nil {
		return badRequest(err.Error())
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		return err
	}
	if req.Color == "" {
		req.Color = "#0d9488"
	}
	u, err := db.Row(c.Context(), s.db, `
		INSERT INTO users (email, password_hash, full_name, role, specialty, license_number, phone, color)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, email, full_name, role`,
		req.Email, hash, strings.TrimSpace(req.FullName), req.Role, emptyToNil(req.Specialty), emptyToNil(req.LicenseNumber), emptyToNil(req.Phone), req.Color)
	if err != nil {
		return err
	}
	c.Audit(u["id"], 0, map[string]any{"email": req.Email, "role": req.Role})
	return c.Created(u)
}

func (s *Server) updateUser(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var req userReq
	if err := c.Bind(&req); err != nil {
		return err
	}
	if !validRole(req.Role) || strings.TrimSpace(req.FullName) == "" {
		return badRequest("Nombre y rol válido son obligatorios")
	}
	if id == c.User.UserID && (req.Role != RoleAdmin || (req.Active != nil && !*req.Active)) {
		return badRequest("No puede quitarse a sí mismo el rol de administrador ni desactivar su cuenta")
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	u, err := db.Row(c.Context(), s.db, `
		UPDATE users SET full_name=$2, role=$3, specialty=$4, license_number=$5, phone=$6, color=COALESCE(NULLIF($7,''), color), active=$8
		 WHERE id=$1 RETURNING id, email, full_name, role, active`,
		id, strings.TrimSpace(req.FullName), req.Role, emptyToNil(req.Specialty), emptyToNil(req.LicenseNumber), emptyToNil(req.Phone), req.Color, active)
	if err != nil {
		return err
	}
	c.Audit(id, 0, map[string]any{"role": req.Role, "active": active})
	return c.OK(u)
}

func (s *Server) resetUserPassword(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}
	if err := security.ValidatePasswordPolicy(req.Password); err != nil {
		return badRequest(err.Error())
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(c.Context(), `UPDATE users SET password_hash=$2, mfa_enabled=FALSE, mfa_secret=NULL WHERE id=$1`, id, hash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFound("Usuario no encontrado")
	}
	c.Audit(id, 0, map[string]any{"reset_password": true, "mfa_reset": true})
	return c.OK(map[string]any{"ok": true})
}

// ------------------------------------------------------- configuración

var publicSettings = []string{"clinica_nombre", "clinica_ruc", "clinica_direccion", "clinica_telefono", "moneda",
	"iva_pct", "descuento_max_pct", "nota_bloqueo_horas", "sesion_inactividad_min", "mfa_obligatorio"}

func (s *Server) getPublicSettings(c *Ctx) error {
	out := map[string]string{}
	for _, k := range publicSettings {
		out[k] = s.settings.Get(k)
	}
	return c.OK(out)
}

func (s *Server) listSettings(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `SELECT * FROM settings ORDER BY key`)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) updateSettings(c *Ctx) error {
	var req map[string]string
	if err := c.Bind(&req); err != nil {
		return err
	}
	numeric := map[string][2]float64{
		"iva_pct": {0, 100}, "descuento_max_pct": {0, 100}, "nota_bloqueo_horas": {1, 720}, "sesion_inactividad_min": {1, 240},
	}
	err := s.inTx(c.Context(), func(q db.Querier) error {
		for k, v := range req {
			v = strings.TrimSpace(v)
			if lim, ok := numeric[k]; ok {
				var f float64
				if _, err := fmt.Sscanf(v, "%g", &f); err != nil || f < lim[0] || f > lim[1] {
					return badRequest(fmt.Sprintf("Valor inválido para %s (rango %g–%g)", k, lim[0], lim[1]))
				}
			}
			if (k == "mfa_obligatorio" || k == "recordatorios_activos") && v != "true" && v != "false" {
				return badRequest("Valor booleano inválido para " + k)
			}
			tag, err := q.Exec(c.Context(), `UPDATE settings SET value=$2 WHERE key=$1`, k, v)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return badRequest("Parámetro desconocido: " + k)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.Audit("settings", 0, map[string]any{"changes": req})
	if err := s.LoadSettings(c.Context()); err != nil {
		return err
	}
	return s.listSettings(c)
}

// ------------------------------------------------------------ catálogos

type catalogDef struct {
	table string
	cols  []string
	list  string
}

var catalogs = map[string]catalogDef{
	"offices":    {"offices", []string{"name", "address", "phone", "active"}, `SELECT * FROM offices ORDER BY id`},
	"chairs":     {"chairs", []string{"office_id", "name", "active"}, `SELECT c.*, o.name AS office_name FROM chairs c JOIN offices o ON o.id = c.office_id ORDER BY c.office_id, c.id`},
	"insurances": {"insurances", []string{"name", "coverage_pct", "phone", "active"}, `SELECT * FROM insurances ORDER BY id`},
	"procedures": {"procedures", []string{"code", "name", "category", "price", "lab_cost", "duration_min", "odontogram_condition", "active"},
		`SELECT p.*, (SELECT count(*) FROM procedure_supplies ps WHERE ps.procedure_id = p.id) AS recipe_items FROM procedures p ORDER BY category, code`},
	"consent-templates": {"consent_templates", []string{"title", "procedure_category", "body", "active"}, `SELECT * FROM consent_templates ORDER BY title`},
}

func (s *Server) catalog(c *Ctx) (catalogDef, error) {
	def, ok := catalogs[c.R.PathValue("name")]
	if !ok {
		return def, notFound("Catálogo inexistente")
	}
	return def, nil
}

func (s *Server) listCatalog(c *Ctx) error {
	def, err := s.catalog(c)
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, def.list)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) saveCatalog(c *Ctx) error {
	def, err := s.catalog(c)
	if err != nil {
		return err
	}
	var body map[string]any
	if err := c.Bind(&body); err != nil {
		return err
	}
	var cols []string
	var args []any
	for _, col := range def.cols {
		if v, ok := body[col]; ok {
			if sv, isStr := v.(string); isStr && strings.TrimSpace(sv) == "" {
				v = nil
			}
			cols = append(cols, col)
			args = append(args, v)
		}
	}
	if len(cols) == 0 {
		return badRequest("No se enviaron campos")
	}
	var row map[string]any
	if idStr := c.R.PathValue("id"); idStr != "" {
		id, err := c.PathID("id")
		if err != nil {
			return err
		}
		sets := make([]string, len(cols))
		for i, col := range cols {
			sets[i] = fmt.Sprintf("%s = $%d", col, i+1)
		}
		args = append(args, id)
		row, err = db.Row(c.Context(), s.db, fmt.Sprintf(`UPDATE %s SET %s WHERE id = $%d RETURNING *`,
			def.table, strings.Join(sets, ", "), len(args)), args...)
		if err != nil {
			return err
		}
	} else {
		ph := make([]string, len(cols))
		for i := range cols {
			ph[i] = fmt.Sprintf("$%d", i+1)
		}
		row, err = db.Row(c.Context(), s.db, fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s) RETURNING *`,
			def.table, strings.Join(cols, ", "), strings.Join(ph, ", ")), args...)
		if err != nil {
			return err
		}
	}
	c.Audit(row["id"], 0, body)
	return c.OK(row)
}

// ----------------------------------------------------------- auditoría

func (s *Server) listAudit(c *Ctx) error {
	where := []string{"TRUE"}
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if v := c.Query("from"); v != "" {
		add("occurred_at >= $%d::date", v)
	}
	if v := c.Query("to"); v != "" {
		add("occurred_at < $%d::date + 1", v)
	}
	if v := c.QueryInt("user_id", 0); v > 0 {
		add("user_id = $%d", v)
	}
	if v := c.QueryInt("patient_id", 0); v > 0 {
		add("patient_id = $%d", v)
	}
	if v := c.Query("action"); v != "" {
		add("action = $%d", strings.ToUpper(v))
	}
	if v := c.Query("entity"); v != "" {
		add("entity = $%d", v)
	}
	if v := c.Query("q"); v != "" {
		add("(user_email ILIKE '%%' || $%[1]d || '%%' OR path ILIKE '%%' || $%[1]d || '%%')", v)
	}
	limit := c.QueryInt("limit", 200)
	if limit > 1000 {
		limit = 1000
	}
	rows, err := db.Rows(c.Context(), s.db, fmt.Sprintf(`
		SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name
		  FROM audit_log a LEFT JOIN patients p ON p.id = a.patient_id
		 WHERE %s ORDER BY a.id DESC LIMIT %d`, strings.Join(where, " AND "), limit), args...)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

// backup exporta todas las tablas operativas a JSON (sin secretos).
func (s *Server) backup(c *Ctx) error {
	tables := []string{"settings", "offices", "chairs", "insurances", "procedures", "patients", "medical_histories",
		"vital_signs", "appointments", "appointment_status_log", "notifications", "treatment_plans", "plan_items",
		"odontogram_findings", "perio_exams", "clinical_notes", "consent_templates", "consents", "prescriptions",
		"cash_sessions", "invoices", "invoice_items", "payments", "commission_rules", "commission_settlements",
		"supplies", "procedure_supplies", "stock_movements", "patient_files"}
	out := map[string]any{"generated_at": time.Now().Format(time.RFC3339), "generated_by": c.User.Email, "version": "1.0"}
	data := map[string]any{}
	for _, t := range tables {
		rows, err := db.Rows(c.Context(), s.db, "SELECT * FROM "+t+" ORDER BY 1")
		if err != nil {
			return err
		}
		data[t] = rows
	}
	users, err := db.Rows(c.Context(), s.db, `SELECT id, email, full_name, role, specialty, license_number, active, created_at FROM users ORDER BY id`)
	if err != nil {
		return err
	}
	data["users"] = users
	out["tables"] = data
	c.action = "EXPORT"
	c.Audit("backup", 0, map[string]any{"tables": len(data)})
	c.W.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="sigo-respaldo-%s.json"`, time.Now().Format("20060102-1504")))
	return c.OK(out)
}
