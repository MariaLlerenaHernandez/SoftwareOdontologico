import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  ClipboardList,
  FileText,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useAuth, type Role } from '../lib/auth'
import { ROLE_LABEL } from '../lib/format'
import { Avatar, Button, Modal, Spinner, cx } from './ui'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  roles?: Role[]
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Operación',
    items: [
      { to: '/', label: 'Inicio', icon: <LayoutDashboard className="size-4" /> },
      { to: '/agenda', label: 'Agenda', icon: <CalendarDays className="size-4" /> },
      { to: '/pacientes', label: 'Pacientes', icon: <Users className="size-4" /> },
    ],
  },
  {
    section: 'Finanzas',
    items: [
      { to: '/facturacion', label: 'Facturación', icon: <FileText className="size-4" />, roles: ['admin', 'recepcion', 'auditor'] },
      { to: '/caja', label: 'Caja', icon: <Wallet className="size-4" />, roles: ['admin', 'recepcion', 'auditor'] },
      { to: '/honorarios', label: 'Honorarios', icon: <HandCoins className="size-4" />, roles: ['admin', 'auditor', 'odontologo'] },
    ],
  },
  {
    section: 'Gestión',
    items: [
      { to: '/inventario', label: 'Inventario', icon: <Boxes className="size-4" />, roles: ['admin', 'odontologo', 'asistente', 'auditor'] },
      { to: '/reportes', label: 'Reportes', icon: <BarChart3 className="size-4" />, roles: ['admin', 'auditor', 'recepcion'] },
      { to: '/notificaciones', label: 'Notificaciones', icon: <Bell className="size-4" />, roles: ['admin', 'recepcion'] },
    ],
  },
  {
    section: 'Administración',
    items: [
      { to: '/admin/usuarios', label: 'Usuarios y roles', icon: <UserCog className="size-4" />, roles: ['admin'] },
      { to: '/admin/catalogos', label: 'Catálogos', icon: <ClipboardList className="size-4" />, roles: ['admin'] },
      { to: '/admin/configuracion', label: 'Configuración', icon: <Settings className="size-4" />, roles: ['admin'] },
      { to: '/admin/auditoria', label: 'Auditoría', icon: <ShieldCheck className="size-4" />, roles: ['admin', 'auditor'] },
    ],
  },
]

/** Cierre automático por inactividad (RNF-05). */
function useIdleLogout(minutes: number, onTimeout: () => void) {
  const [warning, setWarning] = useState(false)
  const [remaining, setRemaining] = useState(60)
  const last = useRef(Date.now())
  const timeout = useRef(onTimeout)
  timeout.current = onTimeout

  useEffect(() => {
    const bump = () => {
      last.current = Date.now()
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => {
      const idle = (Date.now() - last.current) / 1000
      const limit = minutes * 60
      if (idle >= limit) {
        timeout.current()
      } else if (idle >= limit - 60) {
        setWarning(true)
        setRemaining(Math.ceil(limit - idle))
      } else {
        setWarning(false)
      }
    }, 1000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(t)
    }
  }, [minutes])

  return { warning, remaining, keepAlive: () => (last.current = Date.now()) }
}

export default function Layout() {
  const { user, logout, can, settings } = useAuth()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const idleMin = Number(settings.sesion_inactividad_min) || 15
  const idle = useIdleLogout(idleMin, () => logout(`Su sesión se cerró tras ${idleMin} minutos de inactividad.`))

  useEffect(() => setOpen(false), [loc.pathname])
  if (!user) return null

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="/favicon.svg" alt="" className="size-9" />
        <div>
          <p className="text-sm leading-tight font-bold tracking-tight text-white">SIGO-Dental</p>
          <p className="text-[11px] leading-tight text-brand-200/80">{settings.clinica_nombre ?? 'Gestión odontológica'}</p>
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.roles || can(...i.roles))
          if (!items.length) return null
          return (
            <div key={g.section}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-brand-200/60 uppercase">{g.section}</p>
              <div className="space-y-0.5">
                {items.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/12 text-white shadow-inner' : 'text-brand-100/80 hover:bg-white/6 hover:text-white',
                      )
                    }
                  >
                    {i.icon}
                    {i.label}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <NavLink to="/perfil" className="m-3 flex items-center gap-3 rounded-xl bg-white/6 p-3 hover:bg-white/10">
        <Avatar name={user.full_name} color={user.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.full_name}</p>
          <p className="truncate text-xs text-brand-200/80">{ROLE_LABEL[user.role]}</p>
        </div>
        {user.mfa_verified && <ShieldCheck className="size-4 text-emerald-300" aria-label="MFA verificado" />}
      </NavLink>
    </nav>
  )

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-gradient-to-b from-brand-900 to-[#0b3b38] lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-gradient-to-b from-brand-900 to-[#0b3b38]">
            <button className="absolute top-4 right-3 text-white/70" onClick={() => setOpen(false)} aria-label="Cerrar menú">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Stethoscope className="size-4 text-brand-600" />
            <span className="hidden sm:inline">
              {new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-slate-400 md:inline">Cierre automático tras {idleMin} min de inactividad</span>
            <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => logout()}>
              Salir
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <Modal
        open={idle.warning}
        onClose={idle.keepAlive}
        title="¿Sigue ahí?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => logout()}>
              Cerrar sesión
            </Button>
            <Button onClick={idle.keepAlive}>Continuar trabajando</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Por seguridad de la información clínica, su sesión se cerrará en <strong className="tabular-nums">{idle.remaining} s</strong> por inactividad.
        </p>
      </Modal>
    </div>
  )
}
