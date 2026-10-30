import { useState } from 'react'
import { Bell, Mail, MessageCircle, RefreshCw, Smartphone } from 'lucide-react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { fmtDateTime } from '../lib/format'
import { Badge, Button, Card, Empty, Notice, PageHeader, Select, Spinner, useToast } from '../components/ui'

const KIND: Record<string, string> = { confirmacion: 'Confirmación', recordatorio_48h: 'Recordatorio 48 h', recordatorio_24h: 'Recordatorio 24 h', otp: 'Código OTP', cancelacion: 'Cancelación', general: 'General' }
const CH: Record<string, React.ReactNode> = { whatsapp: <MessageCircle className="size-4 text-emerald-600" />, sms: <Smartphone className="size-4 text-sky-600" />, email: <Mail className="size-4 text-violet-600" /> }

/** Bandeja de mensajes transaccionales enviados (RF-11). */
export default function Notifications() {
  const { can } = useAuth()
  const [kind, setKind] = useState('')
  const [channel, setChannel] = useState('')
  const { data, loading, reload } = useFetch<any[]>(`/notifications${qs({ kind, channel })}`)
  const { data: integ } = useFetch<any>('/integrations')
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const r = await api.post('/notifications/run')
      toast.success(r.sent ? `${r.sent} recordatorio(s) enviados` : 'No hay recordatorios pendientes en este momento')
      reload()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Notificaciones" subtitle="Confirmaciones y recordatorios automáticos multicanal" icon={<Bell className="size-5" />}
        actions={can('admin') && <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={busy} onClick={run}>Ejecutar recordatorios ahora</Button>} />
      <div className="mb-4">
        <Notice>
          Un proceso en segundo plano revisa la agenda cada minuto y envía recordatorios <strong>48 h</strong> y <strong>24 h</strong> antes de cada cita por el canal preferido del paciente.
          <span className="mt-2 flex flex-wrap gap-2">
            {(['email', 'sms', 'whatsapp'] as const).map((ch) => (
              <Badge key={ch} tone={integ?.[ch] ? 'emerald' : 'slate'}>
                {{ email: 'Correo (SMTP)', sms: 'SMS (Twilio)', whatsapp: 'WhatsApp (Twilio)' }[ch]}: {integ?.[ch] ? 'envío real' : 'simulado'}
              </Badge>
            ))}
          </span>
        </Notice>
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Todos los tipos</option>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select className="w-auto" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Todos los canales</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Correo</option>
          </Select>
        </div>
        {loading && !data ? <Spinner /> : !data?.length ? <Empty icon={<Bell className="size-5" />} title="Sin mensajes" /> : (
          <ul className="divide-y divide-slate-100">
            {data.map((n) => (
              <li key={n.id} className="flex gap-4 px-5 py-3.5">
                <div className="mt-0.5">{CH[n.channel]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-800">{n.patient_name}</span>
                    <span className="text-slate-400">→ {n.recipient}</span>
                    <Badge tone="sky">{KIND[n.kind]}</Badge>
                    <Badge tone={n.status === 'enviado' ? 'emerald' : 'rose'}>{n.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{n.kind === 'otp' ? n.message.replace(/\d{6}/, '••••••') : n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{fmtDateTime(n.created_at)} · {n.provider} · ref {n.provider_ref}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
