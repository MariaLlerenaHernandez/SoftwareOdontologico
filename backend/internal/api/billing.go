package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
	"sigo-dental/internal/security"
)

// -------------------------- Facturación electrónica y pagos (RF-12)

var paymentMethods = map[string]string{
	"efectivo": "Efectivo", "tarjeta_credito": "Tarjeta de crédito", "tarjeta_debito": "Tarjeta de débito",
	"transferencia": "Transferencia", "seguro": "Seguro / convenio",
}

func (s *Server) listInvoices(c *Ctx) error {
	from, to := c.Query("from"), c.Query("to")
	if from == "" {
		from = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	}
	if to == "" {
		to = time.Now().Format("2006-01-02")
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT i.*, (i.total - i.paid) AS balance, u.full_name AS issued_by_name
		  FROM invoices i LEFT JOIN users u ON u.id = i.issued_by
		 WHERE (($1 <> '' AND i.patient_id::text = $1) OR ($1 = '' AND i.issued_at >= $2::date AND i.issued_at < $3::date + 1))
		   AND ($4 = '' OR i.status = $4)
		   AND ($5 = '' OR i.customer_name ILIKE '%' || $5 || '%' OR i.number ILIKE '%' || $5 || '%' OR i.customer_document ILIKE $5 || '%')
		 ORDER BY i.issued_at DESC LIMIT 500`, c.Query("patient_id"), from, to, c.Query("status"), c.Query("q"))
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) loadInvoice(ctx context.Context, id int64) (map[string]any, error) {
	inv, err := db.Row(ctx, s.db, `
		SELECT i.*, (i.total - i.paid) AS balance, u.full_name AS issued_by_name, p.address AS customer_address,
		       p.email AS customer_email, p.phone AS customer_phone, ins.name AS insurance_name
		  FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN users u ON u.id = i.issued_by
		  LEFT JOIN insurances ins ON ins.id = p.insurance_id WHERE i.id = $1`, id)
	if err != nil {
		return nil, err
	}
	items, err := db.Rows(ctx, s.db, `
		SELECT ii.*, u.full_name AS dentist_name, pr.code AS procedure_code FROM invoice_items ii
		  LEFT JOIN users u ON u.id = ii.dentist_id LEFT JOIN procedures pr ON pr.id = ii.procedure_id
		 WHERE ii.invoice_id = $1 ORDER BY ii.id`, id)
	if err != nil {
		return nil, err
	}
	pays, err := db.Rows(ctx, s.db, `
		SELECT py.*, u.full_name AS received_by_name FROM payments py LEFT JOIN users u ON u.id = py.received_by
		 WHERE py.invoice_id = $1 ORDER BY py.paid_at`, id)
	if err != nil {
		return nil, err
	}
	inv["items"], inv["payments"] = items, pays
	return inv, nil
}

func (s *Server) getInvoice(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	inv, err := s.loadInvoice(c.Context(), id)
	if err != nil {
		return err
	}
	return c.OK(inv)
}

type paymentReq struct {
	Method    string  `json:"method"`
	Amount    float64 `json:"amount"`
	Reference string  `json:"reference"`
}

type invoiceReq struct {
	PatientID        int64  `json:"patient_id"`
	CustomerName     string `json:"customer_name"`
	CustomerDocument string `json:"customer_document"`
	Items            []struct {
		PlanItemID  *int64  `json:"plan_item_id"`
		ProcedureID *int64  `json:"procedure_id"`
		DentistID   *int64  `json:"dentist_id"`
		Description string  `json:"description"`
		Quantity    float64 `json:"quantity"`
		UnitPrice   float64 `json:"unit_price"`
		Discount    float64 `json:"discount"`
	} `json:"items"`
	Payments []paymentReq `json:"payments"`
}

func (s *Server) openSessionID(ctx context.Context, q db.Querier, userID int64) (int64, error) {
	var id int64
	err := q.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE user_id=$1 AND status='abierta'`, userID).Scan(&id)
	if err != nil {
		return 0, conflict("Para cobrar en efectivo debe abrir su caja del día")
	}
	return id, nil
}

