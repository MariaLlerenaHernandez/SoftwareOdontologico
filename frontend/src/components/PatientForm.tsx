import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useFetch } from '../lib/hooks'
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea, useToast } from './ui'

const EMPTY = {
  first_name: '', last_name: '', document_type: 'cedula', document_number: '', birth_date: '', sex: 'F',
  email: '', phone: '', address: '', city: 'Quito', occupation: '',
  emergency_name: '', emergency_phone: '', emergency_relation: '',
  guardian_name: '', guardian_document: '', guardian_phone: '', guardian_relation: '',
  insurance_id: '' as any, insurance_number: '', preferred_channel: 'whatsapp', notes: '', active: true,
}

function ageOf(d: string) {
  if (!d) return null
  const b = new Date(d + 'T00:00:00')
  const n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--
  return a
}

/** Ficha única del paciente (RF-01). */
export default function PatientForm({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: any; onSaved: (id: number) => void }) {
  const [f, setF] = useState<any>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const { data: insurances } = useFetch<any[]>(open ? '/catalog/insurances' : null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setF(patient ? { ...EMPTY, ...Object.fromEntries(Object.entries(patient).map(([k, v]) => [k, v ?? ''])) } : EMPTY)
  }, [open, patient])

  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))
  const age = ageOf(f.birth_date)
  const minor = age !== null && age < 18

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body = { ...f, insurance_id: f.insurance_id ? Number(f.insurance_id) : null }
      const r = patient ? await api.put(`/patients/${patient.id}`, body) : await api.post('/patients', body)
      toast.success(patient ? 'Ficha del paciente actualizada' : `Paciente registrado (${r.record_number})`)
      onSaved(r.id)
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
      title={patient ? 'Editar ficha del paciente' : 'Registrar nuevo paciente'}
      subtitle="Los campos marcados con * son obligatorios"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            {patient ? 'Guardar cambios' : 'Registrar paciente'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ErrorBox message={error} />
        <Section title="Datos demográficos">
          <Field label="Nombres *"><Input value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Apellidos *"><Input value={f.last_name} onChange={set('last_name')} /></Field>
          <Field label="Tipo de documento">
            <Select value={f.document_type} onChange={set('document_type')}>
              <option value="cedula">Cédula</option>
              <option value="pasaporte">Pasaporte</option>
              <option value="ruc">RUC</option>
            </Select>
          </Field>
          <Field label="Número de documento *"><Input value={f.document_number} onChange={set('document_number')} /></Field>
          <Field label="Fecha de nacimiento *" hint={age !== null ? `${age} años` : undefined}>
            <Input type="date" value={f.birth_date?.slice(0, 10)} onChange={set('birth_date')} max={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Sexo *">
            <Select value={f.sex} onChange={set('sex')}>
              <option value="F">Femenino</option>
              <option value="M">Masculino</option>
              <option value="O">Otro</option>
            </Select>
          </Field>
          <Field label="Ocupación"><Input value={f.occupation} onChange={set('occupation')} /></Field>
          <Field label="Ciudad"><Input value={f.city} onChange={set('city')} /></Field>
          <Field label="Dirección" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        </Section>

        <Section title="Contacto y notificaciones">
          <Field label="Teléfono móvil"><Input value={f.phone} onChange={set('phone')} placeholder="+593 99 000 0000" /></Field>
          <Field label="Correo electrónico"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Canal preferido para recordatorios">
            <Select value={f.preferred_channel} onChange={set('preferred_channel')}>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Correo electrónico</option>
            </Select>
          </Field>
        </Section>

        <Section title="Contacto de emergencia">
          <Field label="Nombre"><Input value={f.emergency_name} onChange={set('emergency_name')} /></Field>
          <Field label="Teléfono"><Input value={f.emergency_phone} onChange={set('emergency_phone')} /></Field>
          <Field label="Parentesco"><Input value={f.emergency_relation} onChange={set('emergency_relation')} /></Field>
        </Section>

        <Section title={`Tutor legal ${minor ? '* (paciente menor de edad)' : '(solo menores de edad)'}`}>
          {minor && (
            <div className="sm:col-span-3">
              <Notice tone="amber">El paciente tiene {age} años. Es obligatorio registrar a su representante legal.</Notice>
            </div>
          )}
          <Field label="Nombre del tutor"><Input value={f.guardian_name} onChange={set('guardian_name')} disabled={!minor && !f.guardian_name} /></Field>
          <Field label="Documento del tutor"><Input value={f.guardian_document} onChange={set('guardian_document')} disabled={!minor && !f.guardian_document} /></Field>
          <Field label="Teléfono"><Input value={f.guardian_phone} onChange={set('guardian_phone')} disabled={!minor && !f.guardian_phone} /></Field>
          <Field label="Relación"><Input value={f.guardian_relation} onChange={set('guardian_relation')} disabled={!minor && !f.guardian_relation} placeholder="Madre, padre…" /></Field>
        </Section>

        <Section title="Seguro dental / convenio">
          <Field label="Aseguradora">
            <Select value={f.insurance_id ?? ''} onChange={set('insurance_id')}>
              <option value="">Sin seguro</option>
              {insurances?.filter((i) => i.active).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} {i.coverage_pct > 0 ? `(${i.coverage_pct}% cobertura)` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="N.º de póliza / afiliación"><Input value={f.insurance_number} onChange={set('insurance_number')} /></Field>
        </Section>

        <Field label="Observaciones administrativas"><Textarea value={f.notes} onChange={set('notes')} rows={2} /></Field>
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-semibold tracking-wide text-brand-800 uppercase">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-3">{children}</div>
    </fieldset>
  )
}
