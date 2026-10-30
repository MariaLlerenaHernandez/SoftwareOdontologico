import { useEffect, useMemo, useState } from 'react'
import { Activity, Copy, FilePlus2, Save } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDateTime, num } from '../../lib/format'
import { PERMANENT } from '../../lib/teeth'
import { Badge, Button, Card, Empty, Field, Spinner, Stat, Textarea, cx, useToast } from '../../components/ui'

interface PerioTooth {
  pd: number[]
  gm: number[]
  bleeding: boolean[]
  plaque: boolean[]
  furcation: number
  mobility: number
  missing: boolean
}
type Chart = Record<string, PerioTooth>

const blank = (): PerioTooth => ({ pd: [0, 0, 0, 0, 0, 0], gm: [0, 0, 0, 0, 0, 0], bleeding: Array(6).fill(false), plaque: Array(6).fill(false), furcation: 0, mobility: 0, missing: false })
const blankChart = (): Chart => Object.fromEntries([...PERMANENT.upper, ...PERMANENT.lower].map((t) => [String(t), blank()]))

/** Periodontograma digital: 6 sitios por diente, NIC = PS + MG (RF-04). */
export default function PerioTab({ patientId }: { patientId: number }) {
  const { data: exams, loading, reload } = useFetch<any[]>(`/patients/${patientId}/perio`)
  const { can } = useAuth()
  const editable = can('odontologo', 'asistente')
  const toast = useToast()
  const [chart, setChart] = useState<Chart>(blankChart)
  const [viewing, setViewing] = useState<any | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (exams?.length && !viewing) setViewing(exams[0])
  }, [exams, viewing])

  const startNew = (copy: boolean) => {
    setViewing(null)
    setNotes('')
    setChart(copy && exams?.[0] ? { ...blankChart(), ...structuredClone(exams[0].data.teeth) } : blankChart())
  }

  const current: Chart = viewing ? { ...blankChart(), ...viewing.data.teeth } : chart
  const readOnly = !!viewing || !editable

  const update = (t: string, fn: (x: PerioTooth) => void) =>
    setChart((c) => {
      const n = structuredClone(c)
      fn(n[t])
      return n
    })

  const live = useMemo(() => summarize(current), [current])

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.post(`/patients/${patientId}/perio`, { teeth: chart, notes })
      toast.success('Periodontograma guardado')
      await reload()
      setViewing(r)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !exams) return <Spinner />
  const s = viewing?.summary ?? live

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Profundidad media" value={`${num(s.mean_pd, 2)} mm`} icon={<Activity className="size-5" />} />
        <Stat label="NIC medio" value={`${num(s.mean_cal, 2)} mm`} tone="sky" />
        <Stat label="Sangrado al sondaje" value={`${num(s.bleeding_pct, 1)}%`} tone={s.bleeding_pct >= 10 ? 'rose' : 'emerald'} />
        <Stat label="Sitios PS ≥ 4 mm" value={s.sites_pd_4_plus} hint={`${s.sites_pd_6_plus} sitios ≥ 6 mm`} tone="amber" />
        <Stat label="Diagnóstico orientativo" value={<span className="text-base leading-snug">{s.diagnosis}</span>} tone="violet" />
      </div>

      <Card
        title={viewing ? `Examen del ${fmtDateTime(viewing.created_at)}` : 'Nuevo examen periodontal'}
        subtitle={viewing ? `Registrado por ${viewing.examined_by_name}` : 'Ingrese profundidad de sondaje (PS) y margen gingival (MG) en mm; MG positivo = recesión.'}
        actions={
          editable && (
            <>
              {viewing ? (
                <>
                  <Button variant="secondary" size="sm" icon={<Copy className="size-3.5" />} onClick={() => startNew(true)}>
                    Nuevo a partir del último
                  </Button>
                  <Button size="sm" icon={<FilePlus2 className="size-3.5" />} onClick={() => startNew(false)}>
                    Nuevo examen
                  </Button>
                </>
              ) : (
                <Button size="sm" icon={<Save className="size-3.5" />} loading={saving} onClick={save}>
                  Guardar periodontograma
                </Button>
              )}
            </>
          )
        }
        padded={false}
      >
        {!viewing && !editable ? (
          <Empty title="Sin exámenes periodontales" />
        ) : (
          <div className="space-y-6 p-5">
            <Arch title="Arcada superior" teeth={PERMANENT.upper} chart={current} readOnly={readOnly} update={update} lingualLabel="Palatino" />
            <Arch title="Arcada inferior" teeth={PERMANENT.lower} chart={current} readOnly={readOnly} update={update} lingualLabel="Lingual" />
            {!viewing && <Field label="Observaciones del examen"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
            {viewing?.notes && <p className="text-sm text-slate-600"><strong>Observaciones:</strong> {viewing.notes}</p>}
          </div>
        )}
      </Card>

      {!!exams?.length && (
        <Card title="Historial de exámenes" padded={false}>
          <table className="table-base">
            <thead>
              <tr><th>Fecha</th><th>Profesional</th><th>PS media</th><th>NIC medio</th><th>Sangrado</th><th>Diagnóstico</th></tr>
            </thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id} className={cx('clickable', viewing?.id === e.id && 'bg-brand-50/60')} onClick={() => setViewing(e)}>
                  <td>{fmtDateTime(e.created_at)}</td>
                  <td className="text-slate-600">{e.examined_by_name}</td>
                  <td className="tabular-nums">{num(e.summary?.mean_pd, 2)} mm</td>
                  <td className="tabular-nums">{num(e.summary?.mean_cal, 2)} mm</td>
                  <td className="tabular-nums">{num(e.summary?.bleeding_pct, 1)}%</td>
                  <td><Badge tone="violet">{e.summary?.diagnosis}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function Arch({ title, teeth, chart, readOnly, update, lingualLabel }: { title: string; teeth: number[]; chart: Chart; readOnly: boolean; update: (t: string, fn: (x: PerioTooth) => void) => void; lingualLabel: string }) {
  const cell = 'border-l border-slate-100 px-1 py-1'
  const rowLabel = 'sticky left-0 z-10 bg-white pr-3 text-right text-[11px] font-medium whitespace-nowrap text-slate-500'

  const pdInput = (t: string, i: number, kind: 'pd' | 'gm') => {
    const v = chart[t][kind][i]
    const warn = kind === 'pd' && v >= 6 ? 'bg-rose-100 text-rose-700' : kind === 'pd' && v >= 4 ? 'bg-amber-100 text-amber-800' : ''
    return (
      <input
        key={i}
        type="number"
        disabled={readOnly || chart[t].missing}
        value={v || (readOnly ? '' : '')}
        placeholder="0"
        min={kind === 'pd' ? 0 : -5}
        max={15}
        onChange={(e) => update(t, (x) => (x[kind][i] = Number(e.target.value) || 0))}
        className={cx('w-6 rounded border border-slate-200 bg-white px-0 py-0.5 text-center text-[11px] tabular-nums focus:border-brand-500 focus:outline-none disabled:bg-slate-50', warn)}
      />
    )
  }

  const side = (offset: number, label: string) => (
    <>
      <tr>
        <td className={rowLabel}>Sangrado {label}</td>
        {teeth.map((t) => (
          <td key={t} className={cell}>
            <div className="flex justify-center gap-0.5">
              {[0, 1, 2].map((i) => {
                const on = chart[String(t)].bleeding[offset + i]
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={readOnly || chart[String(t)].missing}
                    onClick={() => update(String(t), (x) => (x.bleeding[offset + i] = !x.bleeding[offset + i]))}
                    className={cx('size-3 rounded-full border', on ? 'border-rose-600 bg-rose-500' : 'border-slate-300 bg-white')}
                    aria-label="Sangrado"
                  />
                )
              })}
            </div>
          </td>
        ))}
      </tr>
      <tr>
        <td className={rowLabel}>PS {label}</td>
        {teeth.map((t) => <td key={t} className={cell}><div className="flex justify-center gap-0.5">{[0, 1, 2].map((i) => pdInput(String(t), offset + i, 'pd'))}</div></td>)}
      </tr>
      <tr>
        <td className={rowLabel}>MG {label}</td>
        {teeth.map((t) => <td key={t} className={cell}><div className="flex justify-center gap-0.5">{[0, 1, 2].map((i) => pdInput(String(t), offset + i, 'gm'))}</div></td>)}
      </tr>
      <tr className="bg-slate-50/60">
        <td className={rowLabel}>NIC {label}</td>
        {teeth.map((t) => {
          const x = chart[String(t)]
          return (
            <td key={t} className={cell}>
              <div className="flex justify-center gap-0.5 text-[11px] font-semibold text-slate-700 tabular-nums">
                {[0, 1, 2].map((i) => {
                  const cal = x.pd[offset + i] + x.gm[offset + i]
                  return <span key={i} className={cx('w-6 text-center', cal >= 5 && 'text-rose-600', x.missing && 'opacity-30')}>{x.missing ? '' : cal}</span>
                })}
              </div>
            </td>
          )
        })}
      </tr>
    </>
  )

  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-brand-800 uppercase">{title}</p>
      <div className="scrollbar-thin overflow-x-auto rounded-lg border border-slate-200">
        <table className="border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5" />
              {teeth.map((t) => (
                <th key={t} className={cx('border-l border-slate-100 px-1 py-1.5 text-center font-semibold', chart[String(t)].missing ? 'text-slate-300 line-through' : 'text-slate-700')}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={rowLabel}>Ausente</td>
              {teeth.map((t) => (
                <td key={t} className={cx(cell, 'text-center')}>
                  <input type="checkbox" disabled={readOnly} className="accent-slate-600" checked={chart[String(t)].missing} onChange={(e) => update(String(t), (x) => (x.missing = e.target.checked))} />
                </td>
              ))}
            </tr>
            <tr>
              <td className={rowLabel}>Movilidad</td>
              {teeth.map((t) => (
                <td key={t} className={cx(cell, 'text-center')}>
                  <Grade value={chart[String(t)].mobility} disabled={readOnly || chart[String(t)].missing} onChange={(v) => update(String(t), (x) => (x.mobility = v))} />
                </td>
              ))}
            </tr>
            <tr>
              <td className={rowLabel}>Furca</td>
              {teeth.map((t) => (
                <td key={t} className={cx(cell, 'text-center')}>
                  {t % 10 >= 6 || (t % 10 >= 4 && [1, 2].includes(Math.floor(t / 10))) ? (
                    <Grade value={chart[String(t)].furcation} disabled={readOnly || chart[String(t)].missing} onChange={(v) => update(String(t), (x) => (x.furcation = v))} />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              ))}
            </tr>
            {side(0, 'V')}
            {side(3, lingualLabel.slice(0, 1))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Grade({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <select disabled={disabled} value={value} onChange={(e) => onChange(Number(e.target.value))} className={cx('rounded border border-slate-200 bg-white px-0.5 text-[11px] disabled:bg-slate-50', value > 0 && 'border-amber-400 bg-amber-50 font-semibold')}>
      {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}

function summarize(chart: Chart) {
  let sites = 0, sumPD = 0, sumCAL = 0, bleed = 0, pd4 = 0, pd6 = 0, maxCAL = 0
  Object.values(chart).forEach((t) => {
    if (t.missing) return
    for (let i = 0; i < 6; i++) {
      sites++
      sumPD += t.pd[i]
      const cal = t.pd[i] + t.gm[i]
      sumCAL += cal
      maxCAL = Math.max(maxCAL, cal)
      if (t.pd[i] >= 4) pd4++
      if (t.pd[i] >= 6) pd6++
      if (t.bleeding[i]) bleed++
    }
  })
  const pct = sites ? (bleed * 100) / sites : 0
  const diagnosis =
    sites === 0 ? 'Sin datos' : maxCAL >= 5 ? 'Periodontitis estadio III/IV' : maxCAL >= 3 ? 'Periodontitis estadio II' : maxCAL >= 1 ? 'Periodontitis estadio I' : pct >= 10 ? 'Gingivitis' : 'Salud periodontal'
  return { mean_pd: sites ? sumPD / sites : 0, mean_cal: sites ? sumCAL / sites : 0, bleeding_pct: pct, sites_pd_4_plus: pd4, sites_pd_6_plus: pd6, diagnosis }
}
