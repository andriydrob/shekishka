import { useEffect, useMemo, useRef, useState } from 'react'
import { autoplay, chooseAction, type Level } from './game/bot'
import { ringCell, type Cell } from './game/board'
import { apply, legalActions, newGame, ringIdx, roll, type Action, type State } from './game/engine'
import type { Op, PublicRoom } from './game/room'
import { api, loadCreds, saveCreds, type Creds } from './online'
import { Board, PLAYER_COLORS, PLAYER_NAMES_COLOR, pieceCell, stopCell, type Hop, type Target } from './ui/Board'

type Seat = 'human' | Level
interface Settings { players: number; seats: Seat[]; turnSeconds: number; mySeat?: number } // mySeat — лише онлайн
interface OnlineProps { room: PublicRoom; deadlineLocal: number; send: (op: Op) => void }
type Screen = { kind: 'menu' } | { kind: 'bots' } | { kind: 'online-new' } | { kind: 'online'; id: string }

const LEVEL_NAMES: Record<Level, string> = { easy: 'легкий', medium: 'середній', hard: 'важкий' }
const TIMES = [15, 30, 45, 60, 0]
const POLL_MS = 1000
const BOT_DELAY = 700
const NO_MOVES_DELAY = 1500 // скільки показувати кубики, коли ходів немає, перед автопропуском
const HOP_DELAY = 450 // фішка спершу стає на П/В/стрілку, потім стрибає

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
    const res = await api({ op: 'create', players: s.players, turnSeconds: s.turnSeconds })
    if (!res.room || res.token === undefined) return alert(res.error ?? 'Не вдалося створити кімнату')
    saveCreds(res.room.id, { seat: 0, token: res.token })
    history.replaceState(null, '', `?room=${res.room.id}`)
    setScreen({ kind: 'online', id: res.room.id })
  }

  if (screen.kind === 'online') return <Online id={screen.id} onMenu={toMenu} />
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
  const [seats, setSeats] = useState<Seat[]>(['human', 'medium', 'medium', 'medium'])
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
        {!online && seats.slice(0, players).map((seat, i) => (
          <label key={i} className="seat">
            <span className="dot" style={{ background: PLAYER_COLORS[i] }} aria-hidden />
            <span>{PLAYER_NAMES_COLOR[i]}</span>
            <select value={seat} onChange={(e) => setSeats(seats.map((s, j) => (j === i ? (e.target.value as Seat) : s)))}>
              <option value="human">Людина</option>
              <option value="easy">Бот: легкий</option>
              <option value="medium">Бот: середній</option>
              <option value="hard">Бот: важкий</option>
            </select>
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
  if (settings.mySeat !== undefined) return i === settings.mySeat ? 'Ти' : PLAYER_NAMES_COLOR[i]
  if (seat !== 'human') return `Бот (${LEVEL_NAMES[seat]})`
  return settings.seats.filter((s) => s === 'human').length === 1 ? 'Ти' : `Гравець ${i + 1}`
}

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
  else if (now.at === 'done') parts.push('фішка вдома!')
  else if (now.at === 'ring' && (was.at === 'ring' || was.at === 'jail')) {
    const n = a.dice.reduce((s: number, i) => s + prev.dice![i], 0)
    const jump = now.p - (was.p + n)
    if (jump > 0) parts.push('політ по «П»')
    if (jump < 0) parts.push('повернення по «В»')
  }
  if (capturedNow > capturedBefore) parts.push('фішку суперника побито!')
  return parts.length ? `${who}: ${parts.join(', ')}` : null
}

function Online({ id, onMenu }: { id: string; onMenu: () => void }) {
  const [creds, setCreds] = useState<Creds | null>(() => loadCreds(id))
  const [room, setRoom] = useState<PublicRoom | null>(null)
  const [deadlineLocal, setDeadlineLocal] = useState(0)
  const [error, setError] = useState('')
  const version = useRef(0)
  const joining = useRef(false)

  // приймаємо лише новіші версії, щоб запізніла відповідь не відкотила стан
  const accept = (r: PublicRoom) => {
    if (r.version < version.current) return
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

  const send = (op: Op) => {
    if (!creds) return
    api({ ...op, id, seat: creds.seat, token: creds.token }).then((res) => res.room && accept(res.room))
  }

  if (error) return (
    <main className="setup">
      <h1>Шекішка</h1>
      <p className="panel" role="alert">{error}</p>
      <button className="btn big" onClick={onMenu}>Меню</button>
    </main>
  )
  if (!room || !creds) return <main className="setup"><p>Підключення…</p></main>
  if (room.joined < room.players) return <Lobby room={room} mySeat={creds.seat} onMenu={onMenu} />
  return (
    <Game key={id} settings={{ players: room.players, seats: Array(room.players).fill('human'), turnSeconds: room.turnSeconds, mySeat: creds.seat }}
      online={{ room, deadlineLocal, send }} onMenu={onMenu} onRestart={onMenu} />
  )
}

function Lobby({ room, mySeat, onMenu }: { room: PublicRoom; mySeat: number; onMenu: () => void }) {
  const link = `${location.origin}${location.pathname}?room=${room.id}`
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})
  return (
    <main className="setup">
      <h1>Шекішка</h1>
      <section className="panel" aria-labelledby="lobby-h">
        <h2 id="lobby-h">Кімната {room.id}</h2>
        <p className="muted">Надішли це посилання друзям. Гра почнеться, коли всі зайдуть.</p>
        <div className="link-row">
          <input readOnly value={link} aria-label="Посилання на кімнату" onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={copy}>{copied ? 'Скопійовано' : 'Копіювати'}</button>
        </div>
        {'share' in navigator && <button className="btn primary" onClick={() => navigator.share({ title: 'Шекішка', text: 'Заходь пограти в Шекішку!', url: link }).catch(() => {})}>Поділитися</button>}
        <ul className="lobby-seats">
          {Array.from({ length: room.players }, (_, i) => (
            <li key={i}>
              <span className="dot" style={{ background: PLAYER_COLORS[i] }} aria-hidden />
              <span>{PLAYER_NAMES_COLOR[i]}{i === mySeat ? ' (ти)' : ''}</span>
              <span className="muted">{i < room.joined ? 'у кімнаті' : 'чекаємо…'}</span>
            </li>
          ))}
        </ul>
      </section>
      <button className="btn big" onClick={onMenu}>Меню</button>
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

  const me = game.current
  const seat = settings.seats[me]
  const isHuman = (online ? me === settings.mySeat : seat === 'human') && game.winner === null
  const legal = useMemo(() => legalActions(game), [game])
  const humanIdx = online ? settings.mySeat! : isHuman ? me : settings.seats.indexOf('human')

  // онлайн: сервер — джерело правди; новий стан приходить через опитування
  useEffect(() => {
    if (!online) return
    const st = online.room.state
    if (st.turn !== game.turn) setMessage(st.winner === null ? (st.current === settings.mySeat ? 'Твій хід!' : `Хід: ${seatName(settings, st.current)}`) : '')
    setGame(st)
  }, [online?.room.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = (a: Action) => {
    const next = apply(game, a)
    if (!next) return
    const text = describe(game, next, a, seatName(settings, me))
    if (text) setMessage(text)
    setSelected(null)
    setGame(next)
    online?.send({ op: 'act', action: a })
    if (a.type !== 'use') return
    // проміжні клітинки для анімації: вихід із тюрми — через стрілку; П/В/стрілка — зупинка перед стрибком
    const was = game.pieces[me][a.piece]
    const path: Cell[] = []
    if (was.at === 'jail' && was.stage === 2) path.push(ringCell(ringIdx(game.sides[me], was.p)))
    const stop = stopCell(game, a)
    const final = pieceCell(next, me, a.piece)
    if (stop && final && (stop.c !== final.c || stop.r !== final.r)) path.push(stop)
    // перший крок — одразу разом із setGame, щоб фішка не блимнула на фінальній клітинці
    path.forEach((cell, i) => (i ? setTimeout(() => setHop({ pl: me, pi: a.piece, cell }), HOP_DELAY * i) : setHop({ pl: me, pi: a.piece, cell })))
    if (path.length) setTimeout(() => setHop(null), HOP_DELAY * path.length)
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
    : online ? Math.max(0, Math.ceil((online.deadlineLocal - now) / 1000))
    : deadline.turn !== game.turn ? settings.turnSeconds : Math.max(0, Math.ceil((deadline.at - now) / 1000))
  useEffect(() => {
    if (online || !isHuman || left !== 0) return // онлайн прострочений хід робить сервер
    setSelected(null)
    setGame(autoplay(game))
    setMessage(`${seatName(settings, me)}: час вийшов, хід зроблено автоматично`)
  }, [left]) // eslint-disable-line react-hooks/exhaustive-deps

  // боти й автоматичний пропуск, коли ходів немає
  useEffect(() => {
    if (game.winner !== null) return
    if (seat !== 'human') {
      const t = setTimeout(() => (game.dice ? act(chooseAction(game, seat)) : doRoll()), BOT_DELAY)
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
    return legal.filter((m) => m.action.type === 'use' && (m.action.piece === pi || ((at === 'home' || at === 'ready') && game.pieces[me][m.action.piece].at === at)))
  }
  const selectable = new Set(isHuman ? game.pieces[me].map((_, i) => i).filter((i) => game.pieces[me][i].at !== 'captured' && actionsFor(i).length) : [])
  const targets: Target[] = selected === null || !isHuman ? [] : actionsFor(selected).flatMap((m) => {
    if (m.action.type !== 'use') return []
    const cell = stopCell(game, m.action) ?? pieceCell(m.next, me, m.action.piece)
    const label = String(m.action.dice.reduce((s: number, i) => s + game.dice![i], 0))
    const prisoners = (st: State) => st.pieces.flat().filter((p) => p.at === 'captured' && p.by === me).length
    const capture = prisoners(m.next) > prisoners(game)
    return cell ? [{ key: m.action.dice.join(), cell, label, capture, onPick: () => act(m.action) }] : []
  })
  const buyback = isHuman ? legal.find((m) => m.action.type === 'use' && game.pieces[me][m.action.piece].at === 'captured') : undefined

  const myPieces = humanIdx >= 0 ? game.pieces[humanIdx] : []
  const count = (at: string) => myPieces.filter((p) => p.at === at).length

  return (
    <div className="game">
      <aside className="side left">
        <div className={`dice ${rolling ? 'rolling' : ''}`} aria-live="polite" aria-label={game.dice ? `Кубики: ${game.dice.join(' і ')}` : 'Кубики ще не кинуто'}>
          {(game.dice ?? [0, 0]).map((v, i) => <Die key={i} value={v} used={!!game.dice && game.used[i]} />)}
        </div>
        <button className="btn primary" disabled={!isHuman || !!game.dice} onClick={doRoll}>Кинути кубики</button>
        {humanIdx >= 0 && (
          <div className="mine">
            <h2>{isHuman ? `Хід: ${seatName(settings, me)}` : 'Твої фішки'}</h2>
            <div className="chips" aria-label="Стан фішок">
              {myPieces.map((p, i) => (
                <span key={i} className={`chip ${p.at}`} style={{ background: PLAYER_COLORS[humanIdx] }} title={p.at} />
              ))}
            </div>
            <p className="muted">Вдома {count('home')} · у грі {count('ready') + count('ring') + count('jail')} · в полоні {count('captured')} · фініш {count('done')}</p>
          </div>
        )}
        <button className="btn" disabled={!buyback} onClick={() => buyback && act(buyback.action)}>Викупити</button>
      </aside>

      <main className="board-wrap">
        <Board state={game} selectable={selectable} selected={selected} onSelect={(pi) => setSelected(pi === selected ? null : pi)} targets={targets} hop={hop} />
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
        <ol className="players">
          {game.sides.map((_, pl) => {
            const prisoners = game.pieces.flat().filter((p) => p.at === 'captured' && p.by === pl)
            const done = game.pieces[pl].filter((p) => p.at === 'done').length
            return (
              <li key={pl} className={pl === me ? 'active' : ''} aria-current={pl === me ? 'true' : undefined}>
                <span className="dot" style={{ background: PLAYER_COLORS[pl] }} aria-hidden />
                <span className="name">{seatName(settings, pl)}</span>
                <span className="muted">{done}/4</span>
                {prisoners.length > 0 && <span className="prisoners" title="Полонені">
                  {game.pieces.flatMap((row, owner) => row.filter((p) => p.at === 'captured' && p.by === pl).map((_, k) =>
                    <span key={`${owner}-${k}`} className="dot small" style={{ background: PLAYER_COLORS[owner] }} />))}
                </span>}
              </li>
            )
          })}
        </ol>
        <p className="message" aria-live="polite">{message}</p>
        {isHuman && game.dice && selected === null && legal.length > 0 && <p className="muted hint">Торкнись фішки, яка світиться</p>}
        <button className="btn" disabled={!isHuman || !game.dice || legal.length > 0} onClick={() => act({ type: 'pass' })}>Пропустити хід</button>
      </aside>

      {game.winner !== null && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="win-h">
          <div className="panel">
            <h2 id="win-h" style={{ color: PLAYER_COLORS[game.winner] }}>{seatName(settings, game.winner)} перемагає!</h2>
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
