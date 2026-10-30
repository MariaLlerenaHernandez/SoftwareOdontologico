import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, FlaskConical, Pencil, Plus, Scale, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { fmtDateTime, money, num } from '../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Tabs, useToast } from '../components/ui'

const MOV: Record<string, { label: string; tone: any }> = {
  entrada: { label: 'Entrada', tone: 'emerald' },
  salida: { label: 'Salida', tone: 'amber' },
  ajuste: { label: 'Ajuste', tone: 'sky' },
  consumo: { label: 'Consumo clínico', tone: 'violet' },
}

/** Inventario de insumos con descargo automático por receta (RF-14). */
export default function Inventory() {
  const { can } = useAuth()
  const [tab, setTab] = useState<'stock' | 'movimientos' | 'recetas'>('stock')
  return (
    <div>
      <PageHeader title="Inventario de insumos" subtitle="Stock por sede, movimientos y recetas estándar de consumo" icon={<Boxes className="size-5" />} />
      <div className="mb-6">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'stock', label: 'Existencias' }, { id: 'movimientos', label: 'Kardex / movimientos' }, { id: 'recetas', label: 'Recetas de consumo' }]} />
      </div>
      {tab === 'stock' && <Stock canMove={can('admin', 'asistente')} canEdit={can('admin')} canCreate={can('admin', 'asistente')} />}
      {tab === 'movimientos' && <Movements />}
      {tab === 'recetas' && <Recipes editable={can('admin')} />}
    </div>
  )
}

function Stock({ canMove, canEdit, canCreate }: { canMove: boolean; canEdit: boolean; canCreate: boolean }) {
  const { settings } = useAuth()
  const { data, loading, reload } = useFetch<any[]>('/supplies')
  const { data: offices } = useFetch<any[]>('/catalog/offices')
  const [moving, setMoving] = useState<{ supply: any; type: string } | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [onlyLow, setOnlyLow] = useState(false)
  if (loading && !data) return <Spinner />
  const list = (data ?? []).filter((s) => !onlyLow || s.low_stock)
  const value = (data ?? []).reduce((s, x) => s + x.stock_value, 0)
  const low = (data ?? []).filter((s) => s.low_stock).length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Insumos activos" value={data?.length ?? 0} icon={<Boxes className="size-5" />} />
        <Stat label="Valor del inventario" value={money(value, settings.moneda)} tone="emerald" />
        <Stat label="Bajo stock mínimo" value={low} tone={low ? 'rose' : 'slate'} icon={<AlertTriangle className="size-5" />} />
      </div>
      <Card padded={false} title="Existencias" actions={
        <>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="accent-brand-700" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo bajo mínimo</label>
          {canCreate && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ unit: 'unidad', category: 'Bioseguridad', min_stock: 0, unit_cost: 0, stock: 0, office_id: 1 })}>Nuevo insumo</Button>}
        </>
      }>
        {!list.length ? <Empty title="Sin insumos" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Código</th><th>Insumo</th><th>Categoría</th><th>Sede</th><th className="text-right">Stock</th><th className="text-right">Mínimo</th><th className="text-right">Consumo 30 d</th><th className="text-right">Costo unit.</th><th /></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-xs">{s.code}</td>
                    <td className="font-medium text-slate-800">{s.name}</td>
                    <td className="text-slate-600">{s.category}</td>
                    <td className="text-slate-600">{s.office_name ?? '—'}</td>
                    <td className="text-right">
                      <span className={`font-semibold tabular-nums ${s.low_stock ? 'text-rose-600' : ''}`}>{num(s.stock, 2)}</span> <span className="text-xs text-slate-400">{s.unit}</span>
                      {s.low_stock && <Badge tone="rose" className="ml-2">Reponer</Badge>}
                    </td>
                    <td className="text-right text-slate-500 tabular-nums">{num(s.min_stock, 0)}</td>
                    <td className="text-right text-slate-500 tabular-nums">{num(s.consumed_30d, 2)}</td>
                    <td className="text-right tabular-nums">{money(s.unit_cost, settings.moneda)}</td>
                    <td className="text-right whitespace-nowrap">
                      {canMove && (
                        <>
                          <button title="Entrada" className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" onClick={() => setMoving({ supply: s, type: 'entrada' })}><ArrowDownToLine className="size-4" /></button>
                          <button title="Salida" className="rounded p-1.5 text-amber-600 hover:bg-amber-50" onClick={() => setMoving({ supply: s, type: 'salida' })}><ArrowUpFromLine className="size-4" /></button>
                          <button title="Ajuste por conteo" className="rounded p-1.5 text-sky-600 hover:bg-sky-50" onClick={() => setMoving({ supply: s, type: 'ajuste' })}><Scale className="size-4" /></button>
                        </>
                      )}
                      {canEdit && <button title="Editar" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setEditing(s)}><Pencil className="size-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <MoveModal moving={moving} onClose={() => setMoving(null)} onSaved={() => (setMoving(null), reload())} />
      <SupplyModal supply={editing} offices={offices ?? []} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </div>
  )
}

