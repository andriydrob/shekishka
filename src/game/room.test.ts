import { describe, expect, it } from 'vitest'
import { legalActions, type Action } from './engine'
import { started, createRoom, joinRoom, parseOp, play, publicView, tick } from './room'

const T0 = 1_000_000

describe('онлайн-кімната', () => {
  it('гра стартує, коли всі зайшли й усі готові; зайвий не заходить', () => {
    const r = createRoom('abc234', 2, 30, 'host')
    expect(play(r, 0, 'host', { op: 'ready', ready: true }, T0)).toBeNull() // готовий ще до приходу друга
    expect(play(r, 0, 'host', { op: 'roll' }, T0)).toBe('Чекаємо, поки всі зайдуть і будуть готові')
    expect(joinRoom(r, 'friend', T0)).toBe(1)
    expect(joinRoom(r, 'third', T0)).toBeNull()
    expect(started(r)).toBe(false) // друг ще не готовий
    expect(r.deadline).toBe(0)
    expect(play(r, 1, 'friend', { op: 'ready', ready: false }, T0)).toBeNull() // скасувати можна
    expect(play(r, 1, 'friend', { op: 'ready', ready: true }, T0 + 5)).toBeNull()
    expect(started(r)).toBe(true)
    expect(r.deadline).toBe(T0 + 5 + 30_000)
    expect(play(r, 1, 'friend', { op: 'ready', ready: false }, T0)).toBe('Гра вже почалась')
  })

  it('ходить лише той, чия черга, і лише зі своїм токеном', () => {
    const r = createRoom('abc234', 2, 30, 'host')
    joinRoom(r, 'friend', T0)
    play(r, 0, 'host', { op: 'ready', ready: true }, T0)
    play(r, 1, 'friend', { op: 'ready', ready: true }, T0)
    const cur = r.state.current, other = 1 - cur
    const tok = ['host', 'friend']
    expect(play(r, other, tok[other], { op: 'roll' }, T0)).toBe('Зараз не твій хід')
    expect(play(r, cur, 'чужий', { op: 'roll' }, T0)).toBe('Невідомий гравець')
    const v = r.version
    expect(play(r, cur, tok[cur], { op: 'roll' }, T0)).toBeNull()
    expect(r.state.dice).not.toBeNull()
    expect(r.version).toBe(v + 1)
    expect(play(r, cur, tok[cur], { op: 'roll' }, T0)).toBe('Кубики вже кинуто')
    // хід потрапляє в журнал разом зі станом до нього — щоб інші гравці побачили, як фішка йде
    const before = r.state
    const a: Action = legalActions(r.state)[0]?.action ?? { type: 'pass' }
    expect(play(r, cur, tok[cur], { op: 'act', action: a }, T0)).toBeNull()
    expect(r.moves).toEqual([{ v: r.version, before, action: a }])
  })

  it('прострочений хід робиться автоматично', () => {
    const r = createRoom('abc234', 2, 15, 'host')
    joinRoom(r, 'friend', T0)
    play(r, 0, 'host', { op: 'ready', ready: true }, T0)
    play(r, 1, 'friend', { op: 'ready', ready: true }, T0)
    const turn = r.state.turn
    expect(tick(r, T0 + 10_000)).toBe(false)
    expect(tick(r, T0 + 16_000)).toBe(true)
    expect(r.state.turn).toBeGreaterThan(turn)
    expect(r.deadline).toBe(T0 + 16_000 + 15_000)
  })

  it('кімната з ботом: бот одразу готовий, ходить сам кроками з паузою, за нього ходити не можна', () => {
    const r = createRoom('abc234', 3, 30, 'host', [null, null, 'easy'])
    expect(publicView(r, T0).taken).toEqual([true, false, true])
    expect(joinRoom(r, 'friend', T0)).toBe(1) // друг займає вільне місце, а не місце бота
    expect(joinRoom(r, 'x', T0)).toBeNull()
    play(r, 0, 'host', { op: 'ready', ready: true }, T0)
    play(r, 1, 'friend', { op: 'ready', ready: true }, T0)
    expect(started(r)).toBe(true)
    r.state = { ...r.state, current: 2 } // хід бота
    expect(play(r, 2, '', { op: 'roll' }, T0)).toBe('Невідомий гравець') // порожній токен місця бота не підходить
    expect(tick(r, T0 + 100)).toBe(false) // чекає паузу після старту
    let t = T0 + 2000, steps = 0
    while (r.state.current === 2 && steps < 10) {
      expect(tick(r, t)).toBe(true)
      expect(tick(r, t)).toBe(false) // наступний крок — лише після паузи
      t += 5000
      steps++
    }
    expect(r.state.current).not.toBe(2)
    expect(steps).toBeGreaterThanOrEqual(2) // щонайменше кидок і хід (або пропуск)
  })

  it('токени не потрапляють у публічний стан', () => {
    const r = createRoom('abc234', 2, 30, 'host')
    expect(JSON.stringify(publicView(r, T0))).not.toContain('host')
  })

  it('сміття з мережі відкидається', () => {
    expect(parseOp({ op: 'act', action: { type: 'use', piece: 9, dice: [0] } })).toBeNull()
    expect(parseOp({ op: 'act', action: { type: 'use', piece: 1, dice: [2] } })).toBeNull()
    expect(parseOp({ op: 'act', action: { type: 'use', piece: 1, dice: [0, 1] } })).toEqual({ op: 'act', action: { type: 'use', piece: 1, dice: [0, 1] } })
    expect(parseOp({ op: 'hack' })).toBeNull()
    expect(parseOp({ op: 'ready', ready: 'так' })).toEqual({ op: 'ready', ready: false })
  })
})
