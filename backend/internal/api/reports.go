package api

import (
	"time"

	"sigo-dental/internal/db"
)

// ------------------------------------------------- Reportes / BI

func (c *Ctx) rangeOrMonth() (string, string) {
	from, to := c.Query("from"), c.Query("to")
	now := time.Now()
	if from == "" {
		from = now.AddDate(0, 0, -29).Format("2006-01-02")
	}
	if to == "" {
		to = now.Format("2006-01-02")
	}
	return from, to
}

func (s *Server) dashboard(c *Ctx) error {
	ctx := c.Context()
	out := map[string]any{}
	today, err := db.Rows(ctx, s.db, `SELECT status, count(*) AS count FROM appointments WHERE starts_at >= current_date AND starts_at < current_date + 1 GROUP BY status`)
	if err != nil {
		return err
	}
	out["today_by_status"] = today
	kpi, err := db.Row(ctx, s.db, `
		SELECT (SELECT count(*) FROM patients WHERE active) AS patients,
		       (SELECT count(*) FROM patients WHERE created_at >= date_trunc('month', now())) AS new_patients_month,
		       (SELECT count(*) FROM appointments WHERE starts_at >= current_date AND starts_at < current_date + 1 AND status <> 'cancelado') AS appointments_today,
		       (SELECT count(*) FROM appointments WHERE starts_at >= current_date + 1 AND starts_at < current_date + 8 AND status IN ('programado','confirmado')) AS appointments_week,
		       (SELECT round(100.0 * count(*) FILTER (WHERE status='no_asistio') / NULLIF(count(*) FILTER (WHERE status IN ('atendido','no_asistio')),0), 1)
		          FROM appointments WHERE starts_at >= now() - interval '30 days' AND starts_at < now()) AS no_show_rate,
		       (SELECT count(*) FROM supplies WHERE active AND stock <= min_stock) AS low_stock,
		       (SELECT count(*) FROM consents WHERE status='pendiente') AS pending_consents,
		       (SELECT count(*) FROM clinical_notes WHERE signed_at IS NULL AND ($1 = 0 OR author_id = $1)) AS unsigned_notes,
		       (SELECT count(*) FROM plan_items WHERE status='aprobado') AS approved_unscheduled`,
		map[bool]int64{true: c.User.UserID, false: 0}[c.Is(RoleOdontologo)])
	if err != nil {
		return err
	}
	out["kpi"] = kpi
	if c.Is(RoleAdmin, RoleRecepcion, RoleAuditor) {
		fin, err := db.Row(ctx, s.db, `
			SELECT COALESCE(sum(total) FILTER (WHERE issued_at >= current_date), 0) AS revenue_today,
			       COALESCE(sum(total) FILTER (WHERE issued_at >= date_trunc('month', now())), 0) AS revenue_month,
			       COALESCE(sum(total) FILTER (WHERE issued_at >= date_trunc('month', now()) - interval '1 month'
			                                       AND issued_at < date_trunc('month', now())), 0) AS revenue_prev_month,
			       COALESCE(sum(total - paid) FILTER (WHERE status IN ('emitida','parcial')), 0) AS receivables
			  FROM invoices WHERE status <> 'anulada'`)
		if err != nil {
			return err
		}
		out["finance"] = fin
		series, err := db.Rows(ctx, s.db, `
			SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(sum(i.total), 0) AS revenue, count(i.id) AS invoices
			  FROM generate_series(current_date - 13, current_date, interval '1 day') d
			  LEFT JOIN invoices i ON i.issued_at >= d AND i.issued_at < d + interval '1 day' AND i.status <> 'anulada'
			 GROUP BY d ORDER BY d`)
		if err != nil {
			return err
		}
		out["revenue_series"] = series
	}
	upcoming, err := db.Rows(ctx, s.db, apptSelect+`
		 WHERE a.starts_at >= current_date AND a.starts_at < current_date + 1 AND a.status NOT IN ('cancelado')
		   AND ($1 = 0 OR a.dentist_id = $1)
		 ORDER BY a.starts_at LIMIT 12`, map[bool]int64{true: c.User.UserID, false: 0}[c.Is(RoleOdontologo)])
	if err != nil {
		return err
	}
	out["today"] = upcoming
	return c.OK(out)
}

