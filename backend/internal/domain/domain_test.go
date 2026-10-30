package domain

import (
	"testing"
	"time"
)

func TestCanTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{StatusProgramado, StatusConfirmado, true},
		{StatusConfirmado, StatusEnEspera, true},
		{StatusEnEspera, StatusEnAtencion, true},
		{StatusEnAtencion, StatusAtendido, true},
		{StatusProgramado, StatusAtendido, false},
		{StatusAtendido, StatusCancelado, false},
		{StatusCancelado, StatusProgramado, false},
		{StatusNoAsistio, StatusConfirmado, false},
	}
	for _, c := range cases {
		if got := CanTransition(c.from, c.to); got != c.want {
			t.Errorf("CanTransition(%s→%s) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestOverlapsRN03(t *testing.T) {
	base := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	h := func(m int) time.Time { return base.Add(time.Duration(m) * time.Minute) }
	if !Overlaps(h(0), h(60), h(30), h(90)) {
		t.Error("intervalos solapados deben detectarse")
	}
	if Overlaps(h(0), h(60), h(60), h(120)) {
		t.Error("citas contiguas no se solapan (intervalo semiabierto)")
	}
	if !Overlaps(h(0), h(120), h(30), h(45)) {
		t.Error("una cita contenida dentro de otra debe detectarse")
	}
	if BlocksChair(StatusCancelado) || BlocksChair(StatusNoAsistio) || !BlocksChair(StatusConfirmado) {
		t.Error("solo las citas activas bloquean el sillón")
	}
}

func TestComputeBudget(t *testing.T) {
	items := []BudgetItem{
		{Price: 100, DiscountPct: 10, Status: "aprobado"},
		{Price: 200, LabCost: 50, Status: "propuesto"},
		{Price: 500, Status: "rechazado"},
	}
	got := ComputeBudget(items, 5)
	if got.Subtotal != 300 || got.ItemDiscounts != 10 || got.LabCost != 50 {
		t.Fatalf("subtotal/descuentos/lab incorrectos: %+v", got)
	}
	if got.PlanDiscount != 14.5 || got.Total != 275.5 {
		t.Fatalf("total incorrecto: %+v", got)
	}
	if got.Approved != 85.5 {
		t.Fatalf("aprobado incorrecto: %+v", got)
	}
}

func TestDiscountAuthorization(t *testing.T) {
	if !DiscountNeedsAuthorization(20, 15, "recepcion") {
		t.Error("descuento sobre el tope requiere autorización")
	}
	if DiscountNeedsAuthorization(20, 15, "admin") {
		t.Error("el administrador autoriza descuentos")
	}
	if DiscountNeedsAuthorization(10, 15, "odontologo") {
		t.Error("descuento dentro del tope no requiere autorización")
	}
}

func TestCommission(t *testing.T) {
	if v := Commission(CommissionRule{RuleType: RulePercent, Value: 40}, 250, 0, 1); v != 100 {
		t.Errorf("porcentaje: %v", v)
	}
	if v := Commission(CommissionRule{RuleType: RuleFixed, Value: 15}, 45, 0, 2); v != 30 {
		t.Errorf("fijo: %v", v)
	}
	if v := Commission(CommissionRule{RuleType: RuleNetPercent, Value: 50}, 480, 180, 1); v != 150 {
		t.Errorf("porcentaje neto: %v", v)
	}
	if v := Commission(CommissionRule{RuleType: RuleNetPercent, Value: 50}, 100, 180, 1); v != 0 {
		t.Errorf("la base neta no puede ser negativa: %v", v)
	}
}

func TestPickRule(t *testing.T) {
	pid := int64(20)
	rules := []CommissionRule{{RuleType: RulePercent, Value: 35}, {RuleType: RuleFixed, Value: 15, ProcedureID: &pid}}
	if r, _ := PickRule(rules, 20); r.RuleType != RuleFixed {
		t.Error("debe preferirse la regla específica del procedimiento")
	}
	if r, _ := PickRule(rules, 7); r.RuleType != RulePercent {
		t.Error("debe usarse la regla general")
	}
	if _, ok := PickRule(nil, 1); ok {
		t.Error("sin reglas no hay comisión")
	}
}

func TestPerio(t *testing.T) {
	if CAL(4, 2) != 6 || CAL(3, -1) != 2 {
		t.Error("NIC = PS + MG")
	}
	teeth := map[string]PerioTooth{
		"16": {PD: []float64{3, 2, 3, 5, 4, 3}, GM: []float64{0, 0, 0, 1, 0, 0}, Bleeding: []bool{true, false, false, true, false, false}},
		"11": {PD: []float64{2, 2, 2, 2, 2, 2}},
		"46": {Missing: true},
	}
	s := SummarizePerio(teeth)
	if s.Teeth != 2 || s.Sites != 12 || s.SitesPD4Plus != 2 {
		t.Fatalf("resumen incorrecto: %+v", s)
	}
	if s.BleedingPct != 16.67 {
		t.Errorf("sangrado: %v", s.BleedingPct)
	}
	if s.Diagnosis != "Periodontitis estadio III/IV (NIC ≥ 5 mm)" {
		t.Errorf("diagnóstico: %s", s.Diagnosis)
	}
}

func TestNoteEditable(t *testing.T) {
	now := time.Now()
	if !NoteEditable(now.Add(-2*time.Hour), false, 24, now) {
		t.Error("nota reciente sin firmar es editable")
	}
	if NoteEditable(now.Add(-25*time.Hour), false, 24, now) {
		t.Error("nota fuera de plazo queda bloqueada")
	}
	if NoteEditable(now.Add(-time.Minute), true, 24, now) {
		t.Error("nota firmada queda bloqueada")
	}
}

func TestAllergyConflict(t *testing.T) {
	if !AllergyConflict("Amoxicilina 500 mg", true, "") {
		t.Error("amoxicilina es una penicilina")
	}
	if AllergyConflict("Clindamicina 300 mg", true, "") {
		t.Error("clindamicina no es una penicilina")
	}
	if !AllergyConflict("Ibuprofeno 400 mg", false, "Ibuprofeno") {
		t.Error("debe detectar alergia registrada en texto libre")
	}
}

func TestCriticalAlerts(t *testing.T) {
	a := CriticalAlerts(map[string]any{"penicillin_allergy": true, "anticoagulated": true, "allergies": "Penicilina"})
	if len(a) != 2 {
		t.Errorf("alertas: %v", a)
	}
}

func TestCashAndInvoice(t *testing.T) {
	if CashDifference(95, 100) != -5 {
		t.Error("faltante de caja")
	}
	if InvoiceStatus(100, 0) != "emitida" || InvoiceStatus(100, 40) != "parcial" || InvoiceStatus(100, 100) != "pagada" {
		t.Error("estado de factura")
	}
	k := AccessKey(time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC), "1790012345001", "001", "001", 25, 1, "12345678")
	if len(k) != 49 {
		t.Fatalf("clave de acceso debe tener 49 dígitos, tiene %d", len(k))
	}
	if Mod11(k[:48]) != int(k[48]-'0') {
		t.Error("dígito verificador inválido")
	}
}
