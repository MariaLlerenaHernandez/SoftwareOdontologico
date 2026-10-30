import { useState } from 'react'
import { CalendarPlus, CheckCheck, CheckCircle2, ClipboardList, Plus, Printer, Send, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { ITEM_STATUS, PLAN_STATUS, fmtDate, fmtDateTime, money } from '../../lib/format'
import AppointmentForm, { type ApptInitial } from '../../components/AppointmentForm'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Field, Input, Modal, Notice, Select, Spinner, Textarea, useToast } from '../../components/ui'

interface ItemDraft {
  phase: number
  procedure_id: string
  tooth: string
  surface: string
  discount_pct: string
  description: string
}
const newItem = (phase = 1): ItemDraft => ({ phase, procedure_id: '', tooth: '', surface: '', discount_pct: '0', description: '' })

/** Planes de tratamiento y presupuestos multinivel (RF-07, RF-08). */
export default function PlansTab({ patient }: { patient: any }) {
  const { data, loading, reload } = useFetch<any[]>(`/patients/${patient.id}/plans`)
  const { data: procedures } = useFetch<any[]>('/catalog/procedures')
  const { can, settings } = useAuth()
  const toast = useToast()
  const cur = settings.moneda

  const [creating, setCreating] = useState(false)
  const [addingTo, setAddingTo] = useState<any | null>(null)
  const [approving, setApproving] = useState<any | null>(null)
  const [printing, setPrinting] = useState<any | null>(null)
  const [schedule, setSchedule] = useState<ApptInitial | null>(null)
  const [completing, setCompleting] = useState<any | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try {
      const r = await fn()
      toast.success(msg)
      reload()
      return r
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Spinner />
  const plans = data ?? []

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {can('odontologo') && (
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo plan de tratamiento
          </Button>
        )}
      </div>
      {plans.length === 0 && (
        <Card>
          <Empty icon={<ClipboardList className="size-5" />} title="Sin planes de tratamiento">El odontólogo puede armar presupuestos por fases desde el diagnóstico.</Empty>
        </Card>
      )}
      {plans.map((plan) => {
        const editable = plan.status === 'borrador' || plan.status === 'presentado'
        const phases = Array.from(new Set(plan.items.map((i: any) => i.phase))) as number[]
        return (
          <Card
            key={plan.id}
            title={
              <span className="flex items-center gap-2">
                {plan.title} <Badge tone={PLAN_STATUS[plan.status].tone}>{PLAN_STATUS[plan.status].label}</Badge>
              </span>
            }
            subtitle={`${plan.dentist_name} · creado ${fmtDate(plan.created_at)}${plan.approved_at ? ` · aprobado por ${plan.approved_by_name} el ${fmtDateTime(plan.approved_at)}` : ''}`}
            actions={
              <>
                <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={() => setPrinting(plan)}>Presupuesto</Button>
                {editable && can('odontologo') && (
                  <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setAddingTo(plan)}>Procedimiento</Button>
                )}
                {plan.status === 'borrador' && can('odontologo') && (
                  <Button size="sm" variant="outline" icon={<Send className="size-3.5" />} loading={busy} onClick={() => act(() => api.post(`/plans/${plan.id}/present`), 'Presupuesto presentado al paciente')}>
                    Presentar
                  </Button>
                )}
                {plan.status === 'presentado' && can('recepcion', 'odontologo') && (
                  <Button size="sm" icon={<CheckCheck className="size-3.5" />} onClick={() => setApproving(plan)}>Registrar aprobación</Button>
                )}
              </>
            }
            padded={false}
          >
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Procedimiento</th>
                    <th>Pieza</th>
                    <th className="text-right">Honorario</th>
                    <th className="text-right">Desc.</th>
                    <th className="text-right">Neto</th>
                    <th className="text-right">Laboratorio</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {phases.map((ph) => (
                    <PhaseRows
                      key={ph}
                      phase={ph}
                      items={plan.items.filter((i: any) => i.phase === ph)}
                      cur={cur}
                      editable={editable && can('odontologo')}
                      canSchedule={can('recepcion', 'odontologo')}
                      canComplete={can('odontologo')}
                      onDelete={(it: any) => act(() => api.del(`/plan-items/${it.id}`), 'Procedimiento quitado del plan')}
                      onSchedule={(it: any) =>
                        setSchedule({
                          patient: { id: patient.id, first_name: patient.first_name, last_name: patient.last_name, document_number: patient.document_number, record_number: patient.record_number },
                          dentist_id: plan.dentist_id,
                          duration: it.duration_min,
                          reason: `${it.procedure_name}${it.tooth ? ` pieza ${it.tooth}` : ''}`,
                          plan_item_id: it.id,
                        })
                      }
                      onComplete={setCompleting}
                    />
                  ))}
                  {plan.items.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-sm text-slate-500">Agregue procedimientos al plan.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Totals plan={plan} cur={cur} />
          </Card>
        )
      })}

      <PlanEditor open={creating} onClose={() => setCreating(false)} procedures={procedures ?? []} patientId={patient.id} onSaved={() => (setCreating(false), reload())} />
      <AddItem plan={addingTo} onClose={() => setAddingTo(null)} procedures={procedures ?? []} onSaved={() => (setAddingTo(null), reload())} />
      <Approve plan={approving} patient={patient} onClose={() => setApproving(null)} onSaved={() => (setApproving(null), reload())} />
      <BudgetPrint plan={printing} patient={patient} onClose={() => setPrinting(null)} />
      <AppointmentForm open={!!schedule} onClose={() => setSchedule(null)} initial={schedule ?? undefined} onSaved={() => (setSchedule(null), reload())} />
      <ConfirmDialog
        open={!!completing}
        onClose={() => setCompleting(null)}
        loading={busy}
        title="Registrar procedimiento realizado"
        confirmLabel="Marcar como realizado"
        message={
          <div className="space-y-2">
            <p>
              <strong>{completing?.procedure_name}</strong> {completing?.tooth && `· pieza ${completing.tooth}`}
            </p>
            <p>Al confirmar: se actualizará el odontograma, se descontarán del inventario los insumos de la receta estándar y el procedimiento quedará disponible para facturación. Esta acción es irreversible (RN-01).</p>
          </div>
        }
        onConfirm={async () => {
          const r = await act(() => api.post(`/plan-items/${completing.id}/complete`), 'Procedimiento realizado')
          setCompleting(null)
          if (r?.consumed?.length) toast.info(`Descargo automático: ${r.consumed.map((c: any) => `${c.quantity} ${c.unit} ${c.name}`).join(', ')}`)
        }}
      />
    </div>
  )
}

