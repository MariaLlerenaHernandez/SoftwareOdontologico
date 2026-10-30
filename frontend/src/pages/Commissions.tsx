import { useState } from 'react'
import { ChevronDown, ChevronRight, HandCoins, Plus, Save } from 'lucide-react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { fmtDate, fmtDateTime, isoDate, money } from '../lib/format'
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Tabs, useToast } from '../components/ui'

const RULE_LABEL: Record<string, string> = { porcentaje: '% sobre lo facturado', fijo: 'Monto fijo por procedimiento', porcentaje_neto: '% tras deducir laboratorio y materiales' }

/** Liquidación de honorarios a profesionales (RF-13). */
export default function Commissions() {
  const { can } = useAuth()
  const [tab, setTab] = useState<'liquidacion' | 'reglas' | 'historial'>('liquidacion')
  const tabs = [
    { id: 'liquidacion' as const, label: 'Liquidación del período' },
    ...(can('admin', 'auditor') ? [{ id: 'reglas' as const, label: 'Reglas de comisión' }] : []),
    { id: 'historial' as const, label: 'Liquidaciones emitidas' },
  ]
  return (
    <div>
      <PageHeader title="Honorarios profesionales" subtitle="Cálculo configurable de comisiones por odontólogo" icon={<HandCoins className="size-5" />} />
      <div className="mb-6"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'liquidacion' && <Report />}
      {tab === 'reglas' && <Rules />}
      {tab === 'historial' && <History />}
    </div>
  )
}

