package api

import (
	"context"
	"fmt"
	"strings"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
)

// ------------------------------- Planes de tratamiento (RF-07, RF-08)

const planItemSelect = `
	SELECT i.*, p.code AS procedure_code, p.name AS procedure_name, p.category, p.duration_min, p.odontogram_condition,
	       a.starts_at AS appointment_at, a.status AS appointment_status, u.full_name AS performed_by_name
	  FROM plan_items i JOIN procedures p ON p.id = i.procedure_id
	  LEFT JOIN appointments a ON a.id = i.appointment_id
	  LEFT JOIN users u ON u.id = i.performed_by`

func (s *Server) loadPlan(ctx context.Context, q db.Querier, id int64) (map[string]any, error) {
	plan, err := db.Row(ctx, q, `
		SELECT t.*, u.full_name AS dentist_name, pa.first_name || ' ' || pa.last_name AS patient_name, pa.record_number,
		       pa.document_number, au.full_name AS discount_authorized_by_name
		  FROM treatment_plans t JOIN users u ON u.id = t.dentist_id JOIN patients pa ON pa.id = t.patient_id
		  LEFT JOIN users au ON au.id = t.discount_authorized_by
		 WHERE t.id = $1`, id)
	if err != nil {
		return nil, err
	}
	items, err := db.Rows(ctx, q, planItemSelect+` WHERE i.plan_id = $1 ORDER BY i.phase, i.id`, id)
	if err != nil {
		return nil, err
	}
	budget := make([]domain.BudgetItem, len(items))
	for i, it := range items {
		it["net"] = domain.ItemNet(num(it["price"]), num(it["discount_pct"]))
		budget[i] = domain.BudgetItem{Price: num(it["price"]), LabCost: num(it["lab_cost"]), DiscountPct: num(it["discount_pct"]), Status: str(it["status"])}
	}
	plan["items"] = items
	plan["totals"] = domain.ComputeBudget(budget, num(plan["discount_pct"]))
	return plan, nil
}

func (s *Server) listPlans(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `SELECT id FROM treatment_plans WHERE patient_id=$1 ORDER BY created_at DESC`, id)
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		p, err := s.loadPlan(c.Context(), s.db, i64(r["id"]))
		if err != nil {
			return err
		}
		out = append(out, p)
	}
	return c.OK(out)
}

func (s *Server) getPlan(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	p, err := s.loadPlan(c.Context(), s.db, id)
	if err != nil {
		return err
	}
	c.Audit(id, i64(p["patient_id"]), nil)
	return c.OK(p)
}

type planItemReq struct {
	Phase       int      `json:"phase"`
	ProcedureID int64    `json:"procedure_id"`
	Tooth       *int     `json:"tooth"`
	Surface     string   `json:"surface"`
	Description string   `json:"description"`
	Price       *float64 `json:"price"`
	DiscountPct float64  `json:"discount_pct"`
}

func (s *Server) checkDiscount(c *Ctx, pct float64) error {
	if pct < 0 || pct > 100 {
		return badRequest("Descuento inválido")
	}
	max := s.settings.Float("descuento_max_pct", 15)
	if domain.DiscountNeedsAuthorization(pct, max, c.User.Role) {
		return forbidden(fmt.Sprintf("Descuentos mayores a %.0f%% requieren autorización del administrador", max))
	}
	return nil
}

func (s *Server) insertPlanItem(c *Ctx, q db.Querier, planID int64, it planItemReq) error {
	if err := s.checkDiscount(c, it.DiscountPct); err != nil {
		return err
	}
	proc, err := db.Row(c.Context(), q, `SELECT * FROM procedures WHERE id=$1 AND active`, it.ProcedureID)
	if err != nil {
		return badRequest("Procedimiento inválido")
	}
	if it.Tooth != nil && !validTooth(*it.Tooth) {
		return badRequest(fmt.Sprintf("Pieza dental inválida: %d", *it.Tooth))
	}
	price := num(proc["price"])
	if it.Price != nil {
		if *it.Price < 0 {
			return badRequest("Precio inválido")
		}
		price = *it.Price
	}
	if it.Phase < 1 {
		it.Phase = 1
	}
	_, err = q.Exec(c.Context(), `
		INSERT INTO plan_items (plan_id, phase, procedure_id, tooth, surface, description, price, lab_cost, discount_pct)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9)`,
		planID, it.Phase, it.ProcedureID, it.Tooth, strings.ToUpper(it.Surface), emptyToNil(it.Description), price, proc["lab_cost"], it.DiscountPct)
	return err
}

