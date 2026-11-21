import { describe, expect, it } from 'vitest'
import { createRoom, joinRoom, parseOp, play, publicView, tick } from './room'

const T0 = 1_000_000

describe('онлайн-кімната', () => {
  it('гра стартує, коли всі зайшли; зайвий не заходить', () => {
    const r = createRoom('abc234', 2, 30, 'host')
    expect(play(r, 0, 'host', { op: 'roll' }, T0)).toBe('Чекаємо, поки всі зайдуть')
    expect(joinRoom(r, 'friend', T0)).toBe(1)
    expect(r.deadline).toBe(T0 + 30_000)
    expect(joinRoom(r, 'third', T0)).toBeNull()
  })

  it('ходить лише той, чия черга, і лише зі своїм токеном', () => {
    const r = createRoom('abc234', 2, 30, 'host')
    joinRoom(r, 'friend', T0)
    const cur = r.state.current, other = 1 - cur
    const tok = ['host', 'friend']
    expect(play(r, other, tok[other], { op: 'roll' }, T0)).toBe('Зараз не твій хід')
    expect(play(r, cur, 'чужий', { op: 'roll' }, T0)).toBe('Невідомий гравець')
    const v = r.version
    expect(play(r, cur, tok[cur], { op: 'roll' }, T0)).toBeNull()
    expect(r.state.dice).not.toBeNull()
    expect(r.version).toBe(v + 1)
    expect(play(r, cur, tok[cur], { op: 'roll' }, T0)).toBe('Кубики вже кинуто')
  })

  it('прострочений хід робиться автоматично', () => {
    const r = createRoom('abc234', 2, 15, 'host')
    joinRoom(r, 'friend', T0)
    const turn = r.state.turn
    expect(tick(r, T0 + 10_000)).toBe(false)
    expect(tick(r, T0 + 16_000)).toBe(true)
    expect(r.state.turn).toBeGreaterThan(turn)
    expect(r.deadline).toBe(T0 + 16_000 + 15_000)
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
  })
})
