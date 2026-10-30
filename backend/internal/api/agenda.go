package api

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
)

// ------------------------------------------------ Mensajería (RF-11)

// Notifier abstrae el gateway de mensajería (Meta Cloud API, Twilio, etc.).
type Notifier interface {
	Send(ctx context.Context, channel, recipient, message string) (provider, ref string, err error)
}

// SimulatedNotifier registra el envío sin contactar proveedores externos.
type SimulatedNotifier struct{}

func (SimulatedNotifier) Send(_ context.Context, channel, _ string, _ string) (string, string, error) {
	provider := map[string]string{
		"whatsapp": "meta-cloud-api (simulado)",
		"sms":      "twilio-sms (simulado)",
		"email":    "twilio-sendgrid (simulado)",
	}[channel]
	return provider, fmt.Sprintf("SIM-%d", time.Now().UnixNano()%1_000_000_000), nil
}

func (s *Server) notify(ctx context.Context, patient map[string]any, appointmentID any, kind, message string) (map[string]any, error) {
	channel := str(patient["preferred_channel"])
	recipient := str(patient["phone"])
	if channel == "email" || recipient == "" {
		if e := str(patient["email"]); e != "" {
			channel, recipient = "email", e
		}
	}
	if recipient == "" {
		return nil, badRequest("El paciente no tiene un medio de contacto registrado")
	}
	provider, ref, err := s.notifier.Send(ctx, channel, recipient, message)
	status := "enviado"
	if err != nil {
		status = "fallido"
	}
	return db.Row(ctx, s.db, `
		INSERT INTO notifications (patient_id, appointment_id, channel, kind, recipient, message, status, provider, provider_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
		patient["id"], appointmentID, channel, kind, recipient, message, status, provider, ref)
}

func apptMessage(kind, clinic, firstName string, start time.Time, dentist, office string) string {
	when := start.Format("02/01/2006") + " a las " + start.Format("15:04")
	name := strings.Split(firstName, " ")[0]
	switch kind {
	case "confirmacion":
		return fmt.Sprintf("Hola %s, su cita en %s quedó agendada para el %s con %s (%s). Responda SI para confirmar.", name, clinic, when, dentist, office)
	case "recordatorio_48h":
		return fmt.Sprintf("Recordatorio: %s, tiene una cita el %s con %s en %s. Responda SI para confirmar o NO para reprogramar.", name, when, dentist, office)
	case "recordatorio_24h":
		return fmt.Sprintf("%s, le esperamos mañana %s con %s en %s. Por favor llegue 10 minutos antes.", name, when, dentist, office)
	case "cancelacion":
		return fmt.Sprintf("Hola %s, su cita del %s en %s fue cancelada. Comuníquese con nosotros para reprogramarla.", name, when, clinic)
	}
	return ""
}

func (s *Server) notifyAppointment(ctx context.Context, apptID int64, kind string) error {
	a, err := db.Row(ctx, s.db, `
		SELECT a.patient_id, a.starts_at, u.full_name AS dentist, o.name AS office
		  FROM appointments a JOIN users u ON u.id = a.dentist_id
		  JOIN chairs ch ON ch.id = a.chair_id JOIN offices o ON o.id = ch.office_id WHERE a.id = $1`, apptID)
	if err != nil {
		return err
	}
	patient, err := db.Row(ctx, s.db, `SELECT * FROM patients WHERE id = $1`, a["patient_id"])
	if err != nil {
		return err
	}
	start := a["starts_at"].(time.Time).In(s.cfg.Location)
	msg := apptMessage(kind, s.settings.Get("clinica_nombre"), str(patient["first_name"]), start, str(a["dentist"]), str(a["office"]))
	_, err = s.notify(ctx, patient, apptID, kind, msg)
	return err
}

// RunReminders envía recordatorios 48h y 24h (RF-11). Se ejecuta periódicamente.
func (s *Server) RunReminders(ctx context.Context) (int, error) {
	if !s.settings.Bool("recordatorios_activos") {
		return 0, nil
	}
	sent := 0
	for _, w := range []struct {
		kind, flag string
		hours      int
	}{{"recordatorio_24h", "reminder_24_sent", 24}, {"recordatorio_48h", "reminder_48_sent", 48}} {
		rows, err := db.Rows(ctx, s.db, fmt.Sprintf(`
			SELECT id FROM appointments
			 WHERE status IN ('programado','confirmado') AND NOT %s
			   AND starts_at > now() AND starts_at <= now() + make_interval(hours => $1)`, w.flag), w.hours)
		if err != nil {
			return sent, err
		}
		for _, r := range rows {
			id := i64(r["id"])
			if err := s.notifyAppointment(ctx, id, w.kind); err != nil {
				slog.Warn("recordatorio no enviado", "appointment", id, "err", err)
				continue
			}
			// Si ya entró en la ventana de 24h, el de 48h deja de tener sentido.
			if _, err := s.db.Exec(ctx, `UPDATE appointments SET reminder_48_sent = TRUE,
				reminder_24_sent = reminder_24_sent OR $2 WHERE id = $1`, id, w.flag == "reminder_24_sent"); err != nil {
				return sent, err
			}
			sent++
		}
	}
	return sent, nil
}

func (s *Server) StartReminderWorker(ctx context.Context) {
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			if n, err := s.RunReminders(ctx); err != nil {
				slog.Error("worker de recordatorios", "err", err)
			} else if n > 0 {
				slog.Info("recordatorios enviados", "cantidad", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
}

func (s *Server) listNotifications(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT n.*, p.first_name || ' ' || p.last_name AS patient_name
		  FROM notifications n LEFT JOIN patients p ON p.id = n.patient_id
		 WHERE ($1 = '' OR n.kind = $1) AND ($2 = '' OR n.channel = $2)
		 ORDER BY n.id DESC LIMIT $3`, c.Query("kind"), c.Query("channel"), c.QueryInt("limit", 200))
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) runRemindersNow(c *Ctx) error {
	n, err := s.RunReminders(c.Context())
	if err != nil {
		return err
	}
	return c.OK(map[string]any{"sent": n})
}