func (s *Server) revenueReport(c *Ctx) error {
	from, to := c.rangeOrMonth()
	ctx := c.Context()
	out := map[string]any{"from": from, "to": to}
	q := func(key, sql string) error {
		rows, err := db.Rows(ctx, s.db, sql, from, to)
		out[key] = rows
		return err
	}
	if err := q("by_day", `
		SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(sum(i.total),0) AS revenue, count(i.id) AS invoices
		  FROM generate_series($1::date, $2::date, interval '1 day') d
		  LEFT JOIN invoices i ON i.issued_at >= d AND i.issued_at < d + interval '1 day' AND i.status <> 'anulada'
		 GROUP BY d ORDER BY d`); err != nil {
		return err
	}
	if err := q("by_method", `
		SELECT p.method, count(*) AS count, sum(p.amount) AS total FROM payments p JOIN invoices i ON i.id = p.invoice_id
		 WHERE i.status <> 'anulada' AND p.paid_at >= $1::date AND p.paid_at < $2::date + 1 GROUP BY p.method ORDER BY total DESC`); err != nil {
		return err
	}
	if err := q("by_procedure", `
		SELECT COALESCE(pr.name, ii.description) AS name, pr.category, sum(ii.quantity) AS quantity, sum(ii.total) AS total
		  FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN procedures pr ON pr.id = ii.procedure_id
		 WHERE i.status <> 'anulada' AND i.issued_at >= $1::date AND i.issued_at < $2::date + 1
		 GROUP BY 1, 2 ORDER BY total DESC LIMIT 12`); err != nil {
		return err
	}
	if err := q("by_dentist", `
		SELECT u.full_name AS name, u.color, count(*) AS items, sum(ii.total) AS total
		  FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN users u ON u.id = ii.dentist_id
		 WHERE i.status <> 'anulada' AND i.issued_at >= $1::date AND i.issued_at < $2::date + 1
		 GROUP BY u.full_name, u.color ORDER BY total DESC`); err != nil {
		return err
	}
	tot, err := db.Row(ctx, s.db, `
		SELECT COALESCE(sum(total),0) AS revenue, count(*) AS invoices, COALESCE(avg(total),0) AS avg_ticket,
		       COALESCE(sum(discount),0) AS discounts, COALESCE(sum(tax),0) AS tax,
		       (SELECT count(*) FROM invoices WHERE status='anulada' AND issued_at >= $1::date AND issued_at < $2::date + 1) AS voided
		  FROM invoices WHERE status <> 'anulada' AND issued_at >= $1::date AND issued_at < $2::date + 1`, from, to)
	if err != nil {
		return err
	}
	out["totals"] = tot
	return c.OK(out)
}

