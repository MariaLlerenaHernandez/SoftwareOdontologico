export const money = (v: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('es-EC', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(v ?? 0))

export const num = (v: number | null | undefined, d = 0) =>
  new Intl.NumberFormat('es-EC', { maximumFractionDigits: d, minimumFractionDigits: d }).format(Number(v ?? 0))

export const fmtDate = (v?: string | Date | null) => {
  if (!v) return '—'
  const d = typeof v === 'string' && v.length === 10 ? new Date(v + 'T00:00:00') : new Date(v)
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const fmtDateTime = (v?: string | Date | null) => {
  if (!v) return '—'
  return new Date(v).toLocaleString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const fmtTime = (v?: string | Date | null) =>
  v ? new Date(v).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

export const isoDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export const startOfWeek = (d: Date) => {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}

export const initials = (name: string) =>
  name
    .replace(/^(Dra?\.)\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador TI',
  recepcion: 'Recepción / Caja',
  odontologo: 'Odontólogo',
  asistente: 'Asistente dental',
  auditor: 'Auditor / Contador',
}

export const APPT_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  programado: { label: 'Programado', cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  confirmado: { label: 'Confirmado', cls: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  en_espera: { label: 'En sala de espera', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  en_atencion: { label: 'En atención', cls: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  atendido: { label: 'Atendido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  cancelado: { label: 'Cancelado', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200 line-through', dot: 'bg-zinc-400' },
  no_asistio: { label: 'No asistió', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
}

export const APPT_NEXT: Record<string, string[]> = {
  programado: ['confirmado', 'en_espera', 'cancelado', 'no_asistio'],
  confirmado: ['en_espera', 'cancelado', 'no_asistio'],
  en_espera: ['en_atencion', 'cancelado', 'no_asistio'],
  en_atencion: ['atendido'],
}

export const PAY_METHOD: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta_credito: 'Tarjeta de crédito',
  tarjeta_debito: 'Tarjeta de débito',
  transferencia: 'Transferencia',
  seguro: 'Seguro / convenio',
}

export const PLAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  borrador: { label: 'Borrador', tone: 'slate' },
  presentado: { label: 'Presentado', tone: 'sky' },
  aprobado: { label: 'Aprobado', tone: 'emerald' },
  aprobado_parcial: { label: 'Aprobado parcial', tone: 'teal' },
  rechazado: { label: 'Rechazado', tone: 'rose' },
  completado: { label: 'Completado', tone: 'violet' },
}

export const ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  propuesto: { label: 'Propuesto', tone: 'slate' },
  aprobado: { label: 'Aprobado', tone: 'emerald' },
  rechazado: { label: 'Rechazado', tone: 'rose' },
  agendado: { label: 'Agendado', tone: 'sky' },
  realizado: { label: 'Realizado', tone: 'violet' },
}

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  emitida: { label: 'Por cobrar', tone: 'amber' },
  parcial: { label: 'Pago parcial', tone: 'sky' },
  pagada: { label: 'Pagada', tone: 'emerald' },
  anulada: { label: 'Anulada', tone: 'rose' },
}

export type Tone = 'slate' | 'sky' | 'emerald' | 'teal' | 'rose' | 'amber' | 'violet' | 'brand'