function PhaseRows({ phase, items, cur, editable, canSchedule, canComplete, onDelete, onSchedule, onComplete }: any) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={8} className="py-1.5! text-xs font-semibold tracking-wide text-brand-800 uppercase">Fase {phase}</td>
      </tr>
      {items.map((it: any) => (
        <tr key={it.id} className={it.status === 'rechazado' ? 'opacity-50' : ''}>
          <td>
            <p className="font-medium text-slate-800">{it.procedure_name}</p>
            <p className="text-xs text-slate-500">
              {it.procedure_code}
              {it.description && ` · ${it.description}`}
            </p>
          </td>
          <td className="text-slate-600">{it.tooth ? `${it.tooth}${it.surface ? ` · ${it.surface}` : ''}` : '—'}</td>
          <td className="text-right tabular-nums">{money(it.price, cur)}</td>
          <td className="text-right text-slate-500 tabular-nums">{it.discount_pct > 0 ? `${it.discount_pct}%` : '—'}</td>
          <td className="text-right font-medium tabular-nums">{money(it.net, cur)}</td>
          <td className="text-right text-slate-500 tabular-nums">{it.lab_cost > 0 ? money(it.lab_cost, cur) : '—'}</td>
          <td>
            <Badge tone={ITEM_STATUS[it.status].tone}>{ITEM_STATUS[it.status].label}</Badge>
            {it.appointment_at && it.status === 'agendado' && <p className="mt-0.5 text-xs text-slate-500">{fmtDateTime(it.appointment_at)}</p>}
            {it.status === 'realizado' && <p className="mt-0.5 text-xs text-slate-500">{fmtDate(it.performed_at)}{it.invoiced ? ' · facturado' : ''}</p>}
          </td>
          <td className="text-right whitespace-nowrap">
            {it.status === 'aprobado' && canSchedule && (
              <Button size="sm" variant="ghost" icon={<CalendarPlus className="size-3.5" />} onClick={() => onSchedule(it)}>Agendar</Button>
            )}
            {(it.status === 'aprobado' || it.status === 'agendado') && canComplete && (
              <Button size="sm" variant="ghost" icon={<CheckCircle2 className="size-3.5" />} onClick={() => onComplete(it)}>Realizado</Button>
            )}
            {editable && it.status === 'propuesto' && (
              <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => onDelete(it)} aria-label="Quitar">
                <Trash2 className="size-4" />
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}

function Totals({ plan, cur }: { plan: any; cur?: string }) {
  const t = plan.totals
  return (
    <div className="flex flex-wrap justify-end gap-x-8 gap-y-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-sm">
      <span className="text-slate-500">Subtotal <strong className="ml-1 text-slate-800 tabular-nums">{money(t.subtotal, cur)}</strong></span>
      <span className="text-slate-500">Desc. ítems <strong className="ml-1 text-slate-800 tabular-nums">−{money(t.item_discounts, cur)}</strong></span>
      {plan.discount_pct > 0 && (
        <span className="text-slate-500">
          Desc. plan {plan.discount_pct}% <strong className="ml-1 text-slate-800 tabular-nums">−{money(t.plan_discount, cur)}</strong>
          {plan.discount_authorized_by_name && <span className="ml-1 text-xs">(autorizó {plan.discount_authorized_by_name})</span>}
        </span>
      )}
      <span className="text-slate-500">Costo laboratorio <strong className="ml-1 text-slate-800 tabular-nums">{money(t.lab_cost, cur)}</strong></span>
      <span className="text-slate-700">Total presupuesto <strong className="ml-1 text-base text-brand-800 tabular-nums">{money(t.total, cur)}</strong></span>
      {['aprobado', 'aprobado_parcial', 'completado'].includes(plan.status) && (
        <span className="text-slate-700">Aprobado <strong className="ml-1 text-base text-emerald-700 tabular-nums">{money(t.approved_total, cur)}</strong></span>
      )}
    </div>
  )
}

function ItemsEditor({ items, setItems, procedures }: { items: ItemDraft[]; setItems: (f: (x: ItemDraft[]) => ItemDraft[]) => void; procedures: any[] }) {
  const upd = (i: number, k: keyof ItemDraft, v: any) => setItems((x) => x.map((it, j) => (j === i ? { ...it, [k]: v } : it)))
  const cats = Array.from(new Set(procedures.filter((p) => p.active).map((p) => p.category)))
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[60px_1fr_70px_70px_70px_32px] gap-2 text-xs font-medium text-slate-500 sm:grid">
        <span>Fase</span><span>Procedimiento</span><span>Pieza</span><span>Sup.</span><span>Desc. %</span><span />
      </div>
      {items.map((it, i) => {
        return (
          <div key={i} className="grid grid-cols-[60px_1fr_70px_70px_70px_32px] items-center gap-2">
            <Input type="number" min={1} max={20} value={it.phase} onChange={(e) => upd(i, 'phase', Number(e.target.value))} />
            <Select value={it.procedure_id} onChange={(e) => upd(i, 'procedure_id', e.target.value)}>
              <option value="">Seleccione…</option>
              {cats.map((c) => (
                <optgroup key={c} label={c}>
                  {procedures.filter((p) => p.category === c && p.active).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — ${p.price}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Input placeholder="FDI" value={it.tooth} onChange={(e) => upd(i, 'tooth', e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <Select value={it.surface} onChange={(e) => upd(i, 'surface', e.target.value)}>
              <option value="">—</option>
              {['O', 'M', 'D', 'V', 'L'].map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Input type="number" min={0} max={100} value={it.discount_pct} onChange={(e) => upd(i, 'discount_pct', e.target.value)} />
            <button className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => setItems((x) => x.filter((_, j) => j !== i))} aria-label="Quitar fila">
              <Trash2 className="size-4" />
            </button>
          </div>
        )
      })}
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setItems((x) => [...x, newItem(x[x.length - 1]?.phase ?? 1)])}>
        Agregar fila
      </Button>
    </div>
  )
}

const toPayload = (items: ItemDraft[]) =>
  items
    .filter((i) => i.procedure_id)
    .map((i) => ({ phase: i.phase, procedure_id: Number(i.procedure_id), tooth: i.tooth ? Number(i.tooth) : null, surface: i.surface, discount_pct: Number(i.discount_pct) || 0, description: i.description }))

function PlanEditor({ open, onClose, procedures, patientId, onSaved }: { open: boolean; onClose: () => void; procedures: any[]; patientId: number; onSaved: () => void }) {
  const { settings } = useAuth()
  const [title, setTitle] = useState('')
  const [discount, setDiscount] = useState('0')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([newItem()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const preview = toPayload(items).reduce((s, i) => {
    const p = procedures.find((x) => x.id === i.procedure_id)
    return s + (p ? p.price * (1 - i.discount_pct / 100) : 0)
  }, 0) * (1 - (Number(discount) || 0) / 100)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/plans`, { title, discount_pct: Number(discount) || 0, notes, items: toPayload(items) })
      setTitle('')
      setItems([newItem()])
      setDiscount('0')
      setNotes('')
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nuevo plan de tratamiento"
      subtitle="Organice los procedimientos por fases o sesiones"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-600">Total estimado: <strong className="text-brand-800">{money(preview, settings.moneda)}</strong></span>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} loading={saving}>Crear plan</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox message={error} />
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <Field label="Título del plan"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Rehabilitación sector posterior" /></Field>
          <Field label="Descuento global %" hint={`Máx. ${settings.descuento_max_pct}% sin autorización`}><Input type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
        </div>
        <ItemsEditor items={items} setItems={setItems} procedures={procedures} />
        <Field label="Notas para el paciente"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function AddItem({ plan, onClose, procedures, onSaved }: { plan: any; onClose: () => void; procedures: any[]; onSaved: () => void }) {
  const [items, setItems] = useState<ItemDraft[]>([newItem()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      for (const it of toPayload(items)) await api.post(`/plans/${plan.id}/items`, it)
      setItems([newItem()])
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open={!!plan} onClose={onClose} size="lg" title="Agregar procedimientos" subtitle={plan?.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={saving}>Agregar</Button></>}>
      <ErrorBox message={error} />
      <div className="mt-3"><ItemsEditor items={items} setItems={setItems} procedures={procedures} /></div>
    </Modal>
  )
}

function Approve({ plan, patient, onClose, onSaved }: { plan: any; patient: any; onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { settings } = useAuth()
  const proposed = plan?.items.filter((i: any) => i.status === 'propuesto') ?? []

  const [lastPlan, setLastPlan] = useState<number | null>(null)
  if (plan && plan.id !== lastPlan) {
    setLastPlan(plan.id)
    setSelected(new Set(proposed.map((i: any) => i.id)))
    setName(patient.guardian_name ?? `${patient.first_name} ${patient.last_name}`)
  }
  const total = proposed.filter((i: any) => selected.has(i.id)).reduce((s: number, i: any) => s + i.net, 0) * (1 - (plan?.discount_pct ?? 0) / 100)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/plans/${plan.id}/approve`, { item_ids: [...selected], approved_by_name: name })
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!plan} onClose={onClose} title="Registrar aprobación del presupuesto" subtitle="Seleccione los procedimientos que el paciente autoriza (aprobación total o parcial)"
      footer={<><span className="mr-auto self-center text-sm">Total aprobado: <strong className="text-emerald-700">{money(total, settings.moneda)}</strong></span><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={saving}>Confirmar aprobación</Button></>}>
      <div className="space-y-4">
        <ErrorBox message={error} />
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {proposed.map((i: any) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="size-4 accent-brand-700" checked={selected.has(i.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(i.id) : n.delete(i.id); return n })} />
                <span className="flex-1">
                  <span className="font-medium">Fase {i.phase} · {i.procedure_name}</span>
                  {i.tooth && <span className="text-slate-500"> · pieza {i.tooth}</span>}
                </span>
                <span className="tabular-nums">{money(i.net, settings.moneda)}</span>
              </label>
            </li>
          ))}
        </ul>
        {selected.size < proposed.length && <Notice tone="amber">Los procedimientos no seleccionados quedarán como «rechazados» por el paciente.</Notice>}
        <Field label="Nombre de quien aprueba (paciente o representante legal)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function BudgetPrint({ plan, patient, onClose }: { plan: any; patient: any; onClose: () => void }) {
  const { settings } = useAuth()
  if (!plan) return null
  const cur = settings.moneda
  return (
    <Modal open onClose={onClose} size="lg" title="Presupuesto de tratamiento" printable footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button></>}>
      <div className="text-sm text-slate-700">
        <div className="flex items-start justify-between border-b-2 border-brand-700 pb-4">
          <div>
            <p className="text-lg font-bold text-brand-800">{settings.clinica_nombre}</p>
            <p className="text-xs text-slate-500">{settings.clinica_direccion} · {settings.clinica_telefono} · RUC {settings.clinica_ruc}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold">PRESUPUESTO N.º {String(plan.id).padStart(6, '0')}</p>
            <p className="text-xs text-slate-500">{fmtDate(plan.created_at)}</p>
          </div>
        </div>
        <div className="my-4 grid grid-cols-2 gap-2 text-xs">
          <p><strong>Paciente:</strong> {patient.first_name} {patient.last_name}</p>
          <p><strong>Historia clínica:</strong> {patient.record_number}</p>
          <p><strong>Documento:</strong> {patient.document_number}</p>
          <p><strong>Profesional:</strong> {plan.dentist_name}</p>
          <p className="col-span-2"><strong>Plan:</strong> {plan.title}</p>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-1.5">Fase</th><th>Procedimiento</th><th>Pieza</th><th className="text-right">Valor</th><th className="text-right">Desc.</th><th className="text-right">Neto</th><th>Estado</th></tr></thead>
          <tbody>
            {plan.items.map((i: any) => (
              <tr key={i.id} className="border-b border-slate-100">
                <td className="py-1.5">{i.phase}</td><td>{i.procedure_name}</td><td>{i.tooth ?? '—'}</td>
                <td className="text-right">{money(i.price, cur)}</td><td className="text-right">{i.discount_pct ? `${i.discount_pct}%` : '—'}</td>
                <td className="text-right">{money(i.net, cur)}</td><td>{ITEM_STATUS[i.status].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-64 space-y-1 text-xs">
          <p className="flex justify-between"><span>Subtotal</span><span>{money(plan.totals.subtotal, cur)}</span></p>
          <p className="flex justify-between"><span>Descuentos</span><span>−{money(plan.totals.item_discounts + plan.totals.plan_discount, cur)}</span></p>
          <p className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold"><span>Total</span><span>{money(plan.totals.total, cur)}</span></p>
        </div>
        {plan.notes && <p className="mt-4 text-xs"><strong>Observaciones:</strong> {plan.notes}</p>}
        <p className="mt-6 text-[11px] text-slate-500">Presupuesto válido por 30 días. Los valores pueden variar si el diagnóstico cambia durante el tratamiento.</p>
        <div className="mt-14 grid grid-cols-2 gap-12 text-center text-xs">
          <div className="border-t border-slate-400 pt-1">{plan.dentist_name}<br />Profesional tratante</div>
          <div className="border-t border-slate-400 pt-1">{plan.approved_by_name ?? 'Paciente / representante'}<br />Aceptación del presupuesto</div>
        </div>
      </div>
    </Modal>
  )
}
