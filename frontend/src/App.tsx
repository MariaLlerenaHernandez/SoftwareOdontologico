import { lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth, type Role } from './lib/auth'
import Layout from './components/Layout'
import { Empty, Spinner } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
const Patients = lazy(() => import('./pages/Patients'))
const PatientDetail = lazy(() => import('./pages/PatientDetail'))
const Agenda = lazy(() => import('./pages/Agenda'))
const Billing = lazy(() => import('./pages/Billing'))
const Cash = lazy(() => import('./pages/Cash'))
const Commissions = lazy(() => import('./pages/Commissions'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Reports = lazy(() => import('./pages/Reports'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Users = lazy(() => import('./pages/admin/Users'))
const Catalogs = lazy(() => import('./pages/admin/Catalogs'))
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'))
const Audit = lazy(() => import('./pages/admin/Audit'))
const Profile = lazy(() => import('./pages/Profile'))

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(...roles))
    return (
      <Empty icon={<ShieldAlert className="size-6" />} title="Acceso restringido">
        Su rol no tiene permisos para este módulo (control de acceso basado en roles).
      </Empty>
    )
  return <>{children}</>
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner label="Iniciando SIGO-Dental…" />
  if (!user) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="pacientes" element={<Patients />} />
        <Route path="pacientes/:id" element={<PatientDetail />} />
        <Route path="facturacion" element={<Guard roles={['admin', 'recepcion', 'auditor']}><Billing /></Guard>} />
        <Route path="caja" element={<Guard roles={['admin', 'recepcion', 'auditor']}><Cash /></Guard>} />
        <Route path="honorarios" element={<Guard roles={['admin', 'auditor', 'odontologo']}><Commissions /></Guard>} />
        <Route path="inventario" element={<Guard roles={['admin', 'odontologo', 'asistente', 'auditor']}><Inventory /></Guard>} />
        <Route path="reportes" element={<Guard roles={['admin', 'auditor', 'recepcion']}><Reports /></Guard>} />
        <Route path="notificaciones" element={<Guard roles={['admin', 'recepcion']}><Notifications /></Guard>} />
        <Route path="admin/usuarios" element={<Guard roles={['admin']}><Users /></Guard>} />
        <Route path="admin/catalogos" element={<Guard roles={['admin']}><Catalogs /></Guard>} />
        <Route path="admin/configuracion" element={<Guard roles={['admin']}><SettingsPage /></Guard>} />
        <Route path="admin/auditoria" element={<Guard roles={['admin', 'auditor']}><Audit /></Guard>} />
        <Route path="perfil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
