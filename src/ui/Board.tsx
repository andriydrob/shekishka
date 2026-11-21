import { POS, RING, SIZE, armCell, jailCell, jailLabels, nestCell, ringCell, special, startIdx, type Cell, type Side } from '../game/board'
import { ARM_START, ringIdx, type Action, type State } from '../game/engine'

export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#facc15', '#22c55e']
export const PLAYER_NAMES_COLOR = ['Синій', 'Червоний', 'Жовтий', 'Зелений']

const U = 10 // розмір клітинки в одиницях SVG
const center = (c: Cell) => ({ x: c.c * U + U / 2, y: c.r * U + U / 2 })

// Де стоїть фішка; null — у полоні (показується в інвентарі).
export function pieceCell(st: State, pl: number, pi: number): Cell | null {
  const side = st.sides[pl]
  const pc = st.pieces[pl][pi]
  switch (pc.at) {
    case 'ring': return ringCell(ringIdx(side, pc.p))
    case 'jail': return jailCell((Math.floor(ringIdx(side, pc.p) / 12)) as Side, pc.stage)
    case 'done': return armCell(side, pc.slot)
    case 'captured': return null
    case 'home': {
      // до шістки фішки чекають у будиночку біля рукава
      const order = st.pieces[pl].map((x, i) => (x.at === 'home' ? i : -1)).filter((i) => i >= 0)
      return nestCell(side, order.indexOf(pi))
    }
    case 'ready': {
      // введені шісткою стоять у рукаві на вільних клітинках, ближчих до кільця
      const used = new Set(st.pieces[pl].flatMap((x) => (x.at === 'done' ? [x.slot] : [])))
      const free = [0, 1, 2, 3].filter((s) => !used.has(s))
      const order = st.pieces[pl].map((x, i) => (x.at === 'ready' ? i : -1)).filter((i) => i >= 0)
      return armCell(side, free[order.indexOf(pi)])
    }
  }
}

// Клітинка, де фішка зупиняється за кубиками (до польоту по П/В чи заходу в тюрму).
// null — коли ціль і є фінальна клітинка (вихід, викуп, кроки в тюрмі).
export function stopCell(st: State, a: Action): Cell | null {
  if (a.type !== 'use' || !st.dice) return null
  const me = st.current
  const pc = st.pieces[me][a.piece]
  const from = pc.at === 'ready' ? -1 : pc.at === 'ring' || (pc.at === 'jail' && pc.stage === 2) ? pc.p : null
  if (from === null) return null
  const q = from + a.dice.reduce((s: number, i) => s + st.dice![i], 0)
  return q >= ARM_START ? armCell(st.sides[me], q - ARM_START) : ringCell(ringIdx(st.sides[me], q))
}

export interface Hop { pl: number; pi: number; cell: Cell }

export interface Target { key: string; cell: Cell; label: string; capture: boolean; onPick: () => void }

interface Props {
  state: State
  selectable: Set<number> // фішки поточного гравця, якими можна ходити
  selected: number | null
  onSelect: (pi: number) => void
  targets: Target[]
  hop: Hop | null // фішка, що зараз стоїть на П/В/стрілці перед стрибком
}

const SIDES: Side[] = [0, 1, 2, 3]

