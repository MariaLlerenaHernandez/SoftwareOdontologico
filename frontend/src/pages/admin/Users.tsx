import { useEffect, useState } from 'react'
import { KeyRound, Pencil, ShieldCheck, UserCog, UserPlus } from 'lucide-react'
import { api } from '../../lib/api'
import { useFetch } from '../../lib/hooks'
import { ROLE_LABEL, fmtDateTime } from '../../lib/format'
import { Avatar, Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from '../../components/ui'

const PERMS: Record<string, string> = {
  admin: 'Configuración global, usuarios, catálogos, auditoría y respaldos',
  recepcion: 'Agendamiento, registro de pacientes, cobro y facturación',
  odontologo: 'Registro clínico, odontograma, planes de tratamiento, recetas y evolución',
  asistente: 'Signos vitales, preparación de insumos y toma de notas clínicas',
  auditor: 'Cortes de caja, liquidación de honorarios, inventario y auditoría',
}

/** Gestión de usuarios y roles (RBAC). */
export default function Users() {
  const { data, loading, reload } = useFetch<any[]>('/users')
  const [editing, setEditing] = useState<any | null>(null)
  const [resetting, setResetting] = useState<any | null>(null)
  return (
    <div>
      <PageHeader title="Usuarios y roles" subtitle="Control de acceso basado en roles y principio de menor privilegio" icon={<UserCog className="size-5" />}
        actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setEditing({ role: 'recepcion', color: '#0d9488', active: true })}>Nuevo usuario</Button>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Object.entries(PERMS).map(([r, p]) => (
          <div key={r} className="card p-3"><p className="text-sm font-semibold text-slate-800">{ROLE_LABEL[r]}</p><p className="mt-1 text-xs text-slate-500">{p}</p></div>
        ))}
      </div>
      <Card padded={false}>
        {loading && !data ? <Spinner /> : (
          <table className="table-base">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Especialidad / registro</th><th>MFA</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                  <td><div className="flex items-center gap-3"><Avatar name={u.full_name} color={u.color} size="sm" /><div><p className="font-medium">{u.full_name}</p><p className="text-xs text-slate-500">{u.email}</p></div></div></td>
                  <td><Badge tone="brand">{ROLE_LABEL[u.role]}</Badge></td>
                  <td className="text-xs text-slate-600">{u.specialty ?? '—'}{u.license_number && <p className="text-slate-400">Reg. {u.license_number}</p>}</td>
                  <td>{u.mfa_enabled ? <Badge tone="emerald"><ShieldCheck className="size-3" /> Activo</Badge> : <Badge tone="slate">No</Badge>}</td>
                  <td className="text-xs text-slate-500">{fmtDateTime(u.last_login_at)}</td>
                  <td><Badge tone={u.active ? 'emerald' : 'rose'}>{u.active ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(u)}>Editar</Button>
                    <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setResetting(u)}>Clave</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <UserModal user={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <ResetModal user={resetting} onClose={() => setResetting(null)} />
    </div>
  )
}

function UserModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({})
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => (setF(user ?? {}), setError(null)), [user])
  if (!user) return null
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    try {
      if (user.id) await api.put(`/users/${user.id}`, f)
      else await api.post('/users', f)
      toast.success('Usuario guardado')
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Modal open onClose={onClose} title={user.id ? 'Editar usuario' : 'Nuevo usuario'} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorBox message={error} /></div>
        <Field label="Nombre completo"><Input value={f.full_name ?? ''} onChange={set('full_name')} /></Field>
        <Field label="Correo institucional"><Input type="email" value={f.email ?? ''} onChange={set('email')} disabled={!!user.id} /></Field>
        <Field label="Rol">
          <Select value={f.role} onChange={set('role')}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
        {!user.id && <Field label="Contraseña inicial" hint="Mín. 8 caracteres con mayúsculas, minúsculas y números"><Input type="password" value={f.password ?? ''} onChange={set('password')} /></Field>}
        <Field label="Especialidad"><Input value={f.specialty ?? ''} onChange={set('specialty')} /></Field>
        <Field label="Registro profesional"><Input value={f.license_number ?? ''} onChange={set('license_number')} /></Field>
        <Field label="Teléfono"><Input value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Color en agenda"><Input type="color" value={f.color ?? '#0d9488'} onChange={set('color')} className="h-10 p-1" /></Field>
        {user.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={f.active ?? true} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Cuenta activa</label>}
      </div>
    </Modal>
  )
}

function ResetModal({ user, onClose }: { user: any; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  if (!user) return null
  const save = async () => {
    try {
      await api.post(`/users/${user.id}/reset-password`, { password: pw })
      toast.success('Contraseña restablecida; el MFA del usuario fue reiniciado')
      setPw('')
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Restablecer contraseña`} subtitle={user.full_name} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Restablecer</Button></>}>
      <ErrorBox message={error} />
      <Field label="Nueva contraseña" hint="Se desactivará el MFA del usuario para que lo configure de nuevo"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    </Modal>
  )
}
