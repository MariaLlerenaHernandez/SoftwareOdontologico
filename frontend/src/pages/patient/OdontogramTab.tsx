import { useMemo, useState } from 'react'
import { Lock, MousePointerClick, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDate } from '../../lib/format'
import { CONDITION, CONDITIONS, findingColor, surfaceName, toothLabel, toothName, type Dentition, type Finding, type Notation, type Surface } from '../../lib/teeth'
import Odontogram, { OdontogramLegend } from '../../components/Odontogram'
import { Badge, Button, Card, ConfirmDialog, Empty, Segmented, Select, Spinner, cx, useToast } from '../../components/ui'

const STATUS_LABEL = { existente: 'Existente', planificado: 'Planificado', realizado: 'Realizado' } as const

export default function OdontogramTab({ patient }: { patient: any }) {
  const { data, loading, reload } = useFetch<Finding[]>(`/patients/${patient.id}/odontogram`)
  const { can } = useAuth()
  const editable = can('odontologo')
  const toast = useToast()
  const [notation, setNotation] = useState<Notation>('fdi')
  const [dentition, setDentition] = useState<Dentition>(patient.age < 6 ? 'temporal' : patient.age < 13 ? 'mixta' : 'permanente')
  const [tool, setTool] = useState('caries')
  const [status, setStatus] = useState<'existente' | 'planificado'>('existente')
  const [selected, setSelected] = useState<number | null>(null)
  const [toDelete, setToDelete] = useState<Finding | null>(null)

  const def = CONDITION[tool]
  const findings = data ?? []
  const toothFindings = useMemo(() => findings.filter((f) => f.tooth === selected).reverse(), [findings, selected])

  const add = async (tooth: number, surface: Surface | null) => {
    if (!editable) return setSelected(tooth)
    setSelected(tooth)
    try {
      await api.post(`/patients/${patient.id}/odontogram`, { tooth, surface: def.surface ? surface : '', condition: tool, status })
      reload()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const markDone = async (f: Finding) => {
    try {
      await api.patch(`/odontogram/${f.id}`, { status: 'realizado' })
      toast.success('Hallazgo marcado como realizado')
      reload()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await api.del(`/odontogram/${toDelete.id}`)
      toast.success('Hallazgo eliminado')
      reload()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setToDelete(null)
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    findings.forEach((f) => (c[f.condition] = (c[f.condition] ?? 0) + 1))
    return c
  }, [findings])

  if (loading && !data) return <Spinner />

  return (
    <div className="grid gap-6 2xl:grid-cols-[1fr_340px]">
      <Card
        title="Odontograma"
        subtitle="Representación anatómica por superficies · M mesial · D distal · O/I oclusal/incisal · V vestibular · L/P lingual/palatino"
        actions={
          <>
            <Segmented
              value={dentition}
              onChange={setDentition}
              options={[
                { id: 'permanente', label: 'Permanente (32)' },
                { id: 'mixta', label: 'Mixta' },
                { id: 'temporal', label: 'Temporal (20)' },
              ]}
            />
            <Segmented value={notation} onChange={setNotation} options={[{ id: 'fdi', label: 'FDI' }, { id: 'universal', label: 'Universal' }]} />
          </>
        }
      >
        {editable && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase">
                <MousePointerClick className="size-3.5" /> Herramienta
              </span>
              {CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => (setTool(c.id), setStatus(c.defaultStatus))}
                  className={cx(
                    'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    tool === c.id ? 'border-brand-500 bg-white text-brand-800 shadow-xs ring-2 ring-brand-500/20' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  <span className="size-2.5 rounded-sm" style={{ background: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Estado del hallazgo:</span>
              <Segmented value={status} onChange={setStatus} options={[{ id: 'existente', label: 'Existente' }, { id: 'planificado', label: 'Planificado' }]} />
              <span>{def.surface ? 'Haga clic sobre la superficie dental a marcar.' : 'Haga clic sobre cualquier parte de la pieza.'}</span>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <Odontogram
              findings={findings}
              notation={notation}
              dentition={dentition}
              selected={selected}
              onSurface={(t, s) => add(t, s)}
              onTooth={(t) => (def.surface || !editable ? setSelected(t) : add(t, null))}
            />
          </div>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <OdontogramLegend />
        </div>
      </Card>

      <div className="space-y-6">
        <Card title={selected ? `Pieza ${toothLabel(selected, notation)}` : 'Detalle de pieza'} subtitle={selected ? toothName(selected) : 'Seleccione una pieza en el odontograma'} padded={false}>
          {!selected ? (
            <Empty title="Ninguna pieza seleccionada">Haga clic sobre una pieza para ver su historial de hallazgos.</Empty>
          ) : toothFindings.length === 0 ? (
            <Empty title="Sin hallazgos registrados" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {toothFindings.map((f) => (
                <li key={f.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: findingColor(f) }} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-slate-800">
                      {CONDITION[f.condition]?.label ?? f.condition}
                      {f.surface && <span className="font-normal text-slate-500"> · {surfaceName(f.surface, f.tooth)}</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(f.created_at)} · {f.created_by_name}
                    </p>
                    {f.notes && <p className="mt-1 text-xs text-slate-600">{f.notes}</p>}
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge tone={f.status === 'realizado' ? 'violet' : f.status === 'planificado' ? 'rose' : 'sky'}>{STATUS_LABEL[f.status]}</Badge>
                      {editable && f.status === 'planificado' && (
                        <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => markDone(f)}>
                          Marcar realizado
                        </button>
                      )}
                    </div>
                  </div>
                  {f.status === 'realizado' ? (
                    <Lock className="mt-1 size-4 text-slate-300" aria-label="Inmutable (RN-01)" />
                  ) : (
                    editable && (
                      <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setToDelete(f)} aria-label="Eliminar">
                        <Trash2 className="size-4" />
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Resumen de hallazgos">
          {findings.length === 0 ? (
            <p className="text-sm text-slate-500">Odontograma sin registros.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(counts).map(([c, n]) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: CONDITION[c]?.color }} />
                  <span className="flex-1 text-slate-600">{CONDITION[c]?.label ?? c}</span>
                  <span className="font-medium text-slate-800 tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-400">
            <Lock className="mt-0.5 size-3 shrink-0" /> Los procedimientos realizados son inmutables (RN-01); las correcciones se documentan mediante adenda en la evolución.
          </p>
        </Card>

        {selected && editable && (
          <Card title="Registro rápido">
            <Select value={tool} onChange={(e) => setTool(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
            {!def.surface && (
              <Button className="mt-3 w-full" variant="outline" onClick={() => add(selected, null)}>
                Registrar «{def.label}» en pieza {toothLabel(selected, notation)}
              </Button>
            )}
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        danger
        title="Eliminar hallazgo"
        confirmLabel="Eliminar"
        message="¿Eliminar este hallazgo del odontograma? La acción queda registrada en la auditoría."
      />
    </div>
  )
}
