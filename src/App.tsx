import { useEffect, useMemo, useRef, useState } from 'react'
import { autoplay, chooseAction, type Level } from './game/bot'
import type { Cell } from './game/board'
import { apply, BONUS_STEPS, isFinished, legalActions, newGame, roll, type Action, type State } from './game/engine'
import type { Op, PublicRoom } from './game/room'
import { api, loadCreds, saveCreds, type Creds } from './online'
import { Board, PLAYER_COLORS, PLAYER_NAMES_COLOR, pieceCell, stepCells, stopCell, type Hop, type Kill, type Target } from './ui/Board'

type Seat = 'human' | Level
interface Settings { players: number; seats: Seat[]; turnSeconds: number; mySeat?: number } // mySeat — лише онлайн
interface OnlineProps { room: PublicRoom; deadlineLocal: number; send: (op: Op) => void }
type Screen = { kind: 'menu' } | { kind: 'bots' } | { kind: 'online-new' } | { kind: 'online'; id: string; fresh?: boolean } // fresh — щойно створена: спершу екран із посиланням

const LEVEL_NAMES: Record<Level, string> = { easy: 'легкий', medium: 'середній', hard: 'важкий' }
const TIMES = [15, 30, 45, 60, 0]
const POLL_MS = 1000
const BOT_DELAY = 700
const NO_MOVES_DELAY = 1500 // скільки показувати кубики, коли ходів немає, перед автопропуском
const STEP_MS = 180 // фішка йде по клітинці за крок
const JUMP_PAUSE = 380 // стоїть на П/В/стрілці перед стрибком
const JUMP_MS = 420 // сам стрибок
const BOOM_MS = 700 // вибух побитої фішки
const TOAST_MS = 2000 // скільки показувати «Твою фішку вбили»
const TURN_BANNER_MS = 1500 // «Твій хід!» посеред поля
const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && a.c === b.c && a.r === b.r

const roomFromUrl = () => new URLSearchParams(location.search).get('room')

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const id = roomFromUrl()
    return id ? { kind: 'online', id } : { kind: 'menu' }
  })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [round, setRound] = useState(0)
  const toMenu = () => {
    history.replaceState(null, '', location.pathname)
    setSettings(null)
    setScreen({ kind: 'menu' })
  }
  const createRoom = async (s: Settings) => {
    const bots = s.seats.map((x, i) => (i === 0 || x === 'human' ? null : x))
    const res = await api({ op: 'create', players: s.players, turnSeconds: s.turnSeconds, bots })
    if (!res.room || res.token === undefined) return alert(res.error ?? 'Не вдалося створити кімнату')
    saveCreds(res.room.id, { seat: 0, token: res.token })
    history.replaceState(null, '', `?room=${res.room.id}`)
    setScreen({ kind: 'online', id: res.room.id, fresh: true })
  }

  if (screen.kind === 'online') return <Online id={screen.id} fresh={screen.fresh} onMenu={toMenu} />
  if (screen.kind === 'online-new') return <Setup online onBack={toMenu} onStart={createRoom} />
  if (screen.kind === 'bots')
    return settings
      ? <Game key={round} settings={settings} onMenu={toMenu} onRestart={() => setRound((r) => r + 1)} />
      : <Setup onBack={toMenu} onStart={(s) => { setSettings(s); setRound((r) => r + 1) }} />
  return (
    <main className="setup">
      <h1>Шекішка</h1>
      <button className="btn primary big menu-btn" onClick={() => setScreen({ kind: 'bots' })}>Грати з ботами</button>
      <button className="btn big menu-btn" onClick={() => setScreen({ kind: 'online-new' })}>Грати онлайн з друзями</button>
    </main>
  )
}

