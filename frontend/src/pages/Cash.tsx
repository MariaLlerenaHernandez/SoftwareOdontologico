import { useState } from 'react'
import { EyeOff, LockKeyhole, Unlock, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/hooks'
import { PAY_METHOD, fmtDateTime, money } from '../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Spinner, Textarea, useToast } from '../components/ui'

const DENOMS = [100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01]

/** Apertura y cierre de caja ciego (RN-02). */
export default function Cash() {
  const { can, settings } = useAuth()
  const cur = settings.moneda
  const operates = can('admin', 'recepcion')
  const { data: current, reload } = useFetch<any>(operates ? '/cash/current' : null)
  const { data: sessions, reload: reloadSessions } = useFetch<any[]>('/cash/sessions')
  const toast = useToast()
  const [opening, setOpening] = useState('50')
  const [closing, setClosing] = useState(false)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counted = DENOMS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0)

  const open = async () => {
    setBusy(true)
    try {
      await api.post('/cash/open', { opening_amount: Number(opening) || 0 })
      toast.success('Caja abierta')
      reload()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post('/cash/close', { counted_cash: Math.round(counted * 100) / 100, notes })
      setResult(r)
      setClosing(false)
      setCounts({})
      setNotes('')
      reload()
      reloadSessions()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Caja" subtitle="Apertura, cierre ciego y conciliación diaria" icon={<Wallet className="size-5" />} />
      {operates && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          {!current ? (
            <Spinner />
          ) : current.open ? (
            <Card title="Caja abierta" subtitle={`Desde ${fmtDateTime(current.opened_at)}`} actions={<Badge tone="emerald">Abierta</Badge>}>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-slate-500">Fondo inicial</dt><dd className="text-lg font-semibold">{money(current.opening_amount, cur)}</dd></div>
                <div><dt className="text-xs text-slate-500">Cobros en efectivo registrados</dt><dd className="text-lg font-semibold">{current.cash_transactions}</dd></div>
              </dl>
              <div className="mt-4"><Notice icon={<EyeOff className="size-4" />}>Cierre ciego: el total teórico del sistema se mostrará solo después de declarar el conteo físico del efectivo.</Notice></div>
              <Button className="mt-4" icon={<LockKeyhole className="size-4" />} onClick={() => setClosing(true)}>Cerrar caja</Button>
            </Card>
          ) : (
            <Card title="Abrir caja del día">
              <div className="flex items-end gap-3">
                <Field label="Fondo inicial (sencillo)" className="flex-1"><Input type="number" min={0} step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
                <Button icon={<Unlock className="size-4" />} loading={busy} onClick={open}>Abrir caja</Button>
              </div>
            </Card>
          )}
          {result && <CloseResult r={result} cur={cur} />}
        </div>
      )}

      <Card title="Historial de cierres" padded={false}>
        {!sessions ? <Spinner /> : !sessions.length ? <Empty icon={<Wallet className="size-5" />} title="Sin cierres registrados" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Apertura</th><th>Cierre</th><th>Cajero</th><th className="text-right">Fondo</th><th className="text-right">Teórico</th><th className="text-right">Contado</th><th className="text-right">Diferencia</th><th>Observaciones</th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="text-slate-600">{fmtDateTime(s.opened_at)}</td>
                    <td className="text-slate-600">{s.closed_at ? fmtDateTime(s.closed_at) : <Badge tone="emerald">Abierta</Badge>}</td>
                    <td>{s.user_name}</td>
                    <td className="text-right tabular-nums">{money(s.opening_amount, cur)}</td>
                    <td className="text-right tabular-nums">{s.status === 'cerrada' ? money(s.expected_cash, cur) : <span className="text-slate-400">oculto</span>}</td>
                    <td className="text-right tabular-nums">{s.counted_cash != null ? money(s.counted_cash, cur) : '—'}</td>
                    <td className="text-right">{s.difference != null ? <Badge tone={s.difference === 0 ? 'emerald' : s.difference < 0 ? 'rose' : 'amber'}>{s.difference > 0 ? '+' : ''}{money(s.difference, cur)}</Badge> : '—'}</td>
                    <td className="max-w-48 truncate text-xs text-slate-500">{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={closing} onClose={() => setClosing(false)} title="Cierre de caja ciego" subtitle="Cuente el efectivo físico por denominación"
        footer={<><span className="mr-auto self-center text-sm">Total contado: <strong className="text-lg">{money(counted, cur)}</strong></span><Button variant="secondary" onClick={() => setClosing(false)}>Cancelar</Button><Button loading={busy} onClick={close}>Declarar conteo y cerrar</Button></>}>
        <div className="space-y-4">
          <ErrorBox message={error} />
          <div className="grid gap-3 sm:grid-cols-3">
            {DENOMS.map((d) => (
              <Field key={d} label={d >= 1 ? `Billete / moneda $${d}` : `Moneda ${d * 100}¢`}>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} value={counts[d] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))} placeholder="0" />
                  <span className="w-20 text-right text-xs text-slate-500 tabular-nums">{money(d * (Number(counts[d]) || 0), cur)}</span>
                </div>
              </Field>
            ))}
          </div>
          <Field label="Observaciones"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  )
}

function CloseResult({ r, cur }: { r: any; cur?: string }) {
  const diff = r.difference
  return (
    <Card title="Resultado del cierre" subtitle={fmtDateTime(r.closed_at)} actions={<Badge tone={diff === 0 ? 'emerald' : diff < 0 ? 'rose' : 'amber'}>{diff === 0 ? 'Cuadrada' : diff < 0 ? 'Faltante' : 'Sobrante'}</Badge>}>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <div><dt className="text-xs text-slate-500">Declarado</dt><dd className="text-lg font-semibold">{money(r.counted_cash, cur)}</dd></div>
        <div><dt className="text-xs text-slate-500">Teórico del sistema</dt><dd className="text-lg font-semibold">{money(r.expected_cash, cur)}</dd></div>
        <div><dt className="text-xs text-slate-500">Diferencia</dt><dd className={`text-lg font-semibold ${diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{money(diff, cur)}</dd></div>
      </dl>
      {r.by_method?.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
          {r.by_method.map((m: any) => <li key={m.method} className="flex justify-between"><span className="text-slate-600">{PAY_METHOD[m.method]} ({m.count})</span><span className="tabular-nums">{money(m.total, cur)}</span></li>)}
        </ul>
      )}
    </Card>
  )
}
