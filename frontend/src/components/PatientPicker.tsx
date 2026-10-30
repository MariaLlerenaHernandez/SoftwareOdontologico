import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { useDebounced } from '../lib/hooks'

export interface PickedPatient {
  id: number
  first_name: string
  last_name: string
  document_number: string
  record_number: string
  alerts?: string[]
}

/** Buscador de pacientes por nombre, documento o historia clínica. */
export default function PatientPicker({ value, onChange, autoFocus }: { value: PickedPatient | null; onChange: (p: PickedPatient | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<PickedPatient[]>([])
  const dq = useDebounced(q, 250)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dq || value) return setResults([])
    api.get<PickedPatient[]>(`/patients?q=${encodeURIComponent(dq)}&limit=8`).then(setResults).catch(() => setResults([]))
  }, [dq, value])

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (value)
    return (
      <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
        <div>
          <p className="font-medium text-brand-900">
            {value.first_name} {value.last_name}
          </p>
          <p className="text-xs text-brand-700/80">
            {value.record_number} · Doc. {value.document_number}
          </p>
        </div>
        <button type="button" className="rounded p-1 text-brand-700 hover:bg-brand-100" onClick={() => (onChange(null), setQ(''))} aria-label="Quitar paciente">
          <X className="size-4" />
        </button>
      </div>
    )

  return (
    <div className="relative" ref={ref}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        className="input pl-9"
        placeholder="Buscar por nombre, cédula o N.º de historia…"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => (onChange(p), setOpen(false))}
              >
                <span>
                  <span className="font-medium text-slate-800">
                    {p.first_name} {p.last_name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {p.record_number} · {p.document_number}
                  </span>
                </span>
                {!!p.alerts?.length && <AlertTriangle className="size-4 text-rose-500" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
