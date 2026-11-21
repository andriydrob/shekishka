// Онлайн-кімната: чисті функції над станом. Сервер (api/room.ts) лише зберігає Room і викликає їх.
import { autoplay } from './bot.js'
import { apply, legalActions, newGame, roll, type Action, type State } from './engine.js'

export const TURN_SECONDS = [15, 30, 45, 60, 0]

export interface Room {
  id: string
  players: number
  turnSeconds: number
  tokens: string[] // секрет кожного місця; індекс = номер гравця
  ready?: boolean[] // хто натиснув «Я готовий» (у старих кімнатах поля нема — вони вже грають)
  state: State
  opening: number[]
  version: number
  deadline: number // мс; 0 = без ліміту
  moves?: Move[] // останні ходи, щоб інші гравці бачили, як фішка йде (у старих кімнатах поля нема)
}
export interface Move { v: number; before: State; action: Action }
const MOVES_KEPT = 6
export type PublicRoom = Omit<Room, 'tokens'> & { joined: number; now: number }
export type Op = { op: 'roll' } | { op: 'act'; action: Action } | { op: 'ready'; ready: boolean }

// гра йде, коли всі зайшли й усі натиснули «Я готовий»
export const started = (r: Room) => r.tokens.length === r.players && (r.ready?.every(Boolean) ?? true)
const resetDeadline = (r: Room, now: number) => (r.deadline = r.turnSeconds && started(r) ? now + r.turnSeconds * 1000 : 0)

export function createRoom(id: string, players: number, turnSeconds: number, hostToken: string, rng?: () => number): Room {
  const { state, opening } = newGame(players, rng)
  return { id, players, turnSeconds, tokens: [hostToken], ready: [false], state, opening, version: 1, deadline: 0 }
}

export function joinRoom(r: Room, token: string, now: number): number | null {
  if (r.tokens.length === r.players) return null
  r.tokens.push(token)
  r.ready?.push(false)
  if (started(r)) resetDeadline(r, now)
  r.version++
  return r.tokens.length - 1
}

// Повертає текст помилки або null, якщо хід прийнято.
export function play(r: Room, seat: number, token: string, op: Op, now: number): string | null {
  if (r.tokens[seat] !== token) return 'Невідомий гравець'
  if (op.op === 'ready') {
    if (started(r) || !r.ready) return 'Гра вже почалась'
    r.ready[seat] = op.ready
    if (started(r)) resetDeadline(r, now)
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
    r.state = next
  }
  if (r.state.turn !== turn) resetDeadline(r, now)
  r.version++
  return null
}

// Сервер не має таймерів, тож прострочений хід добивається при наступному запиті будь-кого з гравців.
export function tick(r: Room, now: number): boolean {
  if (!started(r) || !r.deadline || now < r.deadline || r.state.winner !== null) return false
  r.state = autoplay(r.state)
  resetDeadline(r, now)
  r.version++
  return true
}

export function publicView(r: Room, now: number): PublicRoom {
  const { tokens, ...rest } = r
  return { ...rest, joined: tokens.length, now }
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
