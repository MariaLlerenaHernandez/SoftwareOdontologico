import { useState, type FormEvent } from 'react'
import { CalendarCheck2, KeyRound, Lock, Mail, ShieldCheck, Smile } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth, type User } from '../lib/auth'
import { Button, ErrorBox, Field, Input, Notice } from '../components/ui'

const DEMO = [
  { email: 'admin@sigodental.com', role: 'Administrador TI' },
  { email: 'recepcion@sigodental.com', role: 'Recepción / Caja' },
  { email: 'dra.torres@sigodental.com', role: 'Odontóloga' },
  { email: 'asistente@sigodental.com', role: 'Asistente dental' },
  { email: 'auditor@sigodental.com', role: 'Auditor / Contador' },
]

export default function Login() {
  const { login, logoutReason } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mfaToken) {
        const r = await api.post<{ token: string; user: User }>('/auth/mfa/verify', { mfa_token: mfaToken, code })
        login(r.token, r.user)
      } else {
        const r = await api.post<{ token?: string; user?: User; mfa_required?: boolean; mfa_token?: string }>('/auth/login', { email, password })
        if (r.mfa_required && r.mfa_token) setMfaToken(r.mfa_token)
        else if (r.token && r.user) login(r.token, r.user)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-[#0b3b38] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 size-[28rem] rounded-full bg-teal-300/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/favicon.svg" className="size-11" alt="" />
          <div>
            <p className="text-lg font-bold">SIGO-Dental</p>
            <p className="text-sm text-brand-200">Sistema Integral de Gestión Odontológica</p>
          </div>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">Expediente clínico digital, agenda y finanzas en un solo lugar.</h1>
          <p className="mt-4 text-brand-100/80">Odontograma interactivo FDI/Universal, periodontograma, notas SOEP firmadas, consentimientos digitales, facturación electrónica e inventario con descargo automático.</p>
          <div className="mt-10 grid grid-cols-3 gap-4 text-sm">
            {[
              { i: <Smile className="size-5" />, t: 'Odontograma 2D' },
              { i: <CalendarCheck2 className="size-5" />, t: 'Agenda por sillón' },
              { i: <ShieldCheck className="size-5" />, t: 'MFA y auditoría' },
            ].map((x) => (
              <div key={x.t} className="rounded-xl bg-white/8 p-4 ring-1 ring-white/10">
                <div className="text-brand-200">{x.i}</div>
                <p className="mt-2 font-medium">{x.t}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative mt-10 text-xs text-brand-200/60">Datos de salud protegidos · TLS 1.3 · AES-256 en reposo · Log de auditoría inmutable</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/favicon.svg" className="size-10" alt="" />
            <p className="text-lg font-bold text-brand-900">SIGO-Dental</p>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{mfaToken ? 'Verificación en dos pasos' : 'Iniciar sesión'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {mfaToken ? 'Ingrese el código de 6 dígitos de su aplicación autenticadora.' : 'Acceda con su cuenta institucional.'}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {logoutReason && !error && <Notice tone="amber">{logoutReason}</Notice>}
            <ErrorBox message={error} />
            {mfaToken ? (
              <Field label="Código de verificación">
                <div className="relative">
                  <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="pl-9 text-center font-mono text-lg tracking-[0.4em]"
                    placeholder="000000"
                  />
                </div>
              </Field>
            ) : (
              <>
                <Field label="Correo electrónico">
                  <div className="relative">
                    <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="usuario@sigodental.com" />
                  </div>
                </Field>
                <Field label="Contraseña">
                  <div className="relative">
                    <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" placeholder="••••••••" />
                  </div>
                </Field>
              </>
            )}
            <Button type="submit" loading={loading} className="w-full py-2.5">
              {mfaToken ? 'Verificar y entrar' : 'Ingresar'}
            </Button>
            {mfaToken && (
              <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-700" onClick={() => (setMfaToken(null), setCode(''))}>
                Volver
              </button>
            )}
          </form>

          {!mfaToken && (
            <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white p-4">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Cuentas de demostración</p>
              <p className="mt-1 text-xs text-slate-500">
                Contraseña: <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">Sigo2026!</code>
              </p>
              <div className="mt-3 space-y-1">
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    onClick={() => (setEmail(d.email), setPassword('Sigo2026!'))}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                  >
                    <span className="font-mono text-slate-700">{d.email}</span>
                    <span className="text-slate-400">{d.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
