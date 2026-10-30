package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
	"sigo-dental/internal/security"
)

// --------------------------------------------- Odontograma (RF-03)

var odontoConditions = map[string]bool{
	"caries": true, "restauracion": true, "sellante": true, "fractura": true,
	"endodoncia": true, "endodoncia_requerida": true, "corona": true, "implante": true,
	"protesis_fija": true, "protesis_removible": true, "exodoncia": true, "ausente": true,
}

// surfaceConditions son hallazgos que se marcan por cara dental.
var surfaceConditions = map[string]bool{"caries": true, "restauracion": true, "sellante": true, "fractura": true}

func validTooth(t int) bool {
	q, n := t/10, t%10
	switch {
	case q >= 1 && q <= 4:
		return n >= 1 && n <= 8
	case q >= 5 && q <= 8:
		return n >= 1 && n <= 5
	}
	return false
}

func (s *Server) getOdontogram(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT f.*, u.full_name AS created_by_name FROM odontogram_findings f
		  LEFT JOIN users u ON u.id = f.created_by WHERE f.patient_id = $1 ORDER BY f.created_at`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) addFinding(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Tooth     int    `json:"tooth"`
		Surface   string `json:"surface"`
		Condition string `json:"condition"`
		Status    string `json:"status"`
		Notes     string `json:"notes"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if !validTooth(r.Tooth) {
		return badRequest("Pieza dental inválida (use notación FDI)")
	}
	if !odontoConditions[r.Condition] {
		return badRequest("Condición no reconocida")
	}
	if surfaceConditions[r.Condition] {
		if !strings.Contains("MDOVL", r.Surface) || r.Surface == "" {
			return badRequest("Seleccione la superficie dental (M, D, O/I, V, L/P)")
		}
	} else {
		r.Surface = ""
	}
	if r.Status == "" {
		r.Status = "existente"
	}
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO odontogram_findings (patient_id, tooth, surface, condition, status, notes, created_by)
		VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7) RETURNING *`, id, r.Tooth, r.Surface, r.Condition, r.Status, emptyToNil(r.Notes), c.User.UserID)
	if err != nil {
		return err
	}
	c.Audit(row["id"], id, map[string]any{"tooth": r.Tooth, "surface": r.Surface, "condition": r.Condition, "status": r.Status})
	return c.Created(row)
}

func (s *Server) updateFinding(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Status string `json:"status"`
		Notes  string `json:"notes"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	row, err := db.Row(c.Context(), s.db, `UPDATE odontogram_findings SET status=$2, notes=COALESCE($3, notes) WHERE id=$1 RETURNING *`,
		id, r.Status, emptyToNil(r.Notes))
	if err != nil {
		return err
	}
	c.Audit(id, i64(row["patient_id"]), map[string]any{"status": r.Status})
	return c.OK(row)
}

func (s *Server) deleteFinding(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	row, err := db.Row(c.Context(), s.db, `DELETE FROM odontogram_findings WHERE id=$1 RETURNING patient_id, tooth, condition`, id)
	if err != nil {
		return err
	}
	c.Audit(id, i64(row["patient_id"]), row)
	return c.OK(map[string]any{"ok": true})
}

// ------------------------------------------- Periodontograma (RF-04)

func (s *Server) listPerio(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT e.*, u.full_name AS examined_by_name FROM perio_exams e LEFT JOIN users u ON u.id = e.examined_by
		 WHERE e.patient_id = $1 ORDER BY e.created_at DESC`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) createPerio(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Teeth map[string]domain.PerioTooth `json:"teeth"`
		Notes string                       `json:"notes"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if len(r.Teeth) == 0 {
		return badRequest("El periodontograma no contiene mediciones")
	}
	for k, t := range r.Teeth {
		var tooth int
		if _, err := fmt.Sscanf(k, "%d", &tooth); err != nil || !validTooth(tooth) {
			return badRequest("Pieza inválida en periodontograma: " + k)
		}
		for _, v := range t.PD {
			if v < 0 || v > 15 {
				return badRequest(fmt.Sprintf("Profundidad de sondaje fuera de rango en pieza %s", k))
			}
		}
		if t.Mobility < 0 || t.Mobility > 3 || t.Furcation < 0 || t.Furcation > 3 {
			return badRequest(fmt.Sprintf("Movilidad/furca fuera de rango (0–3) en pieza %s", k))
		}
	}
	summary := domain.SummarizePerio(r.Teeth)
	data, _ := json.Marshal(map[string]any{"teeth": r.Teeth})
	sum, _ := json.Marshal(summary)
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO perio_exams (patient_id, examined_by, data, summary, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		id, c.User.UserID, string(data), string(sum), emptyToNil(r.Notes))
	if err != nil {
		return err
	}
	c.Audit(row["id"], id, map[string]any{"diagnosis": summary.Diagnosis})
	return c.Created(row)
}