function Report() {
  const { can, settings } = useAuth()
  const cur = settings.moneda
  const now = new Date()
  const [from, setFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(isoDate(now))
  const { data, loading } = useFetch<any>(`/commissions/report${qs({ from, to })}`)
  const [open, setOpen] = useState<number | null>(null)
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)

  const settle = async (dentist: number) => {
    setBusy(dentist)
    try {
      await api.post('/commissions/settlements', { dentist_id: dentist, from, to })
      toast.success('Liquidación registrada')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const sum = (k: string) => (data?.dentists ?? []).reduce((s: number, d: any) => s + d[k], 0)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {loading && !data ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Producción facturada" value={money(sum('gross'), cur)} />
            <Stat label="Costos lab./materiales" value={money(sum('costs'), cur)} tone="amber" />
            <Stat label="Honorarios a pagar" value={money(sum('commission'), cur)} tone="violet" />
            <Stat label="Margen clínica" value={money(sum('clinic_net'), cur)} tone="emerald" />
          </div>
          {!data?.dentists?.length ? <Card><Empty title="Sin procedimientos facturados en el período" /></Card> : data.dentists.map((d: any) => (
            <Card key={d.dentist_id} padded={false}>
              <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setOpen(open === d.dentist_id ? null : d.dentist_id)}>
                  {open === d.dentist_id ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                  <Avatar name={d.dentist_name} size="sm" />
                  <div><p className="font-semibold text-slate-800">{d.dentist_name}</p><p className="text-xs text-slate-500">{d.items} procedimientos</p></div>
                </button>
                <div className="grid grid-cols-3 gap-6 text-right text-sm">
                  <div><p className="text-xs text-slate-500">Producción</p><p className="font-medium tabular-nums">{money(d.gross, cur)}</p></div>
                  <div><p className="text-xs text-slate-500">Costos</p><p className="font-medium tabular-nums">{money(d.costs, cur)}</p></div>
                  <div><p className="text-xs text-slate-500">Honorario</p><p className="text-base font-semibold text-violet-700 tabular-nums">{money(d.commission, cur)}</p></div>
                </div>
                {can('admin', 'auditor') && <Button size="sm" variant="outline" loading={busy === d.dentist_id} onClick={() => settle(d.dentist_id)}>Emitir liquidación</Button>}
              </div>
              {open === d.dentist_id && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="table-base">
                    <thead><tr><th>Factura</th><th>Fecha</th><th>Concepto</th><th className="text-right">Facturado</th><th className="text-right">Costos</th><th>Regla</th><th className="text-right">Honorario</th></tr></thead>
                    <tbody>
                      {d.lines.map((l: any, i: number) => (
                        <tr key={i}>
                          <td className="font-mono text-xs">{l.invoice_number}</td><td className="text-slate-600">{fmtDate(l.issued_at)}</td><td>{l.description}</td>
                          <td className="text-right tabular-nums">{money(l.gross, cur)}</td><td className="text-right text-slate-500 tabular-nums">{money(l.costs, cur)}</td>
                          <td className="text-xs text-slate-500">{l.rule_type ? `${l.rule_type === 'fijo' ? money(l.rule_value, cur) : `${l.rule_value}%`} · ${l.rule_type.replace('_', ' ')}` : 'Sin regla'}</td>
                          <td className="text-right font-medium tabular-nums">{money(l.commission, cur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

function Rules() {
  const { can, settings } = useAuth()
  const { data, reload } = useFetch<any[]>('/commissions/rules')
  const { data: staff } = useFetch<any[]>('/staff')
  const { data: procedures } = useFetch<any[]>('/catalog/procedures')
  const [editing, setEditing] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const save = async () => {
    setError(null)
    try {
      const body = { dentist_id: Number(editing.dentist_id), procedure_id: editing.procedure_id ? Number(editing.procedure_id) : null, rule_type: editing.rule_type, value: Number(editing.value), active: editing.active ?? true }
      if (editing.id) await api.put(`/commissions/rules/${editing.id}`, body)
      else await api.post('/commissions/rules', body)
      toast.success('Regla guardada')
      setEditing(null)
      reload()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <Card title="Reglas vigentes" subtitle="Una regla específica por procedimiento prevalece sobre la regla general del profesional"
      actions={can('admin') && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ rule_type: 'porcentaje', value: 40 })}>Nueva regla</Button>} padded={false}>
      {!data ? <Spinner /> : (
        <table className="table-base">
          <thead><tr><th>Profesional</th><th>Aplica a</th><th>Tipo</th><th className="text-right">Valor</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                <td className="font-medium">{r.dentist_name}</td>
                <td>{r.procedure_name ? `${r.procedure_code} · ${r.procedure_name}` : <Badge tone="slate">Todos los procedimientos</Badge>}</td>
                <td className="text-slate-600">{RULE_LABEL[r.rule_type]}</td>
                <td className="text-right font-semibold tabular-nums">{r.rule_type === 'fijo' ? money(r.value, settings.moneda) : `${r.value}%`}</td>
                <td><Badge tone={r.active ? 'emerald' : 'slate'}>{r.active ? 'Activa' : 'Inactiva'}</Badge></td>
                <td className="text-right">{can('admin') && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar regla' : 'Nueva regla de comisión'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button icon={<Save className="size-4" />} onClick={save}>Guardar</Button></>}>
        {editing && (
          <div className="space-y-4">
            <ErrorBox message={error} />
            <Field label="Profesional">
              <Select value={editing.dentist_id ?? ''} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, dentist_id: e.target.value })}>
                <option value="">Seleccione…</option>
                {staff?.filter((s) => s.role === 'odontologo').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Procedimiento (opcional)">
              <Select value={editing.procedure_id ?? ''} onChange={(e) => setEditing({ ...editing, procedure_id: e.target.value })}>
                <option value="">Todos (regla general)</option>
                {procedures?.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </Select>
            </Field>
            <Field label="Tipo de cálculo">
              <Select value={editing.rule_type} onChange={(e) => setEditing({ ...editing, rule_type: e.target.value })}>
                {Object.entries(RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label={editing.rule_type === 'fijo' ? 'Monto por procedimiento' : 'Porcentaje'}><Input type="number" min={0} step="0.01" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></Field>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Regla activa</label>
            )}
          </div>
        )}
      </Modal>
    </Card>
  )
}

function History() {
  const { settings } = useAuth()
  const { data } = useFetch<any[]>('/commissions/settlements')
  return (
    <Card padded={false}>
      {!data ? <Spinner /> : !data.length ? <Empty title="No se han emitido liquidaciones" /> : (
        <table className="table-base">
          <thead><tr><th>Profesional</th><th>Período</th><th className="text-right">Producción</th><th className="text-right">Honorario liquidado</th><th>Emitida</th></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.dentist_name}</td>
                <td className="text-slate-600">{fmtDate(s.period_start)} – {fmtDate(s.period_end)}</td>
                <td className="text-right tabular-nums">{money(s.total_gross, settings.moneda)}</td>
                <td className="text-right font-semibold text-violet-700 tabular-nums">{money(s.total_commission, settings.moneda)}</td>
                <td className="text-xs text-slate-500">{fmtDateTime(s.created_at)} · {s.created_by_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
