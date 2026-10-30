import { useMemo } from 'react'
import {
  DECIDUOUS,
  PERMANENT,
  findingColor,
  isPatientRight,
  isUpper,
  toothLabel,
  type Dentition,
  type Finding,
  type Notation,
  type Surface,
} from '../lib/teeth'

const S = 40 // lado de la corona
const I = 12 // margen de la cara oclusal
const ROOT = 16 // alto de la zona radicular
const GAP = 8 // separación entre piezas
const MID = 20 // separación en la línea media
const W = S + GAP

interface Props {
  findings: Finding[]
  notation: Notation
  dentition: Dentition
  selected?: number | null
  onSurface?: (tooth: number, surface: Surface) => void
  onTooth?: (tooth: number) => void
}

/** Odontograma gráfico interactivo 2D (RF-03). */
export default function Odontogram({ findings, notation, dentition, selected, onSurface, onTooth }: Props) {
  const byTooth = useMemo(() => {
    const m = new Map<number, Finding[]>()
    findings.forEach((f) => m.set(f.tooth, [...(m.get(f.tooth) ?? []), f]))
    return m
  }, [findings])

  const rows: { teeth: number[]; upper: boolean }[] = []
  if (dentition !== 'temporal') rows.push({ teeth: PERMANENT.upper, upper: true })
  if (dentition !== 'permanente') rows.push({ teeth: DECIDUOUS.upper, upper: true }, { teeth: DECIDUOUS.lower, upper: false })
  if (dentition !== 'temporal') rows.push({ teeth: PERMANENT.lower, upper: false })

  const rowH = S + ROOT + 26
  const fullW = 16 * W + MID
  return (
    <svg viewBox={`-6 -6 ${fullW + 12} ${rows.length * rowH + 30}`} className="w-full select-none" role="img" aria-label="Odontograma">
      {rows.map((row, r) => {
        const half = row.teeth.length / 2
        const offset = ((16 - row.teeth.length) / 2) * W
        const y = r * rowH + (r >= rows.length / 2 ? 24 : 0)
        return (
          <g key={r} transform={`translate(0 ${y})`}>
            {row.teeth.map((t, i) => {
              const x = offset + i * W + (i >= half ? MID : 0)
              return (
                <Tooth
                  key={t}
                  tooth={t}
                  x={x}
                  findings={byTooth.get(t) ?? []}
                  label={toothLabel(t, notation)}
                  selected={selected === t}
                  onSurface={onSurface}
                  onTooth={onTooth}
                />
              )
            })}
          </g>
        )
      })}
      <line x1={fullW / 2 - 2} x2={fullW / 2 - 2} y1={-4} y2={rows.length * rowH + 24} stroke="#cbd5e1" strokeDasharray="4 4" />
      <line x1={0} x2={fullW - 4} y1={(rows.length / 2) * rowH + 10} y2={(rows.length / 2) * rowH + 10} stroke="#cbd5e1" strokeDasharray="4 4" />
    </svg>
  )
}

