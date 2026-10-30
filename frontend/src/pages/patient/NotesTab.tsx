import { useState } from 'react'
import { BadgeCheck, Clock, FilePen, Lock, NotebookPen, Plus, Reply } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDateTime, ROLE_LABEL } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, Spinner, Textarea, useToast } from '../../components/ui'

const EMPTY = { subjective: '', objective: '', assessment: '', plan: '' }
const SOAP = [
  { k: 'subjective', l: 'S · Subjetivo', ph: 'Motivo de consulta y lo que refiere el paciente…' },
  { k: 'objective', l: 'O · Objetivo', ph: 'Hallazgos del examen clínico y radiográfico…' },
  { k: 'assessment', l: 'E · Evaluación', ph: 'Diagnóstico / impresión clínica (CIE-10)…' },
  { k: 'plan', l: 'P · Plan', ph: 'Procedimientos realizados, indicaciones y próximos pasos…' },
] as const

/** Bitácora inmutable de evolución SOEP con firma digital (RF-05, RN-01). */
export default function NotesTab({ patientId }: { patientId: number }) {
  const { data, loading, reload } = useFetch<any[]>(`/patients/${patientId}/notes`)
  const { can, settings } = useAuth()
  const toast = useToast()
  const [editor, setEditor] = useState<{ note?: any; parent?: any } | null>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [signing, setSigning] = useState<any | null>(null)
  const [password, setPassword] = useState('')

  const open = (opts: { note?: any; parent?: any }) => {
    setEditor(opts)
    setError(null)
    setForm(opts.note ? { subjective: opts.note.subjective ?? '', objective: opts.note.objective ?? '', assessment: opts.note.assessment ?? '', plan: opts.note.plan ?? '' } : EMPTY)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (editor?.note) await api.put(`/notes/${editor.note.id}`, form)
      else await api.post(`/patients/${patientId}/notes`, { ...form, parent_note_id: editor?.parent?.id })
      toast.success(editor?.parent ? 'Adenda registrada' : 'Nota guardada (pendiente de firma)')
      setEditor(null)
      reload()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const sign = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/notes/${signing.id}/sign`, { password })
      toast.success('Nota firmada digitalmente')
      setSigning(null)
      setPassword('')
      reload()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <Spinner />
  const notes = data ?? []
  const byParent = new Map<number, any[]>()
  notes.filter((n) => n.parent_note_id).forEach((n) => byParent.set(n.parent_note_id, [...(byParent.get(n.parent_note_id) ?? []), n]))
  const roots = notes.filter((n) => !n.parent_note_id)

  return (
    <div className="space-y-4">
      <Notice icon={<Lock className="size-4" />}>
        Las notas pueden editarse por su autor durante <strong>{settings.nota_bloqueo_horas ?? 24} horas</strong> o hasta ser firmadas. Después quedan bloqueadas y cualquier corrección debe registrarse
        como <strong>adenda</strong>.
      </Notice>
      <div className="flex justify-end">
        {can('odontologo', 'asistente') && (
          <Button icon={<Plus className="size-4" />} onClick={() => open({})}>
            Nueva nota de evolución
          </Button>
        )}
      </div>
      {roots.length === 0 ? (
        <Card>
          <Empty icon={<NotebookPen className="size-5" />} title="Sin notas de evolución" />
        </Card>
      ) : (
        <ol className="relative space-y-5 border-l-2 border-slate-200 pl-6">
          {roots.map((n) => (
            <li key={n.id} className="relative">
              <span className={`absolute top-4 -left-[33px] grid size-4 place-items-center rounded-full ring-4 ring-slate-50 ${n.signed_at ? 'bg-brand-600' : 'bg-amber-400'}`} />
              <NoteCard
                note={n}
                canSign={can('odontologo')}
                onEdit={() => open({ note: n })}
                onSign={() => (setSigning(n), setError(null))}
                onAddendum={can('odontologo', 'asistente') ? () => open({ parent: n }) : undefined}
              />
              {byParent.get(n.id)?.map((a) => (
                <div key={a.id} className="mt-3 ml-6 border-l-2 border-dashed border-violet-200 pl-4">
                  <NoteCard note={a} canSign={can('odontologo')} onEdit={() => open({ note: a })} onSign={() => (setSigning(a), setError(null))} />
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}

      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        size="lg"
        title={editor?.note ? 'Editar nota de evolución' : editor?.parent ? 'Registrar adenda' : 'Nueva nota de evolución (SOEP)'}
        subtitle={editor?.parent ? `Corrección / ampliación de la nota del ${fmtDateTime(editor.parent.created_at)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)}>Cancelar</Button>
            <Button onClick={save} loading={saving}>Guardar nota</Button>
          </>
        }
      >
        <div className="space-y-4">
          <ErrorBox message={error} />
          {SOAP.map((s) => (
            <Field key={s.k} label={s.l}>
              <Textarea rows={3} value={form[s.k]} placeholder={s.ph} onChange={(e) => setForm((f: any) => ({ ...f, [s.k]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!signing}
        onClose={() => setSigning(null)}
        size="sm"
        title="Firma digital del profesional"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSigning(null)}>Cancelar</Button>
            <Button onClick={sign} loading={saving} icon={<BadgeCheck className="size-4" />}>Firmar nota</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Confirme su identidad para firmar. Se generará una huella SHA-256 del contenido y la nota quedará bloqueada de forma permanente.</p>
          <ErrorBox message={error} />
          <Field label="Contraseña">
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sign()} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function NoteCard({ note: n, canSign, onEdit, onSign, onAddendum }: { note: any; canSign: boolean; onEdit: () => void; onSign: () => void; onAddendum?: () => void }) {
  const { user } = useAuth()
  const mine = n.author_id === user?.id
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            {n.note_type === 'adenda' ? <Badge tone="violet">Adenda</Badge> : <Badge tone="brand">Evolución</Badge>}
            {fmtDateTime(n.created_at)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {n.author_name} · {ROLE_LABEL[n.author_role]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {n.signed_at ? (
            <Badge tone="emerald">
              <BadgeCheck className="size-3.5" /> Firmada
            </Badge>
          ) : n.editable ? (
            <Badge tone="amber">
              <Clock className="size-3.5" /> Editable hasta {fmtDateTime(n.locks_at)}
            </Badge>
          ) : (
            <Badge tone="slate">
              <Lock className="size-3.5" /> Bloqueada sin firma
            </Badge>
          )}
          {n.editable && mine && (
            <Button size="sm" variant="ghost" icon={<FilePen className="size-3.5" />} onClick={onEdit}>
              Editar
            </Button>
          )}
          {!n.signed_at && mine && canSign && (
            <Button size="sm" variant="outline" icon={<BadgeCheck className="size-3.5" />} onClick={onSign}>
              Firmar
            </Button>
          )}
          {onAddendum && (n.signed_at || !n.editable) && (
            <Button size="sm" variant="ghost" icon={<Reply className="size-3.5" />} onClick={onAddendum}>
              Adenda
            </Button>
          )}
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        {SOAP.map((s) => (
          <div key={s.k} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold tracking-wide text-brand-800 uppercase">{s.l}</dt>
            <dd className="mt-0.5 whitespace-pre-line text-slate-700">{n[s.k] || <span className="text-slate-400">—</span>}</dd>
          </div>
        ))}
      </dl>
      {n.signed_at && (
        <p className="mt-3 truncate font-mono text-[11px] text-slate-400" title={n.signature_hash}>
          Firmado por {n.signed_by_name} {n.signer_license && `(Reg. ${n.signer_license})`} el {fmtDateTime(n.signed_at)} · SHA-256 {n.signature_hash}
        </p>
      )}
    </div>
  )
}
