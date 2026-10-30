// Package domain contiene las reglas de negocio puras (sin E/S) del sistema,
// de modo que puedan probarse de forma unitaria e independiente de la BD.
package domain

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Round2 redondea montos monetarios a 2 decimales (half away from zero).
func Round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// --------------------------------------------------------- Agenda (RF-10)

const (
	StatusProgramado = "programado"
	StatusConfirmado = "confirmado"
	StatusEnEspera   = "en_espera"
	StatusEnAtencion = "en_atencion"
	StatusAtendido   = "atendido"
	StatusCancelado  = "cancelado"
	StatusNoAsistio  = "no_asistio"
)

var appointmentTransitions = map[string][]string{
	StatusProgramado: {StatusConfirmado, StatusEnEspera, StatusCancelado, StatusNoAsistio},
	StatusConfirmado: {StatusProgramado, StatusEnEspera, StatusCancelado, StatusNoAsistio},
	StatusEnEspera:   {StatusEnAtencion, StatusCancelado, StatusNoAsistio},
	StatusEnAtencion: {StatusAtendido},
	StatusAtendido:   {},
	StatusCancelado:  {},
	StatusNoAsistio:  {},
}

// CanTransition indica si una cita puede pasar del estado from al estado to.
func CanTransition(from, to string) bool {
	for _, s := range appointmentTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// IsValidStatus valida que el estado exista en el flujo de citas.
func IsValidStatus(s string) bool {
	_, ok := appointmentTransitions[s]
	return ok
}

// Overlaps implementa RN-03 en memoria: intervalos semiabiertos [inicio, fin).
func Overlaps(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

// BlocksChair indica si una cita en ese estado ocupa el sillón.
func BlocksChair(status string) bool {
	return status != StatusCancelado && status != StatusNoAsistio
}

// ----------------------------------------------- Presupuestos (RF-07/08)

type BudgetItem struct {
	Price       float64
	LabCost     float64
	DiscountPct float64
	Status      string
}

type BudgetTotals struct {
	Subtotal      float64 `json:"subtotal"`
	ItemDiscounts float64 `json:"item_discounts"`
	PlanDiscount  float64 `json:"plan_discount"`
	Total         float64 `json:"total"`
	LabCost       float64 `json:"lab_cost"`
	Approved      float64 `json:"approved_total"`
}

// ItemNet devuelve el valor de un ítem aplicando su descuento individual.
func ItemNet(price, discountPct float64) float64 {
	return Round2(price * (1 - discountPct/100))
}

// ComputeBudget calcula los totales del plan. El descuento global se aplica
// sobre el neto de los ítems no rechazados; "Approved" suma solo los ítems
// autorizados por el paciente (aprobado, agendado o realizado).
func ComputeBudget(items []BudgetItem, planDiscountPct float64) BudgetTotals {
	var t BudgetTotals
	var approvedNet float64
	for _, it := range items {
		if it.Status == "rechazado" {
			continue
		}
		t.Subtotal += it.Price
		net := ItemNet(it.Price, it.DiscountPct)
		t.ItemDiscounts += it.Price - net
		t.LabCost += it.LabCost
		if it.Status == "aprobado" || it.Status == "agendado" || it.Status == "realizado" {
			approvedNet += net
		}
	}
	net := t.Subtotal - t.ItemDiscounts
	t.PlanDiscount = Round2(net * planDiscountPct / 100)
	t.Total = Round2(net - t.PlanDiscount)
	t.Approved = Round2(approvedNet * (1 - planDiscountPct/100))
	t.Subtotal = Round2(t.Subtotal)
	t.ItemDiscounts = Round2(t.ItemDiscounts)
	t.LabCost = Round2(t.LabCost)
	return t
}

// DiscountNeedsAuthorization aplica el tope de descuento sin autorización.
func DiscountNeedsAuthorization(discountPct, maxPct float64, role string) bool {
	return discountPct > maxPct && role != "admin"
}

// ----------------------------------------------------- Honorarios (RF-13)

const (
	RulePercent    = "porcentaje"
	RuleFixed      = "fijo"
	RuleNetPercent = "porcentaje_neto"
)

type CommissionRule struct {
	RuleType    string
	Value       float64
	ProcedureID *int64
}

// Commission calcula el honorario de un procedimiento facturado.
//   - porcentaje:      gross × value%
//   - fijo:            value × cantidad
//   - porcentaje_neto: (gross − costo de laboratorio/materiales) × value%
func Commission(rule CommissionRule, gross, costs, qty float64) float64 {
	switch rule.RuleType {
	case RulePercent:
		return Round2(gross * rule.Value / 100)
	case RuleFixed:
		if qty <= 0 {
			qty = 1
		}
		return Round2(rule.Value * qty)
	case RuleNetPercent:
		base := gross - costs
		if base < 0 {
			base = 0
		}
		return Round2(base * rule.Value / 100)
	}
	return 0
}

// PickRule elige la regla específica del procedimiento o, en su defecto, la general.
func PickRule(rules []CommissionRule, procedureID int64) (CommissionRule, bool) {
	var general *CommissionRule
	for i := range rules {
		r := rules[i]
		if r.ProcedureID != nil && *r.ProcedureID == procedureID {
			return r, true
		}
		if r.ProcedureID == nil && general == nil {
			general = &rules[i]
		}
	}
	if general != nil {
		return *general, true
	}
	return CommissionRule{}, false
}

// ---------------------------------------------- Periodontograma (RF-04)

type PerioTooth struct {
	PD        []float64 `json:"pd"`
	GM        []float64 `json:"gm"`
	Bleeding  []bool    `json:"bleeding"`
	Plaque    []bool    `json:"plaque"`
	Furcation int       `json:"furcation"`
	Mobility  int       `json:"mobility"`
	Missing   bool      `json:"missing"`
}

type PerioSummary struct {
	Teeth        int     `json:"teeth"`
	Sites        int     `json:"sites"`
	MeanPD       float64 `json:"mean_pd"`
	MeanCAL      float64 `json:"mean_cal"`
	BleedingPct  float64 `json:"bleeding_pct"`
	PlaquePct    float64 `json:"plaque_pct"`
	SitesPD4Plus int     `json:"sites_pd_4_plus"`
	SitesPD6Plus int     `json:"sites_pd_6_plus"`
	Diagnosis    string  `json:"diagnosis"`
}

// CAL calcula el nivel de inserción clínica = profundidad de sondaje +
// margen gingival (margen positivo = recesión, negativo = agrandamiento).
func CAL(pd, gm float64) float64 {
	return pd + gm
}

// SummarizePerio resume un periodontograma de 6 sitios por diente.
func SummarizePerio(teeth map[string]PerioTooth) PerioSummary {
	var s PerioSummary
	var sumPD, sumCAL float64
	var bleed, plaque int
	maxCAL := 0.0
	for _, t := range teeth {
		if t.Missing {
			continue
		}
		s.Teeth++
		for i := 0; i < 6; i++ {
			pd := at(t.PD, i)
			gm := at(t.GM, i)
			s.Sites++
			sumPD += pd
			cal := CAL(pd, gm)
			sumCAL += cal
			if cal > maxCAL {
				maxCAL = cal
			}
			if pd >= 4 {
				s.SitesPD4Plus++
			}
			if pd >= 6 {
				s.SitesPD6Plus++
			}
			if i < len(t.Bleeding) && t.Bleeding[i] {
				bleed++
			}
			if i < len(t.Plaque) && t.Plaque[i] {
				plaque++
			}
		}
	}
	if s.Sites == 0 {
		s.Diagnosis = "Sin datos"
		return s
	}
	n := float64(s.Sites)
	s.MeanPD = Round2(sumPD / n)
	s.MeanCAL = Round2(sumCAL / n)
	s.BleedingPct = Round2(float64(bleed) * 100 / n)
	s.PlaquePct = Round2(float64(plaque) * 100 / n)
	switch {
	case maxCAL >= 5:
		s.Diagnosis = "Periodontitis estadio III/IV (NIC ≥ 5 mm)"
	case maxCAL >= 3:
		s.Diagnosis = "Periodontitis estadio II (NIC 3–4 mm)"
	case maxCAL >= 1:
		s.Diagnosis = "Periodontitis estadio I (NIC 1–2 mm)"
	case s.BleedingPct >= 10:
		s.Diagnosis = "Gingivitis (sangrado ≥ 10%)"
	default:
		s.Diagnosis = "Salud periodontal"
	}
	return s
}

func at(v []float64, i int) float64 {
	if i < len(v) {
		return v[i]
	}
	return 0
}

// ------------------------------------------------- Notas SOEP (RF-05)

// NoteEditable indica si una nota aún admite edición de contenido.
func NoteEditable(createdAt time.Time, signed bool, lockHours int, now time.Time) bool {
	if signed {
		return false
	}
	return now.Before(createdAt.Add(time.Duration(lockHours) * time.Hour))
}

// ------------------------------------------- Anamnesis y alertas (RF-02)

// CriticalAlerts traduce los indicadores de la anamnesis a alertas visibles.
func CriticalAlerts(h map[string]any) []string {
	flags := []struct{ key, label string }{
		{"penicillin_allergy", "Alergia a penicilina"},
		{"latex_allergy", "Alergia al látex"},
		{"anesthesia_allergy", "Alergia a anestésicos"},
		{"anticoagulated", "Paciente anticoagulado"},
		{"coagulopathy", "Coagulopatía"},
		{"heart_disease", "Cardiopatía"},
		{"diabetes", "Diabetes"},
		{"pregnant", "Embarazo"},
		{"hypertension", "Hipertensión"},
	}
	var out []string
	for _, f := range flags {
		if b, ok := h[f.key].(bool); ok && b {
			out = append(out, f.label)
		}
	}
	onlyPenicillin, _ := h["penicillin_allergy"].(bool)
	if a, ok := h["allergies"].(string); ok && strings.TrimSpace(a) != "" && !onlyPenicillin {
		out = append(out, "Alergias: "+strings.TrimSpace(a))
	}
	return out
}

// AllergyConflict detecta si un medicamento coincide con alergias registradas.
func AllergyConflict(drug string, penicillinAllergy bool, allergies string) bool {
	d := strings.ToLower(drug)
	if penicillinAllergy {
		for _, k := range []string{"penicil", "amoxicil", "ampicil", "dicloxacil", "oxacil"} {
			if strings.Contains(d, k) {
				return true
			}
		}
	}
	for _, a := range strings.FieldsFunc(strings.ToLower(allergies), func(r rune) bool {
		return r == ',' || r == ';' || r == '(' || r == ')' || r == ' ' || r == '/'
	}) {
		if len(a) >= 5 && strings.Contains(d, a) {
			return true
		}
	}
	return false
}

// -------------------------------------------------- Caja ciega (RN-02)

// CashDifference devuelve sobrante (+) o faltante (−) del cierre.
func CashDifference(counted, expected float64) float64 {
	return Round2(counted - expected)
}

// ----------------------------------------- Facturación electrónica (RF-12)

// AccessKey genera una clave de acceso de 49 dígitos con dígito verificador
// módulo 11 (formato utilizado por autoridades tributarias de la región).
func AccessKey(issued time.Time, taxID string, establishment, point string, seq int64, environment int, numericCode string) string {
	base := fmt.Sprintf("%s01%s%d%s%s%09d%s1", issued.Format("02012006"), padLeft(taxID, 13), environment,
		padLeft(establishment, 3), padLeft(point, 3), seq, padLeft(numericCode, 8))
	return base + fmt.Sprint(Mod11(base))
}

// Mod11 calcula el dígito verificador con pesos 2..7.
func Mod11(digits string) int {
	sum, w := 0, 2
	for i := len(digits) - 1; i >= 0; i-- {
		sum += int(digits[i]-'0') * w
		w++
		if w > 7 {
			w = 2
		}
	}
	d := 11 - sum%11
	switch d {
	case 11:
		return 0
	case 10:
		return 1
	}
	return d
}

func padLeft(s string, n int) string {
	if len(s) >= n {
		return s[len(s)-n:]
	}
	return strings.Repeat("0", n-len(s)) + s
}

// InvoiceStatus deriva el estado a partir de lo pagado.
func InvoiceStatus(total, paid float64) string {
	switch {
	case paid <= 0:
		return "emitida"
	case paid+0.005 >= total:
		return "pagada"
	default:
		return "parcial"
	}
}
