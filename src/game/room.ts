// Онлайн-кімната: чисті функції над станом. Сервер (api/room.ts) лише зберігає Room і викликає їх.
import { autoplay, chooseAction, type Level } from './bot.js'
import { apply, legalActions, newGame, roll, type Action, type State } from './engine.js'

export const TURN_SECONDS = [15, 30, 45, 60, 0]

export interface Room {
  id: string
  players: number
  turnSeconds: number
  tokens: string[] // секрет кожного місця; індекс = номер гравця; '' чи немає — місце вільне або бот
  ready?: boolean[] // хто натиснув «Я готовий» (у старих кімнатах поля нема — вони вже грають)
  bots?: (Level | null)[] // які місця займають боти (ходить за них сервер)
  botNext?: number // мс: не раніше цього бот робить наступний крок (щоб гравці встигали побачити)
  state: State
  opening: number[]
  version: number
  deadline: number // мс; 0 = без ліміту
  moves?: Move[] // останні ходи, щоб інші гравці бачили, як фішка йде (у старих кімнатах поля нема)
}
export interface Move { v: number; before: State; action: Action }
const MOVES_KEPT = 6
export type PublicRoom = Omit<Room, 'tokens'> & { taken: boolean[]; now: number }
export type Op = { op: 'roll' } | { op: 'act'; action: Action } | { op: 'ready'; ready: boolean }

const isBot = (r: Room, seat: number) => !!r.bots?.[seat]
export const botTurn = (r: Room) => isBot(r, r.state.current)
const taken = (r: Room) => Array.from({ length: r.players }, (_, i) => isBot(r, i) || !!r.tokens[i])
// гра йде, коли всі місця зайняті (людьми чи ботами) й усі натиснули «Я готовий»
export const started = (r: Room) => taken(r).every(Boolean) && (r.ready?.every(Boolean) ?? true)
const resetDeadline = (r: Room, now: number) => (r.deadline = r.turnSeconds && started(r) ? now + r.turnSeconds * 1000 : 0)

// bots[i] — рівень бота на місці i або null для людини; місце 0 — завжди той, хто створив.
export function createRoom(id: string, players: number, turnSeconds: number, hostToken: string, bots: (Level | null)[] = [], rng?: () => number): Room {
  const { state, opening } = newGame(players, rng)
  const seats = Array.from({ length: players }, (_, i) => (i === 0 ? null : bots[i] ?? null))
  return {
    id, players, turnSeconds, state, opening, version: 1, deadline: 0,
    tokens: seats.map((_, i) => (i === 0 ? hostToken : '')),
    ready: seats.map((b) => !!b), // боти завжди готові
    bots: seats,
  }
}

export function joinRoom(r: Room, token: string, now: number): number | null {
  const seat = taken(r).indexOf(false)
  if (seat < 0) return null
  r.tokens[seat] = token
  if (r.ready) r.ready[seat] = false
  if (started(r)) resetDeadline(r, now)
  r.version++
  return seat
}

// Повертає текст помилки або null, якщо хід прийнято.
export function play(r: Room, seat: number, token: string, op: Op, now: number): string | null {
  if (!token || r.tokens[seat] !== token) return 'Невідомий гравець'
  if (op.op === 'ready') {
    if (started(r) || !r.ready) return 'Гра вже почалась'
    r.ready[seat] = op.ready
    if (started(r)) {
      resetDeadline(r, now)
      r.botNext = now + 1500 // якщо першим ходить бот — нехай усі встигнуть відкрити поле
    }
    r.version++
    return null
  }
  if (!started(r)) return 'Чекаємо, поки всі зайдуть і будуть готові'
  if (r.state.winner !== null) return 'Гру завершено'
  if (r.state.current !== seat) return 'Зараз не твій хід'
  const turn = r.state.turn
  if (op.op === 'roll') {
    if (r.state.dice) return 'Кубики вже кинуто'
    if (legalActions(r.state).length) return 'Спершу зроби 6 кроків за викуп'
    r.state = roll(r.state)
  } else {
    const next = apply(r.state, op.action)
    if (!next) return 'Такий хід неможливий'
    r.moves = [...(r.moves ?? []), { v: r.version + 1, before: r.state, action: op.action }].slice(-MOVES_KEPT)
    r.botNext = now + botMovePause(r.state, op.action) // бот після людини чекає, поки дограє анімація її ходу
    r.state = next
  }
  if (r.state.turn !== turn) resetDeadline(r, now)
  r.version++
  return null
}

// Пауза бота після кроку: щоб гравці встигли побачити кубики й як іде фішка.
const BOT_ROLL_PAUSE = 1100
const botMovePause = (prev: State, a: Action) =>
  a.type === 'pass' ? 600 : 1300 + 180 * (a.type === 'bonus' ? 6 : a.type === 'use' ? a.dice.reduce((s: number, i) => s + prev.dice![i], 0) : 0)

// Чи змінить tick кімнату зараз (щоб не брати блокування даремно).
export function tickDue(r: Room, now: number): boolean {
  if (!started(r) || r.state.winner !== null) return false
  if (isBot(r, r.state.current)) return now >= (r.botNext ?? 0)
  return !!r.deadline && now >= r.deadline
}

// Сервер не має таймерів, тож усе «само собою» робиться при наступному запиті будь-кого з гравців:
// бот робить один крок (кидок або хід), а прострочений хід людини доробляється автоматично.
export function tick(r: Room, now: number): boolean {
  if (!tickDue(r, now)) return false
  const turn = r.state.turn
  const level = r.bots?.[r.state.current]
  if (level) {
    const st = r.state
    if (!st.dice && !legalActions(st).length) {
      r.state = roll(st)
      r.botNext = now + BOT_ROLL_PAUSE
    } else {
      const action = chooseAction(st, level)
      r.moves = [...(r.moves ?? []), { v: r.version + 1, before: st, action }].slice(-MOVES_KEPT)
      r.state = apply(st, action)!
      r.botNext = now + botMovePause(st, action)
    }
  } else r.state = autoplay(r.state)
  if (r.state.turn !== turn) resetDeadline(r, now)
  r.version++
  return true
}

export function publicView(r: Room, now: number): PublicRoom {
  const { tokens, ...rest } = r
  return { ...rest, taken: taken(r), now }
}

// Перевірка того, що прийшло з мережі.
export function parseOp(body: unknown): Op | null {
  const b = body as { op?: unknown; action?: { type?: unknown; piece?: unknown; dice?: unknown } }
  if (b?.op === 'roll') return { op: 'roll' }
  if (b?.op === 'ready') return { op: 'ready', ready: (body as { ready?: unknown }).ready === true }
  if (b?.op !== 'act' || !b.action) return null
  const a = b.action
  if (a.type === 'pass') return { op: 'act', action: { type: 'pass' } }
  if (!Number.isInteger(a.piece) || (a.piece as number) < 0 || (a.piece as number) > 3) return null
  if (a.type === 'bonus') return { op: 'act', action: { type: 'bonus', piece: a.piece as number } }
  const dice = a.dice
  if (a.type !== 'use') return null
  if (!Array.isArray(dice) || dice.length < 1 || dice.length > 2 || !dice.every((d) => d === 0 || d === 1)) return null
  return { op: 'act', action: { type: 'use', piece: a.piece as number, dice: dice as (0 | 1)[] } }
}
