import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Boxes, CalendarDays, CircleDollarSign, ClipboardCheck, FileSignature, TrendingUp, UserX, Users } from 'lucide-react'
import { useFetch } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { APPT_STATUS, fmtTime, money, num } from '../lib/format'
import { Badge, Card, Empty, PageHeader, Spinner, Stat } from '../components/ui'

export default function Dashboard() {
  const { user, settings } = useAuth()
  const { data, loading } = useFetch<any>('/reports/dashboard')
  if (loading || !data) return <Spinner />
  const k = data.kpi
  const fin = data.finance
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
  const growth = fin && fin.revenue_prev_month > 0 ? ((fin.revenue_month - fin.revenue_prev_month) / fin.revenue_prev_month) * 100 : null

  return (
    <div>
      <PageHeader title={`${greet}, ${user!.full_name.split(' ').slice(0, 2).join(' ')}`} subtitle={`Resumen operativo de ${settings.clinica_nombre ?? 'la clínica'}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Citas de hoy" value={k.appointments_today} hint={`${k.appointments_week} programadas los próximos 7 días`} icon={<CalendarDays className="size-5" />} />
        <Stat label="Pacientes activos" value={num(k.patients)} hint={`${k.new_patients_month} nuevos este mes`} icon={<Users className="size-5" />} tone="sky" />
        {fin ? (
          <Stat
            label="Facturado este mes"
            value={money(fin.revenue_month, settings.moneda)}
            hint={growth !== null ? `${growth >= 0 ? '▲' : '▼'} ${num(Math.abs(growth), 1)}% vs. mes anterior` : `Hoy: ${money(fin.revenue_today, settings.moneda)}`}
            icon={<CircleDollarSign className="size-5" />}
            tone="emerald"
          />
        ) : (
          <Stat label="Notas sin firmar" value={k.unsigned_notes} hint="Requieren firma digital del profesional" icon={<FileSignature className="size-5" />} tone="violet" />
        )}
        <Stat label="Ausentismo (30 días)" value={`${num(k.no_show_rate ?? 0, 1)}%`} hint="Citas con estado «No asistió»" icon={<UserX className="size-5" />} tone="rose" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card
          title="Agenda de hoy"
          subtitle={user!.role === 'odontologo' ? 'Sus pacientes del día' : 'Todos los sillones'}
          actions={
            <Link to="/agenda" className="text-sm font-medium text-brand-700 hover:underline">
              Ver agenda completa
            </Link>
          }
          padded={false}
        >
          {data.today.length === 0 ? (
            <Empty icon={<CalendarDays className="size-5" />} title="Sin citas para hoy" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.today.map((a: any) => (
                <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-14 text-right">
                    <p className="text-sm font-semibold text-slate-800 tabular-nums">{fmtTime(a.starts_at)}</p>
                    <p className="text-xs text-slate-400 tabular-nums">{fmtTime(a.ends_at)}</p>
                  </div>
                  <span className="h-9 w-1 rounded-full" style={{ background: a.dentist_color }} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/pacientes/${a.patient_id}`} className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800 hover:text-brand-700">
                      {a.patient_name}
                      {a.has_alerts && <AlertTriangle className="size-3.5 text-rose-500" aria-label="Alerta médica" />}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {a.reason ?? 'Consulta'} · {a.dentist_name} · {a.chair_name} ({a.office_name})
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${APPT_STATUS[a.status]?.cls}`}>{APPT_STATUS[a.status]?.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Pendientes">
            <ul className="space-y-3 text-sm">
              <Pending icon={<FileSignature className="size-4" />} label="Notas clínicas sin firma digital" value={k.unsigned_notes} tone={k.unsigned_notes ? 'amber' : 'slate'} />
              <Pending icon={<ClipboardCheck className="size-4" />} label="Consentimientos pendientes de firma" value={k.pending_consents} tone={k.pending_consents ? 'amber' : 'slate'} />
              <Pending icon={<CalendarDays className="size-4" />} label="Tratamientos aprobados sin agendar" value={k.approved_unscheduled} tone={k.approved_unscheduled ? 'sky' : 'slate'} />
              <Pending icon={<Boxes className="size-4" />} label="Insumos bajo stock mínimo" value={k.low_stock} tone={k.low_stock ? 'rose' : 'slate'} link="/inventario" />
              {fin && <Pending icon={<CircleDollarSign className="size-4" />} label="Cuentas por cobrar" value={money(fin.receivables, settings.moneda)} tone="slate" link="/facturacion" />}
            </ul>
          </Card>
          <Card title="Estado de citas de hoy">
            <div className="flex flex-wrap gap-2">
              {data.today_by_status.length === 0 && <p className="text-sm text-slate-500">Sin movimiento.</p>}
              {data.today_by_status.map((s: any) => (
                <span key={s.status} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${APPT_STATUS[s.status]?.cls}`}>
                  <span className={`size-2 rounded-full ${APPT_STATUS[s.status]?.dot}`} />
                  {APPT_STATUS[s.status]?.label}
                  <strong className="tabular-nums">{s.count}</strong>
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {data.revenue_series && (
        <Card title="Facturación de los últimos 14 días" className="mt-6" actions={<TrendingUp className="size-4 text-brand-600" />}>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={data.revenue_series} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f766e" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d) => d.slice(8) + '/' + d.slice(5, 7)} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: any) => [money(v, settings.moneda), 'Facturado']} labelFormatter={(l) => `Día ${l}`} />
                <Area type="monotone" dataKey="revenue" stroke="#0f766e" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  )
}

function Pending({ icon, label, value, tone, link }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: any; link?: string }) {
  const content = (
    <span className="flex items-center gap-3">
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1 text-slate-600">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </span>
  )
  return <li>{link ? <Link to={link} className="block hover:opacity-80">{content}</Link> : content}</li>
}
