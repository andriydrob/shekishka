import { RING, special } from './board.js'
import { apply, legalActions, ringIdx, roll, type Action, type Piece, type State } from './engine.js'

export type Level = 'easy' | 'medium' | 'hard'

function value(pc: Piece): number {
  switch (pc.at) {
    case 'home': return 0
    case 'ready': return 12
    case 'captured': return -6
    case 'jail': return 6 + pc.stage * 4 + pc.p * 0.5
    case 'ring': return 14 + pc.p
    case 'done': return 80 + pc.slot * 3 // спершу заповнювати глибші слоти
  }
}

// Шанс, що суперник позаду дістане фішку одним кубиком чи сумою (грубо).
function danger(st: State, me: number): number {
  let risk = 0
  st.pieces[me].forEach((pc) => {
    if (pc.at !== 'ring') return
    const t = ringIdx(st.sides[me], pc.p)
    if (special(t) === 'corner') return
    st.pieces.forEach((row, pl) => {
      if (pl === me) return
      for (const o of row) {
        if (o.at !== 'ring') continue
        const d = (t - ringIdx(st.sides[pl], o.p) + RING) % RING
        if (d >= 1 && d <= 12) risk += (d <= 6 ? 0.31 : 0.12) * value(pc)
      }
    })
  })
  return risk
}

function score(st: State, me: number, careful: boolean): number {
  const places = st.places ?? []
  if (places.includes(me)) return 1e6 - 1e3 * places.indexOf(me) // фінішувати — і чим раніше, тим краще
  if (st.winner !== null) return -1e6 // гра скінчилась, а мене серед місць нема — програв
  const sum = (pl: number) => st.pieces[pl].reduce((a, pc) => a + value(pc), 0)
  const prisoners = st.pieces.flat().filter((pc) => pc.at === 'captured' && pc.by === me).length
  let opp = 0
  st.pieces.forEach((_, pl) => pl !== me && (opp = Math.max(opp, sum(pl))))
  return sum(me) - 0.8 * opp + 4 * prisoners - (careful ? danger(st, me) : 0)
}

export function chooseAction(st: State, level: Level, rng: () => number = Math.random): Action {
  const me = st.current
  const moves = legalActions(st)
  if (moves.length === 0) return { type: 'pass' }
  if (level === 'easy') return moves[Math.floor(rng() * moves.length)].action
  let best = moves[0].action
  let bestScore = -Infinity
  for (const m of moves) {
    let s = score(m.next, me, level === 'hard')
    if (level === 'hard' && m.next.current === me && m.next.dice) {
      // дивимось і на другий кубик
      const follow = legalActions(m.next)
      for (const f of follow) s = Math.max(s, score(f.next, me, true))
    }
    if (s > bestScore) [best, bestScore] = [m.action, s]
  }
  return best
}

// Час вийшов: гра сама робить бонус за викуп, кидає кубики й робить випадкові дозволені ходи до кінця ходу.
export function autoplay(st: State, rng: () => number = Math.random): State {
  const me = st.current
  let s = st
  while (s.current === me && s.winner === null) s = s.dice || legalActions(s).length ? apply(s, chooseAction(s, 'easy', rng))! : roll(s, rng)
  return s
}
