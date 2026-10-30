import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useFetch } from '../lib/hooks'
import { isoDate } from '../lib/format'
import PatientPicker, { type PickedPatient } from './PatientPicker'
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Notice, Select, Textarea, useToast } from './ui'

export interface ApptInitial {
  patient?: PickedPatient | null
  dentist_id?: number
  chair_id?: number
  start?: Date
  duration?: number
  reason?: string
  plan_item_id?: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Alta y reprogramación de citas con validación de sillón (RN-03). */
export default function AppointmentForm({ open, onClose, initial, appointment, onSaved }: { open: boolean; onClose: () => void; initial?: ApptInitial; appointment?: any; onSaved: (a: any) => void }) {
  const { data: staff } = useFetch<any[]>(open ? '/staff' : null)
  const { data: chairs } = useFetch<any[]>(open ? '/catalog/chairs' : null)
  const toast = useToast()
  const [patient, setPatient] = useState<PickedPatient | null>(null)
  const [f, setF] = useState<any>({})
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (appointment) {
      const s = new Date(appointment.starts_at)
      const e = new Date(appointment.ends_at)
      setPatient({ id: appointment.patient_id, first_name: appointment.patient_name, last_name: '', document_number: '', record_number: appointment.record_number })
      setF({ dentist_id: appointment.dentist_id, chair_id: appointment.chair_id, date: isoDate(s), time: hhmm(s), duration: Math.round((+e - +s) / 60000), reason: appointment.reason ?? '', notes: appointment.notes ?? '' })
    } else {
      const s = initial?.start ?? nextSlot()
      setPatient(initial?.patient ?? null)
      setF({ dentist_id: initial?.dentist_id ?? '', chair_id: initial?.chair_id ?? '', date: isoDate(s), time: hhmm(s), duration: initial?.duration ?? 30, reason: initial?.reason ?? '', notes: '' })
    }
  }, [open, appointment, initial])

  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))
  const dentists = staff?.filter((u) => u.role === 'odontologo') ?? []

  const save = async () => {
    if (!patient) return setError('Seleccione un paciente')
    setSaving(true)
    setError(null)
    try {
      const start = new Date(`${f.date}T${f.time}:00`)
      const end = new Date(start.getTime() + Number(f.duration) * 60000)
      const body = {
        patient_id: patient.id,
        dentist_id: Number(f.dentist_id),
        chair_id: Number(f.chair_id),
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        reason: f.reason,
        notes: f.notes,
        plan_item_id: initial?.plan_item_id,
        notify,
      }
      const r = appointment ? await api.put(`/appointments/${appointment.id}`, body) : await api.post('/appointments', body)
      toast.success(appointment ? 'Cita reprogramada' : notify ? 'Cita agendada y confirmación enviada al paciente' : 'Cita agendada')
      onSaved(r)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const offices = Array.from(new Map((chairs ?? []).map((c) => [c.office_id, c.office_name])).entries())

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={appointment ? 'Reprogramar cita' : 'Agendar cita'}
      subtitle="El sistema impide dos citas simultáneas en el mismo sillón (RN-03)"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} loading={saving}>{appointment ? 'Guardar cambios' : 'Agendar'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox message={error} />
        {initial?.plan_item_id && <Notice tone="emerald">Se agendará un procedimiento aprobado del plan de tratamiento.</Notice>}
        <Field label="Paciente">
          {appointment ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium">{appointment.patient_name}</div>
          ) : (
            <PatientPicker value={patient} onChange={setPatient} autoFocus={!initial?.patient} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Odontólogo">
            <Select value={f.dentist_id} onChange={set('dentist_id')}>
              <option value="">Seleccione…</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} {d.specialty ? `· ${d.specialty}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Consultorio / sillón">
            <Select value={f.chair_id} onChange={set('chair_id')}>
              <option value="">Seleccione…</option>
              {offices.map(([oid, oname]) => (
                <optgroup key={oid} label={oname}>
                  {chairs!.filter((c) => c.office_id === oid && c.active).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Fecha"><Input type="date" value={f.date ?? ''} onChange={set('date')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hora"><Input type="time" step={900} min="07:00" max="21:00" value={f.time ?? ''} onChange={set('time')} /></Field>
            <Field label="Duración">
              <Select value={f.duration} onChange={set('duration')}>
                {[15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180].map((m) => <option key={m} value={m}>{m} min</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Motivo" className="sm:col-span-2"><Input value={f.reason ?? ''} onChange={set('reason')} placeholder="Ej.: control, profilaxis, endodoncia pieza 36…" /></Field>
          <Field label="Notas internas" className="sm:col-span-2"><Textarea rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
        </div>
        {!appointment && <Checkbox label="Enviar confirmación automática al paciente (WhatsApp / SMS / correo)" checked={notify} onChange={setNotify} />}
      </div>
    </Modal>
  )
}

function nextSlot() {
  const d = new Date()
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
  if (d.getHours() < 7) d.setHours(8, 0)
  if (d.getHours() >= 20) {
    d.setDate(d.getDate() + 1)
    d.setHours(8, 0)
  }
  return d
}
