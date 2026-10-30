import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Download } from 'lucide-react'
import { qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { APPT_STATUS, PAY_METHOD, addDays, isoDate, money, num } from '../lib/format'
import { Button, Card, Field, Input, PageHeader, Spinner, Stat, Tabs } from '../components/ui'

const PALETTE = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#65a30d', '#0891b2', '#475569']
const STATUS_COLOR: Record<string, string> = { programado: '#94a3b8', confirmado: '#0ea5e9', en_espera: '#f59e0b', en_atencion: '#8b5cf6', atendido: '#10b981', cancelado: '#a1a1aa', no_asistio: '#f43f5e' }

function exportCSV(name: string, rows: any[]) {
  if (!rows?.length) return
  const keys = Object.keys(rows[0])
  const csv = [keys.join(';'), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${name}.csv`
  a.click()
}

/** Reportes de gestión / BI (Fase 3). */
export default function Reports() {
  const { can } = useAuth()
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -29)))
  const [to, setTo] = useState(isoDate(new Date()))
  const tabs = [
    ...(can('admin', 'auditor') ? [{ id: 'finanzas' as const, label: 'Finanzas' }] : []),
    { id: 'agenda' as const, label: 'Agenda y productividad' },
    ...(can('admin', 'auditor') ? [{ id: 'inventario' as const, label: 'Inventario' }] : []),
  ]
  const [tab, setTab] = useState(tabs[0].id)
  return (
    <div>
      <PageHeader title="Reportes" subtitle="Indicadores de gestión clínica, financiera y de inventario" icon={<BarChart3 className="size-5" />}
        actions={<><Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>} />
      <div className="mb-6"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'finanzas' && <Finance from={from} to={to} />}
      {tab === 'agenda' && <Agenda from={from} to={to} />}
      {tab === 'inventario' && <InventoryRep from={from} to={to} />}
    </div>
  )
}

function Finance({ from, to }: { from: string; to: string }) {
  const { settings } = useAuth()
  const cur = settings.moneda
  const { data } = useFetch<any>(`/reports/revenue${qs({ from, to })}`)
  if (!data) return <Spinner />
  const t = data.totals
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Ingresos facturados" value={money(t.revenue, cur)} />
        <Stat label="Comprobantes" value={t.invoices} hint={`${t.voided} anulados`} tone="sky" />
        <Stat label="Ticket promedio" value={money(t.avg_ticket, cur)} tone="violet" />
        <Stat label="Descuentos otorgados" value={money(t.discounts, cur)} tone="amber" />
      </div>
      <Card title="Ingresos diarios" actions={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => exportCSV('ingresos-diarios', data.by_day)}>CSV</Button>}>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={data.by_day}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d) => d.slice(8) + '/' + d.slice(5, 7)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={56} />
              <Tooltip formatter={(v: any) => money(v, cur)} />
              <Bar dataKey="revenue" name="Ingresos" fill="#0f766e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Cobros por forma de pago">
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.by_method.map((m: any) => ({ ...m, name: PAY_METHOD[m.method] }))} dataKey="total" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {data.by_method.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => money(v, cur)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Producción por profesional">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.by_dentist} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: any) => money(v, cur)} />
                <Bar dataKey="total" name="Facturado" radius={[0, 4, 4, 0]}>
                  {data.by_dentist.map((d: any, i: number) => <Cell key={i} fill={d.color ?? PALETTE[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card title="Procedimientos más facturados" padded={false} actions={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => exportCSV('procedimientos', data.by_procedure)}>CSV</Button>}>
        <table className="table-base">
          <thead><tr><th>Procedimiento</th><th>Categoría</th><th className="text-right">Cantidad</th><th className="text-right">Total</th></tr></thead>
          <tbody>{data.by_procedure.map((p: any) => <tr key={p.name}><td className="font-medium">{p.name}</td><td className="text-slate-600">{p.category ?? '—'}</td><td className="text-right tabular-nums">{num(p.quantity)}</td><td className="text-right font-medium tabular-nums">{money(p.total, cur)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  )
}

function Agenda({ from, to }: { from: string; to: string }) {
  const { data } = useFetch<any>(`/reports/appointments${qs({ from, to })}`)
  if (!data) return <Spinner />
  const total = data.by_status.reduce((s: number, x: any) => s + x.count, 0)
  const get = (s: string) => data.by_status.find((x: any) => x.status === s)?.count ?? 0
  const noShowRate = get('atendido') + get('no_asistio') ? (get('no_asistio') * 100) / (get('atendido') + get('no_asistio')) : 0
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Citas en el período" value={total} />
        <Stat label="Atendidas" value={get('atendido')} tone="emerald" />
        <Stat label="Tasa de ausentismo" value={`${num(noShowRate, 1)}%`} tone="rose" />
        <Stat label="Canceladas" value={get('cancelado')} tone="slate" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Citas por estado">
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.by_status.map((s: any) => ({ ...s, name: APPT_STATUS[s.status]?.label }))} dataKey="count" nameKey="name" outerRadius={90} innerRadius={50}>
                  {data.by_status.map((s: any) => <Cell key={s.status} fill={STATUS_COLOR[s.status]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Demanda por hora del día">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={data.by_hour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip labelFormatter={(h) => `${h}:00`} />
                <Line type="monotone" dataKey="count" name="Citas" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Productividad por profesional" padded={false}>
          <table className="table-base">
            <thead><tr><th>Profesional</th><th className="text-right">Citas</th><th className="text-right">Atendidas</th><th className="text-right">No asistió</th><th className="text-right">Canceladas</th></tr></thead>
            <tbody>{data.by_dentist.map((d: any) => <tr key={d.name}><td className="flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: d.color }} />{d.name}</td><td className="text-right">{d.total}</td><td className="text-right text-emerald-700">{d.attended}</td><td className="text-right text-rose-600">{d.no_show}</td><td className="text-right text-slate-500">{d.cancelled}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Ocupación de sillones" subtitle="Horas agendadas sobre 11 h disponibles por día hábil">
          <ul className="space-y-3">
            {data.occupancy.map((o: any) => (
              <li key={o.chair}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-slate-700">{o.chair}</span><span className="font-medium tabular-nums">{num(o.occupancy_pct, 1)}% · {num(o.hours, 1)} h</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, o.occupancy_pct ?? 0)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function InventoryRep({ from, to }: { from: string; to: string }) {
  const { settings } = useAuth()
  const cur = settings.moneda
  const { data } = useFetch<any>(`/reports/inventory${qs({ from, to })}`)
  if (!data) return <Spinner />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Valor del inventario" value={money(data.totals.stock_value, cur)} />
        <Stat label="Insumos activos" value={data.totals.items} tone="sky" />
        <Stat label="Bajo stock mínimo" value={data.low_stock.length} tone="rose" />
      </div>
      <Card title="Consumo valorizado por insumo">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={data.consumption} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip formatter={(v: any) => money(v, cur)} />
              <Bar dataKey="value" name="Costo consumido" fill="#7c3aed" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Consumo por profesional y sede" padded={false}>
        <table className="table-base">
          <thead><tr><th>Profesional</th><th>Sede</th><th className="text-right">Movimientos</th><th className="text-right">Costo consumido</th></tr></thead>
          <tbody>
            {data.by_dentist_office.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Sin consumos clínicos en el período</td></tr>}
            {data.by_dentist_office.map((r: any, i: number) => <tr key={i}><td className="font-medium">{r.dentist}</td><td>{r.office}</td><td className="text-right">{r.movements}</td><td className="text-right tabular-nums">{money(r.value, cur)}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