func (s *Server) insertPayments(ctx context.Context, q db.Querier, c *Ctx, invoiceID, patientID int64, balance float64, pays []paymentReq) (float64, error) {
	var sum float64
	for _, p := range pays {
		if p.Amount <= 0 {
			continue
		}
		if _, ok := paymentMethods[p.Method]; !ok {
			return 0, badRequest("Método de pago inválido: " + p.Method)
		}
		if (p.Method == "tarjeta_credito" || p.Method == "tarjeta_debito" || p.Method == "transferencia") && strings.TrimSpace(p.Reference) == "" {
			return 0, badRequest("Registre el número de autorización/referencia para pagos con " + paymentMethods[p.Method])
		}
		var session any
		if p.Method == "efectivo" {
			id, err := s.openSessionID(ctx, q, c.User.UserID)
			if err != nil {
				return 0, err
			}
			session = id
		}
		if p.Method == "seguro" {
			var cov float64
			if err := q.QueryRow(ctx, `SELECT COALESCE(i.coverage_pct,0)::float8 FROM patients p LEFT JOIN insurances i ON i.id=p.insurance_id WHERE p.id=$1`, patientID).Scan(&cov); err != nil {
				return 0, err
			}
			if cov <= 0 {
				return 0, badRequest("El paciente no tiene un seguro con cobertura registrada")
			}
		}
		sum += p.Amount
		if _, err := q.Exec(ctx, `INSERT INTO payments (invoice_id, method, amount, reference, cash_session_id, received_by) VALUES ($1,$2,$3,$4,$5,$6)`,
			invoiceID, p.Method, domain.Round2(p.Amount), emptyToNil(p.Reference), session, c.User.UserID); err != nil {
			return 0, err
		}
	}
	if domain.Round2(sum) > domain.Round2(balance)+0.001 {
		return 0, badRequest(fmt.Sprintf("Los pagos (%.2f) superan el saldo de la factura (%.2f)", sum, balance))
	}
	return domain.Round2(sum), nil
}