function MoveModal({ moving, onClose, onSaved }: { moving: { supply: any; type: string } | null; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => {
    setQty('')
    setReason(moving?.type === 'entrada' ? 'Compra a proveedor' : moving?.type === 'ajuste' ? 'Conteo físico de inventario' : '')
    setError(null)
  }, [moving])
  if (!moving) return null
  const save = async () => {
    try {
      await api.post(`/supplies/${moving.supply.id}/movements`, { movement_type: moving.type, quantity: Number(qty), reason })
      toast.success('Movimiento registrado')
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`${MOV[moving.type].label} · ${moving.supply.name}`} subtitle={`Stock actual: ${num(moving.supply.stock, 2)} ${moving.supply.unit}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Registrar</Button></>}>
      <div className="space-y-4">
        <ErrorBox message={error} />
        <Field label={moving.type === 'ajuste' ? 'Stock contado (físico)' : 'Cantidad'}><Input type="number" min={0} step="0.01" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Motivo / documento"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function SupplyModal({ supply, offices, onClose, onSaved }: { supply: any; offices: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({})
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => {
    setF(supply ?? {})
    setError(null)
  }, [supply])
  if (!supply) return null
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    try {
      const body = { ...f, min_stock: Number(f.min_stock), unit_cost: Number(f.unit_cost), stock: Number(f.stock) || 0, office_id: f.office_id ? Number(f.office_id) : null }
      if (supply.id) await api.put(`/supplies/${supply.id}`, body)
      else await api.post('/supplies', body)
      toast.success('Insumo guardado')
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Modal open onClose={onClose} title={supply.id ? 'Editar insumo' : 'Nuevo insumo'} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorBox message={error} /></div>
        <Field label="Código"><Input value={f.code ?? ''} onChange={set('code')} /></Field>
        <Field label="Nombre"><Input value={f.name ?? ''} onChange={set('name')} /></Field>
        <Field label="Categoría"><Input value={f.category ?? ''} onChange={set('category')} /></Field>
        <Field label="Unidad de medida"><Input value={f.unit ?? ''} onChange={set('unit')} /></Field>
        <Field label="Stock mínimo"><Input type="number" value={f.min_stock ?? 0} onChange={set('min_stock')} /></Field>
        <Field label="Costo unitario"><Input type="number" step="0.01" value={f.unit_cost ?? 0} onChange={set('unit_cost')} /></Field>
        {!supply.id && <Field label="Stock inicial"><Input type="number" value={f.stock ?? 0} onChange={set('stock')} /></Field>}
        <Field label="Sede">
          <Select value={f.office_id ?? ''} onChange={set('office_id')}>
            <option value="">—</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function Movements() {
  const { data, loading } = useFetch<any[]>('/stock-movements')
  if (loading && !data) return <Spinner />
  return (
    <Card padded={false}>
      {!data?.length ? <Empty title="Sin movimientos" /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Fecha</th><th>Insumo</th><th>Tipo</th><th className="text-right">Cantidad</th><th className="text-right">Saldo</th><th>Detalle</th><th>Usuario</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="text-slate-600">{fmtDateTime(m.created_at)}</td>
                  <td><p className="font-medium">{m.supply_name}</p><p className="font-mono text-xs text-slate-400">{m.code}</p></td>
                  <td><Badge tone={MOV[m.movement_type].tone}>{MOV[m.movement_type].label}</Badge></td>
                  <td className={`text-right font-medium tabular-nums ${m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{m.quantity > 0 ? '+' : ''}{num(m.quantity, 2)} {m.unit}</td>
                  <td className="text-right tabular-nums">{num(m.stock_after, 2)}</td>
                  <td className="max-w-72 text-xs text-slate-600">{m.reason}{m.procedure_name && <p className="text-slate-400">{m.procedure_name} · {m.patient_name} · {m.office_name}</p>}</td>
                  <td className="text-xs text-slate-500">{m.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Recipes({ editable }: { editable: boolean }) {
  const { settings } = useAuth()
  const { data: procedures } = useFetch<any[]>('/catalog/procedures')
  const { data: supplies } = useFetch<any[]>('/supplies')
  const [proc, setProc] = useState<string>('')
  const { data: recipe, setData } = useFetch<any[]>(proc ? `/procedures/${proc}/recipe` : null)
  const [draft, setDraft] = useState<{ supply_id: string; quantity: string }[]>([])
  const toast = useToast()
  useEffect(() => setDraft((recipe ?? []).map((r) => ({ supply_id: String(r.supply_id), quantity: String(r.quantity) }))), [recipe])
  useEffect(() => {
    if (!proc && procedures?.length) setProc(String(procedures.find((p) => p.recipe_items > 0)?.id ?? procedures[0].id))
  }, [procedures, proc])

  const save = async () => {
    try {
      setData(await api.put(`/procedures/${proc}/recipe`, draft.filter((d) => d.supply_id).map((d) => ({ supply_id: Number(d.supply_id), quantity: Number(d.quantity) }))))
      toast.success('Receta de consumo actualizada')
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const cost = (recipe ?? []).reduce((s, r) => s + r.cost, 0)

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card title="Procedimientos" padded={false}>
        <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
          {procedures?.map((p) => (
            <li key={p.id}>
              <button onClick={() => setProc(String(p.id))} className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${proc === String(p.id) ? 'bg-brand-50 font-medium text-brand-900' : ''}`}>
                <span><span className="font-mono text-xs text-slate-400">{p.code}</span> {p.name}</span>
                {p.recipe_items > 0 && <Badge tone="brand">{p.recipe_items}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Receta estándar de consumo" subtitle="Se descuenta automáticamente del stock al marcar el procedimiento como realizado"
        actions={<span className="text-sm text-slate-600">Costo de materiales: <strong>{money(cost, settings.moneda)}</strong></span>}>
        {!proc ? <Empty icon={<FlaskConical className="size-5" />} title="Seleccione un procedimiento" /> : (
          <div className="space-y-2">
            {draft.length === 0 && <p className="text-sm text-slate-500">Este procedimiento no tiene insumos configurados.</p>}
            {draft.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_32px] gap-2">
                <Select disabled={!editable} value={d.supply_id} onChange={(e) => setDraft((x) => x.map((y, j) => (j === i ? { ...y, supply_id: e.target.value } : y)))}>
                  <option value="">Seleccione insumo…</option>
                  {supplies?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                </Select>
                <Input disabled={!editable} type="number" step="0.01" min={0} value={d.quantity} onChange={(e) => setDraft((x) => x.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)))} />
                {editable && <button className="text-slate-400 hover:text-rose-600" onClick={() => setDraft((x) => x.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 className="size-4" /></button>}
              </div>
            ))}
            {editable && (
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDraft((x) => [...x, { supply_id: '', quantity: '1' }])}>Agregar insumo</Button>
                <Button size="sm" className="ml-auto" onClick={save}>Guardar receta</Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