// ----------------------------------------- Notas SOEP (RF-05, RN-01)

func (s *Server) listNotes(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT n.*, a.full_name AS author_name, a.role AS author_role, sg.full_name AS signed_by_name, sg.license_number AS signer_license
		  FROM clinical_notes n JOIN users a ON a.id = n.author_id LEFT JOIN users sg ON sg.id = n.signed_by
		 WHERE n.patient_id = $1 ORDER BY n.created_at DESC`, id)
	if err != nil {
		return err
	}
	lock := s.settings.Int("nota_bloqueo_horas", 24)
	now := time.Now()
	for _, n := range rows {
		created, _ := n["created_at"].(time.Time)
		n["editable"] = domain.NoteEditable(created, n["signed_at"] != nil, lock, now) && i64(n["author_id"]) == c.User.UserID
		n["locks_at"] = created.Add(time.Duration(lock) * time.Hour)
	}
	return c.OK(rows)
}

type noteReq struct {
	AppointmentID *int64 `json:"appointment_id"`
	ParentNoteID  *int64 `json:"parent_note_id"`
	Subjective    string `json:"subjective"`
	Objective     string `json:"objective"`
	Assessment    string `json:"assessment"`
	Plan          string `json:"plan"`
}

func (r noteReq) empty() bool {
	return strings.TrimSpace(r.Subjective+r.Objective+r.Assessment+r.Plan) == ""
}

func (s *Server) createNote(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r noteReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.empty() {
		return badRequest("La nota no puede estar vacía")
	}
	noteType := "evolucion"
	if r.ParentNoteID != nil {
		noteType = "adenda"
		parent, err := db.Row(c.Context(), s.db, `SELECT patient_id FROM clinical_notes WHERE id = $1`, *r.ParentNoteID)
		if err != nil {
			return err
		}
		if i64(parent["patient_id"]) != id {
			return badRequest("La adenda debe referirse a una nota del mismo paciente")
		}
	}
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO clinical_notes (patient_id, appointment_id, author_id, note_type, parent_note_id, subjective, objective, assessment, plan)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
		id, r.AppointmentID, c.User.UserID, noteType, r.ParentNoteID, emptyToNil(r.Subjective), emptyToNil(r.Objective),
		emptyToNil(r.Assessment), emptyToNil(r.Plan))
	if err != nil {
		return err
	}
	c.Audit(row["id"], id, map[string]any{"type": noteType})
	return c.Created(row)
}

func (s *Server) updateNote(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r noteReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.empty() {
		return badRequest("La nota no puede estar vacía")
	}
	n, err := db.Row(c.Context(), s.db, `SELECT * FROM clinical_notes WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if i64(n["author_id"]) != c.User.UserID {
		return forbidden("Solo el autor puede editar la nota")
	}
	row, err := db.Row(c.Context(), s.db, `
		UPDATE clinical_notes SET subjective=$2, objective=$3, assessment=$4, plan=$5, updated_at=now() WHERE id=$1 RETURNING *`,
		id, emptyToNil(r.Subjective), emptyToNil(r.Objective), emptyToNil(r.Assessment), emptyToNil(r.Plan))
	if err != nil {
		return err
	}
	c.Audit(id, i64(n["patient_id"]), nil)
	return c.OK(row)
}

