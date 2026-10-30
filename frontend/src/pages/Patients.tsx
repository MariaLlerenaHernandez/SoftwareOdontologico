import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Search, UserPlus, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useDebounced, useFetch } from '../lib/hooks'
import { fmtDate } from '../lib/format'
import PatientForm from '../components/PatientForm'
import { Avatar, Badge, Button, Card, Empty, PageHeader, Spinner } from '../components/ui'

export default function Patients() {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data, loading } = useFetch<any[]>(`/patients?q=${encodeURIComponent(dq)}`)
  const [creating, setCreating] = useState(false)
  const nav = useNavigate()
  const { can } = useAuth()

  return (
    <div>
      <PageHeader
        title="Pacientes"
        subtitle="Ficha única, anamnesis y expediente clínico digital"
        icon={<Users className="size-5" />}
        actions={
          can('admin', 'recepcion', 'odontologo') && (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
              Nuevo paciente
            </Button>
          )
        }
      />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Buscar por nombre, cédula, historia clínica o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {loading && !data ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<Users className="size-5" />} title="No se encontraron pacientes" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Documento</th>
                  <th>Edad</th>
                  <th>Contacto</th>
                  <th>Seguro</th>
                  <th>Última visita</th>
                  <th>Próxima cita</th>
                  <th>Alertas médicas</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/pacientes/${p.id}`)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={`${p.first_name} ${p.last_name}`} color={p.sex === 'F' ? '#0d9488' : '#2563eb'} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800">
                            {p.last_name}, {p.first_name}
                          </p>
                          <p className="text-xs text-slate-500">{p.record_number}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-slate-600 tabular-nums">{p.document_number}</td>
                    <td className="text-slate-600">
                      {p.age} {p.age < 18 && <Badge tone="sky">Menor</Badge>}
                    </td>
                    <td className="text-slate-600">
                      <p>{p.phone ?? '—'}</p>
                      <p className="text-xs text-slate-400">{p.email}</p>
                    </td>
                    <td className="text-slate-600">{p.insurance_name ?? '—'}</td>
                    <td className="text-slate-600">{fmtDate(p.last_visit)}</td>
                    <td className="text-slate-600">{fmtDate(p.next_visit)}</td>
                    <td>
                      {p.alerts?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {p.alerts.slice(0, 2).map((a: string) => (
                            <Badge key={a} tone="rose">
                              <AlertTriangle className="size-3" /> {a}
                            </Badge>
                          ))}
                          {p.alerts.length > 2 && <Badge tone="rose">+{p.alerts.length - 2}</Badge>}
                        </div>
                      ) : p.has_history ? (
                        <span className="text-xs text-slate-400">Sin alertas</span>
                      ) : (
                        <Badge tone="amber">Anamnesis pendiente</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <PatientForm open={creating} onClose={() => setCreating(false)} onSaved={(id) => nav(`/pacientes/${id}`)} />
    </div>
  )
}
