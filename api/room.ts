// Vercel Function: онлайн-кімнати Шекішки. Стан у Redis (REDIS_URL з інтеграції Vercel); локально (vite dev) — у пам'яті.
import { createClient } from 'redis'
import type { Level } from '../src/game/bot.js'
import { botTurn, createRoom, joinRoom, parseOp, play, publicView, tick, tickDue, TURN_SECONDS, type Room } from '../src/game/room.js'

const redisUrl = process.env.REDIS_URL ?? process.env.STORAGE_URL
const memory: Map<string, Room> = ((globalThis as { __rooms?: Map<string, Room> }).__rooms ??= new Map())
const TTL = 60 * 60 * 24 // кімната живе добу

// одне з'єднання на «теплий» екземпляр функції
const connect = () => createClient({ url: redisUrl }).on('error', (e) => console.error('redis', e)).connect()
let client: ReturnType<typeof connect> | null = null
function redis() {
  client ??= connect().catch((e) => { client = null; throw e })
  return client
}

const load = async (id: string): Promise<Room | null> => {
  if (!redisUrl) return memory.get(id) ?? null
  const raw = await (await redis()).get(`room:${id}`)
  return raw ? JSON.parse(raw) : null
}
const save = async (r: Room) => {
  if (!redisUrl) return void memory.set(r.id, r)
  await (await redis()).set(`room:${r.id}`, JSON.stringify(r), { EX: TTL })
}
// Кроки бота й таймаути робить лише один запит за раз: інакше гравці, що питають одночасно, зробили б крок двічі.
const lock = async (id: string) => !redisUrl || (await (await redis()).set(`lock:${id}`, '1', { NX: true, PX: 3000 })) === 'OK'
const unlock = async (id: string) => void (redisUrl && (await (await redis()).del(`lock:${id}`)))
// shortcut: ходи людей пишуться без блокування — два одночасні записи: виграє останній. Для покрокової гри вистачає.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (error: string, status = 400) => json({ error }, status)

const LEVELS: Level[] = ['easy', 'medium', 'hard']
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ID_CHARS[b % ID_CHARS.length]).join('')
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z2-9]{6}$/.test(id)

function noStore() {
  return !redisUrl && process.env.VERCEL ? fail('Сервер без бази: підключи Redis у Vercel → Storage', 500) : null
}

export async function GET(req: Request) {
  const bad = noStore()
  if (bad) return bad
  const id = new URL(req.url).searchParams.get('id')
  if (!validId(id)) return fail('Неправильний код кімнати')
  let room = await load(id)
  if (!room) return fail('Кімнату не знайдено', 404)
  const now = Date.now()
  if (tickDue(room, now) && (await lock(id))) {
    try {
      room = (await load(id)) ?? room
      if (tick(room, now)) await save(room)
    } finally {
      await unlock(id)
    }
  }
  return json({ room: publicView(room, now) })
}

export async function POST(req: Request) {
  const bad = noStore()
  if (bad) return bad
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return fail('Порожній запит')
  const now = Date.now()

  if (body.op === 'create') {
    const players = Number(body.players), turnSeconds = Number(body.turnSeconds)
    const bots = Array.isArray(body.bots) ? body.bots : []
    const okBot = (b: unknown): b is Level | null => b === null || LEVELS.includes(b as Level)
    if (![2, 3, 4].includes(players) || !TURN_SECONDS.includes(turnSeconds) || bots.length > players || !bots.every(okBot)) return fail('Неправильні налаштування')
    const secret = crypto.randomUUID()
    const room = createRoom(newId(), players, turnSeconds, secret, bots)
    await save(room)
    return json({ seat: 0, token: secret, room: publicView(room, now) })
  }

  if (!validId(body.id)) return fail('Неправильний код кімнати')
  const room = await load(body.id)
  if (!room) return fail('Кімнату не знайдено', 404)

  if (body.op === 'join') {
    const secret = crypto.randomUUID()
    const seat = joinRoom(room, secret, now)
    if (seat === null) return fail('Кімната вже заповнена', 409)
    await save(room)
    return json({ seat, token: secret, room: publicView(room, now) })
  }

  const op = parseOp(body)
  const seat = Number(body.seat)
  if (!op || !Number.isInteger(seat) || typeof body.token !== 'string') return fail('Неправильний хід')
  if (!botTurn(room)) tick(room, now) // за бота кроки робить лише GET під блокуванням
  const error = play(room, seat, body.token, op, now)
  await save(room)
  return error ? json({ error, room: publicView(room, now) }, 409) : json({ room: publicView(room, now) })
}
