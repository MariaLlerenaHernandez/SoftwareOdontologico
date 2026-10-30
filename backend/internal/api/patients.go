package api

import (
	"strings"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
)

const patientSelect = `
	SELECT p.*, i.name AS insurance_name, i.coverage_pct,
	       date_part('year', age(p.birth_date))::int AS age,
	       (SELECT max(starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'atendido') AS last_visit,
	       (SELECT min(starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.starts_at > now()
	           AND a.status IN ('programado','confirmado')) AS next_visit
	  FROM patients p LEFT JOIN insurances i ON i.id = p.insurance_id`

func (s *Server) listPatients(c *Ctx) error {
	q := c.Query("q")
	limit := c.QueryInt("limit", 100)
	if limit > 500 {
		limit = 500
	}
	rows, err := db.Rows(c.Context(), s.db, patientSelect+`
		 WHERE ($1 = '' OR (p.first_name || ' ' || p.last_name) ILIKE '%' || $1 || '%'
		        OR p.document_number ILIKE $1 || '%' OR p.record_number ILIKE '%' || $1 || '%' OR p.phone ILIKE '%' || $1 || '%')
		   AND ($2 OR p.active)
		 ORDER BY p.last_name, p.first_name LIMIT $3`, q, c.Query("inactive") == "true", limit)
	if err != nil {
		return err
	}
	if err := s.attachAlerts(c, rows); err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) attachAlerts(c *Ctx, patients []map[string]any) error {
	if len(patients) == 0 {
		return nil
	}
	ids := make([]int64, len(patients))
	for i, p := range patients {
		ids[i] = i64(p["id"])
	}
	hist, err := db.Rows(c.Context(), s.db, `SELECT * FROM medical_histories WHERE patient_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	byID := map[int64]map[string]any{}
	for _, h := range hist {
		byID[i64(h["patient_id"])] = h
	}
	for _, p := range patients {
		h, ok := byID[i64(p["id"])]
		p["has_history"] = ok
		p["alerts"] = []string{}
		if ok {
			if a := domain.CriticalAlerts(h); a != nil {
				p["alerts"] = a
			}
		}
	}
	return nil
}

type patientReq struct {
	FirstName         string `json:"first_name"`
	LastName          string `json:"last_name"`
	DocumentType      string `json:"document_type"`
	DocumentNumber    string `json:"document_number"`
	BirthDate         string `json:"birth_date"`
	Sex               string `json:"sex"`
	Email             string `json:"email"`
	Phone             string `json:"phone"`
	Address           string `json:"address"`
	City              string `json:"city"`
	Occupation        string `json:"occupation"`
	EmergencyName     string `json:"emergency_name"`
	EmergencyPhone    string `json:"emergency_phone"`
	EmergencyRelation string `json:"emergency_relation"`
	GuardianName      string `json:"guardian_name"`
	GuardianDocument  string `json:"guardian_document"`
	GuardianPhone     string `json:"guardian_phone"`
	GuardianRelation  string `json:"guardian_relation"`
	InsuranceID       *int64 `json:"insurance_id"`
	InsuranceNumber   string `json:"insurance_number"`
	PreferredChannel  string `json:"preferred_channel"`
	Notes             string `json:"notes"`
	Active            *bool  `json:"active"`
}

func (r *patientReq) validate() error {
	r.FirstName, r.LastName, r.DocumentNumber = strings.TrimSpace(r.FirstName), strings.TrimSpace(r.LastName), strings.TrimSpace(r.DocumentNumber)
	if r.FirstName == "" || r.LastName == "" || r.DocumentNumber == "" {
		return badRequest("Nombres, apellidos y documento son obligatorios")
	}
	bd, err := time.Parse("2006-01-02", r.BirthDate)
	if err != nil || bd.After(time.Now()) || bd.Year() < 1900 {
		return badRequest("Fecha de nacimiento inválida")
	}
	if r.Sex != "F" && r.Sex != "M" && r.Sex != "O" {
		return badRequest("Sexo inválido")
	}
	if r.Email != "" && !strings.Contains(r.Email, "@") {
		return badRequest("Correo electrónico inválido")
	}
	if r.Phone == "" && r.Email == "" {
		return badRequest("Registre al menos un teléfono o correo de contacto")
	}
	// RF-01: tutor legal obligatorio para menores de edad
	if bd.AddDate(18, 0, 0).After(time.Now()) && (strings.TrimSpace(r.GuardianName) == "" || strings.TrimSpace(r.GuardianDocument) == "") {
		return badRequest("El paciente es menor de edad: el nombre y documento del tutor legal son obligatorios")
	}
	if r.DocumentType == "" {
		r.DocumentType = "cedula"
	}
	switch r.PreferredChannel {
	case "whatsapp", "sms", "email":
	default:
		r.PreferredChannel = "whatsapp"
	}
	if r.PreferredChannel == "email" && r.Email == "" {
		return badRequest("Para notificar por correo debe registrar un email")
	}
	return nil
}

func (r *patientReq) args() []any {
	return []any{r.FirstName, r.LastName, r.DocumentType, r.DocumentNumber, r.BirthDate, r.Sex,
		emptyToNil(r.Email), emptyToNil(r.Phone), emptyToNil(r.Address), emptyToNil(r.City), emptyToNil(r.Occupation),
		emptyToNil(r.EmergencyName), emptyToNil(r.EmergencyPhone), emptyToNil(r.EmergencyRelation),
		emptyToNil(r.GuardianName), emptyToNil(r.GuardianDocument), emptyToNil(r.GuardianPhone), emptyToNil(r.GuardianRelation),
		r.InsuranceID, emptyToNil(r.InsuranceNumber), r.PreferredChannel, emptyToNil(r.Notes)}
}

func (s *Server) createPatient(c *Ctx) error {
	var req patientReq
	if err := c.Bind(&req); err != nil {
		return err
	}
	if err := req.validate(); err != nil {
		return err
	}
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO patients (first_name, last_name, document_type, document_number, birth_date, sex, email, phone, address, city, occupation,
		    emergency_name, emergency_phone, emergency_relation, guardian_name, guardian_document, guardian_phone, guardian_relation,
		    insurance_id, insurance_number, preferred_channel, notes, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		RETURNING id, record_number`, append(req.args(), c.User.UserID)...)
	if err != nil {
		return err
	}
	c.Audit(row["id"], i64(row["id"]), nil)
	return c.Created(row)
}

