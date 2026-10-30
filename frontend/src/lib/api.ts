// Cliente HTTP de la API REST de SIGO-Dental.

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const TOKEN_KEY = 'sigo.token'

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifique que la API esté en ejecución.')
  }
  const text = await res.text()
  const data = text ? safeJSON(text) : null
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized()
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.code)
  }
  return data as T
}

function safeJSON(t: string) {
  try {
    return JSON.parse(t)
  } catch {
    return { error: t }
  }
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(p: string, f: FormData) => request<T>('POST', p, f),
}

/** URL autenticada para abrir archivos en una pestaña nueva. */
export function fileURL(id: number, download = false) {
  return `/api/files/${id}?token=${encodeURIComponent(tokenStore.get() ?? '')}${download ? '&download=1' : ''}`
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 0) s.set(k, String(v))
  })
  const str = s.toString()
  return str ? `?${str}` : ''
}