func (s *Server) createPlan(c *Ctx) error {
	pid, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Title       string        `json:"title"`
		DentistID   int64         `json:"dentist_id"`
		DiscountPct float64       `json:"discount_pct"`
		Notes       string        `json:"notes"`
		Items       []planItemReq `json:"items"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if strings.TrimSpace(r.Title) == "" {
		return badRequest("El plan requiere un título")
	}
	if r.DentistID == 0 {
		r.DentistID = c.User.UserID
	}
	if err := s.checkDiscount(c, r.DiscountPct); err != nil {
		return err
	}
	var planID int64
	err = s.inTx(c.Context(), func(q db.Querier) error {
		if err := s.checkDentist(c.Context(), q, r.DentistID); err != nil {
			return err
		}
		var auth any
		if r.DiscountPct > s.settings.Float("descuento_max_pct", 15) {
			auth = c.User.UserID
		}
		if err := q.QueryRow(c.Context(), `
			INSERT INTO treatment_plans (patient_id, dentist_id, title, discount_pct, discount_authorized_by, notes, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
			pid, r.DentistID, strings.TrimSpace(r.Title), r.DiscountPct, auth, emptyToNil(r.Notes), c.User.UserID).Scan(&planID); err != nil {
			return err
		}
		for _, it := range r.Items {
			if err := s.insertPlanItem(c, q, planID, it); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.Audit(planID, pid, map[string]any{"items": len(r.Items)})
	p, err := s.loadPlan(c.Context(), s.db, planID)
	if err != nil {
		return err
	}
	return c.Created(p)
}

func (s *Server) editablePlan(c *Ctx, id int64) (map[string]any, error) {
	p, err := db.Row(c.Context(), s.db, `SELECT * FROM treatment_plans WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	if p["status"] != "borrador" && p["status"] != "presentado" {
		return nil, conflict("El plan ya fue aprobado o cerrado; cree un nuevo plan para cambios")
	}
	return p, nil
}

func (s *Server) updatePlan(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Title       string  `json:"title"`
		DiscountPct float64 `json:"discount_pct"`
		Notes       string  `json:"notes"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	p, err := s.editablePlan(c, id)
	if err != nil {
		return err
	}
	if err := s.checkDiscount(c, r.DiscountPct); err != nil {
		return err
	}
	var auth any = p["discount_authorized_by"]
	if r.DiscountPct > s.settings.Float("descuento_max_pct", 15) && num(p["discount_pct"]) != r.DiscountPct {
		auth = c.User.UserID
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE treatment_plans SET title=$2, discount_pct=$3, notes=$4, discount_authorized_by=$5 WHERE id=$1`,
		id, strings.TrimSpace(r.Title), r.DiscountPct, emptyToNil(r.Notes), auth); err != nil {
		return err
	}
	c.Audit(id, i64(p["patient_id"]), map[string]any{"discount_pct": r.DiscountPct})
	out, err := s.loadPlan(c.Context(), s.db, id)
	if err != nil {
		return err
	}
	return c.OK(out)
}

func (s *Server) addPlanItem(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var it planItemReq
	if err := c.Bind(&it); err != nil {
		return err
	}
	p, err := s.editablePlan(c, id)
	if err != nil {
		return err
	}
	if err := s.insertPlanItem(c, s.db, id, it); err != nil {
		return err
	}
	c.Audit(id, i64(p["patient_id"]), map[string]any{"procedure_id": it.ProcedureID})
	out, err := s.loadPlan(c.Context(), s.db, id)
	if err != nil {
		return err
	}
	return c.OK(out)
}

func (s *Server) deletePlanItem(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	it, err := db.Row(c.Context(), s.db, `SELECT i.*, t.patient_id FROM plan_items i JOIN treatment_plans t ON t.id=i.plan_id WHERE i.id=$1`, id)
	if err != nil {
		return err
	}
	if _, err := s.editablePlan(c, i64(it["plan_id"])); err != nil {
		return err
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM plan_items WHERE id=$1`, id); err != nil {
		return err
	}
	c.Audit(id, i64(it["patient_id"]), nil)
	out, err := s.loadPlan(c.Context(), s.db, i64(it["plan_id"]))
	if err != nil {
		return err
	}
	return c.OK(out)
}

func (s *Server) presentPlan(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	p, err := s.editablePlan(c, id)
	if err != nil {
		return err
	}
	var n int
	if err := s.db.QueryRow(c.Context(), `SELECT count(*) FROM plan_items WHERE plan_id=$1`, id).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return badRequest("Agregue procedimientos antes de presentar el presupuesto")
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE treatment_plans SET status='presentado' WHERE id=$1`, id); err != nil {
		return err
	}
	c.Audit(id, i64(p["patient_id"]), nil)
	out, err := s.loadPlan(c.Context(), s.db, id)
	if err != nil {
		return err
	}
	return c.OK(out)
}

// approvePlan registra la aprobación total o parcial del paciente (RF-08).
func (s *Server) approvePlan(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		ItemIDs        []int64 `json:"item_ids"`
		ApprovedByName string  `json:"approved_by_name"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	p, err := s.editablePlan(c, id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(r.ApprovedByName) == "" {
		return badRequest("Indique el nombre de quien aprueba (paciente o representante)")
	}
	var status string
	err = s.inTx(c.Context(), func(q db.Querier) error {
		if _, err := q.Exec(c.Context(), `UPDATE plan_items SET status = CASE WHEN id = ANY($2) THEN 'aprobado' ELSE 'rechazado' END
			WHERE plan_id=$1 AND status='propuesto'`, id, r.ItemIDs); err != nil {
			return err
		}
		var total, approved int
		if err := q.QueryRow(c.Context(), `SELECT count(*), count(*) FILTER (WHERE status <> 'rechazado') FROM plan_items WHERE plan_id=$1`, id).
			Scan(&total, &approved); err != nil {
			return err
		}
		switch {
		case approved == 0:
			status = "rechazado"
		case approved == total:
			status = "aprobado"
		default:
			status = "aprobado_parcial"
		}
		_, err := q.Exec(c.Context(), `UPDATE treatment_plans SET status=$2, approved_at=now(), approved_by_name=$3 WHERE id=$1`,
			id, status, strings.TrimSpace(r.ApprovedByName))
		return err
	})
	if err != nil {
		return err
	}
	c.action = "APPROVE"
	c.Audit(id, i64(p["patient_id"]), map[string]any{"status": status, "approved_items": r.ItemIDs})
	out, err := s.loadPlan(c.Context(), s.db, id)
	if err != nil {
		return err
	}
	return c.OK(out)
}

// completePlanItem marca el procedimiento como realizado: actualiza el
// odontograma y descuenta los insumos según la receta estándar (RF-14).
func (s *Server) completePlanItem(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Notes string `json:"notes"`
	}
	_ = c.Bind(&r)
	var patientID, planID int64
	var consumed []map[string]any
	err = s.inTx(c.Context(), func(q db.Querier) error {
		it, err := db.Row(c.Context(), q, `
			SELECT i.*, t.patient_id, t.status AS plan_status, p.odontogram_condition, p.name AS procedure_name,
			       a.chair_id, ch.office_id
			  FROM plan_items i JOIN treatment_plans t ON t.id = i.plan_id JOIN procedures p ON p.id = i.procedure_id
			  LEFT JOIN appointments a ON a.id = i.appointment_id LEFT JOIN chairs ch ON ch.id = a.chair_id
			 WHERE i.id = $1 FOR UPDATE OF i`, id)
		if err != nil {
			return err
		}
		patientID, planID = i64(it["patient_id"]), i64(it["plan_id"])
		if it["status"] != "aprobado" && it["status"] != "agendado" {
			return conflict("Solo se pueden realizar procedimientos aprobados por el paciente")
		}
		if _, err := q.Exec(c.Context(), `UPDATE plan_items SET status='realizado', performed_at=now(), performed_by=$2 WHERE id=$1`, id, c.User.UserID); err != nil {
			return err
		}
		if cond := str(it["odontogram_condition"]); cond != "" && it["tooth"] != nil {
			if _, err := q.Exec(c.Context(), `
				INSERT INTO odontogram_findings (patient_id, tooth, surface, condition, status, notes, plan_item_id, created_by)
				VALUES ($1,$2,$3,$4,'realizado',$5,$6,$7)`,
				patientID, it["tooth"], it["surface"], cond, "Realizado: "+str(it["procedure_name"]), id, c.User.UserID); err != nil {
				return err
			}
		}
		consumed, err = s.consumeSupplies(c.Context(), q, i64(it["procedure_id"]), id, it["office_id"], c.User.UserID)
		if err != nil {
			return err
		}
		if it["appointment_id"] != nil {
			if _, err := q.Exec(c.Context(), `UPDATE appointments SET status='atendido', updated_at=now() WHERE id=$1 AND status='en_atencion'`, it["appointment_id"]); err != nil {
				return err
			}
		}
		var pending int
		if err := q.QueryRow(c.Context(), `SELECT count(*) FROM plan_items WHERE plan_id=$1 AND status IN ('aprobado','agendado')`, planID).Scan(&pending); err != nil {
			return err
		}
		if pending == 0 {
			_, err = q.Exec(c.Context(), `UPDATE treatment_plans SET status='completado' WHERE id=$1`, planID)
		}
		return err
	})
	if err != nil {
		return err
	}
	c.action = "COMPLETE"
	c.Audit(id, patientID, map[string]any{"supplies_consumed": len(consumed)})
	out, err := s.loadPlan(c.Context(), s.db, planID)
	if err != nil {
		return err
	}
	out["consumed"] = consumed
	return c.OK(out)
}

// consumeSupplies descarga del stock la receta del procedimiento.
func (s *Server) consumeSupplies(ctx context.Context, q db.Querier, procedureID, planItemID int64, officeID any, userID int64) ([]map[string]any, error) {
	recipe, err := db.Rows(ctx, q, `
		SELECT ps.supply_id, ps.quantity, s.name, s.unit FROM procedure_supplies ps JOIN supplies s ON s.id = ps.supply_id
		 WHERE ps.procedure_id = $1 AND s.active`, procedureID)
	if err != nil {
		return nil, err
	}
	for _, r := range recipe {
		var after float64
		if err := q.QueryRow(ctx, `UPDATE supplies SET stock = stock - $2 WHERE id = $1 RETURNING stock`, r["supply_id"], r["quantity"]).Scan(&after); err != nil {
			return nil, err
		}
		r["stock_after"] = after
		if _, err := q.Exec(ctx, `
			INSERT INTO stock_movements (supply_id, movement_type, quantity, stock_after, reason, plan_item_id, office_id, dentist_id, user_id)
			VALUES ($1,'consumo',$2,$3,'Descargo automático por procedimiento realizado',$4,$5,$6,$6)`,
			r["supply_id"], -num(r["quantity"]), after, planItemID, officeID, userID); err != nil {
			return nil, err
		}
	}
	return recipe, nil
}

func (s *Server) billableItems(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, planItemSelect+`
		JOIN treatment_plans t ON t.id = i.plan_id
		 WHERE t.patient_id = $1 AND i.status = 'realizado' AND NOT i.invoiced ORDER BY i.performed_at`, id)
	if err != nil {
		return err
	}
	plans := map[int64]float64{}
	for _, r := range rows {
		pid := i64(r["plan_id"])
		if _, ok := plans[pid]; !ok {
			var d float64
			_ = s.db.QueryRow(c.Context(), `SELECT discount_pct::float8 FROM treatment_plans WHERE id=$1`, pid).Scan(&d)
			plans[pid] = d
		}
		net := domain.ItemNet(num(r["price"]), num(r["discount_pct"]))
		r["net"] = domain.Round2(net * (1 - plans[pid]/100))
		r["dentist_id"] = r["performed_by"]
	}
	return c.OK(rows)
}

