package api

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"
)

// ------------------------------------ Comprobante electrónico (RF-12)
//
// Genera el XML de la factura según el esquema "factura" v1.1.0 de la ficha
// técnica de comprobantes electrónicos del SRI (esquema offline). Para su
// autorización real falta firmarlo con XAdES-BES usando el certificado .p12
// del emisor y enviarlo a los web services de recepción/autorización del SRI.

type sriFactura struct {
	XMLName        xml.Name          `xml:"factura"`
	ID             string            `xml:"id,attr"`
	Version        string            `xml:"version,attr"`
	InfoTributaria sriInfoTributaria `xml:"infoTributaria"`
	InfoFactura    sriInfoFactura    `xml:"infoFactura"`
	Detalles       []sriDetalle      `xml:"detalles>detalle"`
	InfoAdicional  []sriCampo        `xml:"infoAdicional>campoAdicional,omitempty"`
}

type sriInfoTributaria struct {
	Ambiente        string `xml:"ambiente"`
	TipoEmision     string `xml:"tipoEmision"`
	RazonSocial     string `xml:"razonSocial"`
	NombreComercial string `xml:"nombreComercial"`
	Ruc             string `xml:"ruc"`
	ClaveAcceso     string `xml:"claveAcceso"`
	CodDoc          string `xml:"codDoc"`
	Estab           string `xml:"estab"`
	PtoEmi          string `xml:"ptoEmi"`
	Secuencial      string `xml:"secuencial"`
	DirMatriz       string `xml:"dirMatriz"`
}

type sriImpuesto struct {
	Codigo           string `xml:"codigo"`
	CodigoPorcentaje string `xml:"codigoPorcentaje"`
	Tarifa           string `xml:"tarifa,omitempty"`
	BaseImponible    string `xml:"baseImponible"`
	Valor            string `xml:"valor"`
}

type sriPago struct {
	FormaPago string `xml:"formaPago"`
	Total     string `xml:"total"`
}

type sriInfoFactura struct {
	FechaEmision                string        `xml:"fechaEmision"`
	DirEstablecimiento          string        `xml:"dirEstablecimiento"`
	ObligadoContabilidad        string        `xml:"obligadoContabilidad"`
	TipoIdentificacionComprador string        `xml:"tipoIdentificacionComprador"`
	RazonSocialComprador        string        `xml:"razonSocialComprador"`
	IdentificacionComprador     string        `xml:"identificacionComprador"`
	DireccionComprador          string        `xml:"direccionComprador,omitempty"`
	TotalSinImpuestos           string        `xml:"totalSinImpuestos"`
	TotalDescuento              string        `xml:"totalDescuento"`
	TotalConImpuestos           []sriImpuesto `xml:"totalConImpuestos>totalImpuesto"`
	Propina                     string        `xml:"propina"`
	ImporteTotal                string        `xml:"importeTotal"`
	Moneda                      string        `xml:"moneda"`
	Pagos                       []sriPago     `xml:"pagos>pago"`
}

type sriDetalle struct {
	CodigoPrincipal        string        `xml:"codigoPrincipal"`
	Descripcion            string        `xml:"descripcion"`
	Cantidad               string        `xml:"cantidad"`
	PrecioUnitario         string        `xml:"precioUnitario"`
	Descuento              string        `xml:"descuento"`
	PrecioTotalSinImpuesto string        `xml:"precioTotalSinImpuesto"`
	Impuestos              []sriImpuesto `xml:"impuestos>impuesto"`
}

type sriCampo struct {
	Nombre string `xml:"nombre,attr"`
	Valor  string `xml:",chardata"`
}

func money2(v float64) string { return fmt.Sprintf("%.2f", v) }

// ivaCode traduce el porcentaje de IVA al código de la tabla 17 del SRI.
func ivaCode(pct float64) string {
	switch pct {
	case 0:
		return "0"
	case 12:
		return "2"
	case 14:
		return "3"
	case 15:
		return "4"
	case 5:
		return "5"
	}
	return "4"
}

// formaPagoSRI traduce el método de pago a la tabla 24 del SRI.
var formaPagoSRI = map[string]string{
	"efectivo":        "01", // sin utilización del sistema financiero
	"tarjeta_debito":  "16",
	"tarjeta_credito": "19",
	"transferencia":   "20", // otros con utilización del sistema financiero
	"seguro":          "20",
}

