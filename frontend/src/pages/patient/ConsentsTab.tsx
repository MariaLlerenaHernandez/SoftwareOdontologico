import { useRef, useState } from 'react'
import { BadgeCheck, FileSignature, MessageSquareText, PenLine, Plus, Printer, ShieldX } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDateTime } from '../../lib/format'
import SignaturePad, { type SignaturePadHandle } from '../../components/SignaturePad'
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Field, Input, Modal, Notice, Segmented, Select, Spinner, Textarea, useToast } from '../../components/ui'

/** Consentimiento informado digital: firma biométrica u OTP (RF-06). */
export default function ConsentsTab({ patient, onChange }: { patient: any; onChange: () => void }) {
  const { data, loading, reload } = useFetch<any[]>(`/patients/${patient.id}/consents`)
  const { data: templates } = useFetch<any[]>('/catalog/consent-templates')
  const { data: staff } = useFetch<any[]>('/staff')
  const { can } = useAuth()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [tpl, setTpl] = useState('')
  const [dentist, setDentist] = useState('')
  const [extra, setExtra] = useState('')
  const [signing, setSigning] = useState<any | null>(null)
  const [viewing, setViewing] = useState<any | null>(null)
  const [revoking, setRevoking] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = () => (reload(), onChange())

  const create = async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await api.post(`/patients/${patient.id}/consents`, { template_id: Number(tpl), dentist_id: dentist ? Number(dentist) : undefined, extra })
      setCreating(false)
      setTpl('')
      setExtra('')
      await reload()
      onChange()
      const fresh = await api.get<any[]>(`/patients/${patient.id}/consents`)
      setSigning(fresh.find((c) => c.id === r.id))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {can('recepcion', 'odontologo', 'asistente') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Generar consentimiento</Button>}
      </div>
      <Card padded={false}>
        {!data?.length ? (
          <Empty icon={<FileSignature className="size-5" />} title="Sin consentimientos informados" />
        ) : (
          <table className="table-base">
            <thead><tr><th>Documento</th><th>Generado</th><th>Estado</th><th>Firma</th><th /></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-slate-800">{c.title}</td>
                  <td className="text-slate-600">{fmtDateTime(c.created_at)}<p className="text-xs text-slate-400">{c.created_by_name}</p></td>
                  <td>
                    <Badge tone={c.status === 'firmado' ? 'emerald' : c.status === 'pendiente' ? 'amber' : 'rose'}>
                      {c.status === 'firmado' ? 'Firmado' : c.status === 'pendiente' ? 'Pendiente de firma' : 'Revocado'}
                    </Badge>
                  </td>
                  <td className="text-xs text-slate-600">
                    {c.signed_at ? (
                      <>
                        {c.method === 'otp' ? 'Código OTP' : 'Firma manuscrita'} · {c.signer_name}
                        <p className="text-slate-400">{fmtDateTime(c.signed_at)} · IP {c.signed_ip}</p>
                      </>
                    ) : '—'}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {c.status === 'pendiente' && can('recepcion', 'odontologo', 'asistente') && (
                      <Button size="sm" icon={<PenLine className="size-3.5" />} onClick={() => setSigning(c)}>Firmar</Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={() => setViewing(c)}>Ver</Button>
                    {c.status === 'firmado' && can('odontologo') && (
                      <Button size="sm" variant="ghost" icon={<ShieldX className="size-3.5" />} onClick={() => setRevoking(c)}>Revocar</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Generar consentimiento informado"
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button><Button onClick={create} loading={saving} disabled={!tpl}>Generar y firmar</Button></>}>
        <div className="space-y-4">
          <ErrorBox message={error} />
          <Field label="Formato legal por procedimiento">
            <Select value={tpl} onChange={(e) => setTpl(e.target.value)}>
              <option value="">Seleccione…</option>
              {templates?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
          <Field label="Profesional responsable">
            <Select value={dentist} onChange={(e) => setDentist(e.target.value)}>
              <option value="">Usuario actual</option>
              {staff?.filter((s) => s.role === 'odontologo').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Detalle específico (opcional)"><Textarea value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ej.: exodoncia de piezas 18 y 28 bajo anestesia local" /></Field>
        </div>
      </Modal>

      <SignConsent consent={signing} patient={patient} onClose={() => setSigning(null)} onSigned={() => (setSigning(null), toast.success('Consentimiento firmado'), refresh())} />
      <ConsentView consent={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog open={!!revoking} onClose={() => setRevoking(null)} danger title="Revocar consentimiento" confirmLabel="Revocar"
        message="El paciente retira su autorización. El documento se conserva en el expediente con estado «revocado»."
        onConfirm={async () => {
          try {
            await api.post(`/consents/${revoking.id}/revoke`)
            toast.success('Consentimiento revocado')
            refresh()
          } catch (e: any) {
            toast.error(e.message)
          }
          setRevoking(null)
        }} />
    </div>
  )
}

function SignConsent({ consent, patient, onClose, onSigned }: { consent: any; patient: any; onClose: () => void; onSigned: () => void }) {
  const pad = useRef<SignaturePadHandle>(null)
  const [method, setMethod] = useState<'firma' | 'otp'>('firma')
  const [name, setName] = useState('')
  const [doc, setDoc] = useState('')
  const [otp, setOtp] = useState<{ sent_to: string; channel: string; demo_code: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastId, setLastId] = useState<number | null>(null)

  if (consent && consent.id !== lastId) {
    setLastId(consent.id)
    setName(patient.guardian_name ?? `${patient.first_name} ${patient.last_name}`)
    setDoc(patient.guardian_document ?? patient.document_number)
    setOtp(null)
    setCode('')
    setError(null)
  }
  if (!consent) return null

  const run = async (fn: () => Promise<any>) => {
    setSaving(true)
    setError(null)
    try {
      await fn()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const sign = () =>
    run(async () => {
      if (method === 'firma') {
        const data = pad.current?.toDataURL()
        if (!data) throw new Error('Capture la firma en el recuadro')
        await api.post(`/consents/${consent.id}/sign`, { signer_name: name, signer_document: doc, signature_data: data })
      } else {
        await api.post(`/consents/${consent.id}/verify-otp`, { signer_name: name, signer_document: doc, code })
      }
      onSigned()
    })

  return (
    <Modal open onClose={onClose} size="lg" title={consent.title} subtitle="Lea el documento con el paciente antes de firmar"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<BadgeCheck className="size-4" />} loading={saving} onClick={sign} disabled={method === 'otp' && (!otp || code.length !== 6)}>Firmar consentimiento</Button></>}>
      <div className="space-y-4">
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed whitespace-pre-line text-slate-700">{consent.body}</div>
        <ErrorBox message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre del firmante"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Documento del firmante"><Input value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
        </div>
        <Segmented value={method} onChange={setMethod} options={[{ id: 'firma', label: 'Firma en pantalla / tablet' }, { id: 'otp', label: 'Código OTP al paciente' }]} />
        {method === 'firma' ? (
          <SignaturePad ref={pad} />
        ) : (
          <div className="space-y-3">
            {!otp ? (
              <Button variant="outline" icon={<MessageSquareText className="size-4" />} loading={saving}
                onClick={() => run(async () => setOtp(await api.post(`/consents/${consent.id}/otp`)))}>
                Enviar código al paciente
              </Button>
            ) : (
              <>
                <Notice tone="emerald">
                  Código enviado por {otp.channel} a <strong>{otp.sent_to}</strong>. Vence en 10 minutos.
                  <span className="mt-1 block text-xs text-emerald-700/80">Modo demostración (gateway simulado): código <code className="rounded bg-white px-1 font-mono font-bold">{otp.demo_code}</code></span>
                </Notice>
                <Field label="Código recibido por el paciente">
                  <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-40 text-center font-mono text-lg tracking-[0.3em]" />
                </Field>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ConsentView({ consent, onClose }: { consent: any; onClose: () => void }) {
  const { settings } = useAuth()
  if (!consent) return null
  return (
    <Modal open onClose={onClose} size="md" title={consent.title} printable footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button></>}>
      <div className="text-sm text-slate-700">
        <div className="mb-4 border-b-2 border-brand-700 pb-3 text-center">
          <p className="text-lg font-bold text-brand-800">{settings.clinica_nombre}</p>
          <p className="font-semibold uppercase">{consent.title}</p>
        </div>
        <p className="leading-relaxed whitespace-pre-line">{consent.body}</p>
        {consent.status === 'firmado' ? (
          <div className="mt-8 text-center">
            {consent.signature_data && <img src={consent.signature_data} alt="Firma" className="mx-auto h-24" />}
            <div className="mx-auto w-72 border-t border-slate-400 pt-1 text-xs">
              {consent.signer_name} · Doc. {consent.signer_document}
              <br />
              Firmado {consent.method === 'otp' ? 'mediante código OTP' : 'de forma manuscrita digital'} el {fmtDateTime(consent.signed_at)} · IP {consent.signed_ip}
            </div>
          </div>
        ) : (
          <p className="mt-8 text-center text-xs text-amber-700">Documento pendiente de firma</p>
        )}
        {consent.status === 'revocado' && <p className="mt-4 text-center font-bold text-rose-700">CONSENTIMIENTO REVOCADO POR EL PACIENTE</p>}
      </div>
    </Modal>
  )
}