// signNote aplica la firma digital: re-autenticación + huella SHA-256 del contenido.
func (s *Server) signNote(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Password string `json:"password"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	n, err := db.Row(c.Context(), s.db, `SELECT * FROM clinical_notes WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if n["signed_at"] != nil {
		return conflict("La nota ya está firmada")
	}
	if i64(n["author_id"]) != c.User.UserID {
		return forbidden("Solo el profesional autor puede firmar la nota")
	}
	if !s.verifyPassword(c.Context(), c.User.UserID, r.Password) {
		return badRequest("Contraseña incorrecta: no se aplicó la firma")
	}
	signedAt := time.Now()
	hash := security.SHA256Hex(fmt.Sprint(id), fmt.Sprint(c.User.UserID), c.User.Email, str(n["subjective"]), str(n["objective"]),
		str(n["assessment"]), str(n["plan"]), signedAt.UTC().Format(time.RFC3339Nano))
	row, err := db.Row(c.Context(), s.db, `
		UPDATE clinical_notes SET signed_at=$2, signed_by=$3, signature_hash=$4 WHERE id=$1 RETURNING *`, id, signedAt, c.User.UserID, hash)
	if err != nil {
		return err
	}
	c.action = "SIGN"
	c.Audit(id, i64(n["patient_id"]), map[string]any{"signature_hash": hash})
	return c.OK(row)
}

// ------------------------------------- Consentimiento informado (RF-06)