func (s *Server) createInvoice(c *Ctx) error {
	var r invoiceReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.PatientID == 0 || len(r.Items) == 0 {
		return badRequest("Seleccione el paciente y al menos un concepto")
	}
	var invID int64
	err := s.inTx(c.Context(), func(q db.Querier) error {
		p, err := db.Row(c.Context(), q, `SELECT * FROM patients WHERE id=$1`, r.PatientID)
		if err != nil {
			return err
		}
		name, doc := strings.TrimSpace(r.CustomerName), strings.TrimSpace(r.CustomerDocument)
		if name == "" {
			name = str(p["first_name"]) + " " + str(p["last_name"])
		}
		if doc == "" {
			doc = str(p["document_number"])
		}
		type line struct {
			planItem, procedure, dentist any
			desc                         string
			qty, price, disc, total      float64
		}
		var lines []line
		var subtotal, discount float64
		for _, it := range r.Items {
			l := line{qty: it.Quantity, price: it.UnitPrice, disc: it.Discount, desc: strings.TrimSpace(it.Description)}
			if l.qty <= 0 {
				l.qty = 1
			}
			if it.PlanItemID != nil {
				pi, err := db.Row(c.Context(), q, `
					SELECT i.*, t.discount_pct AS plan_discount, pr.name FROM plan_items i JOIN treatment_plans t ON t.id = i.plan_id
					  JOIN procedures pr ON pr.id = i.procedure_id
					 WHERE i.id=$1 AND t.patient_id=$2 FOR UPDATE OF i`, *it.PlanItemID, r.PatientID)
				if err != nil {
					return badRequest("Ítem de plan inválido")
				}
				if pi["status"] != "realizado" || pi["invoiced"] == true {
					return conflict("Solo se facturan procedimientos realizados y no facturados")
				}
				net := domain.Round2(domain.ItemNet(num(pi["price"]), num(pi["discount_pct"])) * (1 - num(pi["plan_discount"])/100))
				l.planItem, l.procedure, l.dentist = pi["id"], pi["procedure_id"], pi["performed_by"]
				l.qty, l.price, l.disc = 1, num(pi["price"]), domain.Round2(num(pi["price"])-net)
				if l.desc == "" {
					l.desc = str(pi["name"])
					if pi["tooth"] != nil {
						l.desc += fmt.Sprintf(" · pieza %v", pi["tooth"])
					}
				}
				if _, err := q.Exec(c.Context(), `UPDATE plan_items SET invoiced=TRUE WHERE id=$1`, pi["id"]); err != nil {
					return err
				}
			} else {
				if it.ProcedureID != nil {
					pr, err := db.Row(c.Context(), q, `SELECT * FROM procedures WHERE id=$1`, *it.ProcedureID)
					if err != nil {
						return badRequest("Procedimiento inválido")
					}
					l.procedure = pr["id"]
					if l.desc == "" {
						l.desc = str(pr["name"])
					}
				}
				if it.DentistID != nil {
					l.dentist = *it.DentistID
				}
			}
			if l.desc == "" {
				return badRequest("Cada concepto necesita una descripción")
			}
			if l.price < 0 || l.disc < 0 || l.disc > l.qty*l.price {
				return badRequest("Precio o descuento inválido en: " + l.desc)
			}
			l.total = domain.Round2(l.qty*l.price - l.disc)
			subtotal += l.qty * l.price
			discount += l.disc
			lines = append(lines, l)
		}
		subtotal, discount = domain.Round2(subtotal), domain.Round2(discount)
		tax := domain.Round2((subtotal - discount) * s.settings.Float("iva_pct", 0) / 100)
		total := domain.Round2(subtotal - discount + tax)

		var seq int64
		if err := q.QueryRow(c.Context(), `SELECT nextval('invoice_number_seq')`).Scan(&seq); err != nil {
			return err
		}
		now := time.Now().In(s.cfg.Location)
		key := domain.AccessKey(now, s.settings.Get("clinica_ruc"), "001", "001", seq, 1, security.RandomDigits(8))
		if err := q.QueryRow(c.Context(), `
			INSERT INTO invoices (number, patient_id, customer_name, customer_document, subtotal, discount, tax, total,
			                      electronic_status, authorization_number, access_key, issued_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'autorizada',$9,$9,$10) RETURNING id`,
			fmt.Sprintf("001-001-%09d", seq), r.PatientID, name, doc, subtotal, discount, tax, total, key, c.User.UserID).Scan(&invID); err != nil {
			return err
		}
		for _, l := range lines {
			if _, err := q.Exec(c.Context(), `
				INSERT INTO invoice_items (invoice_id, plan_item_id, procedure_id, dentist_id, description, quantity, unit_price, discount, total)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, invID, l.planItem, l.procedure, l.dentist, l.desc, l.qty, l.price, l.disc, l.total); err != nil {
				return err
			}
		}
		paid, err := s.insertPayments(c.Context(), q, c, invID, r.PatientID, total, r.Payments)
		if err != nil {
			return err
		}
		_, err = q.Exec(c.Context(), `UPDATE invoices SET paid=$2, status=$3 WHERE id=$1`, invID, paid, domain.InvoiceStatus(total, paid))
		return err
	})
	if err != nil {
		return err
	}
	inv, err := s.loadInvoice(c.Context(), invID)
	if err != nil {
		return err
	}
	c.Audit(invID, r.PatientID, map[string]any{"number": inv["number"], "total": inv["total"]})
	return c.Created(inv)
}

func (s *Server) addPayment(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var p paymentReq
	if err := c.Bind(&p); err != nil {
		return err
	}
	var patientID int64
	err = s.inTx(c.Context(), func(q db.Querier) error {
		inv, err := db.Row(c.Context(), q, `SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, id)
		if err != nil {
			return err
		}
		if inv["status"] == "anulada" || inv["status"] == "pagada" {
			return conflict("La factura no admite más pagos")
		}
		patientID = i64(inv["patient_id"])
		balance := num(inv["total"]) - num(inv["paid"])
		if p.Amount <= 0 {
			return badRequest("Monto inválido")
		}
		paid, err := s.insertPayments(c.Context(), q, c, id, patientID, balance, []paymentReq{p})
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
	c.Audit(id, patientID, map[string]any{"method": p.Method, "amount": p.Amount})
	inv, err := s.loadInvoice(c.Context(), id)
	if err != nil {
		return err
	}
	return c.OK(inv)
}

func (s *Server) voidInvoice(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Reason string `json:"reason"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if strings.TrimSpace(r.Reason) == "" {
		return badRequest("Indique el motivo de anulación")
	}
	var patientID int64
	err = s.inTx(c.Context(), func(q db.Querier) error {
		inv, err := db.Row(c.Context(), q, `SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, id)
		if err != nil {
			return err
		}
		if inv["status"] == "anulada" {
			return conflict("La factura ya está anulada")
		}
		patientID = i64(inv["patient_id"])
		if _, err := q.Exec(c.Context(), `UPDATE invoices SET status='anulada', void_reason=$2 WHERE id=$1`, id, strings.TrimSpace(r.Reason)); err != nil {
			return err
		}
		_, err = q.Exec(c.Context(), `UPDATE plan_items SET invoiced=FALSE WHERE id IN (SELECT plan_item_id FROM invoice_items WHERE invoice_id=$1 AND plan_item_id IS NOT NULL)`, id)
		return err
	})
	if err != nil {
		return err
	}
	c.action = "VOID"
	c.Audit(id, patientID, map[string]any{"reason": r.Reason})
	inv, err := s.loadInvoice(c.Context(), id)
	if err != nil {
		return err
	}
	return c.OK(inv)
}

