import { useRef, useState } from 'react'
import { Download, Eye, FileImage, FileText, FolderOpen, Lock, Upload } from 'lucide-react'
import { api, fileURL } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { fmtDateTime } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Spinner, useToast } from '../../components/ui'

const CATS: Record<string, string> = { radiografia: 'Radiografía', fotografia: 'Fotografía clínica', documento: 'Documento', laboratorio: 'Laboratorio', otro: 'Otro' }
const size = (b: number) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)

/** Repositorio de Rx, fotografías y PDFs cifrados en reposo (AES-256-GCM). */
export default function FilesTab({ patientId }: { patientId: number }) {
  const { data, loading, reload } = useFetch<any[]>(`/patients/${patientId}/files`)
  const { can } = useAuth()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState('radiografia')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', category)
      fd.append('description', description)
      await api.upload(`/patients/${patientId}/files`, fd)
      toast.success('Archivo cargado y cifrado')
      setDescription('')
      reload()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  if (loading && !data) return <Spinner />
  return (
    <div className="space-y-4">
      {can('recepcion', 'odontologo', 'asistente') && (
        <Card title="Cargar archivo" subtitle="JPG, PNG, WEBP, PDF o DICOM (.dcm) · máximo 15 MB">
          <div className="grid items-end gap-4 sm:grid-cols-[200px_1fr_auto]">
            <Field label="Categoría">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Descripción"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: Periapical pieza 36 post-endodoncia" /></Field>
            <Button icon={<Upload className="size-4" />} loading={uploading} onClick={() => input.current?.click()}>Seleccionar archivo</Button>
            <input ref={input} type="file" hidden accept="image/*,application/pdf,.dcm" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
          <div className="mt-4">
            <Notice icon={<Lock className="size-4" />}>Los archivos se cifran con AES-256-GCM antes de almacenarse. La visualización de imágenes DICOM 3D se integrará con PACS externo en fases posteriores.</Notice>
          </div>
        </Card>
      )}
      <Card padded={false}>
        {!data?.length ? (
          <Empty icon={<FolderOpen className="size-5" />} title="Sin archivos en el expediente" />
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((f) => (
              <li key={f.id} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
                  {f.mime_type.startsWith('image/') ? <img src={fileURL(f.id)} alt="" className="size-full object-cover" /> : f.mime_type === 'application/pdf' ? <FileText className="size-6" /> : <FileImage className="size-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800" title={f.filename}>{f.filename}</p>
                  <p className="truncate text-xs text-slate-500">{f.description ?? '—'}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    <Badge tone="sky">{CATS[f.category]}</Badge> {size(f.size_bytes)}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{fmtDateTime(f.uploaded_at)} · {f.uploaded_by_name}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <a href={fileURL(f.id)} target="_blank" rel="noreferrer" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Ver"><Eye className="size-4" /></a>
                  <a href={fileURL(f.id, true)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Descargar"><Download className="size-4" /></a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
