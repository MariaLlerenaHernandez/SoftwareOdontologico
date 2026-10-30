import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, History, Plus } from 'lucide-react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { APPT_NEXT, APPT_STATUS, addDays, fmtDateTime, fmtTime, isoDate, startOfWeek } from '../lib/format'
import AppointmentForm, { type ApptInitial } from '../components/AppointmentForm'
import { Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Segmented, Select, Spinner, Textarea, cx, useToast } from '../components/ui'

const START_H = 7
const END_H = 21
const PX_H = 64

/** Agenda multirrecinto por sillón y profesional (RF-09, RF-10). */
export default function Agenda() {
  const { user, can } = useAuth()
  const [view, setView] = useState<'dia' | 'semana'>('dia')
  const [date, setDate] = useState(() => new Date())
  const [office, setOffice] = useState('')
  const [dentist, setDentist] = useState(user?.role === 'odontologo' ? String(user.id) : '')
  const [creating, setCreating] = useState<ApptInitial | null>(null)
  const [detail, setDetail] = useState<any | null>(null)

  const from = view === 'dia' ? isoDate(date) : isoDate(startOfWeek(date))
  const to = view === 'dia' ? from : isoDate(addDays(startOfWeek(date), 5))
  const { data: chairs } = useFetch<any[]>('/catalog/chairs')
  const { data: staff } = useFetch<any[]>('/staff')
  const { data: appts, loading, reload } = useFetch<any[]>(`/appointments${qs({ from, to, office_id: office, dentist_id: dentist })}`)

  const offices = useMemo(() => Array.from(new Map((chairs ?? []).map((c) => [c.office_id, c.office_name])).entries()), [chairs])
  const visibleChairs = (chairs ?? []).filter((c) => c.active && (!office || String(c.office_id) === office))
  const canCreate = can('admin', 'recepcion', 'odontologo')
  const step = (n: number) => setDate((d) => addDays(d, view === 'dia' ? n : n * 7))

  return (
    <div>
      <PageHeader
        title="Agenda médica"
        subtitle="Programación por consultorio, sillón dental y profesional"
        icon={<CalendarDays className="size-5" />}
        actions={canCreate && <Button icon={<Plus className="size-4" />} onClick={() => setCreating({ dentist_id: dentist ? Number(dentist) : undefined })}>Nueva cita</Button>}
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft className="size-4" /></Button>
            <Button variant="secondary" size="sm" onClick={() => setDate(new Date())}>Hoy</Button>
            <Button variant="secondary" size="sm" onClick={() => step(1)} aria-label="Siguiente"><ChevronRight className="size-4" /></Button>
          </div>
          <h2 className="min-w-56 text-sm font-semibold text-slate-800 first-letter:uppercase">
            {view === 'dia'
              ? date.toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
              : `Semana del ${startOfWeek(date).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })} al ${addDays(startOfWeek(date), 5).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </h2>
          <input type="date" className="input w-auto py-1.5" value={isoDate(date)} onChange={(e) => e.target.value && setDate(new Date(e.target.value + 'T12:00:00'))} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select className="w-auto py-1.5" value={office} onChange={(e) => setOffice(e.target.value)}>
              <option value="">Todas las sedes</option>
              {offices.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
            <Select className="w-auto py-1.5" value={dentist} onChange={(e) => setDentist(e.target.value)}>
              <option value="">Todos los profesionales</option>
              {staff?.filter((s) => s.role === 'odontologo').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
            <Segmented value={view} onChange={setView} options={[{ id: 'dia', label: 'Día' }, { id: 'semana', label: 'Semana' }]} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-b border-slate-100 px-4 py-2 text-xs">
          {Object.entries(APPT_STATUS).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5 text-slate-600"><span className={`size-2 rounded-full ${v.dot}`} />{v.label}</span>
          ))}
        </div>

        {loading && !appts ? (
          <Spinner />
        ) : view === 'dia' ? (
          <DayGrid date={date} chairs={visibleChairs} appts={appts ?? []} onSlot={canCreate ? (chair, start) => setCreating({ chair_id: chair, start, dentist_id: dentist ? Number(dentist) : undefined }) : undefined} onOpen={setDetail} />
        ) : (
          <WeekGrid start={startOfWeek(date)} appts={appts ?? []} onOpen={setDetail} onDay={(d) => (setDate(d), setView('dia'))} />
        )}
      </Card>

      <AppointmentForm open={!!creating} initial={creating ?? undefined} onClose={() => setCreating(null)} onSaved={() => (setCreating(null), reload())} />
      <AppointmentDetail appt={detail} onClose={() => setDetail(null)} onChanged={(a) => (setDetail(a), reload())} />
    </div>
  )
}

function DayGrid({ date, chairs, appts, onSlot, onOpen }: { date: Date; chairs: any[]; appts: any[]; onSlot?: (chair: number, start: Date) => void; onOpen: (a: any) => void }) {
  if (!chairs.length) return <Empty title="No hay sillones activos para la sede seleccionada" />
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i)
  const now = new Date()
  const isToday = isoDate(now) === isoDate(date)
  const nowTop = ((now.getHours() - START_H) * 60 + now.getMinutes()) * (PX_H / 60)

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-slate-100 bg-white">
          <div className="h-11 border-b border-slate-100" />
          {hours.map((h) => (
            <div key={h} style={{ height: PX_H }} className="pr-2 text-right text-[11px] text-slate-400 tabular-nums">
              <span className="relative -top-2">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>
        {chairs.map((c) => {
          const list = appts.filter((a) => a.chair_id === c.id)
          return (
            <div key={c.id} className="w-56 shrink-0 border-r border-slate-100 last:border-r-0">
              <div className="sticky top-0 flex h-11 flex-col justify-center border-b border-slate-100 bg-slate-50/80 px-3">
                <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                <p className="text-[11px] text-slate-500">{c.office_name}</p>
              </div>
              <div
                className={cx('relative', onSlot && 'cursor-copy')}
                style={{ height: hours.length * PX_H }}
                onClick={(e) => {
                  if (!onSlot || e.target !== e.currentTarget) return
                  const y = e.nativeEvent.offsetY
                  const mins = Math.floor((y / PX_H) * 60 / 15) * 15
                  const d = new Date(date)
                  d.setHours(START_H, 0, 0, 0)
                  d.setMinutes(mins)
                  onSlot(c.id, d)
                }}
              >
                {hours.map((h) => (
                  <div key={h} style={{ top: (h - START_H) * PX_H, height: PX_H }} className="pointer-events-none absolute inset-x-0 border-b border-slate-100">
                    <div className="absolute inset-x-0 top-1/2 border-b border-dashed border-slate-50" />
                  </div>
                ))}
                {isToday && nowTop > 0 && nowTop < hours.length * PX_H && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-rose-500" style={{ top: nowTop }} />
                )}
                {list.map((a) => {
                  const s = new Date(a.starts_at)
                  const e = new Date(a.ends_at)
                  const top = ((s.getHours() - START_H) * 60 + s.getMinutes()) * (PX_H / 60)
                  const height = Math.max(22, ((+e - +s) / 60000) * (PX_H / 60) - 2)
                  const st = APPT_STATUS[a.status]
                  return (
                    <button
                      key={a.id}
                      onClick={() => onOpen(a)}
                      style={{ top, height, borderLeftColor: a.dentist_color }}
                      className={cx('absolute inset-x-1 overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left shadow-xs transition hover:z-20 hover:shadow-md', st.cls)}
                    >
                      <p className="flex items-center gap-1 truncate text-xs font-semibold">
                        {a.has_alerts && <AlertTriangle className="size-3 shrink-0 text-rose-600" />}
                        {a.patient_name}
                      </p>
                      {height > 34 && <p className="truncate text-[11px] opacity-80">{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)} · {a.reason}</p>}
                      {height > 52 && <p className="truncate text-[11px] opacity-70">{a.dentist_name}</p>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekGrid({ start, appts, onOpen, onDay }: { start: Date; appts: any[]; onOpen: (a: any) => void; onDay: (d: Date) => void }) {
  const days = Array.from({ length: 6 }, (_, i) => addDays(start, i))
  return (
    <div className="grid min-h-[480px] grid-cols-1 divide-y divide-slate-100 md:grid-cols-6 md:divide-x md:divide-y-0">
      {days.map((d) => {
        const list = appts.filter((a) => isoDate(new Date(a.starts_at)) === isoDate(d))
        const today = isoDate(d) === isoDate(new Date())
        return (
          <div key={d.toISOString()} className="p-2">
            <button onClick={() => onDay(d)} className={cx('mb-2 w-full rounded-lg px-2 py-1.5 text-left', today ? 'bg-brand-700 text-white' : 'hover:bg-slate-50')}>
              <p className="text-xs capitalize opacity-80">{d.toLocaleDateString('es-EC', { weekday: 'long' })}</p>
              <p className="text-lg leading-tight font-semibold">{d.getDate()}</p>
            </button>
            <div className="space-y-1.5">
              {list.length === 0 && <p className="px-2 text-xs text-slate-400">Sin citas</p>}
              {list.map((a) => (
                <button key={a.id} onClick={() => onOpen(a)} style={{ borderLeftColor: a.dentist_color }} className={cx('w-full rounded-md border border-l-4 px-2 py-1 text-left', APPT_STATUS[a.status].cls)}>
                  <p className="text-[11px] font-semibold tabular-nums">{fmtTime(a.starts_at)} · {a.chair_name}</p>
                  <p className="truncate text-xs">{a.patient_name}</p>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  confirmado: 'Confirmar asistencia',
  en_espera: 'Registrar llegada',
  en_atencion: 'Iniciar atención',
  atendido: 'Finalizar atención',
  cancelado: 'Cancelar cita',
  no_asistio: 'Marcar no asistió',
}

function AppointmentDetail({ appt, onClose, onChanged }: { appt: any; onClose: () => void; onChanged: (a: any) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { data: log } = useFetch<any[]>(appt ? `/appointments/${appt.id}/log` : null, [appt?.status])
  if (!appt) return null
  const st = APPT_STATUS[appt.status]
  const next = (APPT_NEXT[appt.status] ?? []).filter((s) => !['en_atencion', 'atendido'].includes(s) || can('odontologo', 'asistente', 'admin'))

  const change = async (status: string) => {
    if (status === 'cancelado' && !cancelling) return setCancelling(true)
    setBusy(status)
    setError(null)
    try {
      const r = await api.post(`/appointments/${appt.id}/status`, { status, reason })
      toast.success(`Cita: ${APPT_STATUS[status].label}`)
      setCancelling(false)
      setReason('')
      onChanged(r)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Modal open={!editing} onClose={onClose} title={appt.patient_name} subtitle={`${appt.record_number} · ${appt.patient_phone ?? ''}`}
        footer={<>{['programado', 'confirmado'].includes(appt.status) && can('admin', 'recepcion', 'odontologo') && <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setEditing(true)}>Reprogramar</Button>}<Link to={`/pacientes/${appt.patient_id}`}><Button variant="outline">Abrir expediente</Button></Link></>}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-medium ${st.cls}`}>{st.label}</span>
            {appt.has_alerts && <span className="flex items-center gap-1 text-sm font-medium text-rose-600"><AlertTriangle className="size-4" /> Paciente con alerta médica</span>}
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Horario</dt><dd className="font-medium">{fmtDateTime(appt.starts_at)} – {fmtTime(appt.ends_at)}</dd></div>
            <div><dt className="text-xs text-slate-500">Profesional</dt><dd className="font-medium">{appt.dentist_name}</dd></div>
            <div><dt className="text-xs text-slate-500">Sillón</dt><dd className="font-medium">{appt.chair_name} · {appt.office_name}</dd></div>
            <div><dt className="text-xs text-slate-500">Motivo</dt><dd className="font-medium">{appt.reason ?? '—'}</dd></div>
            {appt.plan_item_name && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Procedimiento del plan</dt><dd className="font-medium">{appt.plan_item_name}</dd></div>}
            {appt.notes && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Notas</dt><dd>{appt.notes}</dd></div>}
            {appt.cancel_reason && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Motivo de cancelación</dt><dd>{appt.cancel_reason}</dd></div>}
          </dl>
          <ErrorBox message={error} />
          {next.length > 0 && (
            <div>
              <p className="label">Cambiar estado</p>
              <div className="flex flex-wrap gap-2">
                {next.map((s) => (
                  <Button key={s} size="sm" variant={s === 'cancelado' || s === 'no_asistio' ? 'secondary' : 'primary'} loading={busy === s} onClick={() => change(s)}>
                    {ACTION_LABEL[s]}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {cancelling && (
            <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
              <Field label="Motivo de la cancelación"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setCancelling(false)}>Volver</Button>
                <Button size="sm" variant="danger" loading={busy === 'cancelado'} onClick={() => change('cancelado')}>Confirmar cancelación</Button>
              </div>
            </div>
          )}
          {!!log?.length && (
            <div>
              <p className="label flex items-center gap-1"><History className="size-3.5" /> Trazabilidad de estados</p>
              <ol className="space-y-1 text-xs text-slate-600">
                {log.map((l) => (
                  <li key={l.id}>{fmtDateTime(l.changed_at)} — {l.from_status ? `${APPT_STATUS[l.from_status]?.label} → ` : ''}<strong>{APPT_STATUS[l.to_status]?.label}</strong> · {l.changed_by_name}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </Modal>
      <AppointmentForm open={editing} appointment={appt} onClose={() => setEditing(false)} onSaved={(a) => (setEditing(false), onChanged(a))} />
    </>
  )
}
