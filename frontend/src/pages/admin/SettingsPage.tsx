import { useEffect, useState } from 'react'
import { DatabaseBackup, Save, Settings } from 'lucide-react'
import { api, tokenStore } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/hooks'
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, useToast } from '../../components/ui'

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Datos de la clínica', keys: ['clinica_nombre', 'clinica_ruc', 'clinica_direccion', 'clinica_telefono', 'moneda'] },
  { title: 'Reglas clínicas', keys: ['nota_bloqueo_horas'] },
  { title: 'Finanzas', keys: ['iva_pct', 'descuento_max_pct'] },
  { title: 'Seguridad', keys: ['mfa_obligatorio', 'sesion_inactividad_min'] },
  { title: 'Notificaciones', keys: ['recordatorios_activos'] },
]
const BOOL = ['mfa_obligatorio', 'recordatorios_activos']

/** Configuración global y respaldos (Administrador TI). */
export default function SettingsPage() {
  const { data, loading, setData } = useFetch<any[]>('/settings')
  const { refreshSettings } = useAuth()
  const [f, setF] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [backing, setBacking] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (data) setF(Object.fromEntries(data.map((s) => [s.key, s.value])))
  }, [data])
  if (loading || !data) return <Spinner />
  const desc = Object.fromEntries(data.map((s) => [s.key, s.description]))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => data.find((s) => s.key === k)?.value !== v))
      setData(await api.put('/settings', changed))
      await refreshSettings()
      toast.success('Configuración actualizada')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const backup = async () => {
    setBacking(true)
    try {
      const res = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      if (!res.ok) throw new Error('No se pudo generar el respaldo')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `sigo-respaldo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`
      a.click()
      toast.success('Respaldo generado')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBacking(false)
    }
  }

  return (
    <div>
      <PageHeader title="Configuración" subtitle="Parámetros globales del sistema" icon={<Settings className="size-5" />} actions={<Button icon={<Save className="size-4" />} loading={saving} onClick={save}>Guardar cambios</Button>} />
      <ErrorBox message={error} />
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g.title} title={g.title}>
            <div className="space-y-4">
              {g.keys.map((k) => (
                <Field key={k} label={desc[k] ?? k}>
                  {BOOL.includes(k) ? (
                    <Select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                      <option value="true">Activado</option>
                      <option value="false">Desactivado</option>
                    </Select>
                  ) : (
                    <Input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                  )}
                </Field>
              ))}
              {g.title === 'Seguridad' && f.mfa_obligatorio === 'true' && (
                <Notice tone="amber">Con MFA obligatorio, los usuarios sin MFA verificado no podrán acceder a expedientes clínicos ni a información financiera hasta activarlo en «Mi perfil».</Notice>
              )}
            </div>
          </Card>
        ))}
        <Card title="Respaldo de información">
          <p className="text-sm text-slate-600">Exporta todas las tablas operativas en formato JSON (sin contraseñas ni secretos MFA). La operación queda registrada en la auditoría.</p>
          <Button className="mt-4" variant="secondary" icon={<DatabaseBackup className="size-4" />} loading={backing} onClick={backup}>Descargar respaldo</Button>
        </Card>
      </div>
    </div>
  )
}
