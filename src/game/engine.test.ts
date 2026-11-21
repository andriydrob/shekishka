import { describe, expect, it } from 'vitest'
import { ringCell, special } from './board'
import { chooseAction, type Level } from './bot'
import { apply, legalActions, newGame, roll, type Action, type Piece, type State } from './engine'

// Гравець 0 знизу (side 2), гравець 1 зверху (side 0). Старт низу = ring 30, верху = ring 6.
function make(p0: Piece[], p1: Piece[] = [], dice: [number, number] = [1, 2], turn = 5): State {
  const fill = (a: Piece[]) => [...a, ...Array(4 - a.length).fill({ at: 'home' })]
  return { sides: [2, 0], pieces: [fill(p0), fill(p1)], current: 0, turn, dice, used: [false, false], winner: null }
}
const use = (piece: number, ...dice: (0 | 1)[]): Action => ({ type: 'use', piece, dice })

describe('поле', () => {
  it('клітинки збігаються з фото', () => {
    expect(ringCell(0)).toEqual({ c: 12, r: 0 }) // правий верхній кут
    expect(ringCell(3)).toEqual({ c: 9, r: 0 }) // В зверху
    expect(ringCell(7)).toEqual({ c: 5, r: 0 }) // П зверху
    expect(ringCell(17)).toEqual({ c: 0, r: 5 }) // куди летить П зверху
    expect(ringCell(31)).toEqual({ c: 7, r: 12 }) // П знизу
    expect(special(12)).toBe('corner')
  })
})