// ------------------------------------------------ Caja ciega (RN-02)

func (s *Server) currentCash(c *Ctx) error {
	sess, err := db.Row(c.Context(), s.db, `
		SELECT id, opened_at, opening_amount, status,
		       (SELECT count(*) FROM payments p WHERE p.cash_session_id = cs.id) AS cash_transactions
		  FROM cash_sessions cs WHERE user_id=$1 AND status='abierta'`, c.User.UserID)
	if err == db.ErrNotFound {
		return c.OK(map[string]any{"open": false})
	}
	if err != nil {
		return err
	}
	// RN-02: el total teórico NO se expone hasta que el cajero declare su conteo.
	sess["open"] = true
	return c.OK(sess)
}

func (s *Server) openCash(c *Ctx) error {
	var r struct {
		OpeningAmount float64 `json:"opening_amount"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.OpeningAmount < 0 {
		return badRequest("El fondo inicial no puede ser negativo")
	}
	row, err := db.Row(c.Context(), s.db, `INSERT INTO cash_sessions (user_id, opening_amount) VALUES ($1,$2) RETURNING id, opened_at, opening_amount`,
		c.User.UserID, domain.Round2(r.OpeningAmount))
	if err != nil {
		return err
	}
	c.Audit(row["id"], 0, map[string]any{"opening_amount": r.OpeningAmount})
	return c.Created(row)
}

func (s *Server) closeCash(c *Ctx) error {
	var r struct {
		CountedCash *float64 `json:"counted_cash"`
		Notes       string   `json:"notes"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.CountedCash == nil || *r.CountedCash < 0 {
		return badRequest("Ingrese el conteo físico de efectivo")
	}
	var row map[string]any
	err := s.inTx(c.Context(), func(q db.Querier) error {
		id, err := s.openSessionID(c.Context(), q, c.User.UserID)
		if err != nil {
			return conflict("No tiene una caja abierta")
		}
		var expected float64
		if err := q.QueryRow(c.Context(), `
			SELECT (opening_amount + COALESCE((SELECT sum(amount) FROM payments WHERE cash_session_id=$1),0))::float8
			  FROM cash_sessions WHERE id=$1`, id).Scan(&expected); err != nil {
			return err
		}
		counted := domain.Round2(*r.CountedCash)
		row, err = db.Row(c.Context(), q, `
			UPDATE cash_sessions SET counted_cash=$2, expected_cash=$3, difference=$4, notes=$5, closed_at=now(), status='cerrada'
			 WHERE id=$1 RETURNING *`, id, counted, domain.Round2(expected), domain.CashDifference(counted, expected), emptyToNil(r.Notes))
		return err
	})
	if err != nil {
		return err
	}
	summary, err := db.Rows(c.Context(), s.db, `
		SELECT method, count(*) AS count, sum(amount) AS total FROM payments
		 WHERE received_by=$1 AND paid_at >= $2 GROUP BY method ORDER BY method`, c.User.UserID, row["opened_at"])
	if err != nil {
		return err
	}
	row["by_method"] = summary
	c.action = "CLOSE"
	c.Audit(row["id"], 0, map[string]any{"counted": row["counted_cash"], "expected": row["expected_cash"], "difference": row["difference"]})
	return c.OK(row)
}

func (s *Server) listCashSessions(c *Ctx) error {
	onlyOwn := c.Is(RoleRecepcion)
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT cs.*, u.full_name AS user_name,
		       (SELECT count(*) FROM payments p WHERE p.cash_session_id = cs.id) AS cash_transactions
		  FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
		 WHERE (NOT $1 OR (cs.user_id = $2 AND cs.status = 'cerrada'))
		 ORDER BY cs.opened_at DESC LIMIT 120`, onlyOwn, c.User.UserID)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

// ---------------------------------------- Honorarios profesionales (RF-13)

func (s *Server) listCommissionRules(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT r.*, u.full_name AS dentist_name, p.name AS procedure_name, p.code AS procedure_code
		  FROM commission_rules r JOIN users u ON u.id = r.dentist_id LEFT JOIN procedures p ON p.id = r.procedure_id
		 ORDER BY r.active DESC, u.full_name, r.procedure_id NULLS FIRST`)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) saveCommissionRule(c *Ctx) error {
	var r struct {
		DentistID   int64   `json:"dentist_id"`
		ProcedureID *int64  `json:"procedure_id"`
		RuleType    string  `json:"rule_type"`
		Value       float64 `json:"value"`
		Active      *bool   `json:"active"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.RuleType != domain.RulePercent && r.RuleType != domain.RuleFixed && r.RuleType != domain.RuleNetPercent {
		return badRequest("Tipo de regla inválido")
	}
	if r.Value < 0 || (r.RuleType != domain.RuleFixed && r.Value > 100) {
		return badRequest("Valor de comisión inválido")
	}
	active := r.Active == nil || *r.Active
	var row map[string]any
	var err error
	if c.R.PathValue("id") != "" {
		id, perr := c.PathID("id")
		if perr != nil {
			return perr
		}
		row, err = db.Row(c.Context(), s.db, `UPDATE commission_rules SET rule_type=$2, value=$3, active=$4, procedure_id=$5 WHERE id=$1 RETURNING *`,
			id, r.RuleType, r.Value, active, r.ProcedureID)
	} else {
		if err := s.checkDentist(c.Context(), s.db, r.DentistID); err != nil {
			return err
		}
		row, err = db.Row(c.Context(), s.db, `INSERT INTO commission_rules (dentist_id, procedure_id, rule_type, value) VALUES ($1,$2,$3,$4) RETURNING *`,
			r.DentistID, r.ProcedureID, r.RuleType, r.Value)
	}
	if err != nil {
		return err
	}
	c.Audit(row["id"], 0, map[string]any{"rule_type": r.RuleType, "value": r.Value})
	return c.OK(row)
}

type commissionLine struct {
	InvoiceNumber string  `json:"invoice_number"`
	IssuedAt      any     `json:"issued_at"`
	Description   string  `json:"description"`
	Quantity      float64 `json:"quantity"`
	Gross         float64 `json:"gross"`
	Costs         float64 `json:"costs"`
	RuleType      string  `json:"rule_type"`
	RuleValue     float64 `json:"rule_value"`
	Commission    float64 `json:"commission"`
}

type commissionSummary struct {
	DentistID   int64            `json:"dentist_id"`
	DentistName string           `json:"dentist_name"`
	Items       int              `json:"items"`
	Gross       float64          `json:"gross"`
	Costs       float64          `json:"costs"`
	Commission  float64          `json:"commission"`
	ClinicNet   float64          `json:"clinic_net"`
	Lines       []commissionLine `json:"lines"`
}

func (s *Server) computeCommissions(ctx context.Context, from, to string, dentistID int64) ([]*commissionSummary, error) {
	rules, err := db.Rows(ctx, s.db, `SELECT * FROM commission_rules WHERE active`)
	if err != nil {
		return nil, err
	}
	byDentist := map[int64][]domain.CommissionRule{}
	for _, r := range rules {
		var pid *int64
		if r["procedure_id"] != nil {
			v := i64(r["procedure_id"])
			pid = &v
		}
		d := i64(r["dentist_id"])
		byDentist[d] = append(byDentist[d], domain.CommissionRule{RuleType: str(r["rule_type"]), Value: num(r["value"]), ProcedureID: pid})
	}
	lines, err := db.Rows(ctx, s.db, `
		SELECT ii.*, i.number, i.issued_at, u.full_name AS dentist_name,
		       COALESCE(pi.lab_cost, pr.lab_cost * ii.quantity, 0) AS lab_cost,
		       COALESCE((SELECT sum(ps.quantity * su.unit_cost) FROM procedure_supplies ps JOIN supplies su ON su.id = ps.supply_id
		                  WHERE ps.procedure_id = ii.procedure_id), 0) * ii.quantity AS material_cost
		  FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN users u ON u.id = ii.dentist_id
		  LEFT JOIN plan_items pi ON pi.id = ii.plan_item_id LEFT JOIN procedures pr ON pr.id = ii.procedure_id
		 WHERE i.status <> 'anulada' AND i.issued_at >= $1::date AND i.issued_at < $2::date + 1
		   AND ($3 = 0 OR ii.dentist_id = $3)
		 ORDER BY u.full_name, i.issued_at`, from, to, dentistID)
	if err != nil {
		return nil, err
	}
	out := []*commissionSummary{}
	idx := map[int64]*commissionSummary{}
	for _, l := range lines {
		d := i64(l["dentist_id"])
		sum, ok := idx[d]
		if !ok {
			sum = &commissionSummary{DentistID: d, DentistName: str(l["dentist_name"]), Lines: []commissionLine{}}
			idx[d] = sum
			out = append(out, sum)
		}
		gross := num(l["total"])
		costs := domain.Round2(num(l["lab_cost"]) + num(l["material_cost"]))
		var procID int64
		if l["procedure_id"] != nil {
			procID = i64(l["procedure_id"])
		}
		rule, ok := domain.PickRule(byDentist[d], procID)
		var com float64
		if ok {
			com = domain.Commission(rule, gross, costs, num(l["quantity"]))
		}
		sum.Items++
		sum.Gross += gross
		sum.Costs += costs
		sum.Commission += com
		sum.Lines = append(sum.Lines, commissionLine{
			InvoiceNumber: str(l["number"]), IssuedAt: l["issued_at"], Description: str(l["description"]), Quantity: num(l["quantity"]),
			Gross: gross, Costs: costs, RuleType: rule.RuleType, RuleValue: rule.Value, Commission: com,
		})
	}
	for _, s := range out {
		s.Gross, s.Costs, s.Commission = domain.Round2(s.Gross), domain.Round2(s.Costs), domain.Round2(s.Commission)
		s.ClinicNet = domain.Round2(s.Gross - s.Costs - s.Commission)
	}
	return out, nil
}

func (s *Server) commissionReport(c *Ctx) error {
	from, to := c.Query("from"), c.Query("to")
	if from == "" || to == "" {
		now := time.Now()
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local).Format("2006-01-02")
		to = now.Format("2006-01-02")
	}
	dentist := c.QueryInt("dentist_id", 0)
	if c.Is(RoleOdontologo) {
		dentist = c.User.UserID
	}
	rep, err := s.computeCommissions(c.Context(), from, to, dentist)
	if err != nil {
		return err
	}
	return c.OK(map[string]any{"from": from, "to": to, "dentists": rep})
}

func (s *Server) createSettlement(c *Ctx) error {
	var r struct {
		DentistID int64  `json:"dentist_id"`
		From      string `json:"from"`
		To        string `json:"to"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.DentistID == 0 || r.From == "" || r.To == "" {
		return badRequest("Seleccione profesional y período")
	}
	var dup bool
	if err := s.db.QueryRow(c.Context(), `SELECT EXISTS (SELECT 1 FROM commission_settlements WHERE dentist_id=$1
		AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]'))`, r.DentistID, r.From, r.To).Scan(&dup); err != nil {
		return err
	}
	if dup {
		return conflict("Ya existe una liquidación que cubre parte de ese período para el profesional")
	}
	rep, err := s.computeCommissions(c.Context(), r.From, r.To, r.DentistID)
	if err != nil {
		return err
	}
	if len(rep) == 0 {
		return badRequest("El profesional no registra procedimientos facturados en el período")
	}
	details, _ := json.Marshal(rep[0])
	row, err := db.Row(c.Context(), s.db, `
		INSERT INTO commission_settlements (dentist_id, period_start, period_end, total_gross, total_commission, details, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, total_commission`,
		r.DentistID, r.From, r.To, rep[0].Gross, rep[0].Commission, string(details), c.User.UserID)
	if err != nil {
		return err
	}
	c.Audit(row["id"], 0, map[string]any{"dentist_id": r.DentistID, "total": rep[0].Commission})
	return c.Created(row)
}

func (s *Server) listSettlements(c *Ctx) error {
	dentist := int64(0)
	if c.Is(RoleOdontologo) {
		dentist = c.User.UserID
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT cs.id, cs.dentist_id, cs.period_start, cs.period_end, cs.total_gross, cs.total_commission, cs.created_at, cs.details,
		       u.full_name AS dentist_name, cb.full_name AS created_by_name
		  FROM commission_settlements cs JOIN users u ON u.id = cs.dentist_id LEFT JOIN users cb ON cb.id = cs.created_by
		 WHERE ($1 = 0 OR cs.dentist_id = $1) ORDER BY cs.created_at DESC`, dentist)
	if err != nil {
		return err
	}
	return c.OK(rows)
}
