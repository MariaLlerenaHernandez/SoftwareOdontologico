package api

import (
	"strings"

	"sigo-dental/internal/db"
	"sigo-dental/internal/domain"
)

// ----------------------------------------------- Inventario (RF-14)

func (s *Server) listSupplies(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT s.*, o.name AS office_name, (s.stock <= s.min_stock) AS low_stock, (s.stock * s.unit_cost) AS stock_value,
		       (SELECT COALESCE(-sum(m.quantity),0) FROM stock_movements m WHERE m.supply_id = s.id AND m.movement_type = 'consumo'
		           AND m.created_at >= now() - interval '30 days') AS consumed_30d
		  FROM supplies s LEFT JOIN offices o ON o.id = s.office_id
		 WHERE ($1 OR s.active) ORDER BY s.category, s.name`, c.Query("all") == "true")
	if err != nil {
		return err
	}
	return c.OK(rows)
}

type supplyReq struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Unit     string  `json:"unit"`
	MinStock float64 `json:"min_stock"`
	UnitCost float64 `json:"unit_cost"`
	OfficeID *int64  `json:"office_id"`
	Active   *bool   `json:"active"`
	Stock    float64 `json:"stock"`
}

func (r *supplyReq) validate() error {
	if strings.TrimSpace(r.Code) == "" || strings.TrimSpace(r.Name) == "" || strings.TrimSpace(r.Unit) == "" || strings.TrimSpace(r.Category) == "" {
		return badRequest("Código, nombre, categoría y unidad son obligatorios")
	}
	if r.MinStock < 0 || r.UnitCost < 0 || r.Stock < 0 {
		return badRequest("Las cantidades y costos no pueden ser negativos")
	}
	return nil
}

func (s *Server) createSupply(c *Ctx) error {
	var r supplyReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if err := r.validate(); err != nil {
		return err
	}
	var row map[string]any
	err := s.inTx(c.Context(), func(q db.Querier) error {
		var err error
		row, err = db.Row(c.Context(), q, `
			INSERT INTO supplies (code, name, category, unit, stock, min_stock, unit_cost, office_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
			strings.ToUpper(strings.TrimSpace(r.Code)), strings.TrimSpace(r.Name), strings.TrimSpace(r.Category), strings.TrimSpace(r.Unit),
			r.Stock, r.MinStock, r.UnitCost, r.OfficeID)
		if err != nil {
			return err
		}
		if r.Stock > 0 {
			_, err = q.Exec(c.Context(), `INSERT INTO stock_movements (supply_id, movement_type, quantity, stock_after, reason, office_id, user_id)
				VALUES ($1,'entrada',$2,$2,'Stock inicial',$3,$4)`, row["id"], r.Stock, r.OfficeID, c.User.UserID)
		}
		return err
	})
	if err != nil {
		return err
	}
	c.Audit(row["id"], 0, nil)
	return c.Created(row)
}

func (s *Server) updateSupply(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r supplyReq
	if err := c.Bind(&r); err != nil {
		return err
	}
	if err := r.validate(); err != nil {
		return err
	}
	active := r.Active == nil || *r.Active
	row, err := db.Row(c.Context(), s.db, `
		UPDATE supplies SET code=$2, name=$3, category=$4, unit=$5, min_stock=$6, unit_cost=$7, office_id=$8, active=$9
		 WHERE id=$1 RETURNING *`, id, strings.ToUpper(strings.TrimSpace(r.Code)), strings.TrimSpace(r.Name), strings.TrimSpace(r.Category),
		strings.TrimSpace(r.Unit), r.MinStock, r.UnitCost, r.OfficeID, active)
	if err != nil {
		return err
	}
	return c.OK(row)
}