func (s *Server) updatePatient(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var req patientReq
	if err := c.Bind(&req); err != nil {
		return err
	}
	if err := req.validate(); err != nil {
		return err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	row, err := db.Row(c.Context(), s.db, `
		UPDATE patients SET first_name=$1, last_name=$2, document_type=$3, document_number=$4, birth_date=$5, sex=$6, email=$7, phone=$8,
		    address=$9, city=$10, occupation=$11, emergency_name=$12, emergency_phone=$13, emergency_relation=$14,
		    guardian_name=$15, guardian_document=$16, guardian_phone=$17, guardian_relation=$18, insurance_id=$19, insurance_number=$20,
		    preferred_channel=$21, notes=$22, active=$23, updated_at=now()
		 WHERE id=$24 RETURNING id`, append(req.args(), active, id)...)
	if err != nil {
		return err
	}
	return c.OK(row)
}

func (s *Server) getPatient(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	p, err := db.Row(c.Context(), s.db, patientSelect+` WHERE p.id = $1`, id)
	if err != nil {
		return err
	}
	if err := s.attachAlerts(c, []map[string]any{p}); err != nil {
		return err
	}
	stats, err := db.Row(c.Context(), s.db, `
		SELECT (SELECT count(*) FROM appointments WHERE patient_id=$1 AND status='atendido') AS visits,
		       (SELECT count(*) FROM appointments WHERE patient_id=$1 AND status='no_asistio') AS no_shows,
		       (SELECT COALESCE(sum(total - paid),0) FROM invoices WHERE patient_id=$1 AND status IN ('emitida','parcial')) AS balance,
		       (SELECT count(*) FROM treatment_plans WHERE patient_id=$1 AND status IN ('presentado','aprobado','aprobado_parcial')) AS active_plans,
		       (SELECT count(*) FROM consents WHERE patient_id=$1 AND status='pendiente') AS pending_consents`, id)
	if err != nil {
		return err
	}
	p["stats"] = stats
	return c.OK(p)
}

// ------------------------------------------------ anamnesis (RF-02)

func (s *Server) getHistory(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	h, err := db.Row(c.Context(), s.db, `
		SELECT h.*, u.full_name AS updated_by_name FROM medical_histories h
		  LEFT JOIN users u ON u.id = h.updated_by WHERE h.patient_id = $1`, id)
	if err == db.ErrNotFound {
		return c.OK(map[string]any{"patient_id": id, "exists": false, "alerts": []string{}})
	}
	if err != nil {
		return err
	}
	h["exists"] = true
	h["alerts"] = domain.CriticalAlerts(h)
	return c.OK(h)
}

type historyReq struct {
	SystemicDiseases  string `json:"systemic_diseases"`
	Allergies         string `json:"allergies"`
	Medications       string `json:"medications"`
	SurgicalHistory   string `json:"surgical_history"`
	PenicillinAllergy bool   `json:"penicillin_allergy"`
	LatexAllergy      bool   `json:"latex_allergy"`
	AnesthesiaAllergy bool   `json:"anesthesia_allergy"`
	Anticoagulated    bool   `json:"anticoagulated"`
	Coagulopathy      bool   `json:"coagulopathy"`
	Diabetes          bool   `json:"diabetes"`
	Hypertension      bool   `json:"hypertension"`
	HeartDisease      bool   `json:"heart_disease"`
	Pregnant          bool   `json:"pregnant"`
	Smoker            bool   `json:"smoker"`
	OtherConditions   string `json:"other_conditions"`
}

func (s *Server) saveHistory(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r historyReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	_, err = s.db.Exec(c.Context(), `
		INSERT INTO medical_histories (patient_id, systemic_diseases, allergies, medications, surgical_history, penicillin_allergy,
		    latex_allergy, anesthesia_allergy, anticoagulated, coagulopathy, diabetes, hypertension, heart_disease, pregnant, smoker,
		    other_conditions, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
		ON CONFLICT (patient_id) DO UPDATE SET systemic_diseases=EXCLUDED.systemic_diseases, allergies=EXCLUDED.allergies,
		    medications=EXCLUDED.medications, surgical_history=EXCLUDED.surgical_history, penicillin_allergy=EXCLUDED.penicillin_allergy,
		    latex_allergy=EXCLUDED.latex_allergy, anesthesia_allergy=EXCLUDED.anesthesia_allergy, anticoagulated=EXCLUDED.anticoagulated,
		    coagulopathy=EXCLUDED.coagulopathy, diabetes=EXCLUDED.diabetes, hypertension=EXCLUDED.hypertension,
		    heart_disease=EXCLUDED.heart_disease, pregnant=EXCLUDED.pregnant, smoker=EXCLUDED.smoker,
		    other_conditions=EXCLUDED.other_conditions, updated_by=EXCLUDED.updated_by, updated_at=now()`,
		id, emptyToNil(r.SystemicDiseases), emptyToNil(r.Allergies), emptyToNil(r.Medications), emptyToNil(r.SurgicalHistory),
		r.PenicillinAllergy, r.LatexAllergy, r.AnesthesiaAllergy, r.Anticoagulated, r.Coagulopathy, r.Diabetes, r.Hypertension,
		r.HeartDisease, r.Pregnant, r.Smoker, emptyToNil(r.OtherConditions), c.User.UserID)
	if err != nil {
		return err
	}
	return s.getHistory(c)
}

// ------------------------------------------------------ signos vitales

func (s *Server) listVitals(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT v.*, u.full_name AS taken_by_name FROM vital_signs v LEFT JOIN users u ON u.id = v.taken_by
		 WHERE v.patient_id = $1 ORDER BY v.taken_at DESC`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) createVitals(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		AppointmentID *int64   `json:"appointment_id"`
		Systolic      *int     `json:"systolic"`
		Diastolic     *int     `json:"diastolic"`
		HeartRate     *int     `json:"heart_rate"`
		RespRate      *int     `json:"resp_rate"`
		Temperature   *float64 `json:"temperature"`
		SpO2          *int     `json:"spo2"`
		Weight        *float64 `json:"weight"`
		Glucose       *int     `json:"glucose"`
		Notes         string   `json:"notes"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.Systolic == nil && r.HeartRate == nil && r.Temperature == nil && r.SpO2 == nil {
		return badRequest("Registre al menos un signo vital")
	}
	if r.Temperature != nil && (*r.Temperature < 30 || *r.Temperature > 45) {
		return badRequest("Temperatura fuera de rango fisiológico")
	}
	if r.SpO2 != nil && (*r.SpO2 < 50 || *r.SpO2 > 100) {
		return badRequest("Saturación fuera de rango")
	}
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO vital_signs (patient_id, appointment_id, systolic, diastolic, heart_rate, resp_rate, temperature, spo2, weight, glucose, notes, taken_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
		id, r.AppointmentID, r.Systolic, r.Diastolic, r.HeartRate, r.RespRate, r.Temperature, r.SpO2, r.Weight, r.Glucose, emptyToNil(r.Notes), c.User.UserID)
	if err != nil {
		return err
	}
	return c.Created(row)
}