function Setup({ onStart, onBack, online }: { onStart: (s: Settings) => void; onBack: () => void; online?: boolean }) {
  const [players, setPlayers] = useState(2)
  const [seats, setSeats] = useState<Seat[]>(online ? ['human', 'human', 'human', 'human'] : ['human', 'medium', 'medium', 'medium'])
  const [turnSeconds, setTurnSeconds] = useState(30)
  return (
    <main className="setup">
      <h1>Шекішка</h1>
      <section className="panel" aria-labelledby="players-h">
        <h2 id="players-h">Гравці</h2>
        <div className="segmented" role="radiogroup" aria-label="Кількість гравців">
          {[2, 3, 4].map((n) => (
            <button key={n} role="radio" aria-checked={players === n} onClick={() => setPlayers(n)}>{n}</button>
          ))}
        </div>
        {seats.slice(0, players).map((seat, i) => (
          <label key={i} className="seat">
            <span className="dot" style={{ background: PLAYER_COLORS[i] }} aria-hidden />
            <span>{PLAYER_NAMES_COLOR[i]}</span>
            {online && i === 0 ? <span className="muted">Ти</span> : (
            <select value={seat} onChange={(e) => setSeats(seats.map((s, j) => (j === i ? (e.target.value as Seat) : s)))}>
              <option value="human">{online ? 'Друг' : 'Людина'}</option>
              <option value="easy">Бот: легкий</option>
              <option value="medium">Бот: середній</option>
              <option value="hard">Бот: важкий</option>
            </select>
            )}
          </label>
        ))}
      </section>
      <section className="panel" aria-labelledby="time-h">
        <h2 id="time-h">Час на хід</h2>
        <div className="segmented" role="radiogroup" aria-label="Час на хід">
          {TIMES.map((t) => (
            <button key={t} role="radio" aria-checked={turnSeconds === t} onClick={() => setTurnSeconds(t)}>{t ? `${t} с` : '∞'}</button>
          ))}
        </div>
      </section>
      <div className="row">
        <button className="btn big" onClick={onBack}>Назад</button>
        <button className="btn primary big" onClick={() => onStart({ players, seats: seats.slice(0, players), turnSeconds })}>
          {online ? 'Створити кімнату' : 'Почати гру'}
        </button>
      </div>
    </main>
  )
}

function seatName(settings: Settings, i: number) {
  const seat = settings.seats[i]
  if (seat !== 'human') return `Бот (${LEVEL_NAMES[seat]})`
  if (settings.mySeat !== undefined) return i === settings.mySeat ? 'Ти' : PLAYER_NAMES_COLOR[i]
  return settings.seats.filter((s) => s === 'human').length === 1 ? 'Ти' : `Гравець ${i + 1}`
}
// за кольором — щоб відрізнити двох однакових ботів
const colorName = (settings: Settings, i: number) => `${PLAYER_NAMES_COLOR[i]}${settings.seats[i] !== 'human' ? ' · бот' : ''}`

// Короткий опис того, що сталося після ходу.
function describe(prev: State, next: State, a: Action, who: string): string | null {
  if (a.type === 'pass') return `${who}: хід пропущено`
  const me = prev.current
  const was = prev.pieces[me][a.piece], now = next.pieces[me][a.piece]
  const capturedBefore = prev.pieces.flat().filter((p) => p.at === 'captured' && p.by === me).length
  const capturedNow = next.pieces.flat().filter((p) => p.at === 'captured' && p.by === me).length
  const parts: string[] = []
  if (was.at === 'home') parts.push('фішка входить у гру')
  else if (was.at === 'captured') parts.push('фішку викуплено')
  else if (now.at === 'jail' && was.at !== 'jail') parts.push('фішка потрапляє в тюрму')
  else if (was.at === 'jail' && now.at === 'jail') parts.push(`у тюрмі: ${now.stage === 1 ? '3' : '6'}`)
  else if (now.at === 'done') parts.push(isFinished(next.pieces[me], a.piece) ? 'фішка дійшла до кінця рукава!' : 'фішка в рукаві, треба довести до кінця')
  else if (now.at === 'ring' && (was.at === 'ring' || was.at === 'jail')) {
    const n = a.type === 'bonus' ? BONUS_STEPS : a.dice.reduce((s: number, i) => s + prev.dice![i], 0)
    const jump = now.p - (was.p + n)
    if (jump > 0) parts.push('політ по «П»')
    if (jump < 0) parts.push('повернення по «В»')
  }
  if (capturedNow > capturedBefore) parts.push('фішку суперника побито!')
  if (a.type === 'bonus') parts.unshift('6 кроків за викуп')
  const placed = next.places ?? []
  if (placed.length > (prev.places?.length ?? 0)) parts.push(`усі фішки на місці — ${placed.length} місце!`)
  return parts.length ? `${who}: ${parts.join(', ')}` : null
}