func (s *Server) invoiceXML(c *Ctx) error {
	id, err := c.PathID("id")
	if err != nil {
		return err
	}
	inv, err := s.loadInvoice(c.Context(), id)
	if err != nil {
		return err
	}
	parts := strings.Split(str(inv["number"]), "-")
	if len(parts) != 3 {
		return badRequest("Número de factura con formato inesperado")
	}
	doc := str(inv["customer_document"])
	tipoID := "05" // cédula
	switch {
	case len(doc) == 13:
		tipoID = "04" // RUC
	case doc == "9999999999999":
		tipoID = "07" // consumidor final
	case len(doc) != 10:
		tipoID = "06" // pasaporte
	}
	ivaPct := s.settings.Float("iva_pct", 0)
	code := ivaCode(ivaPct)
	base := num(inv["subtotal"]) - num(inv["discount"])
	issued := inv["issued_at"].(time.Time).In(s.cfg.Location)

	f := sriFactura{
		ID: "comprobante", Version: "1.1.0",
		InfoTributaria: sriInfoTributaria{
			Ambiente: "1", TipoEmision: "1",
			RazonSocial: s.settings.Get("clinica_nombre"), NombreComercial: s.settings.Get("clinica_nombre"),
			Ruc: s.settings.Get("clinica_ruc"), ClaveAcceso: str(inv["access_key"]), CodDoc: "01",
			Estab: parts[0], PtoEmi: parts[1], Secuencial: parts[2], DirMatriz: s.settings.Get("clinica_direccion"),
		},
		InfoFactura: sriInfoFactura{
			FechaEmision: issued.Format("02/01/2006"), DirEstablecimiento: s.settings.Get("clinica_direccion"),
			ObligadoContabilidad: "SI", TipoIdentificacionComprador: tipoID,
			RazonSocialComprador: str(inv["customer_name"]), IdentificacionComprador: doc,
			DireccionComprador: str(inv["customer_address"]),
			TotalSinImpuestos:  money2(base), TotalDescuento: money2(num(inv["discount"])),
			TotalConImpuestos: []sriImpuesto{{Codigo: "2", CodigoPorcentaje: code, BaseImponible: money2(base), Valor: money2(num(inv["tax"]))}},
			Propina:           "0.00", ImporteTotal: money2(num(inv["total"])), Moneda: "DOLAR",
		},
	}
	pays := map[string]float64{}
	for _, p := range inv["payments"].([]map[string]any) {
		pays[formaPagoSRI[str(p["method"])]] += num(p["amount"])
	}
	if len(pays) == 0 {
		pays["20"] = num(inv["total"]) // pendiente de cobro
	}
	for k, v := range pays {
		f.InfoFactura.Pagos = append(f.InfoFactura.Pagos, sriPago{FormaPago: k, Total: money2(v)})
	}
	for i, it := range inv["items"].([]map[string]any) {
		codigo := str(it["procedure_code"])
		if codigo == "" {
			codigo = fmt.Sprintf("SERV-%02d", i+1)
		}
		neto := num(it["total"])
		f.Detalles = append(f.Detalles, sriDetalle{
			CodigoPrincipal: codigo, Descripcion: str(it["description"]),
			Cantidad: fmt.Sprintf("%.2f", num(it["quantity"])), PrecioUnitario: money2(num(it["unit_price"])),
			Descuento: money2(num(it["discount"])), PrecioTotalSinImpuesto: money2(neto),
			Impuestos: []sriImpuesto{{Codigo: "2", CodigoPorcentaje: code, Tarifa: fmt.Sprintf("%.0f", ivaPct), BaseImponible: money2(neto), Valor: money2(neto * ivaPct / 100)}},
		})
	}
	if e := str(inv["customer_email"]); e != "" {
		f.InfoAdicional = append(f.InfoAdicional, sriCampo{Nombre: "Email", Valor: e})
	}
	if p := str(inv["customer_phone"]); p != "" {
		f.InfoAdicional = append(f.InfoAdicional, sriCampo{Nombre: "Telefono", Valor: p})
	}
	out, err := xml.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	c.action = "EXPORT"
	c.Audit(id, i64(inv["patient_id"]), map[string]any{"format": "xml-sri"})
	c.W.Header().Set("Content-Type", "application/xml; charset=utf-8")
	c.W.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="factura-%s.xml"`, inv["number"]))
	c.status = 200
	_, err = c.W.Write(append([]byte(xml.Header), out...))
	return err
}
