import { useState } from 'react'
import { AlertTriangle, Pill, Plus, Printer, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, Spinner, Textarea, useToast } from '../../components/ui'

const blank = () => ({ medicamento: '', dosis: '', frecuencia: '', duracion: '' })
const COMMON = ['Amoxicilina 500 mg', 'Clindamicina 300 mg', 'Ibuprofeno 400 mg', 'Paracetamol 500 mg', 'Ketorolaco 10 mg', 'Clorhexidina 0.12% enjuague', 'Azitromicina 500 mg']

/** Recetas odontológicas con verificación de alergias. */
export default function PrescriptionsTab({ patient }: { patient: any }) {
  const { data, loading, reload } = useFetch<any[]>(`/patients/${patient.id}/prescriptions`)
  const { can } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([blank()])
  const [diagnosis, setDiagnosis] = useState('')
  const [indications, setIndications] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState<any | null>(null)

  const save = async (override = false) => {
    setSaving(true)
    setError(null)
    try {
      const r = await api.post(`/patients/${patient.id}/prescriptions`, { diagnosis, items, indications, override_allergy: override })
      toast.success('Receta emitida')
      setOpen(false)
      setItems([blank()])
      setDiagnosis('')
      setIndications('')
      setConflict(null)
      reload()
      setPrinting({ ...r, dentist_name: undefined })
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'allergy_conflict') setConflict(e.message)
      else setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const upd = (i: number, k: string, v: string) => setItems((x) => x.map((it, j) => (j === i ? { ...it, [k]: v } : it)))

  if (loading && !data) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {can('odontologo') && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Nueva receta</Button>}
      </div>
      <Card padded={false}>
        {!data?.length ? (
          <Empty icon={<Pill className="size-5" />} title="Sin recetas emitidas" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700"><Pill className="size-5" /></div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-slate-800">{r.diagnosis ?? 'Receta'} </p>
                  <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)} · {r.dentist_name}</p>
                  <ul className="mt-2 space-y-0.5 text-slate-700">
                    {r.items.map((it: any, i: number) => (
                      <li key={i}>• <strong>{it.medicamento}</strong> — {it.dosis} {it.frecuencia} por {it.duracion}</li>
                    ))}
                  </ul>
                </div>
                <Button size="sm" variant="secondary" icon={<Printer className="size-3.5" />} onClick={() => setPrinting(r)}>Imprimir</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Emitir receta odontológica"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save(false)} loading={saving}>Emitir receta</Button></>}>
        <div className="space-y-4">
          {patient.alerts?.length > 0 && <Notice tone="rose" icon={<AlertTriangle className="size-4" />}>Alertas del paciente: <strong>{patient.alerts.join(' · ')}</strong></Notice>}
          <ErrorBox message={error} />
          {conflict && (
            <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> {conflict}</p>
              <p className="mt-1">Revise la prescripción. Si cuenta con criterio clínico documentado, puede emitirla bajo su responsabilidad.</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>Corregir</Button>
                <Button size="sm" variant="danger" loading={saving} onClick={() => save(true)}>Emitir de todos modos</Button>
              </div>
            </div>
          )}
          <Field label="Diagnóstico"><Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Ej.: Pulpitis irreversible pieza 36" /></Field>
          <div className="space-y-2">
            <p className="label">Medicamentos</p>
            <datalist id="meds">{COMMON.map((m) => <option key={m} value={m} />)}</datalist>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_32px] gap-2">
                <Input list="meds" placeholder="Medicamento y concentración" value={it.medicamento} onChange={(e) => upd(i, 'medicamento', e.target.value)} />
                <Input placeholder="Dosis" value={it.dosis} onChange={(e) => upd(i, 'dosis', e.target.value)} />
                <Input placeholder="Frecuencia" value={it.frecuencia} onChange={(e) => upd(i, 'frecuencia', e.target.value)} />
                <Input placeholder="Duración" value={it.duracion} onChange={(e) => upd(i, 'duracion', e.target.value)} />
                <button className="text-slate-400 hover:text-rose-600" onClick={() => setItems((x) => x.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setItems((x) => [...x, blank()])}>Agregar medicamento</Button>
          </div>
          <Field label="Indicaciones generales"><Textarea value={indications} onChange={(e) => setIndications(e.target.value)} /></Field>
        </div>
      </Modal>

      <RxPrint rx={printing} patient={patient} onClose={() => setPrinting(null)} />
    </div>
  )
}

function RxPrint({ rx, patient, onClose }: { rx: any; patient: any; onClose: () => void }) {
  const { settings, user } = useAuth()
  if (!rx) return null
  return (
    <Modal open onClose={onClose} size="md" title="Receta" printable footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button></>}>
      <div className="text-sm text-slate-700">
        <div className="border-b-2 border-brand-700 pb-3 text-center">
          <p className="text-lg font-bold text-brand-800">{settings.clinica_nombre}</p>
          <p className="text-xs text-slate-500">{settings.clinica_direccion} · {settings.clinica_telefono}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-1 text-xs">
          <p><strong>Paciente:</strong> {patient.first_name} {patient.last_name}</p>
          <p className="text-right"><strong>Fecha:</strong> {fmtDate(rx.created_at)}</p>
          <p><strong>Edad:</strong> {patient.age} años · <strong>Doc.:</strong> {patient.document_number}</p>
          <p className="text-right"><strong>Receta N.º</strong> {String(rx.id).padStart(6, '0')}</p>
          {rx.diagnosis && <p className="col-span-2"><strong>Diagnóstico:</strong> {rx.diagnosis}</p>}
          {patient.alerts?.length > 0 && <p className="col-span-2 text-rose-700"><strong>Alergias / alertas:</strong> {patient.alerts.join(', ')}</p>}
        </div>
        <p className="mt-5 font-serif text-3xl text-brand-800 italic">Rp/</p>
        <ol className="mt-2 list-decimal space-y-3 pl-6">
          {rx.items.map((it: any, i: number) => (
            <li key={i}><p className="font-semibold">{it.medicamento}</p><p className="text-xs">Tomar {it.dosis} {it.frecuencia} durante {it.duracion}.</p></li>
          ))}
        </ol>
        {rx.indications && <p className="mt-5 text-xs"><strong>Indicaciones:</strong> {rx.indications}</p>}
        <div className="mx-auto mt-16 w-60 border-t border-slate-400 pt-1 text-center text-xs">
          {rx.dentist_name ?? user?.full_name}<br />{rx.license_number && `Reg. ${rx.license_number}`}
        </div>
      </div>
    </Modal>
  )
}
