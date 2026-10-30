import { useEffect, useState } from 'react'
import { AlertTriangle, Save } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDateTime } from '../../lib/format'
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Spinner, Textarea, useToast } from '../../components/ui'

const CRITICAL = [
  { k: 'penicillin_allergy', l: 'Alergia a penicilina' },
  { k: 'latex_allergy', l: 'Alergia al látex' },
  { k: 'anesthesia_allergy', l: 'Alergia a anestésicos locales' },
  { k: 'anticoagulated', l: 'Tratamiento anticoagulante' },
  { k: 'coagulopathy', l: 'Coagulopatía / trastorno de coagulación' },
  { k: 'heart_disease', l: 'Cardiopatía' },
]
const OTHER = [
  { k: 'diabetes', l: 'Diabetes' },
  { k: 'hypertension', l: 'Hipertensión arterial' },
  { k: 'pregnant', l: 'Embarazo' },
  { k: 'smoker', l: 'Fumador' },
]

/** Anamnesis y alertas médicas (RF-02). */
export default function HistoryTab({ patientId, onSaved }: { patientId: number; onSaved: () => void }) {
  const { data, loading, reload } = useFetch<any>(`/patients/${patientId}/history`)
  const { can } = useAuth()
  const [f, setF] = useState<any>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const editable = can('recepcion', 'odontologo', 'asistente')

  useEffect(() => {
    if (data) setF(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? ''])))
  }, [data])

  if (loading || !data) return <Spinner />
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))
  const toggle = (k: string) => (v: boolean) => setF((x: any) => ({ ...x, [k]: v }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.put(`/patients/${patientId}/history`, f)
      toast.success('Anamnesis actualizada')
      reload()
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title="Historia médica general"
      subtitle={data.exists ? `Última actualización: ${fmtDateTime(data.updated_at)} por ${data.updated_by_name ?? '—'}` : 'Registro obligatorio antes de iniciar tratamientos'}
      actions={
        editable && (
          <Button icon={<Save className="size-4" />} onClick={save} loading={saving}>
            Guardar anamnesis
          </Button>
        )
      }
    >
      <fieldset disabled={!editable} className="space-y-6">
        <ErrorBox message={error} />
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-700">
            <AlertTriangle className="size-4" /> Condiciones críticas (generan alerta en el expediente)
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CRITICAL.map((c) => (
              <Checkbox key={c.k} tone="rose" label={c.l} checked={!!f[c.k]} onChange={toggle(c.k)} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">Otras condiciones</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {OTHER.map((c) => (
              <Checkbox key={c.k} label={c.l} checked={!!f[c.k]} onChange={toggle(c.k)} />
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Enfermedades sistémicas"><Textarea value={f.systemic_diseases} onChange={set('systemic_diseases')} placeholder="Ej.: hipotiroidismo, asma, VIH…" /></Field>
          <Field label="Alergias a fármacos / materiales" hint="Se verifican automáticamente al emitir recetas"><Textarea value={f.allergies} onChange={set('allergies')} placeholder="Ej.: penicilina, ibuprofeno, látex…" /></Field>
          <Field label="Medicación actual"><Textarea value={f.medications} onChange={set('medications')} /></Field>
          <Field label="Antecedentes quirúrgicos"><Textarea value={f.surgical_history} onChange={set('surgical_history')} /></Field>
          <Field label="Otras observaciones clínicas" className="md:col-span-2"><Textarea value={f.other_conditions} onChange={set('other_conditions')} /></Field>
        </div>
        {data.alerts?.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Alertas activas:</span>
            {data.alerts.map((a: string) => (
              <Badge key={a} tone="rose">{a}</Badge>
            ))}
          </div>
        )}
      </fieldset>
    </Card>
  )
}
