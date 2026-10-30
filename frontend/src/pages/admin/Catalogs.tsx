import { useEffect, useState } from 'react'
import { ClipboardList, Pencil, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { money } from '../../lib/format'
import { CONDITIONS } from '../../lib/teeth'
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, useToast } from '../../components/ui'

type Col = { k: string; l: string; type?: 'number' | 'textarea' | 'select' | 'bool'; options?: { v: any; l: string }[]; show?: (r: any, cur?: string) => React.ReactNode }

const DEFS: Record<string, { title: string; cols: Col[]; blank: any }> = {
  procedures: {
    title: 'Procedimientos',
    blank: { category: 'Operatoria', price: 0, lab_cost: 0, duration_min: 30, active: true },
    cols: [
      { k: 'code', l: 'Código' },
      { k: 'name', l: 'Nombre' },
      { k: 'category', l: 'Categoría' },
      { k: 'price', l: 'Honorario', type: 'number', show: (r, c) => money(r.price, c) },
      { k: 'lab_cost', l: 'Costo laboratorio', type: 'number', show: (r, c) => money(r.lab_cost, c) },
      { k: 'duration_min', l: 'Duración (min)', type: 'number' },
      { k: 'odontogram_condition', l: 'Marca en odontograma', type: 'select', options: [{ v: '', l: '— Ninguna —' }, ...CONDITIONS.map((c) => ({ v: c.id, l: c.label }))] },
      { k: 'active', l: 'Activo', type: 'bool' },
    ],
  },
  offices: {
    title: 'Consultorios / sedes',
    blank: { active: true },
    cols: [{ k: 'name', l: 'Nombre' }, { k: 'address', l: 'Dirección' }, { k: 'phone', l: 'Teléfono' }, { k: 'active', l: 'Activo', type: 'bool' }],
  },
  chairs: {
    title: 'Sillones dentales',
    blank: { active: true, office_id: 1 },
    cols: [{ k: 'name', l: 'Nombre' }, { k: 'office_id', l: 'Sede', type: 'select', show: (r) => r.office_name }, { k: 'active', l: 'Activo', type: 'bool' }],
  },
  insurances: {
    title: 'Seguros y convenios',
    blank: { coverage_pct: 0, active: true },
    cols: [{ k: 'name', l: 'Nombre' }, { k: 'coverage_pct', l: 'Cobertura %', type: 'number' }, { k: 'phone', l: 'Teléfono' }, { k: 'active', l: 'Activo', type: 'bool' }],
  },
  'consent-templates': {
    title: 'Formatos de consentimiento',
    blank: { active: true, body: 'Yo, {{paciente}}, con documento {{documento}}, autorizo al profesional {{odontologo}} a …' },
    cols: [{ k: 'title', l: 'Título' }, { k: 'procedure_category', l: 'Categoría' }, { k: 'body', l: 'Texto legal', type: 'textarea', show: (r) => <span className="line-clamp-2 max-w-md text-xs text-slate-500">{r.body}</span> }, { k: 'active', l: 'Activo', type: 'bool' }],
  },
}

/** Parametrización de catálogos (Administrador TI). */
export default function Catalogs() {
  const [tab, setTab] = useState('procedures')
  return (
    <div>
      <PageHeader title="Catálogos" subtitle="Procedimientos, sedes, sillones, seguros y formatos legales" icon={<ClipboardList className="size-5" />} />
      <div className="mb-6"><Tabs value={tab} onChange={setTab} tabs={Object.entries(DEFS).map(([id, d]) => ({ id, label: d.title }))} /></div>
      <CatalogTable key={tab} name={tab} />
    </div>
  )
}

function CatalogTable({ name }: { name: string }) {
  const def = DEFS[name]
  const { settings } = useAuth()
  const { data, loading, reload } = useFetch<any[]>(`/catalog/${name}`)
  const { data: offices } = useFetch<any[]>(name === 'chairs' ? '/catalog/offices' : null)
  const [editing, setEditing] = useState<any | null>(null)
  const cols = def.cols.map((c) => (c.k === 'office_id' ? { ...c, options: (offices ?? []).map((o) => ({ v: o.id, l: o.name })) } : c))

  return (
    <Card padded={false} title={def.title} actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ ...def.blank })}>Agregar</Button>}>
      {loading && !data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr>{cols.map((c) => <th key={c.k}>{c.l}</th>)}<th /></tr></thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id} className={r.active === false ? 'opacity-50' : ''}>
                  {cols.map((c) => (
                    <td key={c.k}>{c.show ? c.show(r, settings.moneda) : c.type === 'bool' ? <Badge tone={r[c.k] ? 'emerald' : 'slate'}>{r[c.k] ? 'Sí' : 'No'}</Badge> : c.type === 'select' ? (c.options?.find((o) => o.v === (r[c.k] ?? ''))?.l ?? '—') : (r[c.k] ?? '—')}</td>
                  ))}
                  <td className="text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EditModal name={name} cols={cols} row={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </Card>
  )
}

function EditModal({ name, cols, row, onClose, onSaved }: { name: string; cols: Col[]; row: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({})
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => (setF(row ?? {}), setError(null)), [row])
  if (!row) return null
  const save = async () => {
    try {
      const body: any = {}
      cols.forEach((c) => {
        let v = f[c.k]
        if (c.type === 'number' || c.k === 'office_id') v = v === '' || v == null ? 0 : Number(v)
        if (c.type === 'bool') v = !!v
        body[c.k] = v ?? ''
      })
      if (row.id) await api.put(`/catalog/${name}/${row.id}`, body)
      else await api.post(`/catalog/${name}`, body)
      toast.success('Registro guardado')
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Modal open onClose={onClose} title={row.id ? 'Editar registro' : 'Nuevo registro'} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorBox message={error} /></div>
        {cols.map((c) =>
          c.type === 'bool' ? (
            <label key={c.k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={!!f[c.k]} onChange={(e) => setF({ ...f, [c.k]: e.target.checked })} /> {c.l}</label>
          ) : c.type === 'textarea' ? (
            <Field key={c.k} label={c.l} className="sm:col-span-2" hint="Variables: {{paciente}}, {{documento}}, {{odontologo}}"><Textarea rows={6} value={f[c.k] ?? ''} onChange={(e) => setF({ ...f, [c.k]: e.target.value })} /></Field>
          ) : c.type === 'select' ? (
            <Field key={c.k} label={c.l}><Select value={f[c.k] ?? ''} onChange={(e) => setF({ ...f, [c.k]: e.target.value })}>{c.options?.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select></Field>
          ) : (
            <Field key={c.k} label={c.l}><Input type={c.type === 'number' ? 'number' : 'text'} step="0.01" value={f[c.k] ?? ''} onChange={(e) => setF({ ...f, [c.k]: e.target.value })} /></Field>
          ),
        )}
      </div>
    </Modal>
  )
}
