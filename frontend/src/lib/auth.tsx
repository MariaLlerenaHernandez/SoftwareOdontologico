import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from './api'

export type Role = 'admin' | 'recepcion' | 'odontologo' | 'asistente' | 'auditor'

export interface User {
  id: number
  email: string
  full_name: string
  role: Role
  specialty?: string | null
  color?: string
  mfa_enabled: boolean
  mfa_verified: boolean
}

export type PublicSettings = Record<string, string>

interface AuthState {
  user: User | null
  settings: PublicSettings
  loading: boolean
  login: (token: string, user: User) => void
  logout: (reason?: string) => void
  refreshSettings: () => Promise<void>
  can: (...roles: Role[]) => boolean
  logoutReason: string | null
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<PublicSettings>({})
  const [loading, setLoading] = useState(true)
  const [logoutReason, setLogoutReason] = useState<string | null>(null)

  const logout = useCallback((reason?: string) => {
    tokenStore.clear()
    setUser(null)
    setLogoutReason(reason ?? null)
  }, [])

  const refreshSettings = useCallback(async () => {
    setSettings(await api.get('/settings/public'))
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => logout('Su sesión expiró. Inicie sesión nuevamente.'))
    if (!tokenStore.get()) {
      setLoading(false)
      return
    }
    Promise.all([api.get<User>('/auth/me'), api.get('/settings/public')])
      .then(([u, s]) => {
        setUser(u)
        setSettings(s)
      })
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false))
  }, [logout])

  const login = useCallback(
    (token: string, u: User) => {
      tokenStore.set(token)
      setUser(u)
      setLogoutReason(null)
      refreshSettings().catch(() => {})
    },
    [refreshSettings],
  )

  const can = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user])

  const value = useMemo(
    () => ({ user, settings, loading, login, logout, refreshSettings, can, logoutReason }),
    [user, settings, loading, login, logout, refreshSettings, can, logoutReason],
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
