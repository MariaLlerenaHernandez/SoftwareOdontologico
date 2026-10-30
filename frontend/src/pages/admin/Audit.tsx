import { useState } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import { qs } from '../../lib/api'
import { useDebounced, useFetch } from '../../lib/hooks'
import { Badge, Card, Empty, Field, Input, Notice, PageHeader, Select, Spinner } from '../../components/ui'

const TONE: Record<string, any> = { READ: 'sky', CREATE: 'emerald', UPDATE: 'amber', DELETE: 'rose', LOGIN: 'brand', LOGIN_FAILED: 'rose', DENIED: 'rose', EXPORT: 'violet', SIGN: 'teal' }

/** Log de auditoría inmutable (RNF-06). */
export default function Audit() {
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data, loading } = useFetch<any[]>(`/audit${qs({ action, from, to, q: dq, limit: 300 })}`)
  return (
    <div>
      <PageHeader title="Auditoría" subtitle="Trazabilidad de accesos y modificaciones sobre historias clínicas" icon={<ShieldCheck className="size-5" />} />
      <div className="mb-4">
        <Notice icon={<Lock className="size-4" />}>El log es inmutable: un trigger de base de datos bloquea cualquier UPDATE o DELETE. Cada registro incluye usuario, rol, acción, entidad, paciente, IP de origen y marca de tiempo ISO-8601.</Notice>
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Buscar (usuario o ruta)" className="min-w-64 flex-1"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Acción">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Todas</option>
              {['READ', 'CREATE', 'UPDATE', 'DELETE', 'SIGN', 'EXPORT', 'LOGIN', 'LOGIN_FAILED', 'DENIED', 'APPROVE', 'COMPLETE', 'VOID', 'CLOSE'].map((a) => <option key={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {loading && !data ? <Spinner /> : !data?.length ? <Empty title="Sin eventos" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Fecha (ISO-8601)</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Paciente</th><th>IP</th><th>Ruta</th><th>HTTP</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-[11px] whitespace-nowrap text-slate-600">{new Date(a.occurred_at).toISOString()}</td>
                    <td><p className="text-sm">{a.user_email ?? '—'}</p><p className="text-xs text-slate-400">{a.role}</p></td>
                    <td><Badge tone={TONE[a.action.replace('_FAILED', '')] ?? (a.action.endsWith('FAILED') ? 'rose' : 'slate')}>{a.action}</Badge></td>
                    <td className="text-sm">{a.entity}{a.entity_id && <span className="text-slate-400"> #{a.entity_id}</span>}</td>
                    <td className="text-sm text-slate-600">{a.patient_name ?? '—'}</td>
                    <td className="font-mono text-xs">{a.ip}</td>
                    <td className="max-w-56 truncate font-mono text-[11px] text-slate-500" title={a.details ? JSON.stringify(a.details) : undefined}>{a.method} {a.path}</td>
                    <td><span className={`font-mono text-xs ${a.status >= 400 ? 'text-rose-600' : 'text-emerald-600'}`}>{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