function Online({ id, fresh, onMenu }: { id: string; fresh?: boolean; onMenu: () => void }) {
  const [creds, setCreds] = useState<Creds | null>(() => loadCreds(id))
  const [shared, setShared] = useState(!fresh)
  const [room, setRoom] = useState<PublicRoom | null>(null)
  const [deadlineLocal, setDeadlineLocal] = useState(0)
  const [error, setError] = useState('')
  const version = useRef(0)
  const joining = useRef(false)

  // приймаємо лише новіші версії, щоб запізніла відповідь не відкотила стан
  // force: сервер відхилив наш хід — повертаємось до його стану навіть за тієї ж версії
  const accept = (r: PublicRoom, force = false) => {
    if (r.version < version.current || (r.version === version.current && !force)) return
    version.current = r.version
    setRoom(r)
    setDeadlineLocal(Date.now() + (r.deadline - r.now))
  }

  useEffect(() => {
    if (creds || joining.current) return
    joining.current = true
    api({ op: 'join', id }).then((res) => {
      if (!res.room || res.token === undefined || res.seat === undefined) return setError(res.error ?? 'Не вдалося зайти в кімнату')
      const c = { seat: res.seat, token: res.token }
      saveCreds(id, c)
      setCreds(c)
      accept(res.room)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!creds) return
    const poll = () => api(null, id).then((res) => (res.room ? accept(res.room) : res.error && setError(res.error)))
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [creds]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (op: Op) => {
    if (!creds) return
    const res = await api({ ...op, id, seat: creds.seat, token: creds.token })
    if (res.room) accept(res.room, !!res.error)
  }

  if (error) return (
    <main className="setup">
      <h1>Шекішка</h1>
      <p className="panel" role="alert">{error}</p>
      <button className="btn big" onClick={onMenu}>Меню</button>
    </main>
  )
  if (!room || !creds) return <main className="setup"><p>Підключення…</p></main>
  const link = `${location.origin}${location.pathname}?room=${room.id}`
  if (!shared) return <ShareLink room={room} link={link} onNext={() => setShared(true)} onMenu={onMenu} />
  const playing = room.taken.every(Boolean) && (room.ready?.every(Boolean) ?? true)
  if (!playing) return <WaitingRoom room={room} link={link} mySeat={creds.seat} send={send} onMenu={onMenu} />
  return (
    <Game key={id} settings={{ players: room.players, seats: Array.from({ length: room.players }, (_, i) => room.bots?.[i] ?? 'human'), turnSeconds: room.turnSeconds, mySeat: creds.seat }}
      online={{ room, deadlineLocal, send }} onMenu={onMenu} onRestart={onMenu} />
  )
}

function CopyLink({ link, label = 'Копіювати' }: { link: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})
  return <button className="btn" onClick={copy}>{copied ? 'Скопійовано' : label}</button>
}

// Крок 1 (лише для того, хто створив): посилання, яке треба надіслати другу.
function ShareLink({ room, link, onNext, onMenu }: { room: PublicRoom; link: string; onNext: () => void; onMenu: () => void }) {
  return (
    <main className="setup">
      <h1>Шекішка</h1>
      <section className="panel" aria-labelledby="share-h">
        <h2 id="share-h">Кімната {room.id}</h2>
        <p className="muted">Надішли це посилання другу, потім переходь у кімнату й чекай його там.</p>
        <div className="link-row">
          <input readOnly value={link} aria-label="Посилання на кімнату" onFocus={(e) => e.target.select()} />
          <CopyLink link={link} />
        </div>
        {'share' in navigator && <button className="btn" onClick={() => navigator.share({ title: 'Шекішка', text: 'Заходь пограти в Шекішку!', url: link }).catch(() => {})}>Поділитися</button>}
      </section>
      <div className="row">
        <button className="btn big" onClick={onMenu}>Меню</button>
        <button className="btn primary big" onClick={onNext}>Далі в кімнату</button>
      </div>
    </main>
  )
}

// Крок 2: кімната очікування. Гра починається, коли всі зайшли й натиснули «Я готовий».
function WaitingRoom({ room, link, mySeat, send, onMenu }: { room: PublicRoom; link: string; mySeat: number; send: (op: Op) => Promise<void>; onMenu: () => void }) {
  const [busy, setBusy] = useState(false)
  const ready = room.ready ?? []
  const iAmReady = !!ready[mySeat]
  const toggle = () => {
    setBusy(true)
    send({ op: 'ready', ready: !iAmReady }).finally(() => setBusy(false))
  }
  const waitingFor = room.taken.filter((t) => !t).length
  return (
    <main className="setup">
      <h1>Шекішка</h1>
      <section className="panel" aria-labelledby="wait-h">
        <h2 id="wait-h">Кімната очікування</h2>
        <ul className="lobby-seats" aria-live="polite">
          {Array.from({ length: room.players }, (_, i) => {
            const bot = room.bots?.[i]
            const status = !room.taken[i] ? 'чекаємо…' : ready[i] ? 'готовий ✓' : 'у кімнаті'
            return (
              <li key={i}>
                <span className="dot" style={{ background: PLAYER_COLORS[i] }} aria-hidden />
                <span>{PLAYER_NAMES_COLOR[i]}{i === mySeat ? ' (ти)' : bot ? ` — бот (${LEVEL_NAMES[bot]})` : ''}</span>
                <span className={room.taken[i] && ready[i] ? 'seat-ready' : 'muted'}>{status}</span>
              </li>
            )
          })}
        </ul>
        <p className="muted">
          {waitingFor > 0 ? `Чекаємо ще ${waitingFor === 1 ? 'одного гравця' : `${waitingFor} гравців`}. ` : ''}
          Гра почнеться, коли всі зайдуть і натиснуть «Я готовий».
        </p>
        {waitingFor > 0 && <CopyLink link={link} label="Скопіювати посилання ще раз" />}
      </section>
      <div className="row">
        <button className="btn big" onClick={onMenu}>Меню</button>
        <button className={`btn big ${iAmReady ? '' : 'primary'}`} disabled={busy} aria-pressed={iAmReady} onClick={toggle}>
          {iAmReady ? 'Я не готовий' : 'Я готовий'}
        </button>
      </div>
    </main>
  )
}

function Game({ settings, onMenu, onRestart, online }: { settings: Settings; onMenu: () => void; onRestart: () => void; online?: OnlineProps }) {
  const [opening] = useState(() => (online ? { state: online.room.state, opening: online.room.opening } : newGame(settings.players)))
  const [game, setGame] = useState<State>(opening.state)
  const [selected, setSelected] = useState<number | null>(null)
  const [message, setMessage] = useState(() => `Першим ходить ${seatName(settings, opening.state.current)} (сума ${Math.max(...opening.opening)})`)
  const [deadline, setDeadline] = useState({ turn: -1, at: 0 })
  const [now, setNow] = useState(() => Date.now())
  const [rolling, setRolling] = useState(false)
  const [hop, setHop] = useState<Hop | null>(null)
  const [kills, setKills] = useState<Kill[]>([])
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null)
  const [turnBanner, setTurnBanner] = useState<{ key: number; text: string; mine: boolean; color: string } | null>(null)
  const toastTimer = useRef(0)
  const showToast = (text: string) => {
    clearTimeout(toastTimer.current)
    setToast({ key: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }
  const timers = useRef<number[]>([])
  const busyUntil = useRef(0)

  const me = game.current
  const seat = settings.seats[me]
  const isHuman = (online ? me === settings.mySeat : seat === 'human') && game.winner === null
  const place = (pl: number) => (game.places ?? (game.winner === null ? [] : [game.winner])).indexOf(pl)
  const legal = useMemo(() => legalActions(game), [game])
  const humanIdx = online ? settings.mySeat! : isHuman ? me : settings.seats.indexOf('human')
  const viewer = online ? settings.mySeat! : settings.seats.indexOf('human') // чиє поле внизу

  // Анімація ходу: фішка йде по клітинках, на П/В/стрілці зупиняється й стрибає;
  // побита фішка стоїть, доки до неї не дійде нападник, і вибухає. Повертає тривалість у мс.
  const animate = (prev: State, a: Action, next: State): number => {
    timers.current.forEach(clearTimeout) // новий хід обриває попередню анімацію
    timers.current = []
    setHop(null)
    setKills([])
    if (a.type === 'pass') return 0
    const pl = prev.current, pi = a.piece
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
    const steps = stepCells(prev, a)
    const final = pieceCell(next, pl, pi)
    const last = (steps.length - 1) * STEP_MS
    let end = 160
    steps.forEach((cell, i) => (i ? at(i * STEP_MS, () => setHop({ pl, pi, cell })) : setHop({ pl, pi, cell }))) // перший крок — разом із setGame
    if (steps.length && final && !sameCell(steps.at(-1), final)) {
      at(last + JUMP_PAUSE, () => setHop({ pl, pi, cell: final, ms: JUMP_MS }))
      end = last + JUMP_PAUSE + JUMP_MS
    } else if (steps.length) end = last + STEP_MS
    if (steps.length) at(end, () => setHop(null))

    const victims: (Kill & { owner: number })[] = []
    prev.pieces.forEach((row, vpl) => row.forEach((pc, vpi) => {
      const cell = pieceCell(prev, vpl, vpi)
      if (vpl !== pl && pc.at !== 'captured' && next.pieces[vpl][vpi].at === 'captured' && cell)
        victims.push({ key: `${vpl}-${vpi}-${next.turn}`, cell, color: PLAYER_COLORS[vpl], boom: false, owner: vpl })
    }))
    // сповіщення тому, чию фішку вбили (на цьому пристрої)
    const humans = settings.seats.filter((s) => s === 'human').length
    const isMine = (owner: number) => (online ? owner === settings.mySeat : settings.seats[owner] === 'human')
    const killText = (owner: number) => `${!online && humans > 1 ? `${PLAYER_NAMES_COLOR[owner]}, твою` : 'Твою'} фішку вбив ${seatName(settings, pl)}!`
    let total = end
    if (victims.length) {
      setKills(victims)
      victims.forEach((v) => {
        const idx = steps.findIndex((c) => sameCell(c, v.cell))
        const hit = idx >= 0 ? idx * STEP_MS + 120 : end
        at(hit, () => {
          setKills((ks) => ks.map((k) => (k.key === v.key ? { ...k, boom: true } : k)))
          if (isMine(v.owner)) showToast(killText(v.owner))
        })
        total = Math.max(total, hit + BOOM_MS)
      })
      at(total, () => setKills([]))
    }
    busyUntil.current = Date.now() + total
    return total
  }

  // онлайн: сервер — джерело правди. Чужі ходи з журналу програємо по черзі, потім ставимо стан сервера.
  const shownVersion = useRef(online?.room.version ?? 0)
  const gameRef = useRef(game)
  gameRef.current = game
  const replay = useRef<{ queue: { prev: State; action: Action; next: State }[]; final: State | null; running: boolean }>({ queue: [], final: null, running: false })
  const pump = () => {
    const r = replay.current
    const m = r.queue.shift()
    if (!m) {
      r.running = false
      if (r.final) {
        const st = r.final
        r.final = null
        if (st.turn !== gameRef.current.turn) setMessage(st.winner === null ? (st.current === settings.mySeat ? 'Твій хід!' : `Хід: ${seatName(settings, st.current)}`) : '')
        setGame(st)
      }
      return
    }
    r.running = true
    const text = describe(m.prev, m.next, m.action, seatName(settings, m.prev.current))
    if (text) setMessage(text)
    setGame(m.next)
    window.setTimeout(pump, animate(m.prev, m.action, m.next) + 150)
  }
  useEffect(() => {
    if (!online) return
    const room = online.room
    const fresh = (room.moves ?? []).filter((m) => m.v > shownVersion.current && m.before.current !== settings.mySeat)
    shownVersion.current = room.version
    const r = replay.current
    fresh.forEach((m, i) => r.queue.push({ prev: m.before, action: m.action, next: fresh[i + 1]?.before ?? room.state }))
    r.final = room.state
    if (!r.running) pump()
  }, [online?.room]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = (a: Action) => {
    const next = apply(game, a)
    if (!next) return
    const text = describe(game, next, a, seatName(settings, me))
    if (text) setMessage(text)
    setSelected(null)
    setGame(next)
    online?.send({ op: 'act', action: a })
    animate(game, a, next)
  }
  const doRoll = () => {
    setRolling(true)
    setTimeout(() => setRolling(false), 450)
    if (online) online.send({ op: 'roll' })
    else setGame(roll(game))
  }

  // таймер ходу
  useEffect(() => setDeadline({ turn: game.turn, at: Date.now() + settings.turnSeconds * 1000 }), [game.turn, settings.turnSeconds])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  // поки дедлайн не оновився для нового ходу, показуємо повний час
  const left = !settings.turnSeconds ? null
    : online ? Math.min(settings.turnSeconds, Math.max(0, Math.ceil((online.deadlineLocal - now) / 1000)))
    : deadline.turn !== game.turn ? settings.turnSeconds : Math.max(0, Math.ceil((deadline.at - now) / 1000))
  useEffect(() => {
    if (online || !isHuman || left !== 0) return // онлайн прострочений хід робить сервер
    setSelected(null)
    setGame(autoplay(game))
    setMessage(`${seatName(settings, me)}: час вийшов, хід зроблено автоматично`)
  }, [left]) // eslint-disable-line react-hooks/exhaustive-deps

  // чий хід: «Твій хід!» / «Хід: Червоний» — посеред поля, коли дограє анімація попереднього ходу
  const singleViewer = !!online || settings.seats.filter((s) => s === 'human').length === 1
  const turnLabel = isHuman && singleViewer ? 'Твій хід' : colorName(settings, me)
  useEffect(() => {
    if (game.winner !== null) return
    const text = isHuman && singleViewer ? 'Твій хід!' : `Хід: ${PLAYER_NAMES_COLOR[me]}`
    const wait = Math.max(0, busyUntil.current - Date.now())
    const show = window.setTimeout(() => setTurnBanner({ key: Date.now(), text, mine: isHuman, color: PLAYER_COLORS[me] }), wait)
    const hide = window.setTimeout(() => setTurnBanner(null), wait + TURN_BANNER_MS)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
      setTurnBanner(null)
    }
  }, [game.turn, game.winner]) // eslint-disable-line react-hooks/exhaustive-deps

  // боти й автоматичний пропуск, коли ходів немає
  useEffect(() => {
    if (game.winner !== null) return
    if (online) {
      // онлайн за ботів ходить сервер; сам пропускаєш лише свій хід, коли ходів немає
      if (!isHuman) return
    } else if (seat !== 'human') {
      // бот чекає, поки дограє анімація попереднього ходу
      const wait = Math.max(BOT_DELAY, busyUntil.current - Date.now() + 300)
      const t = setTimeout(() => (game.dice || legal.length ? act(chooseAction(game, seat)) : doRoll()), wait)
      return () => clearTimeout(t)
    }
    if (game.dice && legal.length === 0) {
      setMessage(`${seatName(settings, me)}: немає ходів, хід переходить далі`)
      const t = setTimeout(() => act({ type: 'pass' }), NO_MOVES_DELAY)
      return () => clearTimeout(t)
    }
  }, [game]) // eslint-disable-line react-hooks/exhaustive-deps

  // які дії відповідають натиснутій фішці (домашні фішки взаємозамінні)
  const actionsFor = (pi: number) => {
    const at = game.pieces[me][pi].at
    return legal.filter((m) => m.action.type !== 'pass' && (m.action.piece === pi || ((at === 'home' || at === 'ready') && game.pieces[me][m.action.piece].at === at)))
  }
  const selectable = new Set(isHuman ? game.pieces[me].map((_, i) => i).filter((i) => game.pieces[me][i].at !== 'captured' && actionsFor(i).length) : [])
  const targets: Target[] = selected === null || !isHuman ? [] : actionsFor(selected).flatMap((m) => {
    if (m.action.type === 'pass') return []
    const cell = stopCell(game, m.action) ?? pieceCell(m.next, me, m.action.piece)
    const label = String(m.action.type === 'bonus' ? BONUS_STEPS : m.action.dice.reduce((s: number, i) => s + game.dice![i], 0))
    const prisoners = (st: State) => st.pieces.flat().filter((p) => p.at === 'captured' && p.by === me).length
    const capture = prisoners(m.next) > prisoners(game)
    return cell ? [{ key: m.action.type === 'bonus' ? 'bonus' : m.action.dice.join(), cell, label, capture, onPick: () => act(m.action) }] : []
  })
  // по варіанту на кожного, у кого твоя фішка в полоні: від вибору залежить, хто отримає 6 кроків за викуп
  const buybacks = isHuman ? legal.filter((m) => m.action.type === 'use' && game.pieces[me][m.action.piece].at === 'captured') : []
  const captorOf = (m: (typeof legal)[number]) => { const pc = m.action.type === 'use' ? game.pieces[me][m.action.piece] : null; return pc?.at === 'captured' ? pc.by : -1 }

  const myPieces = humanIdx >= 0 ? game.pieces[humanIdx] : []
  const finished = myPieces.filter((_, i) => isFinished(myPieces, i)).length
  const count = (at: string) => myPieces.filter((p) => p.at === at).length

  return (
    <div className="game">
      <aside className="side left">
        <div className={`dice ${rolling ? 'rolling' : ''}`} aria-live="polite" aria-label={game.dice ? `Кубики: ${game.dice.join(' і ')}` : 'Кубики ще не кинуто'}>
          {(game.dice ?? [0, 0]).map((v, i) => <Die key={i} value={v} used={!!game.dice && game.used[i]} />)}
        </div>
        <button className={`btn primary ${isHuman && !game.dice && legal.length === 0 ? 'attention' : ''}`} disabled={!isHuman || !!game.dice || legal.length > 0} onClick={doRoll}>Кинути кубики</button>
        {humanIdx >= 0 && (
          <div className="mine">
            <h2>{isHuman ? `Хід: ${seatName(settings, me)}` : 'Твої фішки'}</h2>
            <div className="chips" aria-label="Стан фішок">
              {myPieces.map((p, i) => (
                <span key={i} className={`chip ${isFinished(myPieces, i) ? 'done' : p.at === 'done' ? 'ring' : p.at}`} style={{ background: PLAYER_COLORS[humanIdx] }} title={p.at} />
              ))}
            </div>
            <p className="muted">Вдома {count('home')} · у грі {count('ready') + count('ring') + count('jail') + count('done') - finished} · в полоні {count('captured')} · фініш {finished}</p>
          </div>
        )}
        {buybacks.length < 2 ? (
          <button className="btn" disabled={!buybacks.length} onClick={() => buybacks[0] && act(buybacks[0].action)}>Викупити</button>
        ) : (
          <div className="buybacks" role="group" aria-label="У кого викупити">
            <span className="muted">У кого викупити?</span>
            {buybacks.map((m) => (
              <button key={captorOf(m)} className="btn" onClick={() => act(m.action)}>
                <span className="dot" style={{ background: PLAYER_COLORS[captorOf(m)] }} aria-hidden />
                {PLAYER_NAMES_COLOR[captorOf(m)]}{settings.seats[captorOf(m)] !== 'human' && <span className="tag"> · бот</span>}
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className="board-wrap">
        <Board state={game} selectable={selectable} selected={selected} onSelect={(pi) => setSelected(pi === selected ? null : pi)} targets={targets} hop={hop} kills={kills} bottom={viewer >= 0 ? game.sides[viewer] : undefined} />
        {toast && <div key={toast.key} className="toast" role="alert">{toast.text}</div>}
        {turnBanner && (
          <div key={turnBanner.key} className={`turn-banner ${turnBanner.mine ? '' : 'other'}`} style={{ '--pc': turnBanner.color } as React.CSSProperties} role="status">
            {turnBanner.text}
          </div>
        )}
      </main>

      <aside className="side right">
        <div className="topbar">
          <div className={`timer ${left !== null && left <= 5 ? 'low' : ''}`} aria-label="Час на хід">
            {left === null ? '∞' : `00:${String(left).padStart(2, '0')}`}
          </div>
          <button className="btn icon" aria-label="Меню" onClick={() => confirm('Вийти в меню? Партія завершиться.') && onMenu()}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        {game.winner === null && (
          <div className={`turn-card ${isHuman ? 'my-turn' : ''}`} style={{ '--pc': PLAYER_COLORS[me] } as React.CSSProperties} aria-live="polite">
            <span className="dot" style={{ background: PLAYER_COLORS[me] }} aria-hidden />
            <span>{turnLabel}</span>
          </div>
        )}
        <ol className="players">
          {game.sides.map((_, pl) => {
            const prisoners = game.pieces.flat().filter((p) => p.at === 'captured' && p.by === pl)
            const done = game.pieces[pl].filter((_, i) => isFinished(game.pieces[pl], i)).length
            return (
              <li key={pl} className={pl === me ? 'active' : ''} aria-current={pl === me ? 'true' : undefined}>
                <span className="dot" style={{ background: PLAYER_COLORS[pl] }} aria-hidden />
                <span className="name">{seatName(settings, pl)}</span>
                <span className="muted">{place(pl) >= 0 ? `${place(pl) + 1} місце` : game.winner !== null ? 'програв' : `${done}/4`}</span>
                {prisoners.length > 0 && <span className="prisoners" title="Полонені">
                  {game.pieces.flatMap((row, owner) => row.filter((p) => p.at === 'captured' && p.by === pl).map((_, k) =>
                    <span key={`${owner}-${k}`} className="dot small" style={{ background: PLAYER_COLORS[owner] }} />))}
                </span>}
              </li>
            )
          })}
        </ol>
        <p className="message" aria-live="polite">{message}</p>
        {isHuman && selected === null && legal.length > 0 && <p className="muted hint">{game.dice ? (legal.every((m) => m.action.type === 'use' && m.action.dice.length === 2) && !game.used[0] && !game.used[1] ? 'Ходить лише одна фішка — обидва кубики разом' : 'Торкнись фішки, яка світиться') : 'У тебе викупили фішку: спершу зроби 6 кроків будь-якою фішкою'}</p>}
      </aside>

      {game.winner !== null && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="win-h">
          <div className="panel">
            <h2 id="win-h" style={{ color: PLAYER_COLORS[game.winner] }}>{seatName(settings, game.winner)} перемагає!</h2>
            <ol className="standings">
              {game.sides.map((_, pl) => pl).sort((x, y) => (place(x) < 0 ? 99 : place(x)) - (place(y) < 0 ? 99 : place(y))).map((pl) => (
                <li key={pl} className={place(pl) < 0 ? 'lost' : ''}>
                  <span>{place(pl) >= 0 ? `${place(pl) + 1} місце` : 'Програв'}</span>
                  <span className="dot" style={{ background: PLAYER_COLORS[pl] }} aria-hidden />
                  <span>{seatName(settings, pl)}</span>
                </li>
              ))}
            </ol>
            <div className="row">
              {!online && <button className="btn primary" autoFocus onClick={onRestart}>Ще раз</button>}
              <button className="btn" onClick={onMenu}>Меню</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
}
function Die({ value, used }: { value: number; used: boolean }) {
  return (
    <svg className={`die ${used ? 'used' : ''}`} viewBox="0 0 4 4" aria-hidden>
      <rect x="0.1" y="0.1" width="3.8" height="3.8" rx="0.7" />
      {(PIPS[value] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="0.36" />)}
    </svg>
  )
}
