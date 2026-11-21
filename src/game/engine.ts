import { JUMP, RING, mod, special, startIdx, type Side } from './board.js'

export type Piece =
  | { at: 'home' }
  | { at: 'ready' } // вийшла шісткою: ще в рукаві, клітинка під рукавом = перший крок
  | { at: 'ring'; p: number } // p = прогрес від своєї стартової клітинки (може бути −1 після «В»)
  | { at: 'jail'; p: number; stage: 0 | 1 | 2; since: number } // p = клітинка зі стрілкою
  | { at: 'captured'; by: number } // лежить в інвентарі гравця by
  | { at: 'done'; slot: number } // у рукаві (slot 0 біля кільця, 3 — кінець); фінішна лише коли дійшла до кінця — isFinished

// Фішка в рукаві зараховується, лише коли дійшла до кінця: усі глибші клітинки рукава зайняті своїми.
export function isFinished(row: Piece[], pi: number): boolean {
  const pc = row[pi]
  if (pc.at !== 'done') return false
  for (let s = pc.slot + 1; s < PIECES; s++) if (!row.some((x) => x.at === 'done' && x.slot === s)) return false
  return true
}

export type DieIdx = 0 | 1
// bonus — «6 кроків за викуп»: на початку свого ходу, до кидка
export type Action = { type: 'use'; piece: number; dice: DieIdx[] } | { type: 'bonus'; piece: number } | { type: 'pass' }

export interface State {
  sides: Side[]
  pieces: Piece[][]
  current: number
  turn: number
  dice: [number, number] | null
  used: [boolean, boolean]
  winner: number | null
  frozen: number | null // фішка поточного гравця, що вже била чи стрибала по П/В: до кінця ходу не ходить
  bonus: number[] // скільки разів у гравця викупили фішку: стільки разів по 6 кроків на початку його ходу
}

export const PIECES = 4
// Повне коло закінчується на своїй стартовій клітинці (прогрес 48 = клітинка під рукавом),
// і лише наступний крок заводить у рукав: прогрес 49..52 = слоти 0..3.
export const ARM_START = RING + 1
// вихід з тюрми: клітинка кільця під «6» (стрілка + 2) — це вже крок 1
export const JAIL_EXIT = 1
export const BONUS_STEPS = 6
export const SIDES_BY_COUNT: Record<number, Side[]> = { 2: [2, 0], 3: [2, 3, 0], 4: [2, 3, 0, 1] }

export type Rng = () => number
export const rollDie = (rng: Rng) => 1 + Math.floor(rng() * 6)

export function newGame(players: number, rng: Rng = Math.random): { state: State; opening: number[] } {
  const sides = SIDES_BY_COUNT[players]
  // Першим ходить той, хто викинув найбільшу суму; при нічиїй перекидають усі.
  let opening: number[]
  do opening = sides.map(() => rollDie(rng) + rollDie(rng))
  while (opening.filter((v) => v === Math.max(...opening)).length > 1)
  return {
    opening,
    state: {
      sides,
      pieces: sides.map(() => Array.from({ length: PIECES }, () => ({ at: 'home' }) as Piece)),
      current: opening.indexOf(Math.max(...opening)),
      turn: 0,
      dice: null,
      used: [false, false],
      winner: null,
      frozen: null,
      bonus: sides.map(() => 0),
    },
  }
}

export function roll(st: State, rng: Rng = Math.random): State {
  if (st.dice || st.winner !== null || legalActions(st).length) return st // спершу 6 кроків за викуп
  const bonus = [...st.bonus]
  bonus[st.current] = 0 // бонус, яким нема як піти, пропадає
  return { ...st, bonus, dice: [rollDie(rng), rollDie(rng)], used: [false, false] }
}

export const ringIdx = (side: Side, p: number) => mod(startIdx(side) + p, RING)

function occupant(st: State, idx: number, skip?: [number, number]) {
  for (let pl = 0; pl < st.pieces.length; pl++)
    for (let pc = 0; pc < PIECES; pc++) {
      const x = st.pieces[pl][pc]
      if (x.at === 'ring' && ringIdx(st.sides[pl], x.p) === idx && !(skip && skip[0] === pl && skip[1] === pc)) return { pl, pc }
    }
  return null
}

