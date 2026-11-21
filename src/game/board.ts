// Поле 13×13. Кільце з 48 клітинок, рух проти годинникової стрілки.
// Сторони в порядку руху: 0 верх, 1 ліво, 2 низ, 3 право.
// На кожній стороні pos 0 = кут, далі 1..11 у напрямку руху.
export const SIZE = 13
export const RING = 48
export type Side = 0 | 1 | 2 | 3
export type Cell = { c: number; r: number }

export const mod = (a: number, m: number) => ((a % m) + m) % m

export const POS = { corner: 0, back: 3, landing: 5, start: 6, fly: 7, jail: 8 } as const
export const JUMP = 10 // П: +10 клітинок, В: −10

export const startIdx = (side: Side) => 12 * side + POS.start

export type Special = 'corner' | 'fly' | 'back' | 'jail' | null
export function special(idx: number): Special {
  const p = mod(idx, 12)
  return p === POS.corner ? 'corner' : p === POS.fly ? 'fly' : p === POS.back ? 'back' : p === POS.jail ? 'jail' : null
}

export function ringCell(idx: number): Cell {
  const i = mod(idx, RING)
  const s = Math.floor(i / 12)
  const p = i % 12
  if (s === 0) return { c: 12 - p, r: 0 }
  if (s === 1) return { c: 0, r: p }
  if (s === 2) return { c: p, r: 12 }
  return { c: 12, r: 12 - p }
}

// Клітинка всередині поля навпроти позиції pos сторони side, на глибині depth (1 = впритул до кільця).
export function innerCell(side: Side, pos: number, depth: number): Cell {
  if (side === 0) return { c: 12 - pos, r: depth }
  if (side === 1) return { c: depth, r: pos }
  if (side === 2) return { c: pos, r: 12 - depth }
  return { c: 12 - depth, r: 12 - pos }
}

// Рукав (дім): slot 0 біля кільця, slot 3 найглибший.
export const armCell = (side: Side, slot: number) => innerCell(side, POS.start, slot + 1)
// Тюрма: stage 0 = «Т», 1 = «3», 2 = «6».
export const jailCell = (side: Side, stage: number) => innerCell(side, POS.jail + stage, 1)
export const jailLabels = ['Т', '3', '6']
// Будиночок: стовпчик із 4 місць поруч із рукавом — сюди фішка стає після шістки й звідси виходить на кільце.
export const nestCell = (side: Side, k: number) => innerCell(side, POS.start - 1, 1 + k)
// Поза дошкою: ряд із 4 місць за краєм навпроти рукава — тут фішки чекають на шістку.
export const homeCell = (side: Side, k: number) => innerCell(side, POS.start - 2 + k, -1.3)