describe('правила', () => {
  it('вихід лише з 6 на одному кубику', () => {
    expect(apply(make([], [], [3, 3]), use(0, 0, 1))).toBeNull()
    const s = apply(make([], [], [6, 2]), use(0, 0))!
    expect(s.pieces[0][0]).toEqual({ at: 'ring', p: 0 })
  })

  it('дві шістки — дві фішки', () => {
    let s = apply(make([], [], [6, 6]), use(0, 0))!
    s = { ...s, pieces: s.pieces } // хід ще не закінчився
    expect(s.current).toBe(0)
    // друга шістка: стартова клітинка зайнята своєю, тож спершу зрушити першу
    expect(apply(s, use(1, 1))).toBeNull()
    s = apply(s, use(0, 1))!
    expect(s.pieces[0][0]).toEqual({ at: 'ring', p: 6 })
  })

  it('окремо кубики або сума', () => {
    const st = make([{ at: 'ring', p: 20 }], [], [3, 4])
    expect(apply(st, use(0, 0, 1))!.pieces[0][0]).toEqual({ at: 'ring', p: 27 })
    expect(apply(st, use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 23 })
  })

  it('захоплення і кут', () => {
    // суперник (side 0) на ring 34 → для нас p=4
    const opp: Piece = { at: 'ring', p: 28 } // ring 6+28 = 34
    const s = apply(make([{ at: 'ring', p: 1 }], [opp], [3, 5]), use(0, 0))!
    expect(s.pieces[1][0]).toEqual({ at: 'captured', by: 0 })
    // у куті (ring 36 → для суперника p=30) неуразлива
    expect(apply(make([{ at: 'ring', p: 1 }], [{ at: 'ring', p: 30 }], [5, 1]), use(0, 0))).toBeNull()
  })

  it('не можна перестрибувати ні через чужу, ні через свою; на свою не можна', () => {
    expect(apply(make([{ at: 'ring', p: 1 }], [{ at: 'ring', p: 28 }], [5, 1]), use(0, 0))).toBeNull()
    expect(apply(make([{ at: 'ring', p: 1 }, { at: 'ring', p: 4 }], [], [5, 3]), use(0, 0))).toBeNull()
    expect(apply(make([{ at: 'ring', p: 1 }, { at: 'ring', p: 4 }], [], [2, 3]), use(0, 0))).not.toBeNull() // зупинитись перед своєю можна
    // у рукаві через фішку на фініші перестрибнути можна, інакше фініш закривається назавжди
    expect(apply(make([{ at: 'ring', p: 47 }, { at: 'done', slot: 0 }], [], [3, 1]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'done', slot: 1 })
    expect(apply(make([{ at: 'ring', p: 1 }, { at: 'ring', p: 4 }], [], [3, 5]), use(0, 0))).toBeNull()
  })

  it('П летить +10, В повертає −10', () => {
    // П на ring 43 (side 3 pos 7) → для нас p=13
    expect(apply(make([{ at: 'ring', p: 10 }], [], [3, 5]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 23 })
    // В на ring 39 (side 3 pos 3) → p=9 → назад на −1
    expect(apply(make([{ at: 'ring', p: 7 }], [], [2, 5]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: -1 })
  })

  it('тюрма: стрілка → Т, потім 3, потім 6 у різних кидках, вихід від стрілки', () => {
    // стрілка на ring 44 → p=14
    let s = apply(make([{ at: 'ring', p: 10 }], [], [4, 3]), use(0, 0))!
    expect(s.pieces[0][0]).toMatchObject({ at: 'jail', stage: 0 })
    expect(apply(s, use(0, 1))).toBeNull() // 3 у тому самому кидку не рахується
    s = { ...s, turn: s.turn + 2, dice: [3, 6], used: [false, false] }
    s = apply(s, use(0, 0))!
    expect(s.pieces[0][0]).toMatchObject({ stage: 1 })
    expect(apply(s, use(0, 1))).toBeNull() // 6 лише наступного разу
    s = { ...s, turn: s.turn + 2, dice: [6, 4], used: [false, false] }
    s = apply(s, use(0, 0))!
    expect(s.pieces[0][0]).toMatchObject({ stage: 2 })
    expect(apply(s, use(0, 1))).toBeNull()
    s = { ...s, turn: s.turn + 2, dice: [2, 1], used: [false, false] }
    expect(apply(s, use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 16 })
    expect(apply(s, use(0, 1))!.pieces[0][0]).toEqual({ at: 'ring', p: 15 }) // 1 = перша клітинка після стрілки (p=14)
  })

  it('пропустити хід можна лише коли ходів немає', () => {
    expect(apply(make([{ at: 'ring', p: 10 }], [], [4, 3]), { type: 'pass' })).toBeNull() // є хід (навіть у тюрму) — обов'язково
    expect(apply({ ...make([], [], [1, 2]), dice: null }, { type: 'pass' })).toBeNull() // спершу треба кинути
    expect(apply(make([], [], [1, 2]), { type: 'pass' })!.current).toBe(1) // усі вдома, 6 немає
  })

  it('викуп повертає фішку в рукав, вивести — ще одною 6', () => {
    const done3: Piece[] = [{ at: 'done', slot: 3 }, { at: 'done', slot: 2 }, { at: 'done', slot: 1 }]
    let s = apply(make([{ at: 'captured', by: 1 }, ...done3], [], [6, 6]), use(0, 0))!
    expect(s.pieces[0][0]).toEqual({ at: 'home' })
    s = apply(s, use(0, 1))!
    expect(s.pieces[0][0]).toEqual({ at: 'ring', p: 0 })
    expect(apply(make([{ at: 'captured', by: 1 }], [], [3, 3]), use(0, 0, 1))).toBeNull() // лише 6 на одному кубику
  })

  it('коло замикається на клітинці під рукавом, у рукав — наступним кроком', () => {
    // з клітинки перед стартом: 1 → на клітинку під рукавом, 2 → перша клітинка рукава
    expect(apply(make([{ at: 'ring', p: 47 }], [], [1, 2]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 48 })
    expect(apply(make([{ at: 'ring', p: 47 }], [], [1, 2]), use(0, 1))!.pieces[0][0]).toEqual({ at: 'done', slot: 0 })
  })

  it('фініш лише точним числом, перемога', () => {
    const done = (slot: number): Piece => ({ at: 'done', slot })
    const st = make([{ at: 'ring', p: 47 }, done(3), done(2), done(1)], [], [6, 2])
    expect(apply(st, use(0, 0))).toBeNull() // перебір
    const s = apply(st, use(0, 1))!
    expect(s.pieces[0][0]).toEqual({ at: 'done', slot: 0 })
    expect(s.winner).toBe(0)
  })
})

describe('боти', () => {
  it.each<[number, Level]>([[2, 'easy'], [3, 'medium'], [4, 'hard']])('%i гравців (%s) догравають до кінця', (n, level) => {
    let seed = 42
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let s = newGame(n, rng).state
    for (let i = 0; i < 200000 && s.winner === null; i++) {
      if (!s.dice) s = roll(s, rng)
      const a = chooseAction(s, level, rng)
      if (a.type === 'use') expect(legalActions(s).some((m) => JSON.stringify(m.action) === JSON.stringify(a))).toBe(true)
      s = apply(s, a)!
    }
    expect(s.winner).not.toBeNull()
  })
})