// ------------------------------------------------------ Citas (RF-09)

const apptSelect = `
	SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name, p.record_number, p.phone AS patient_phone,
	       u.full_name AS dentist_name, u.color AS dentist_color, ch.name AS chair_name, ch.office_id, o.name AS office_name,
	       pi.id AS plan_item_id, pr.name AS plan_item_name,
	       EXISTS (SELECT 1 FROM medical_histories h WHERE h.patient_id = a.patient_id AND (h.penicillin_allergy OR h.latex_allergy
	           OR h.anesthesia_allergy OR h.anticoagulated OR h.coagulopathy OR h.heart_disease OR h.pregnant)) AS has_alerts
	  FROM appointments a
	  JOIN patients p ON p.id = a.patient_id
	  JOIN users u ON u.id = a.dentist_id
	  JOIN chairs ch ON ch.id = a.chair_id
	  JOIN offices o ON o.id = ch.office_id
	  LEFT JOIN plan_items pi ON pi.appointment_id = a.id
	  LEFT JOIN procedures pr ON pr.id = pi.procedure_id`

func (s *Server) listAppointments(c *Ctx) error {
	from, to := c.Query("from"), c.Query("to")
	if from == "" {
		from = time.Now().Format("2006-01-02")
	}
	if to == "" {
		to = from
	}
	rows, err := db.Rows(c.Context(), s.db, apptSelect+`
		 WHERE a.starts_at >= $1::date AND a.starts_at < $2::date + 1
		   AND ($3 = 0 OR a.chair_id = $3) AND ($4 = 0 OR a.dentist_id = $4)
		   AND ($5 = 0 OR ch.office_id = $5) AND ($6 = 0 OR a.patient_id = $6)
		   AND ($7 OR a.status NOT IN ('cancelado'))
		 ORDER BY a.starts_at, ch.id`,
		from, to, c.QueryInt("chair_id", 0), c.QueryInt("dentist_id", 0), c.QueryInt("office_id", 0), c.QueryInt("patient_id", 0),
		c.Query("include_cancelled") == "true")
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) patientAppointments(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, apptSelect+` WHERE a.patient_id = $1 ORDER BY a.starts_at DESC LIMIT 100`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

type apptReq struct {
	PatientID  int64     `json:"patient_id"`
	DentistID  int64     `json:"dentist_id"`
	ChairID    int64     `json:"chair_id"`
	StartsAt   time.Time `json:"starts_at"`
	EndsAt     time.Time `json:"ends_at"`
	Reason     string    `json:"reason"`
	Notes      string    `json:"notes"`
	PlanItemID *int64    `json:"plan_item_id"`
	Notify     *bool     `json:"notify"`
}

func (r *apptReq) validate(isNew bool) error {
	if r.PatientID == 0 || r.DentistID == 0 || r.ChairID == 0 {
		return badRequest("Paciente, profesional y sillón son obligatorios")
	}
	if r.StartsAt.IsZero() || !r.EndsAt.After(r.StartsAt) {
		return badRequest("El horario de la cita es inválido")
	}
	if r.EndsAt.Sub(r.StartsAt) > 6*time.Hour {
		return badRequest("La cita no puede durar más de 6 horas")
	}
	if isNew && r.StartsAt.Before(time.Now().Add(-15*time.Minute)) {
		return badRequest("No se pueden agendar citas en el pasado")
	}
	return nil
}

// checkDentist valida que el usuario asignado sea odontólogo activo.
func (s *Server) checkDentist(ctx context.Context, q db.Querier, id int64) error {
	u, err := db.Row(ctx, q, `SELECT role, active FROM users WHERE id=$1`, id)
	if err != nil || u["role"] != RoleOdontologo || u["active"] != true {
		return badRequest("El profesional seleccionado no es un odontólogo activo")
	}
	return nil
}

// dentistBusy advierte si el profesional ya tiene otra cita en ese horario.
func (s *Server) dentistBusy(ctx context.Context, q db.Querier, dentistID int64, start, end time.Time, exclude int64) (bool, error) {
	var busy bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM appointments WHERE dentist_id=$1 AND id <> $4
		AND status NOT IN ('cancelado','no_asistio') AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2, $3, '[)'))`,
		dentistID, start, end, exclude).Scan(&busy)
	return busy, err
}

func (s *Server) createAppointment(c *Ctx) error {
	var r apptReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if err := r.validate(true); err != nil {
		return err
	}
	var row map[string]any
	err := s.inTx(c.Context(), func(q db.Querier) error {
		if err := s.checkDentist(c.Context(), q, r.DentistID); err != nil {
			return err
		}
		if busy, err := s.dentistBusy(c.Context(), q, r.DentistID, r.StartsAt, r.EndsAt, 0); err != nil {
			return err
		} else if busy {
			return conflict("El profesional ya tiene otra cita en ese horario")
		}
		var err error
		row, err = db.Row(c.Context(), q, `
			INSERT INTO appointments (patient_id, dentist_id, chair_id, starts_at, ends_at, reason, notes, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
			r.PatientID, r.DentistID, r.ChairID, r.StartsAt, r.EndsAt, emptyToNil(r.Reason), emptyToNil(r.Notes), c.User.UserID)
		if err != nil {
			return err
		}
		if r.PlanItemID != nil {
			tag, err := q.Exec(c.Context(), `UPDATE plan_items SET status='agendado', appointment_id=$2
				WHERE id=$1 AND status IN ('aprobado','agendado')
				  AND plan_id IN (SELECT id FROM treatment_plans WHERE patient_id=$3)`, *r.PlanItemID, row["id"], r.PatientID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return badRequest("El ítem del plan no está aprobado o no pertenece al paciente")
			}
		}
		_, err = q.Exec(c.Context(), `INSERT INTO appointment_status_log (appointment_id, to_status, changed_by) VALUES ($1,'programado',$2)`, row["id"], c.User.UserID)
		return err
	})
	if err != nil {
		return err
	}
	id := i64(row["id"])
	if r.Notify == nil || *r.Notify {
		if err := s.notifyAppointment(c.Context(), id, "confirmacion"); err != nil {
			slog.Warn("confirmación no enviada", "err", err)
		}
	}
	c.Audit(id, r.PatientID, map[string]any{"chair_id": r.ChairID, "starts_at": r.StartsAt})
	out, err := db.Row(c.Context(), s.db, apptSelect+` WHERE a.id = $1`, id)
	if err != nil {
		return err
	}
	return c.Created(out)
}