func (s *Server) listConsents(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT k.id, k.patient_id, k.template_id, k.title, k.body, k.status, k.method, k.signature_data, k.signer_name,
		       k.signer_document, k.signed_at, k.signed_ip, k.created_at, u.full_name AS created_by_name
		  FROM consents k LEFT JOIN users u ON u.id = k.created_by WHERE k.patient_id = $1 ORDER BY k.created_at DESC`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) createConsent(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		TemplateID int64  `json:"template_id"`
		DentistID  *int64 `json:"dentist_id"`
		Extra      string `json:"extra"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	t, err := db.Row(c.Context(), s.db, `SELECT * FROM consent_templates WHERE id=$1 AND active`, r.TemplateID)
	if err != nil {
		return err
	}
	p, err := db.Row(c.Context(), s.db, `SELECT * FROM patients WHERE id=$1`, id)
	if err != nil {
		return err
	}
	dentist := c.User.Name
	if r.DentistID != nil {
		if d, err := db.Row(c.Context(), s.db, `SELECT full_name FROM users WHERE id=$1`, *r.DentistID); err == nil {
			dentist = str(d["full_name"])
		}
	}
	body := strings.NewReplacer(
		"{{paciente}}", str(p["first_name"])+" "+str(p["last_name"]),
		"{{documento}}", str(p["document_number"]),
		"{{odontologo}}", dentist,
	).Replace(str(t["body"]))
	if p["guardian_name"] != nil {
		body += fmt.Sprintf("\n\nPor tratarse de un paciente menor de edad, firma su representante legal %s (documento %s) en calidad de %s.",
			str(p["guardian_name"]), str(p["guardian_document"]), strings.ToLower(str(p["guardian_relation"])))
	}
	if strings.TrimSpace(r.Extra) != "" {
		body += "\n\nDetalle del procedimiento: " + strings.TrimSpace(r.Extra)
	}
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO consents (patient_id, template_id, title, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, title, status`,
		id, r.TemplateID, t["title"], body, c.User.UserID)
	if err != nil {
		return err
	}
	c.Audit(row["id"], id, nil)
	return c.Created(row)
}

func (s *Server) loadPendingConsent(c *Ctx) (map[string]any, error) {
	id, err := c.PathID("id")
	if err != nil {
		return nil, err
	}
	k, err := db.Row(c.Context(), s.db, `SELECT * FROM consents WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	if k["status"] != "pendiente" {
		return nil, conflict("El consentimiento ya no está pendiente de firma")
	}
	return k, nil
}

type signerReq struct {
	SignerName     string `json:"signer_name"`
	SignerDocument string `json:"signer_document"`
	SignatureData  string `json:"signature_data"`
	Code           string `json:"code"`
}

func (r signerReq) validate() error {
	if strings.TrimSpace(r.SignerName) == "" || strings.TrimSpace(r.SignerDocument) == "" {
		return badRequest("Nombre y documento del firmante son obligatorios")
	}
	return nil
}

func (s *Server) signConsent(c *Ctx) error {
	k, err := s.loadPendingConsent(c)
	if err != nil {
		return err
	}
	var r signerReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if err := r.validate(); err != nil {
		return err
	}
	if !strings.HasPrefix(r.SignatureData, "data:image/png;base64,") || len(r.SignatureData) < 1500 {
		return badRequest("Capture la firma del paciente en el recuadro")
	}
	if len(r.SignatureData) > 1_500_000 {
		return badRequest("La imagen de la firma es demasiado grande")
	}
	row, err := db.Row(c.Context(), s.db, `
		UPDATE consents SET status='firmado', method='firma', signature_data=$2, signer_name=$3, signer_document=$4, signed_at=now(), signed_ip=$5
		 WHERE id=$1 RETURNING id, status, signed_at`, k["id"], r.SignatureData, strings.TrimSpace(r.SignerName), strings.TrimSpace(r.SignerDocument), c.IP())
	if err != nil {
		return err
	}
	c.action = "SIGN"
	c.Audit(k["id"], i64(k["patient_id"]), map[string]any{"method": "firma", "signer": r.SignerName})
	return c.OK(row)
}

func (s *Server) sendConsentOTP(c *Ctx) error {
	k, err := s.loadPendingConsent(c)
	if err != nil {
		return err
	}
	p, err := db.Row(c.Context(), s.db, `SELECT * FROM patients WHERE id=$1`, k["patient_id"])
	if err != nil {
		return err
	}
	code := security.RandomDigits(6)
	_, err = s.db.Exec(c.Context(), `UPDATE consents SET otp_hash=$2, otp_expires_at=now() + interval '10 minutes' WHERE id=$1`,
		k["id"], security.SHA256Hex(fmt.Sprint(k["id"]), code))
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("SIGO-Dental: su código para firmar \"%s\" es %s. Vence en 10 minutos. No lo comparta.", str(k["title"]), code)
	n, err := s.notify(c.Context(), p, nil, "otp", msg)
	if err != nil {
		return err
	}
	c.Audit(k["id"], i64(k["patient_id"]), map[string]any{"otp_sent_to": n["recipient"], "channel": n["channel"]})
	// El proveedor de mensajería es simulado: se devuelve el código para la demostración.
	return c.OK(map[string]any{"sent_to": n["recipient"], "channel": n["channel"], "demo_code": code, "expires_in": 600})
}

func (s *Server) verifyConsentOTP(c *Ctx) error {
	k, err := s.loadPendingConsent(c)
	if err != nil {
		return err
	}
	var r signerReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if err := r.validate(); err != nil {
		return err
	}
	exp, _ := k["otp_expires_at"].(time.Time)
	if k["otp_hash"] == nil || time.Now().After(exp) {
		return badRequest("El código expiró o no ha sido enviado. Solicite uno nuevo.")
	}
	if security.SHA256Hex(fmt.Sprint(k["id"]), strings.TrimSpace(r.Code)) != str(k["otp_hash"]) {
		return badRequest("Código OTP incorrecto")
	}
	row, err := db.Row(c.Context(), s.db, `
		UPDATE consents SET status='firmado', method='otp', otp_hash=NULL, signer_name=$2, signer_document=$3, signed_at=now(), signed_ip=$4
		 WHERE id=$1 RETURNING id, status, signed_at`, k["id"], strings.TrimSpace(r.SignerName), strings.TrimSpace(r.SignerDocument), c.IP())
	if err != nil {
		return err
	}
	c.action = "SIGN"
	c.Audit(k["id"], i64(k["patient_id"]), map[string]any{"method": "otp", "signer": r.SignerName})
	return c.OK(row)
}

func (s *Server) revokeConsent(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	row, err := db.Row(c.Context(), s.db, `UPDATE consents SET status='revocado' WHERE id=$1 AND status <> 'revocado' RETURNING id, patient_id`, id)
	if err != nil {
		return err
	}
	c.Audit(id, i64(row["patient_id"]), nil)
	return c.OK(row)
}

// ------------------------------------------------------------- Recetas

type rxItem struct {
	Medicamento string `json:"medicamento"`
	Dosis       string `json:"dosis"`
	Frecuencia  string `json:"frecuencia"`
	Duracion    string `json:"duracion"`
}

func (s *Server) listPrescriptions(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT r.*, u.full_name AS dentist_name, u.license_number, u.specialty
		  FROM prescriptions r JOIN users u ON u.id = r.dentist_id WHERE r.patient_id = $1 ORDER BY r.created_at DESC`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) createPrescription(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Diagnosis   string   `json:"diagnosis"`
		Items       []rxItem `json:"items"`
		Indications string   `json:"indications"`
		Override    bool     `json:"override_allergy"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	var items []rxItem
	for _, it := range r.Items {
		if strings.TrimSpace(it.Medicamento) != "" {
			items = append(items, it)
		}
	}
	if len(items) == 0 {
		return badRequest("Agregue al menos un medicamento")
	}
	h, _ := db.Row(c.Context(), s.db, `SELECT penicillin_allergy, allergies FROM medical_histories WHERE patient_id=$1`, id)
	if h != nil && !r.Override {
		pen, _ := h["penicillin_allergy"].(bool)
		for _, it := range items {
			if domain.AllergyConflict(it.Medicamento, pen, str(h["allergies"])) {
				return &HTTPError{Code: 409, Reason: "allergy_conflict",
					Message: fmt.Sprintf("ALERTA: %s puede estar contraindicado por las alergias registradas del paciente.", it.Medicamento)}
			}
		}
	}
	data, _ := json.Marshal(items)
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO prescriptions (patient_id, dentist_id, diagnosis, items, indications) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		id, c.User.UserID, emptyToNil(r.Diagnosis), string(data), emptyToNil(r.Indications))
	if err != nil {
		return err
	}
	c.Audit(row["id"], id, map[string]any{"items": len(items), "allergy_override": r.Override})
	return c.Created(row)
}