// Клітинки тюрми — як звичайні: на чужу фішку стаєш і б'єш, на свою не можна.
const jailSide = (st: State, pl: number, p: number) => Math.floor(ringIdx(st.sides[pl], p) / 12)
function enterJailCell(s: State, me: number, pi: number, p: number, stage: 0 | 1 | 2): boolean {
  const js = jailSide(s, me, p)
  for (let pl = 0; pl < s.pieces.length; pl++)
    for (let pc = 0; pc < PIECES; pc++) {
      const x = s.pieces[pl][pc]
      if (x.at !== 'jail' || (pl === me && pc === pi) || x.stage !== stage || jailSide(s, pl, x.p) !== js) continue
      if (pl === me) return false
      s.pieces[pl][pc] = { at: 'captured', by: me }
      s.frozen = pi
    }
  return true
}

function endTurn(s: State) {
  s.current = (s.current + 1) % s.sides.length
  s.turn++
  s.dice = null
  s.used = [false, false]
  s.frozen = null
}

// Ставить фішку на прогрес q (з захопленням і спецклітинками). false = хід заборонений.
function placeAt(s: State, me: number, pi: number, q: number): boolean {
  const side = s.sides[me]
  const self: [number, number] = [me, pi]
  const land = (qq: number) => {
    const idx = ringIdx(side, qq)
    const o = occupant(s, idx, self)
    if (!o) return true
    if (o.pl === me || special(idx) === 'corner') return false // на свою не можна; у куті неуразлива
    s.pieces[o.pl][o.pc] = { at: 'captured', by: me }
    s.frozen = pi
    return true
  }
  if (!land(q)) return false
  const sp = special(ringIdx(side, q))
  if (sp === 'fly' || sp === 'back') {
    q += sp === 'fly' ? JUMP : -JUMP
    s.frozen = pi
    if (!land(q)) return false
  }
  if (sp === 'jail' && !enterJailCell(s, me, pi, q, 0)) return false
  s.pieces[me][pi] = sp === 'jail' ? { at: 'jail', p: q, stage: 0, since: s.turn } : { at: 'ring', p: q }
  return true
}

function moveFrom(s: State, me: number, pi: number, p: number, n: number): boolean {
  const q = p + n
  if (q > ARM_START + PIECES - 1) return false // у рукав лише точним числом
  // перестрибувати не можна ні через чужі, ні через свої — ні по кільцю, ні в рукаві
  const inArm = (slot: number) => s.pieces[me].some((x, i) => i !== pi && x.at === 'done' && x.slot === slot)
  for (let k = p + 1; k < q; k++) {
    if (k < ARM_START ? occupant(s, ringIdx(s.sides[me], k), [me, pi]) : inArm(k - ARM_START)) return false
  }
  if (q >= ARM_START) {
    const slot = q - ARM_START
    if (inArm(slot)) return false
    s.pieces[me][pi] = { at: 'done', slot }
    return true
  }
  return placeAt(s, me, pi, q)
}