function Tooth({
  tooth,
  x,
  findings,
  label,
  selected,
  onSurface,
  onTooth,
}: {
  tooth: number
  x: number
  findings: Finding[]
  label: string
  selected: boolean
  onSurface?: Props['onSurface']
  onTooth?: Props['onTooth']
}) {
  const upper = isUpper(tooth)
  const right = isPatientRight(tooth)
  // Posición vertical: raíz arriba en superiores, abajo en inferiores
  const crownY = upper ? ROOT + 4 : 18
  const rootY = upper ? 0 : crownY + S
  const labelY = upper ? crownY + S + 14 : 11

  const surfaceAt: Record<'top' | 'bottom' | 'left' | 'right' | 'center', Surface> = {
    top: upper ? 'V' : 'L',
    bottom: upper ? 'L' : 'V',
    left: right ? 'D' : 'M',
    right: right ? 'M' : 'D',
    center: 'O',
  }

  const surfaceColor = (s: Surface) => {
    const f = [...findings].reverse().find((x) => x.surface === s)
    return f ? findingColor(f) : null
  }
  const whole = findings.filter((f) => !f.surface)
  const has = (c: string) => [...whole].reverse().find((f) => f.condition === c)

  const polys: Record<keyof typeof surfaceAt, string> = {
    top: `0,0 ${S},0 ${S - I},${I} ${I},${I}`,
    bottom: `0,${S} ${S},${S} ${S - I},${S - I} ${I},${S - I}`,
    left: `0,0 ${I},${I} ${I},${S - I} 0,${S}`,
    right: `${S},0 ${S - I},${I} ${S - I},${S - I} ${S},${S}`,
    center: `${I},${I} ${S - I},${I} ${S - I},${S - I} ${I},${S - I}`,
  }

  const absent = has('ausente')
  const extraction = has('exodoncia')
  const endo = has('endodoncia') ?? has('endodoncia_requerida')
  const crown = has('corona')
  const implant = has('implante')
  const fixed = has('protesis_fija')
  const removable = has('protesis_removible')

  const rootPath = upper
    ? `M${S / 2 - 7},${rootY + ROOT} L${S / 2 - 3},${rootY + 1} L${S / 2 + 3},${rootY + 1} L${S / 2 + 7},${rootY + ROOT} Z`
    : `M${S / 2 - 7},${rootY} L${S / 2 - 3},${rootY + ROOT - 1} L${S / 2 + 3},${rootY + ROOT - 1} L${S / 2 + 7},${rootY} Z`

  return (
    <g transform={`translate(${x} 0)`} className="cursor-pointer">
      <title>{`Pieza ${label}`}</title>
      {selected && <rect x={-4} y={crownY - 4} width={S + 8} height={S + 8} rx={6} fill="#ccfbf1" stroke="#0d9488" strokeWidth={1.5} />}
      {/* raíz */}
      <path
        d={rootPath}
        fill={implant ? '#e2e8f0' : endo ? findingColor(endo) : '#f8fafc'}
        stroke={implant ? findingColor(implant) : '#cbd5e1'}
        strokeWidth={implant ? 1.6 : 1}
        onClick={() => onTooth?.(tooth)}
      />
      {implant &&
        [0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={S / 2 - 6} x2={S / 2 + 6} y1={rootY + ROOT * p} y2={rootY + ROOT * p} stroke={findingColor(implant)} strokeWidth={1.4} />
        ))}
      <text x={S / 2} y={labelY} textAnchor="middle" fontSize={11} fontWeight={600} fill={selected ? '#0f766e' : '#475569'} onClick={() => onTooth?.(tooth)}>
        {label}
      </text>
      <g transform={`translate(0 ${crownY})`} opacity={absent ? 0.35 : 1}>
        {(Object.keys(polys) as (keyof typeof polys)[]).map((k) => {
          const s = surfaceAt[k]
          const c = surfaceColor(s)
          return (
            <polygon
              key={k}
              points={polys[k]}
              fill={c ?? '#ffffff'}
              fillOpacity={c ? 0.85 : 1}
              stroke="#94a3b8"
              strokeWidth={1}
              className={c ? 'hover:opacity-80' : 'hover:fill-brand-100'}
              onClick={(e) => {
                e.stopPropagation()
                onSurface?.(tooth, s)
              }}
            >
              <title>{`Pieza ${label} · superficie ${s}`}</title>
            </polygon>
          )
        })}
        {crown && <circle cx={S / 2} cy={S / 2} r={S / 2 + 2} fill="none" stroke={findingColor(crown)} strokeWidth={2.5} pointerEvents="none" />}
        {(absent || extraction) && (
          <g stroke={absent ? '#334155' : findingColor(extraction!)} strokeWidth={3} strokeLinecap="round" pointerEvents="none">
            <line x1={2} y1={2} x2={S - 2} y2={S - 2} />
            <line x1={S - 2} y1={2} x2={2} y2={S - 2} />
          </g>
        )}
        {(fixed || removable) && (
          <line
            x1={-GAP / 2}
            x2={S + GAP / 2}
            y1={upper ? -3 : S + 3}
            y2={upper ? -3 : S + 3}
            stroke={findingColor((fixed ?? removable)!)}
            strokeWidth={3}
            strokeDasharray={fixed ? undefined : '4 3'}
            pointerEvents="none"
          />
        )}
      </g>
    </g>
  )
}

export function OdontogramLegend() {
  const items = [
    { c: '#dc2626', l: 'Caries / tratamiento por realizar' },
    { c: '#2563eb', l: 'Restauración existente / realizado' },
    { c: '#0891b2', l: 'Sellante' },
    { c: '#ea580c', l: 'Fractura' },
  ]
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.l} className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: i.c }} /> {i.l}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><line x1="2" y1="2" x2="12" y2="12" stroke="#dc2626" strokeWidth="2.5" /><line x1="12" y1="2" x2="2" y2="12" stroke="#dc2626" strokeWidth="2.5" /></svg> Exodoncia
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="#2563eb" strokeWidth="2" /></svg> Corona
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#2563eb" strokeWidth="3" /></svg> Prótesis fija
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#2563eb" strokeWidth="3" strokeDasharray="4 3" /></svg> Prótesis removible
      </span>
    </div>
  )
}
