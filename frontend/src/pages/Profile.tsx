import { useState } from 'react'
import QRCode from 'qrcode'
import { KeyRound, ShieldCheck, ShieldOff, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/format'
import { Avatar, Badge, Button, Card, ErrorBox, Field, Input, Notice, PageHeader, useToast } from '../components/ui'

/** Perfil del usuario: cambio de contraseña y autenticación multifactor (RNF-05). */
export default function Profile() {
  const { user, login, settings } = useAuth()
  const toast = useToast()
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwError, setPwError] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [mfaPw, setMfaPw] = useState('')
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const changePw = async () => {
    setPwError(null)
    if (pw.new_password !== pw.confirm) return setPwError('Las contraseñas no coinciden')
    try {
      await api.post('/auth/change-password', pw)
      toast.success('Contraseña actualizada')
      setPw({ current_password: '', new_password: '', confirm: '' })
    } catch (e: any) {
      setPwError(e.message)
    }
  }

  const startMFA = async () => {
    setMfaError(null)
    const r = await api.post('/auth/mfa/setup')
    setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauth_url, { width: 200, margin: 1 }) })
  }

  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    setMfaError(null)
    try {
      const r = await fn()
      login(r.token, r.user)
      toast.success(msg)
      setSetup(null)
      setCode('')
      setMfaPw('')
    } catch (e: any) {
      setMfaError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Mi perfil" subtitle="Seguridad de la cuenta" icon={<UserRound className="size-5" />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Datos de la cuenta">
          <div className="flex items-center gap-4">
            <Avatar name={user.full_name} color={user.color} />
            <div>
              <p className="font-semibold text-slate-800">{user.full_name}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
              <div className="mt-1 flex gap-2"><Badge tone="brand">{ROLE_LABEL[user.role]}</Badge>{user.mfa_verified && <Badge tone="emerald"><ShieldCheck className="size-3" /> Sesión verificada con MFA</Badge>}</div>
            </div>
          </div>
        </Card>

        <Card title="Autenticación multifactor (TOTP)" subtitle="Google Authenticator, Microsoft Authenticator, Authy…">
          <div className="space-y-4">
            {settings.mfa_obligatorio === 'true' && !user.mfa_verified && <Notice tone="amber">La política de la clínica exige MFA para acceder a expedientes clínicos e información financiera.</Notice>}
            <ErrorBox message={mfaError} />
            {user.mfa_enabled ? (
              <>
                <Notice tone="emerald" icon={<ShieldCheck className="size-4" />}>MFA activo. Se solicitará un código de 6 dígitos en cada inicio de sesión.</Notice>
                <div className="flex items-end gap-2">
                  <Field label="Contraseña para desactivar" className="flex-1"><Input type="password" value={mfaPw} onChange={(e) => setMfaPw(e.target.value)} /></Field>
                  <Button variant="secondary" icon={<ShieldOff className="size-4" />} loading={busy} onClick={() => run(() => api.post('/auth/mfa/disable', { password: mfaPw }), 'MFA desactivado')}>Desactivar</Button>
                </div>
              </>
            ) : !setup ? (
              <Button icon={<ShieldCheck className="size-4" />} onClick={startMFA}>Activar MFA</Button>
            ) : (
              <div className="flex flex-wrap gap-5">
                <img src={setup.qr} alt="Código QR MFA" className="size-44 rounded-lg border border-slate-200" />
                <div className="min-w-48 flex-1 space-y-3 text-sm">
                  <p>1. Escanee el código QR con su aplicación autenticadora.</p>
                  <p className="text-xs text-slate-500">O ingrese la clave manualmente: <code className="font-mono break-all text-slate-700">{setup.secret}</code></p>
                  <p>2. Ingrese el código de 6 dígitos generado:</p>
                  <div className="flex gap-2">
                    <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-32 text-center font-mono tracking-[0.3em]" />
                    <Button loading={busy} onClick={() => run(() => api.post('/auth/mfa/enable', { code }), 'MFA activado correctamente')}>Verificar</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Cambiar contraseña">
          <div className="space-y-4">
            <ErrorBox message={pwError} />
            <Field label="Contraseña actual"><Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="Nueva contraseña" hint="Mínimo 8 caracteres con mayúsculas, minúsculas y números"><Input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <Field label="Confirmar nueva contraseña"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <Button icon={<KeyRound className="size-4" />} onClick={changePw}>Actualizar contraseña</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