func (s *Server) appointmentsReport(c *Ctx) error {
	from, to := c.rangeOrMonth()
	ctx := c.Context()
	out := map[string]any{"from": from, "to": to}
	byStatus, err := db.Rows(ctx, s.db, `SELECT status, count(*) AS count FROM appointments
		WHERE starts_at >= $1::date AND starts_at < $2::date + 1 GROUP BY status ORDER BY count DESC`, from, to)
	if err != nil {
		return err
	}
	out["by_status"] = byStatus
	byDentist, err := db.Rows(ctx, s.db, `
		SELECT u.full_name AS name, u.color, count(*) AS total,
		       count(*) FILTER (WHERE a.status='atendido') AS attended, count(*) FILTER (WHERE a.status='no_asistio') AS no_show,
		       count(*) FILTER (WHERE a.status='cancelado') AS cancelled
		  FROM appointments a JOIN users u ON u.id = a.dentist_id
		 WHERE a.starts_at >= $1::date AND a.starts_at < $2::date + 1 GROUP BY u.full_name, u.color ORDER BY total DESC`, from, to)
	if err != nil {
		return err
	}
	out["by_dentist"] = byDentist
	// Ocupación: horas agendadas / horas disponibles (11 h por día hábil, lunes a sábado)
	occ, err := db.Rows(ctx, s.db, `
		WITH days AS (SELECT count(*) AS n FROM generate_series($1::date, $2::date, interval '1 day') d WHERE extract(dow FROM d) <> 0)
		SELECT ch.name || ' · ' || o.name AS chair,
		       round(COALESCE(sum(extract(epoch FROM (a.ends_at - a.starts_at)) / 3600) FILTER (WHERE a.status NOT IN ('cancelado','no_asistio')), 0)::numeric, 1) AS hours,
		       round(100 * COALESCE(sum(extract(epoch FROM (a.ends_at - a.starts_at)) / 3600) FILTER (WHERE a.status NOT IN ('cancelado','no_asistio')), 0)::numeric
		             / NULLIF((SELECT n FROM days) * 11, 0), 1) AS occupancy_pct
		  FROM chairs ch JOIN offices o ON o.id = ch.office_id
		  LEFT JOIN appointments a ON a.chair_id = ch.id AND a.starts_at >= $1::date AND a.starts_at < $2::date + 1
		 WHERE ch.active GROUP BY ch.id, ch.name, o.name ORDER BY ch.id`, from, to)
	if err != nil {
		return err
	}
	out["occupancy"] = occ
	byHour, err := db.Rows(ctx, s.db, `
		SELECT extract(hour FROM starts_at)::int AS hour, count(*) AS count FROM appointments
		 WHERE starts_at >= $1::date AND starts_at < $2::date + 1 AND status <> 'cancelado' GROUP BY 1 ORDER BY 1`, from, to)
	if err != nil {
		return err
	}
	out["by_hour"] = byHour
	return c.OK(out)
}

func (s *Server) inventoryReport(c *Ctx) error {
	from, to := c.rangeOrMonth()
	ctx := c.Context()
	out := map[string]any{"from": from, "to": to}
	cons, err := db.Rows(ctx, s.db, `
		SELECT s.name, s.unit, -sum(m.quantity) AS quantity, -sum(m.quantity * s.unit_cost) AS value
		  FROM stock_movements m JOIN supplies s ON s.id = m.supply_id
		 WHERE m.movement_type IN ('consumo','salida') AND m.created_at >= $1::date AND m.created_at < $2::date + 1
		 GROUP BY s.name, s.unit ORDER BY value DESC LIMIT 15`, from, to)
	if err != nil {
		return err
	}
	out["consumption"] = cons
	byDentist, err := db.Rows(ctx, s.db, `
		SELECT COALESCE(d.full_name, 'Sin profesional') AS dentist, COALESCE(o.name, 'Sin sede') AS office,
		       -sum(m.quantity * s.unit_cost) AS value, count(*) AS movements
		  FROM stock_movements m JOIN supplies s ON s.id = m.supply_id
		  LEFT JOIN users d ON d.id = m.dentist_id LEFT JOIN offices o ON o.id = m.office_id
		 WHERE m.movement_type = 'consumo' AND m.created_at >= $1::date AND m.created_at < $2::date + 1
		 GROUP BY 1, 2 ORDER BY value DESC`, from, to)
	if err != nil {
		return err
	}
	out["by_dentist_office"] = byDentist
	low, err := db.Rows(ctx, s.db, `SELECT id, code, name, unit, stock, min_stock FROM supplies WHERE active AND stock <= min_stock ORDER BY stock / NULLIF(min_stock,0)`)
	if err != nil {
		return err
	}
	out["low_stock"] = low
	val, err := db.Row(ctx, s.db, `SELECT COALESCE(sum(stock * unit_cost),0) AS stock_value, count(*) AS items FROM supplies WHERE active`)
	if err != nil {
		return err
	}
	out["totals"] = val
	return c.OK(out)
}
