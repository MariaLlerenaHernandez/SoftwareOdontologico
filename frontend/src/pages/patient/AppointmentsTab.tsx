import { CalendarDays } from 'lucide-react'
import { useFetch } from '../../lib/hooks'
import { APPT_STATUS, fmtDateTime, fmtTime } from '../../lib/format'
import { Card, Empty, Spinner } from '../../components/ui'

export default function AppointmentsTab({ patientId }: { patientId: number }) {
  const { data, loading } = useFetch<any[]>(`/patients/${patientId}/appointments`)
  if (loading && !data) return <Spinner />
  return (
    <Card padded={false}>
      {!data?.length ? (
        <Empty icon={<CalendarDays className="size-5" />} title="El paciente no tiene citas registradas" />
      ) : (
        <table className="table-base">
          <thead><tr><th>Fecha</th><th>Motivo</th><th>Profesional</th><th>Sillón</th><th>Estado</th></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="tabular-nums">{fmtDateTime(a.starts_at)} – {fmtTime(a.ends_at)}</td>
                <td>{a.reason ?? '—'}{a.cancel_reason && <p className="text-xs text-slate-400">Motivo de cancelación: {a.cancel_reason}</p>}</td>
                <td className="text-slate-600">{a.dentist_name}</td>
                <td className="text-slate-600">{a.chair_name} · {a.office_name}</td>
                <td><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${APPT_STATUS[a.status].cls}`}>{APPT_STATUS[a.status].label}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