function tryUse(st: State, pi: number, dice: DieIdx[]): State | null {
  if (!st.dice || st.winner !== null || dice.length === 0 || dice.some((i) => st.used[i]) || pi === st.frozen) return null
  if (dice.length === 2 && dice[0] === dice[1]) return null
  const n = dice.reduce((a: number, i) => a + st.dice![i], 0)
  const single = dice.length === 1
  const me = st.current
  const s: State = { ...st, used: [...st.used], pieces: st.pieces.map((row) => [...row]) }
  const pc = s.pieces[me][pi]
  if (!pc) return null
  if (pc.at === 'captured') {
    if (!single || n !== 6) return null
    s.pieces[me][pi] = { at: 'home' } // викуплена фішка йде за дошку; виводити — ще одною 6
    s.bonus = [...st.bonus]
    s.bonus[pc.by]++ // тому, в кого викупили — 6 кроків на початку його ходу
  } else if (pc.at === 'home') {
    if (!single || n !== 6) return null
    s.pieces[me][pi] = { at: 'ready' }
  } else if (pc.at === 'ready') {
    if (!moveFrom(s, me, pi, -1, n)) return null // від «перед стартом»: 1 = клітинка під рукавом
  } else if (pc.at === 'ring') {
    if (!moveFrom(s, me, pi, pc.p, n)) return null
  } else if (pc.at === 'done') {
    if (!moveFrom(s, me, pi, ARM_START + pc.slot, n)) return null // у рукаві ходиш далі до кінця точним числом
  } else if (pc.at === 'jail') {
    if (pc.since >= st.turn) return null // кожен крок тюрми лише в наступному кидку
    if (pc.stage === 0) {
      if (!single || n !== 3) return null
      if (!enterJailCell(s, me, pi, pc.p, 1)) return null
      s.pieces[me][pi] = { ...pc, stage: 1, since: st.turn }
    } else if (pc.stage === 1) {
      if (!single || n !== 6) return null
      if (!enterJailCell(s, me, pi, pc.p, 2)) return null
      s.pieces[me][pi] = { ...pc, stage: 2, since: st.turn }
    } else if (!moveFrom(s, me, pi, pc.p + JAIL_EXIT, n)) return null
  } else return null
  for (const i of dice) s.used[i] = true
  if (s.pieces[me].every((x) => x.at === 'done')) s.winner = me
  else if (s.used[0] && s.used[1]) endTurn(s)
  return s
}

// 6 кроків за викуп будь-якою фішкою на полі; вивести з-за дошки чи викупити ними не можна.
function tryBonus(st: State, pi: number): State | null {
  const me = st.current
  if (st.dice || st.winner !== null || !st.bonus[me] || pi === st.frozen) return null
  const pc = st.pieces[me][pi]
  const from = pc?.at === 'ready' ? -1 : pc?.at === 'ring' ? pc.p
    : pc?.at === 'jail' && pc.stage === 2 && pc.since < st.turn ? pc.p + JAIL_EXIT : null
  if (from === null) return null
  const s: State = { ...st, bonus: [...st.bonus], pieces: st.pieces.map((row) => [...row]) }
  if (!moveFrom(s, me, pi, from, BONUS_STEPS)) return null
  s.bonus[me]--
  if (s.pieces[me].every((x) => x.at === 'done')) s.winner = me
  return s
}

export function apply(st: State, a: Action): State | null {
  if (a.type === 'bonus') return tryBonus(st, a.piece)
  if (a.type === 'pass') {
    // хід обов'язковий: пропустити можна лише після кидка, коли ходів немає
    if (st.winner !== null || !st.dice || legalActions(st).length > 0) return null
    const s = { ...st }
    endTurn(s)
    return s
  }
  return tryUse(st, a.piece, a.dice)
}

const COMBOS: DieIdx[][] = [[0], [1], [0, 1]]

export function legalActions(st: State): { action: Action; next: State }[] {
  if (st.winner !== null) return []
  const out: { action: Action; next: State }[] = []
  const seen = new Set<string>()
  if (!st.dice) {
    // до кидка ходити можна лише бонусом за викуп
    st.pieces[st.current].forEach((pc, piece) => {
      const key = pc.at === 'ready' ? 'ready' : `p${piece}`
      if (seen.has(key)) return
      const next = tryBonus(st, piece)
      if (next) {
        seen.add(key)
        out.push({ action: { type: 'bonus', piece }, next })
      }
    })
    return out
  }
  st.pieces[st.current].forEach((pc, piece) => {
    // однакові фішки вдома/в полоні — достатньо однієї
    const key = pc.at === 'home' || pc.at === 'ready' || pc.at === 'captured' ? pc.at : `p${piece}`
    for (const dice of COMBOS) {
      if (dice.length === 1 && dice[0] === 1 && st.dice![0] === st.dice![1] && !st.used[0]) continue // дубль: кубики однакові
      const k = `${key}:${dice.join()}`
      if (seen.has(k)) continue
      const next = tryUse(st, piece, dice)
      if (next) {
        seen.add(k)
        out.push({ action: { type: 'use', piece, dice }, next })
      }
    }
  })
  return out
}