func (s *Server) updateAppointment(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r apptReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	cur, err := db.Row(c.Context(), s.db, `SELECT * FROM appointments WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if cur["status"] != domain.StatusProgramado && cur["status"] != domain.StatusConfirmado {
		return conflict("Solo se pueden reprogramar citas programadas o confirmadas")
	}
	r.PatientID = i64(cur["patient_id"])
	if err := r.validate(false); err != nil {
		return err
	}
	moved := !r.StartsAt.Equal(cur["starts_at"].(time.Time))
	err = s.inTx(c.Context(), func(q db.Querier) error {
		if err := s.checkDentist(c.Context(), q, r.DentistID); err != nil {
			return err
		}
		if busy, err := s.dentistBusy(c.Context(), q, r.DentistID, r.StartsAt, r.EndsAt, id); err != nil {
			return err
		} else if busy {
			return conflict("El profesional ya tiene otra cita en ese horario")
		}
		_, err := q.Exec(c.Context(), `
			UPDATE appointments SET dentist_id=$2, chair_id=$3, starts_at=$4, ends_at=$5, reason=$6, notes=$7, updated_at=now(),
			       reminder_48_sent = CASE WHEN $8 THEN FALSE ELSE reminder_48_sent END,
			       reminder_24_sent = CASE WHEN $8 THEN FALSE ELSE reminder_24_sent END,
			       status = CASE WHEN $8 THEN 'programado' ELSE status END
			 WHERE id=$1`, id, r.DentistID, r.ChairID, r.StartsAt, r.EndsAt, emptyToNil(r.Reason), emptyToNil(r.Notes), moved)
		return err
	})
	if err != nil {
		return err
	}
	if moved {
		_ = s.notifyAppointment(c.Context(), id, "confirmacion")
	}
	c.Audit(id, r.PatientID, map[string]any{"rescheduled": moved})
	out, err := db.Row(c.Context(), s.db, apptSelect+` WHERE a.id = $1`, id)
	if err != nil {
		return err
	}
	return c.OK(out)
}

func (s *Server) changeAppointmentStatus(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if !domain.IsValidStatus(r.Status) {
		return badRequest("Estado inválido")
	}
	cur, err := db.Row(c.Context(), s.db, `SELECT * FROM appointments WHERE id=$1`, id)
	if err != nil {
		return err
	}
	from := str(cur["status"])
	if !domain.CanTransition(from, r.Status) {
		return conflict(fmt.Sprintf("No se puede pasar de «%s» a «%s»", from, r.Status))
	}
	if (r.Status == domain.StatusEnAtencion || r.Status == domain.StatusAtendido) && !c.Is(RoleOdontologo, RoleAsistente, RoleAdmin) {
		return forbidden("Solo el personal clínico puede iniciar o finalizar la atención")
	}
	if r.Status == domain.StatusCancelado && strings.TrimSpace(r.Reason) == "" {
		return badRequest("Indique el motivo de cancelación")
	}
	err = s.inTx(c.Context(), func(q db.Querier) error {
		_, err := q.Exec(c.Context(), `
			UPDATE appointments SET status=$2, updated_at=now(),
			       confirmed_at = CASE WHEN $2 = 'confirmado' THEN now() ELSE confirmed_at END,
			       cancel_reason = CASE WHEN $2 = 'cancelado' THEN $3 ELSE cancel_reason END
			 WHERE id=$1`, id, r.Status, emptyToNil(r.Reason))
		if err != nil {
			return err
		}
		if r.Status == domain.StatusCancelado || r.Status == domain.StatusNoAsistio {
			// libera el ítem del plan para poder reagendarlo
			if _, err := q.Exec(c.Context(), `UPDATE plan_items SET status='aprobado', appointment_id=NULL WHERE appointment_id=$1 AND status='agendado'`, id); err != nil {
				return err
			}
		}
		_, err = q.Exec(c.Context(), `INSERT INTO appointment_status_log (appointment_id, from_status, to_status, changed_by) VALUES ($1,$2,$3,$4)`,
			id, from, r.Status, c.User.UserID)
		return err
	})
	if err != nil {
		return err
	}
	if r.Status == domain.StatusCancelado {
		_ = s.notifyAppointment(c.Context(), id, "cancelacion")
	}
	c.Audit(id, i64(cur["patient_id"]), map[string]any{"from": from, "to": r.Status})
	out, err := db.Row(c.Context(), s.db, apptSelect+` WHERE a.id = $1`, id)
	if err != nil {
		return err
	}
	return c.OK(out)
}

func (s *Server) appointmentLog(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT l.*, u.full_name AS changed_by_name FROM appointment_status_log l LEFT JOIN users u ON u.id = l.changed_by
		 WHERE l.appointment_id = $1 ORDER BY l.changed_at`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}
