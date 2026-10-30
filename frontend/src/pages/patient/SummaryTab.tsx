import { useState } from 'react'
import { HeartPulse, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { Button, Card, Empty, ErrorBox, Field, Input, Modal, Textarea, useToast } from '../../components/ui'

export default function SummaryTab({ patient: p }: { patient: any }) {
  const { can } = useAuth()
  const clinical = can('admin', 'odontologo', 'asistente')
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <Card title="Ficha del paciente">
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Item label="Fecha de nacimiento" value={fmtDate(p.birth_date)} />
          <Item label="Ocupación" value={p.occupation} />
          <Item label="Teléfono" value={p.phone} />
          <Item label="Correo" value={p.email} />
          <Item label="Dirección" value={[p.address, p.city].filter(Boolean).join(', ')} />
          <Item label="Canal de recordatorios" value={{ whatsapp: 'WhatsApp', sms: 'SMS', email: 'Correo' }[p.preferred_channel as string]} />
          <Item label="Contacto de emergencia" value={p.emergency_name && `${p.emergency_name} (${p.emergency_relation ?? '—'}) · ${p.emergency_phone ?? ''}`} />
          <Item label="Seguro / convenio" value={p.insurance_name && `${p.insurance_name}${p.insurance_number ? ` · ${p.insurance_number}` : ''}`} />
          {p.guardian_name && (
            <Item label="Tutor legal" value={`${p.guardian_name} (${p.guardian_relation ?? 'representante'}) · Doc. ${p.guardian_document} · ${p.guardian_phone ?? ''}`} />
          )}
          <Item label="Registrado" value={fmtDateTime(p.created_at)} />
          {p.notes && <Item label="Observaciones" value={p.notes} />}
        </dl>
      </Card>
      {clinical && <VitalsCard patientId={p.id} />}
    </div>
  )
}

function Item({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value || '—'}</dd>
    </div>
  )
}

function VitalsCard({ patientId }: { patientId: number }) {
  const { data, reload } = useFetch<any[]>(`/patients/${patientId}/vitals`)
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<any>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body: any = { notes: f.notes ?? '' }
      ;['systolic', 'diastolic', 'heart_rate', 'resp_rate', 'spo2', 'glucose'].forEach((k) => f[k] && (body[k] = parseInt(f[k])))
      ;['temperature', 'weight'].forEach((k) => f[k] && (body[k] = parseFloat(f[k])))
      await api.post(`/patients/${patientId}/vitals`, body)
      toast.success('Signos vitales registrados')
      setOpen(false)
      setF({})
      reload()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const bpTone = (s?: number) => (s && s >= 140 ? 'text-rose-600 font-semibold' : '')

  return (
    <Card
      title="Signos vitales"
      subtitle="Registrados por el personal clínico antes de la atención"
      actions={
        can('odontologo', 'asistente') && (
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
            Registrar
          </Button>
        )
      }
      padded={false}
    >
      {!data?.length ? (
        <Empty icon={<HeartPulse className="size-5" />} title="Sin registros de signos vitales" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>PA (mmHg)</th>
                <th>FC</th>
                <th>FR</th>
                <th>T °C</th>
                <th>SpO₂</th>
                <th>Peso</th>
                <th>Registró</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id}>
                  <td className="text-slate-600">{fmtDateTime(v.taken_at)}</td>
                  <td className={bpTone(v.systolic)}>{v.systolic ? `${v.systolic}/${v.diastolic}` : '—'}</td>
                  <td>{v.heart_rate ?? '—'}</td>
                  <td>{v.resp_rate ?? '—'}</td>
                  <td>{v.temperature ?? '—'}</td>
                  <td>{v.spo2 ? `${v.spo2}%` : '—'}</td>
                  <td>{v.weight ? `${v.weight} kg` : '—'}</td>
                  <td className="text-xs text-slate-500">{v.taken_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Registrar signos vitales"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={saving}>
              Guardar
            </Button>
          </>
        }
      >
        <ErrorBox message={error} />
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Field label="PA sistólica"><Input type="number" value={f.systolic ?? ''} onChange={set('systolic')} /></Field>
          <Field label="PA diastólica"><Input type="number" value={f.diastolic ?? ''} onChange={set('diastolic')} /></Field>
          <Field label="Frec. cardíaca"><Input type="number" value={f.heart_rate ?? ''} onChange={set('heart_rate')} /></Field>
          <Field label="Frec. respiratoria"><Input type="number" value={f.resp_rate ?? ''} onChange={set('resp_rate')} /></Field>
          <Field label="Temperatura °C"><Input type="number" step="0.1" value={f.temperature ?? ''} onChange={set('temperature')} /></Field>
          <Field label="SpO₂ %"><Input type="number" value={f.spo2 ?? ''} onChange={set('spo2')} /></Field>
          <Field label="Peso kg"><Input type="number" step="0.1" value={f.weight ?? ''} onChange={set('weight')} /></Field>
          <Field label="Glucemia mg/dL"><Input type="number" value={f.glucose ?? ''} onChange={set('glucose')} /></Field>
          <Field label="Observaciones" className="sm:col-span-4"><Textarea value={f.notes ?? ''} onChange={set('notes')} rows={2} /></Field>
        </div>
      </Modal>
    </Card>
  )
}