func (s *Server) createMovement(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var r struct {
		Type     string  `json:"movement_type"`
		Quantity float64 `json:"quantity"`
		Reason   string  `json:"reason"`
		OfficeID *int64  `json:"office_id"`
	}
	if err := c.Bind(&r); err != nil {
		return err
	}
	if strings.TrimSpace(r.Reason) == "" {
		return badRequest("Indique el motivo del movimiento")
	}
	var row map[string]any
	err = s.inTx(c.Context(), func(q db.Querier) error {
		sup, err := db.Row(c.Context(), q, `SELECT * FROM supplies WHERE id=$1 FOR UPDATE`, id)
		if err != nil {
			return err
		}
		stock := num(sup["stock"])
		var delta float64
		switch r.Type {
		case "entrada":
			if r.Quantity <= 0 {
				return badRequest("La cantidad debe ser mayor a cero")
			}
			delta = r.Quantity
		case "salida":
			if r.Quantity <= 0 {
				return badRequest("La cantidad debe ser mayor a cero")
			}
			if r.Quantity > stock {
				return badRequest("La salida supera el stock disponible")
			}
			delta = -r.Quantity
		case "ajuste":
			if r.Quantity < 0 {
				return badRequest("El stock ajustado no puede ser negativo")
			}
			delta = r.Quantity - stock // en ajustes se envía el conteo físico
		default:
			return badRequest("Tipo de movimiento inválido")
		}
		after := domain.Round2(stock + delta)
		if _, err := q.Exec(c.Context(), `UPDATE supplies SET stock=$2 WHERE id=$1`, id, after); err != nil {
			return err
		}
		officeID := r.OfficeID
		if officeID == nil && sup["office_id"] != nil {
			v := i64(sup["office_id"])
			officeID = &v
		}
		row, err = db.Row(c.Context(), q, `
			INSERT INTO stock_movements (supply_id, movement_type, quantity, stock_after, reason, office_id, user_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, id, r.Type, domain.Round2(delta), after, strings.TrimSpace(r.Reason), officeID, c.User.UserID)
		return err
	})
	if err != nil {
		return err
	}
	c.Audit(row["id"], 0, map[string]any{"supply_id": id, "type": r.Type, "quantity": row["quantity"]})
	return c.Created(row)
}

func (s *Server) listMovements(c *Ctx) error {
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT m.*, s.name AS supply_name, s.unit, s.code, u.full_name AS user_name, d.full_name AS dentist_name, o.name AS office_name,
		       pr.name AS procedure_name, pa.first_name || ' ' || pa.last_name AS patient_name
		  FROM stock_movements m JOIN supplies s ON s.id = m.supply_id
		  LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users d ON d.id = m.dentist_id LEFT JOIN offices o ON o.id = m.office_id
		  LEFT JOIN plan_items pi ON pi.id = m.plan_item_id LEFT JOIN procedures pr ON pr.id = pi.procedure_id
		  LEFT JOIN treatment_plans tp ON tp.id = pi.plan_id LEFT JOIN patients pa ON pa.id = tp.patient_id
		 WHERE ($1 = 0 OR m.supply_id = $1) AND ($2 = '' OR m.movement_type = $2)
		 ORDER BY m.id DESC LIMIT 300`, c.QueryInt("supply_id", 0), c.Query("type"))
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) getRecipe(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	rows, err := db.Rows(c.Context(), s.db, `
		SELECT ps.supply_id, ps.quantity, s.code, s.name, s.unit, s.unit_cost, (ps.quantity * s.unit_cost) AS cost
		  FROM procedure_supplies ps JOIN supplies s ON s.id = ps.supply_id WHERE ps.procedure_id = $1 ORDER BY s.name`, id)
	if err != nil {
		return err
	}
	return c.OK(rows)
}

func (s *Server) saveRecipe(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	var items []struct {
		SupplyID int64   `json:"supply_id"`
		Quantity float64 `json:"quantity"`
	}
	if err := c.Bind(&items); err != nil {
		return err
	}
	err = s.inTx(c.Context(), func(q db.Querier) error {
		if _, err := q.Exec(c.Context(), `DELETE FROM procedure_supplies WHERE procedure_id=$1`, id); err != nil {
			return err
		}
		for _, it := range items {
			if it.Quantity <= 0 {
				continue
			}
			if _, err := q.Exec(c.Context(), `INSERT INTO procedure_supplies (procedure_id, supply_id, quantity) VALUES ($1,$2,$3)
				ON CONFLICT (procedure_id, supply_id) DO UPDATE SET quantity = EXCLUDED.quantity`, id, it.SupplyID, it.Quantity); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.Audit(id, 0, map[string]any{"items": len(items)})
	return s.getRecipe(c)
}
