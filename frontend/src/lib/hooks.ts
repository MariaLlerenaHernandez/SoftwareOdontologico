import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/** Carga datos de la API y expone estado de carga, error y recarga. */
export function useFetch<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!path) return
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const d = await api.get<T>(path)
      if (id === seq.current) setData(d)
    } catch (e: any) {
      if (id === seq.current) setError(e.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, reload: load, setData }
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