// ------------------------------------------- Archivos (Rx, fotos, PDF)

const maxUpload = 15 << 20

var allowedMime = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true, "application/pdf": true,
	"application/dicom": true, "application/octet-stream": true,
}

func (s *Server) listFiles(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT f.id, f.patient_id, f.category, f.filename, f.mime_type, f.size_bytes, f.description, f.uploaded_at, u.full_name AS uploaded_by_name
		  FROM patient_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.patient_id = $1 ORDER BY f.uploaded_at DESC`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) uploadFile(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	c.R.Body = http.MaxBytesReader(c.W, c.R.Body, maxUpload+1<<20)
	if err := c.R.ParseMultipartForm(maxUpload); err != nil {
		return badRequest("El archivo supera el límite de 15 MB")
	}
	file, hdr, err := c.R.FormFile("file")
	if err != nil {
		return badRequest("Adjunte un archivo")
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	mime := http.DetectContentType(content)
	if strings.HasSuffix(strings.ToLower(hdr.Filename), ".dcm") {
		mime = "application/dicom"
	}
	if i := strings.Index(mime, ";"); i > 0 {
		mime = mime[:i]
	}
	if !allowedMime[mime] {
		return badRequest("Tipo de archivo no permitido (" + mime + "). Use JPG, PNG, WEBP, PDF o DICOM.")
	}
	category := c.R.FormValue("category")
	switch category {
	case "radiografia", "fotografia", "documento", "laboratorio", "otro":
	default:
		category = "otro"
	}
	enc, err := s.files.Encrypt(content)
	if err != nil {
		return err
	}
	dir := filepath.Join(s.cfg.UploadDir, fmt.Sprint(id))
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	name := security.SHA256Hex(hdr.Filename, time.Now().String(), security.RandomDigits(8))[:32] + ".enc"
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, enc, 0o640); err != nil {
		return err
	}
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO patient_files (patient_id, category, filename, mime_type, size_bytes, storage_path, description, uploaded_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, category, size_bytes, uploaded_at`,
		id, category, filepath.Base(hdr.Filename), mime, len(content), path, emptyToNil(c.R.FormValue("description")), c.User.UserID)
	if err != nil {
		_ = os.Remove(path)
		return err
	}
	c.Audit(row["id"], id, map[string]any{"filename": hdr.Filename, "encrypted": "AES-256-GCM"})
	return c.Created(row)
}

func (s *Server) downloadFile(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	f, err := db.Row(c.Context(), s.db, `SELECT * FROM patient_files WHERE id = $1`, id)
	if err != nil {
		return err
	}
	enc, err := os.ReadFile(str(f["storage_path"]))
	if err != nil {
		return notFound("El archivo no está disponible en el almacenamiento")
	}
	plain, err := s.files.Decrypt(enc)
	if err != nil {
		return err
	}
	c.action = "EXPORT"
	c.Audit(id, i64(f["patient_id"]), map[string]any{"filename": f["filename"]})
	disp := "inline"
	if c.Query("download") == "1" {
		disp = "attachment"
	}
	c.W.Header().Set("Content-Type", str(f["mime_type"]))
	c.W.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disp, strings.ReplaceAll(str(f["filename"]), `"`, "")))
	c.W.Header().Set("Cache-Control", "private, no-store")
	c.status = 200
	_, err = c.W.Write(plain)
	return err
}
