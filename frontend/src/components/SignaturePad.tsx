import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { Eraser } from 'lucide-react'

export interface SignaturePadHandle {
  clear: () => void
  toDataURL: () => string | null
}

/** Captura de firma manuscrita en pantalla táctil, lápiz o mouse (RF-06). */
export default function SignaturePad({ ref, height = 180 }: { ref?: Ref<SignaturePadHandle>; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = canvas.current!
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = height * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [height])

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  useImperativeHandle(ref, () => ({
    clear: () => {
      const c = canvas.current!
      c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
      dirty.current = false
    },
    toDataURL: () => (dirty.current ? canvas.current!.toDataURL('image/png') : null),
  }))

  return (
    <div className="relative">
      <canvas
        ref={canvas}
        style={{ height, touchAction: 'none' }}
        className="w-full cursor-crosshair rounded-xl border-2 border-dashed border-slate-300 bg-white"
        onPointerDown={(e) => {
          drawing.current = true
          last.current = pos(e)
          canvas.current!.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return
          const p = pos(e)
          const ctx = canvas.current!.getContext('2d')!
          ctx.beginPath()
          ctx.moveTo(last.current.x, last.current.y)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          last.current = p
          dirty.current = true
        }}
        onPointerUp={() => {
          drawing.current = false
          last.current = null
        }}
      />
      <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-slate-300" />
      <span className="pointer-events-none absolute bottom-2 left-6 text-[11px] text-slate-400">Firme dentro del recuadro</span>
      <button type="button" className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs text-slate-500 ring-1 ring-slate-200 hover:text-slate-800" onClick={() => {
        const c = canvas.current!
        c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
        dirty.current = false
      }}>
        <Eraser className="size-3.5" /> Limpiar
      </button>
    </div>
  )
}
