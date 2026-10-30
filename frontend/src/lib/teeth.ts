// Nomenclatura dental FDI (ISO 3950) y Universal (ADA).

export type Notation = 'fdi' | 'universal'
export type Dentition = 'permanente' | 'temporal' | 'mixta'

export const PERMANENT = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
}
export const DECIDUOUS = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
}

const UNIVERSAL_DECIDUOUS: Record<number, string> = {
  55: 'A', 54: 'B', 53: 'C', 52: 'D', 51: 'E', 61: 'F', 62: 'G', 63: 'H', 64: 'I', 65: 'J',
  75: 'K', 74: 'L', 73: 'M', 72: 'N', 71: 'O', 81: 'P', 82: 'Q', 83: 'R', 84: 'S', 85: 'T',
}

/** Convierte un código FDI a la notación Universal americana. */
export function toUniversal(fdi: number): string {
  const q = Math.floor(fdi / 10)
  const n = fdi % 10
  switch (q) {
    case 1: return String(9 - n)
    case 2: return String(8 + n)
    case 3: return String(25 - n)
    case 4: return String(24 + n)
    default: return UNIVERSAL_DECIDUOUS[fdi] ?? String(fdi)
  }
}

export const toothLabel = (fdi: number, notation: Notation) => (notation === 'fdi' ? String(fdi) : toUniversal(fdi))

export const isUpper = (fdi: number) => [1, 2, 5, 6].includes(Math.floor(fdi / 10))
/** Cuadrantes del lado derecho del paciente (se dibujan a la izquierda del gráfico). */
export const isPatientRight = (fdi: number) => [1, 4, 5, 8].includes(Math.floor(fdi / 10))
export const isAnterior = (fdi: number) => fdi % 10 <= 3

export function toothName(fdi: number): string {
  const n = fdi % 10
  const q = Math.floor(fdi / 10)
  const temp = q >= 5
  const arc = isUpper(fdi) ? 'superior' : 'inferior'
  const side = isPatientRight(fdi) ? 'derecho' : 'izquierdo'
  const names = temp
    ? ['', 'Incisivo central', 'Incisivo lateral', 'Canino', 'Primer molar', 'Segundo molar']
    : ['', 'Incisivo central', 'Incisivo lateral', 'Canino', 'Primer premolar', 'Segundo premolar', 'Primer molar', 'Segundo molar', 'Tercer molar']
  return `${names[n]} ${arc} ${side}${temp ? ' (temporal)' : ''}`
}

export type Surface = 'M' | 'D' | 'O' | 'V' | 'L'

export function surfaceName(s: string, fdi: number) {
  switch (s) {
    case 'M': return 'Mesial'
    case 'D': return 'Distal'
    case 'O': return isAnterior(fdi) ? 'Incisal' : 'Oclusal'
    case 'V': return 'Vestibular'
    case 'L': return isUpper(fdi) ? 'Palatino' : 'Lingual'
  }
  return s
}

export interface ConditionDef {
  id: string
  label: string
  surface: boolean
  color: string
  defaultStatus: 'existente' | 'planificado'
}

/** Catálogo visual estandarizado (RF-03). Rojo = patología / por realizar; azul = existente / realizado. */
export const CONDITIONS: ConditionDef[] = [
  { id: 'caries', label: 'Caries', surface: true, color: '#dc2626', defaultStatus: 'existente' },
  { id: 'restauracion', label: 'Restauración', surface: true, color: '#2563eb', defaultStatus: 'existente' },
  { id: 'sellante', label: 'Sellante', surface: true, color: '#0891b2', defaultStatus: 'existente' },
  { id: 'fractura', label: 'Fractura', surface: true, color: '#ea580c', defaultStatus: 'existente' },
  { id: 'endodoncia', label: 'Endodoncia realizada', surface: false, color: '#2563eb', defaultStatus: 'existente' },
  { id: 'endodoncia_requerida', label: 'Endodoncia requerida', surface: false, color: '#dc2626', defaultStatus: 'planificado' },
  { id: 'corona', label: 'Corona', surface: false, color: '#2563eb', defaultStatus: 'existente' },
  { id: 'implante', label: 'Implante', surface: false, color: '#2563eb', defaultStatus: 'existente' },
  { id: 'protesis_fija', label: 'Prótesis fija', surface: false, color: '#2563eb', defaultStatus: 'existente' },
  { id: 'protesis_removible', label: 'Prótesis removible', surface: false, color: '#2563eb', defaultStatus: 'existente' },
  { id: 'exodoncia', label: 'Exodoncia indicada', surface: false, color: '#dc2626', defaultStatus: 'planificado' },
  { id: 'ausente', label: 'Ausente / extraído', surface: false, color: '#475569', defaultStatus: 'existente' },
]

export const CONDITION = Object.fromEntries(CONDITIONS.map((c) => [c.id, c])) as Record<string, ConditionDef>

export interface Finding {
  id: number
  tooth: number
  surface: string | null
  condition: string
  status: 'existente' | 'planificado' | 'realizado'
  notes?: string | null
  created_at: string
  created_by_name?: string
  plan_item_id?: number | null
}

/** Color con el que se pinta un hallazgo según su estado. */
export function findingColor(f: Pick<Finding, 'condition' | 'status'>) {
  const def = CONDITION[f.condition]
  if (!def) return '#64748b'
  if (f.condition === 'caries' || f.condition === 'fractura') return f.status === 'realizado' ? '#2563eb' : def.color
  if (f.status === 'planificado') return '#dc2626'
  return def.color
}