export function Board({ state, selectable, selected, onSelect, targets, hop }: Props) {
  const ring = Array.from({ length: RING }, (_, i) => i)
  const owner = (side: Side) => state.sides.indexOf(side)

  return (
    <svg className="board" viewBox={`-3 -3 ${SIZE * U + 6} ${SIZE * U + 6}`} role="img" aria-label="Ігрове поле">
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2bf8d" />
          <stop offset="0.5" stopColor="#d4a874" />
          <stop offset="1" stopColor="#c69660" />
        </linearGradient>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.35" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.28  0 0 0 0 0.12  0 0 0 0.22 0" />
        </filter>
        {['red', 'ink'].map((id) => (
          <marker key={id} id={`arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={id === 'red' ? 'var(--fly)' : 'var(--ink)'} />
          </marker>
        ))}
        <radialGradient id="shine" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="-3" y="-3" width={SIZE * U + 6} height={SIZE * U + 6} rx="3" fill="url(#wood)" />
      <rect x="-3" y="-3" width={SIZE * U + 6} height={SIZE * U + 6} rx="3" filter="url(#grain)" />

      {/* кільце */}
      {ring.map((i) => {
        const { c, r } = ringCell(i)
        const sp = special(i)
        const x = c * U, y = r * U
        const startOf = SIDES.find((s) => startIdx(s) === i)
        const pl = startOf === undefined ? -1 : owner(startOf)
        return (
          <g key={i}>
            <rect x={x} y={y} width={U} height={U} className="cell" fill={pl >= 0 ? PLAYER_COLORS[pl] : 'none'} fillOpacity={pl >= 0 ? 0.28 : 0} />
            {sp === 'corner' && <Checker x={x} y={y} />}
            {sp === 'fly' && <text x={x + U / 2} y={y + U / 2} className="mark fly">П</text>}
            {sp === 'back' && <text x={x + U / 2} y={y + U / 2} className="mark">В</text>}
            {sp === 'jail' && <JailArrow side={Math.floor(i / 12) as Side} x={x} y={y} />}
          </g>
        )
      })}

      {/* рукави (дім) і тюрми */}
      {SIDES.map((side) => {
        const pl = owner(side)
        return (
          <g key={side}>
            {pl >= 0 && <Nest side={side} color={PLAYER_COLORS[pl]} />}
            {[0, 1, 2, 3].map((slot) => {
              const { c, r } = armCell(side, slot)
              return <rect key={slot} x={c * U} y={r * U} width={U} height={U} className="cell" fill={pl >= 0 ? PLAYER_COLORS[pl] : 'none'} fillOpacity={pl >= 0 ? 0.2 : 0} />
            })}
            {jailLabels.map((t, stage) => {
              const { c, r } = jailCell(side, stage)
              return (
                <g key={t}>
                  <rect x={c * U} y={r * U} width={U} height={U} className="cell" fill="none" />
                  <text x={c * U + U / 2} y={r * U + U / 2} className="mark">{t}</text>
                </g>
              )
            })}
          </g>
        )
      })}

      {/* стрілки П (червоні, вперед) і В (чорні, назад) */}
      {SIDES.map((side) => {
        const fly = center(ringCell(12 * side + POS.fly))
        const flyTo = center(ringCell(12 * side + POS.fly + 10))
        const back = center(ringCell(12 * side + POS.back))
        const backTo = center(ringCell(12 * side + POS.back - 10))
        return (
          <g key={side} className="routes">
            <line x1={fly.x} y1={fly.y} x2={flyTo.x} y2={flyTo.y} stroke="var(--fly)" markerEnd="url(#arrow-red)" />
            <line x1={back.x} y1={back.y} x2={backTo.x} y2={backTo.y} stroke="var(--ink)" markerEnd="url(#arrow-ink)" />
          </g>
        )
      })}

      {/* фішки */}
      {state.pieces.map((row, pl) =>
        row.map((pc, pi) => {
          const cell = hop && hop.pl === pl && hop.pi === pi ? hop.cell : pieceCell(state, pl, pi)
          if (!cell) return null
          const { x, y } = center(cell)
          const can = pl === state.current && selectable.has(pi)
          const cls = ['piece', can && 'can', selected === pi && pl === state.current && 'sel', pc.at === 'done' && 'done', pc.at === 'ready' && 'ready'].filter(Boolean).join(' ')
          const label = `${PLAYER_NAMES_COLOR[pl]} фішка ${pi + 1}`
          return (
            <g key={`${pl}-${pi}`} className={cls} style={{ transform: `translate(${x}px, ${y}px)` }}
              {...(can ? {
                role: 'button', tabIndex: 0, 'aria-label': label, 'aria-pressed': selected === pi,
                onClick: () => onSelect(pi),
                onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onSelect(pi),
              } : { 'aria-label': label })}>
              <circle r={U / 2} fill="transparent" />
              <circle r={3.3} fill={PLAYER_COLORS[pl]} className="body" />
              <circle r={3.3} fill="url(#shine)" />
              {pc.at === 'done' && <path d="M-1.6 0.1L-0.4 1.3L1.7 -1.2" className="check" />}
            </g>
          )
        }),
      )}
      {/* цілі ходу — поверх фішок, щоб можна було натиснути на фішку суперника */}
      {targets.map((t) => {
        const { x, y } = center(t.cell)
        return (
          <g key={t.key} className={`target ${t.capture ? 'capture' : ''}`} role="button" tabIndex={0} aria-label={`Походити на ${t.label}${t.capture ? ', побити фішку' : ''}`}
            onClick={t.onPick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && t.onPick()}>
            <circle cx={x} cy={y} r={4.4} />
            <text x={x} y={y}>{t.label}</text>
          </g>
        )
      })}

    </svg>
  )
}

function Nest({ side, color }: { side: Side; color: string }) {
  const cells = [0, 1, 2, 3].map((k) => nestCell(side, k))
  const cs = cells.map((c) => c.c), rs = cells.map((c) => c.r)
  const x = Math.min(...cs) * U, y = Math.min(...rs) * U
  const w = (Math.max(...cs) + 1) * U - x, h = (Math.max(...rs) + 1) * U - y
  return <rect x={x + 0.8} y={y + 0.8} width={w - 1.6} height={h - 1.6} rx={3} className="nest" fill={color} />
}

function Checker({ x, y }: { x: number; y: number }) {
  const s = U / 3
  return (
    <g>
      {Array.from({ length: 9 }, (_, k) =>
        (k % 2 === 0) ? <rect key={k} x={x + (k % 3) * s} y={y + Math.floor(k / 3) * s} width={s} height={s} fill="var(--ink)" /> : null,
      )}
    </g>
  )
}

// Маленька стрілка в клітинці, що показує в бік «Т».
function JailArrow({ side, x, y }: { side: Side; x: number; y: number }) {
  const rot = [90, 0, 270, 180][side] // напрямок усередину поля
  return (
    <g transform={`translate(${x + U / 2} ${y + U / 2}) rotate(${rot})`}>
      <path d="M-2.5 -2.2 V1 H2" className="jail-arrow" markerEnd="url(#arrow-ink)" />
    </g>
  )
}
