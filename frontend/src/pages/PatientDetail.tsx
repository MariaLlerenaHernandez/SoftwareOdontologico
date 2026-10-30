import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  FileHeart,
  FileSignature,
  FolderOpen,
  HeartPulse,
  NotebookPen,
  Pencil,
  Pill,
  Smile,
  User,
} from 'lucide-react'
import { useAuth, type Role } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { money } from '../lib/format'
import PatientForm from '../components/PatientForm'
import { Avatar, Badge, Button, Spinner, Tabs } from '../components/ui'
import SummaryTab from './patient/SummaryTab'
import HistoryTab from './patient/HistoryTab'
import OdontogramTab from './patient/OdontogramTab'
import PerioTab from './patient/PerioTab'
import NotesTab from './patient/NotesTab'
import PlansTab from './patient/PlansTab'
import PrescriptionsTab from './patient/PrescriptionsTab'
import ConsentsTab from './patient/ConsentsTab'
import FilesTab from './patient/FilesTab'
import AppointmentsTab from './patient/AppointmentsTab'

type TabId = 'resumen' | 'anamnesis' | 'odontograma' | 'perio' | 'evolucion' | 'planes' | 'recetas' | 'consentimientos' | 'archivos' | 'citas'

const CLINICAL: Role[] = ['admin', 'odontologo', 'asistente']

const TABS: { id: TabId; label: string; icon: React.ReactNode; roles: Role[] }[] = [
  { id: 'resumen', label: 'Resumen', icon: <User className="size-4" />, roles: ['admin', 'recepcion', 'odontologo', 'asistente', 'auditor'] },
  { id: 'anamnesis', label: 'Anamnesis', icon: <HeartPulse className="size-4" />, roles: ['admin', 'recepcion', 'odontologo', 'asistente'] },
  { id: 'odontograma', label: 'Odontograma', icon: <Smile className="size-4" />, roles: CLINICAL },
  { id: 'perio', label: 'Periodontograma', icon: <Activity className="size-4" />, roles: CLINICAL },
  { id: 'evolucion', label: 'Evolución SOEP', icon: <NotebookPen className="size-4" />, roles: CLINICAL },
  { id: 'planes', label: 'Planes y presupuestos', icon: <ClipboardList className="size-4" />, roles: ['admin', 'recepcion', 'odontologo', 'asistente', 'auditor'] },
  { id: 'recetas', label: 'Recetas', icon: <Pill className="size-4" />, roles: CLINICAL },
  { id: 'consentimientos', label: 'Consentimientos', icon: <FileSignature className="size-4" />, roles: ['admin', 'recepcion', 'odontologo', 'asistente'] },
  { id: 'archivos', label: 'Rx y archivos', icon: <FolderOpen className="size-4" />, roles: ['admin', 'recepcion', 'odontologo', 'asistente'] },
  { id: 'citas', label: 'Citas', icon: <CalendarDays className="size-4" />, roles: ['admin', 'recepcion', 'odontologo', 'asistente'] },
]

export default function PatientDetail() {
  const { id } = useParams()
  const { can, settings } = useAuth()
  const { data: p, loading, reload } = useFetch<any>(`/patients/${id}`)
  const [tab, setTab] = useState<TabId>('resumen')
  const [editing, setEditing] = useState(false)

  if (loading && !p) return <Spinner />
  if (!p) return <p className="text-sm text-slate-500">Paciente no encontrado.</p>
  const pid = Number(id)
  const tabs = TABS.filter((t) => can(...t.roles))

  return (
    <div>
      <Link to="/pacientes" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Pacientes
      </Link>

      <div className="card overflow-hidden">
        {/* RF-02: badge de alta visibilidad en la cabecera del expediente */}
        {p.alerts?.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-rose-600 px-5 py-2.5 text-sm text-white">
            <AlertTriangle className="size-5 shrink-0 animate-pulse" />
            <strong className="mr-1 tracking-wide uppercase">Alerta médica:</strong>
            {p.alerts.map((a: string) => (
              <span key={a} className="rounded-full bg-white/20 px-2.5 py-0.5 font-medium ring-1 ring-white/30">
                {a}
              </span>
            ))}
          </div>
        )}
        {!p.has_history && (
          <div className="flex items-center gap-2 bg-amber-50 px-5 py-2 text-sm text-amber-900">
            <FileHeart className="size-4" /> Anamnesis pendiente: el registro del historial médico es obligatorio antes de cualquier procedimiento.
            {can('recepcion', 'odontologo', 'asistente') && (
              <button className="ml-auto font-medium underline" onClick={() => setTab('anamnesis')}>
                Completar ahora
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-5 px-5 py-4">
          <Avatar name={`${p.first_name} ${p.last_name}`} color={p.sex === 'F' ? '#0d9488' : '#2563eb'} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-slate-900">
              {p.first_name} {p.last_name}
            </h1>
            <p className="text-sm text-slate-500">
              {p.record_number} · {p.document_type === 'cedula' ? 'C.I.' : p.document_type} {p.document_number} · {p.age} años ·{' '}
              {p.sex === 'F' ? 'Femenino' : p.sex === 'M' ? 'Masculino' : 'Otro'}
              {p.insurance_name && ` · ${p.insurance_name}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="slate">{p.stats.visits} visitas</Badge>
            {p.stats.no_shows > 0 && <Badge tone="rose">{p.stats.no_shows} inasistencias</Badge>}
            {p.stats.balance > 0 && <Badge tone="amber">Saldo {money(p.stats.balance, settings.moneda)}</Badge>}
            {p.stats.pending_consents > 0 && <Badge tone="amber">{p.stats.pending_consents} consentimiento(s) pendiente(s)</Badge>}
          </div>
          {can('admin', 'recepcion', 'odontologo') && (
            <Button variant="secondary" size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
              Editar ficha
            </Button>
          )}
        </div>
        <div className="px-5">
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
      </div>

      <div className="mt-6">
        {tab === 'resumen' && <SummaryTab patient={p} />}
        {tab === 'anamnesis' && <HistoryTab patientId={pid} onSaved={reload} />}
        {tab === 'odontograma' && <OdontogramTab patient={p} />}
        {tab === 'perio' && <PerioTab patientId={pid} />}
        {tab === 'evolucion' && <NotesTab patientId={pid} />}
        {tab === 'planes' && <PlansTab patient={p} />}
        {tab === 'recetas' && <PrescriptionsTab patient={p} />}
        {tab === 'consentimientos' && <ConsentsTab patient={p} onChange={reload} />}
        {tab === 'archivos' && <FilesTab patientId={pid} />}
        {tab === 'citas' && <AppointmentsTab patientId={pid} />}
      </div>

      <PatientForm open={editing} onClose={() => setEditing(false)} patient={p} onSaved={() => (setEditing(false), reload())} />
    </div>
  )
}
