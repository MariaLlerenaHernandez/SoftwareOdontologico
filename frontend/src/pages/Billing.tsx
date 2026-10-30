import { useEffect, useMemo, useState } from 'react'
import { Ban, CreditCard, FileCode2, FileText, Plus, Printer, Receipt, Search, Trash2, Wallet } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, qs, tokenStore } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useDebounced, useFetch } from '../lib/hooks'
import { INVOICE_STATUS, PAY_METHOD, addDays, fmtDate, fmtDateTime, isoDate, money } from '../lib/format'
import PatientPicker, { type PickedPatient } from '../components/PatientPicker'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Stat, Textarea, useToast } from '../components/ui'

/** Punto de venta y facturación electrónica (RF-12). */
export default function Billing() {
  const { can, settings } = useAuth()
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -30)))
  const [to, setTo] = useState(isoDate(new Date()))
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data, loading, reload } = useFetch<any[]>(`/invoices${qs({ from, to, status, q: dq })}`)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const cur = settings.moneda
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  // Retorno desde Stripe Checkout: se verifica la sesión con la API antes de registrar el pago.
  useEffect(() => {
    const invoice = Number(params.get('invoice'))
    const session = params.get('stripe_session')
    if (!invoice) return
    setParams({}, { replace: true })
    if (params.get('stripe_cancel')) {
      toast.warning('Pago con tarjeta cancelado')
      setViewing(invoice)
      return
    }
    if (!session) return
    api
      .post(`/invoices/${invoice}/stripe-confirm`, { session_id: session })
      .then((r) => toast.success(r.already_registered ? 'El pago ya estaba registrado' : 'Pago con tarjeta aprobado por Stripe y registrado'))
      .catch((e) => toast.error(e.message))
      .finally(() => (reload(), setViewing(invoice)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(() => {
    const ok = (data ?? []).filter((i) => i.status !== 'anulada')
    return { total: ok.reduce((s, i) => s + i.total, 0), paid: ok.reduce((s, i) => s + i.paid, 0), count: ok.length }
  }, [data])

  return (
    <div>
      <PageHeader title="Facturación" subtitle="Comprobantes electrónicos y cobros con pagos mixtos" icon={<FileText className="size-5" />}
        actions={can('admin', 'recepcion') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nueva factura</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Facturado en el período" value={money(totals.total, cur)} hint={`${totals.count} comprobantes`} icon={<Receipt className="size-5" />} />
        <Stat label="Cobrado" value={money(totals.paid, cur)} icon={<Wallet className="size-5" />} tone="emerald" />
        <Stat label="Por cobrar" value={money(totals.total - totals.paid, cur)} icon={<FileText className="size-5" />} tone="amber" />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Cliente, documento o número de factura…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(INVOICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
        </div>
        {loading && !data ? <Spinner /> : !data?.length ? <Empty icon={<FileText className="size-5" />} title="No hay comprobantes en el período" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th className="text-right">Total</th><th className="text-right">Saldo</th><th>Estado</th><th>SRI / Autorización</th></tr></thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => setViewing(i.id)}>
                    <td className="font-mono text-xs font-medium">{i.number}</td>
                    <td className="text-slate-600">{fmtDateTime(i.issued_at)}</td>
                    <td><p className="font-medium text-slate-800">{i.customer_name}</p><p className="text-xs text-slate-500">{i.customer_document}</p></td>
                    <td className="text-right font-medium tabular-nums">{money(i.total, cur)}</td>
                    <td className="text-right tabular-nums">{i.balance > 0 ? money(i.balance, cur) : '—'}</td>
                    <td><Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge></td>
                    <td><Badge tone={i.electronic_status === 'autorizada' ? 'emerald' : 'amber'}>{i.electronic_status === 'autorizada' ? 'Autorizada' : i.electronic_status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <NewInvoice open={creating} onClose={() => setCreating(false)} onCreated={(inv) => (setCreating(false), reload(), setViewing(inv.id))} />
      <InvoiceView id={viewing} onClose={() => setViewing(null)} onChanged={reload} />
    </div>
  )
}

interface Line {
  key: string
  plan_item_id?: number
  procedure_id?: number
  dentist_id?: number
  description: string
  quantity: number
  unit_price: number
  discount: number
  locked?: boolean
}
interface Pay {
  method: string
  amount: string
  reference: string
}

function NewInvoice({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (inv: any) => void }) {
  const { settings } = useAuth()
  const cur = settings.moneda
  const [patient, setPatient] = useState<PickedPatient | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [pays, setPays] = useState<Pay[]>([{ method: 'efectivo', amount: '', reference: '' }])
  const [customer, setCustomer] = useState({ name: '', doc: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: billable } = useFetch<any[]>(patient ? `/patients/${patient.id}/billable` : null)
  const { data: procedures } = useFetch<any[]>(open ? '/catalog/procedures' : null)
  const { data: staff } = useFetch<any[]>(open ? '/staff' : null)
  const { data: cash } = useFetch<any>(open ? '/cash/current' : null)

  useEffect(() => {
    if (!open) {
      setPatient(null)
      setLines([])
      setPays([{ method: 'efectivo', amount: '', reference: '' }])
      setError(null)
      setCustomer({ name: '', doc: '' })
    }
  }, [open])

  useEffect(() => {
    if (!billable) return
    setLines(billable.map((b) => ({ key: `pi${b.id}`, plan_item_id: b.id, procedure_id: b.procedure_id, dentist_id: b.dentist_id, description: `${b.procedure_name}${b.tooth ? ` · pieza ${b.tooth}` : ''}`, quantity: 1, unit_price: b.price, discount: Math.round((b.price - b.net) * 100) / 100, locked: true })))
  }, [billable])

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0)
  const discount = lines.reduce((s, l) => s + l.discount, 0)
  const tax = ((subtotal - discount) * (Number(settings.iva_pct) || 0)) / 100
  const total = Math.round((subtotal - discount + tax) * 100) / 100
  const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const addProc = (id: string) => {
    const p = procedures?.find((x) => String(x.id) === id)
    if (!p) return
    setLines((l) => [...l, { key: `m${Date.now()}`, procedure_id: p.id, description: p.name, quantity: 1, unit_price: p.price, discount: 0 }])
  }
  const updLine = (k: string, f: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...f } : l)))
  const updPay = (i: number, f: Partial<Pay>) => setPays((ps) => ps.map((p, j) => (j === i ? { ...p, ...f } : p)))

  const save = async () => {
    if (!patient) return setError('Seleccione el paciente')
    setSaving(true)
    setError(null)
    try {
      const inv = await api.post('/invoices', {
        patient_id: patient.id,
        customer_name: customer.name,
        customer_document: customer.doc,
        items: lines.map((l) => ({ plan_item_id: l.plan_item_id, procedure_id: l.plan_item_id ? undefined : l.procedure_id, dentist_id: l.dentist_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount: l.discount })),
        payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
      })
      onCreated(inv)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const dentists = staff?.filter((s) => s.role === 'odontologo') ?? []

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Nueva factura electrónica" subtitle="Los procedimientos realizados y no facturados del paciente se cargan automáticamente"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={saving} disabled={!lines.length}>Emitir y autorizar comprobante</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <ErrorBox message={error} />
          <Field label="Paciente"><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>
          {patient && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Facturar a (opcional)" hint="Por defecto: el paciente"><Input value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} /></Field>
              <Field label="RUC / cédula del cliente"><Input value={customer.doc} onChange={(e) => setCustomer((c) => ({ ...c, doc: e.target.value }))} /></Field>
            </div>
          )}
          <div className="rounded-lg border border-slate-200">
            <table className="table-base">
              <thead><tr><th>Concepto</th><th>Profesional</th><th className="w-16">Cant.</th><th className="w-24">P. unit.</th><th className="w-24">Desc.</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {lines.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-sm text-slate-500">{patient ? 'Sin procedimientos pendientes de facturar. Agregue conceptos del catálogo.' : 'Seleccione un paciente.'}</td></tr>}
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>{l.locked ? <><p className="text-sm font-medium">{l.description}</p><Badge tone="violet">Del plan de tratamiento</Badge></> : <Input value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} />}</td>
                    <td>
                      <Select value={l.dentist_id ?? ''} disabled={l.locked} onChange={(e) => updLine(l.key, { dentist_id: e.target.value ? Number(e.target.value) : undefined })} className="py-1 text-xs">
                        <option value="">—</option>
                        {dentists.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                      </Select>
                    </td>
                    <td><Input type="number" min={1} value={l.quantity} disabled={l.locked} onChange={(e) => updLine(l.key, { quantity: Number(e.target.value) || 1 })} className="py-1" /></td>
                    <td><Input type="number" min={0} step="0.01" value={l.unit_price} disabled={l.locked} onChange={(e) => updLine(l.key, { unit_price: Number(e.target.value) || 0 })} className="py-1" /></td>
                    <td><Input type="number" min={0} step="0.01" value={l.discount} disabled={l.locked} onChange={(e) => updLine(l.key, { discount: Number(e.target.value) || 0 })} className="py-1" /></td>
                    <td className="text-right font-medium tabular-nums">{money(l.quantity * l.unit_price - l.discount, cur)}</td>
                    <td><button className="text-slate-400 hover:text-rose-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar"><Trash2 className="size-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {patient && (
            <Select value="" onChange={(e) => addProc(e.target.value)}>
              <option value="">+ Agregar concepto del catálogo de procedimientos…</option>
              {procedures?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} — {money(p.price, cur)}</option>)}
            </Select>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
            <p className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{money(subtotal, cur)}</span></p>
            <p className="flex justify-between"><span className="text-slate-500">Descuentos</span><span className="tabular-nums">−{money(discount, cur)}</span></p>
            <p className="flex justify-between"><span className="text-slate-500">IVA {settings.iva_pct}%</span><span className="tabular-nums">{money(tax, cur)}</span></p>
            <p className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{money(total, cur)}</span></p>
          </div>
          <div>
            <p className="label">Formas de pago (pagos mixtos)</p>
            <div className="space-y-2">
              {pays.map((p, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
                  <div className="flex gap-2">
                    <Select value={p.method} onChange={(e) => updPay(i, { method: e.target.value })} className="py-1.5">
                      {Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <Input type="number" min={0} step="0.01" placeholder="Monto" value={p.amount} onChange={(e) => updPay(i, { amount: e.target.value })} className="w-28 py-1.5" />
                    <button className="text-slate-400 hover:text-rose-600" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} aria-label="Quitar pago"><Trash2 className="size-4" /></button>
                  </div>
                  {p.method !== 'efectivo' && <Input placeholder="N.º de autorización / referencia" value={p.reference} onChange={(e) => updPay(i, { reference: e.target.value })} className="py-1.5 text-xs" />}
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setPays((ps) => [...ps, { method: 'tarjeta_debito', amount: '', reference: '' }])}>Otra forma de pago</Button>
                {total - paid > 0.004 && <Button size="sm" variant="ghost" onClick={() => setPays((ps) => (ps.length ? ps.map((p, j) => (j === ps.length - 1 ? { ...p, amount: String(Math.round(((Number(p.amount) || 0) + total - paid) * 100) / 100) } : p)) : [{ method: 'efectivo', amount: String(total), reference: '' }]))}>Completar saldo</Button>}
              </div>
            </div>
            <p className="mt-2 flex justify-between text-sm"><span className="text-slate-500">Pagado</span><strong className="tabular-nums">{money(paid, cur)}</strong></p>
            <p className="flex justify-between text-sm"><span className="text-slate-500">Saldo pendiente</span><strong className={total - paid > 0.004 ? 'text-amber-700' : 'text-emerald-700'}>{money(Math.max(0, total - paid), cur)}</strong></p>
          </div>
          {pays.some((p) => p.method === 'efectivo' && Number(p.amount) > 0) && cash && !cash.open && <Notice tone="amber">Para recibir efectivo debe abrir su caja del día en el módulo Caja.</Notice>}
        </div>
      </div>
    </Modal>
  )
}

function InvoiceView({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const { data: inv, setData } = useFetch<any>(id ? `/invoices/${id}` : null)
  const { can, settings } = useAuth()
  const toast = useToast()
  const [pay, setPay] = useState<Pay>({ method: 'efectivo', amount: '', reference: '' })
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: integ } = useFetch<any>('/integrations')
  if (!id) return null
  const cur = settings.moneda

  const downloadXML = async () => {
    try {
      const res = await fetch(`/api/invoices/${id}/xml`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      if (!res.ok) throw new Error('No se pudo generar el XML')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await res.blob())
      a.download = `factura-${inv.number}.xml`
      a.click()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const payWithStripe = async () => {
    setBusy(true)
    setError(null)
    try {
      const amount = Number(pay.amount) || inv.balance
      const r = await api.post(`/invoices/${id}/stripe-checkout`, { amount, return_url: `${window.location.origin}/facturacion` })
      window.location.href = r.url
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }

  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    setError(null)
    try {
      setData(await fn())
      toast.success(msg)
      onChanged()
      setPay({ method: 'efectivo', amount: '', reference: '' })
      setVoiding(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Comprobante electrónico" printable
      footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button>{inv && <Button variant="secondary" icon={<FileCode2 className="size-4" />} onClick={downloadXML}>XML (formato SRI)</Button>}{inv && <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir RIDE / PDF</Button>}</>}>
      {!inv ? <Spinner /> : (
        <div className="space-y-5 text-sm text-slate-700">
          <div className="grid gap-4 border-b-2 border-brand-700 pb-4 sm:grid-cols-2">
            <div>
              <p className="text-lg font-bold text-brand-800">{settings.clinica_nombre}</p>
              <p className="text-xs text-slate-500">RUC {settings.clinica_ruc}</p>
              <p className="text-xs text-slate-500">{settings.clinica_direccion} · {settings.clinica_telefono}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 text-xs">
              <p className="text-sm font-bold">FACTURA N.º {inv.number}</p>
              <p><strong>Ambiente:</strong> Pruebas · <strong>Emisión:</strong> Normal</p>
              <p className="mt-1"><strong>Autorización:</strong> <Badge tone={inv.electronic_status === 'autorizada' ? 'emerald' : 'amber'}>{inv.electronic_status}</Badge></p>
              <p className="mt-1 font-semibold">Clave de acceso:</p>
              <p className="font-mono text-[10px] break-all">{inv.access_key}</p>
            </div>
          </div>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <p><strong>Cliente:</strong> {inv.customer_name}</p>
            <p><strong>Identificación:</strong> {inv.customer_document}</p>
            <p><strong>Fecha de emisión:</strong> {fmtDateTime(inv.issued_at)}</p>
            <p><strong>Dirección:</strong> {inv.customer_address ?? '—'}</p>
            {inv.insurance_name && <p><strong>Seguro:</strong> {inv.insurance_name}</p>}
            <p><strong>Emitido por:</strong> {inv.issued_by_name}</p>
          </div>
          {inv.status === 'anulada' && <Notice tone="rose" icon={<Ban className="size-4" />}>Comprobante ANULADO · {inv.void_reason}</Notice>}
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-300 text-left"><th className="py-1.5">Código</th><th>Descripción</th><th>Profesional</th><th className="text-right">Cant.</th><th className="text-right">P. unit.</th><th className="text-right">Desc.</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {inv.items.map((it: any) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="py-1.5 font-mono">{it.procedure_code ?? '—'}</td><td>{it.description}</td><td>{it.dentist_name ?? '—'}</td>
                  <td className="text-right">{it.quantity}</td><td className="text-right">{money(it.unit_price, cur)}</td><td className="text-right">{money(it.discount, cur)}</td><td className="text-right">{money(it.total, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold">Pagos registrados</p>
              {inv.payments.length === 0 ? <p className="text-xs text-slate-500">Sin pagos</p> : (
                <ul className="space-y-1 text-xs">
                  {inv.payments.map((p: any) => <li key={p.id} className="flex justify-between"><span>{PAY_METHOD[p.method]} {p.reference && `· ${p.reference}`} · {fmtDate(p.paid_at)}</span><span className="tabular-nums">{money(p.amount, cur)}</span></li>)}
                </ul>
              )}
            </div>
            <div className="space-y-1 text-xs">
              <p className="flex justify-between"><span>Subtotal</span><span>{money(inv.subtotal, cur)}</span></p>
              <p className="flex justify-between"><span>Descuento</span><span>−{money(inv.discount, cur)}</span></p>
              <p className="flex justify-between"><span>IVA</span><span>{money(inv.tax, cur)}</span></p>
              <p className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold"><span>TOTAL</span><span>{money(inv.total, cur)}</span></p>
              <p className="flex justify-between"><span>Pagado</span><span>{money(inv.paid, cur)}</span></p>
              <p className="flex justify-between font-semibold"><span>Saldo</span><span>{money(inv.balance, cur)}</span></p>
            </div>
          </div>
          <ErrorBox message={error} />
          {inv.status !== 'anulada' && inv.status !== 'pagada' && can('admin', 'recepcion') && (
            <div className="no-print rounded-lg border border-slate-200 p-3">
              <p className="label">Registrar abono</p>
              <div className="flex flex-wrap gap-2">
                <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className="w-48 py-1.5">
                  {Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Input type="number" placeholder="Monto" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="w-28 py-1.5" />
                {pay.method !== 'efectivo' && <Input placeholder="Referencia" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} className="w-40 py-1.5" />}
                <Button size="sm" loading={busy} onClick={() => run(() => api.post(`/invoices/${inv.id}/payments`, { ...pay, amount: Number(pay.amount) }), 'Pago registrado')}>Registrar</Button>
              </div>
              {integ?.stripe && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                  <Button size="sm" variant="outline" icon={<CreditCard className="size-4" />} loading={busy} onClick={payWithStripe}>
                    Cobrar {money(Number(pay.amount) || inv.balance, cur)} con tarjeta (Stripe)
                  </Button>
                  <span className="text-xs text-slate-500">Se abrirá la página segura de pago. En modo de prueba use la tarjeta 4242 4242 4242 4242.</span>
                </div>
              )}
            </div>
          )}
          {inv.status !== 'anulada' && can('admin') && (
            <div className="no-print">
              {!voiding ? <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} onClick={() => setVoiding(true)}>Anular comprobante</Button> : (
                <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                  <Field label="Motivo de anulación (nota de crédito)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setVoiding(false)}>Cancelar</Button><Button size="sm" variant="danger" loading={busy} onClick={() => run(() => api.post(`/invoices/${inv.id}/void`, { reason }), 'Comprobante anulado')}>Anular</Button></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
