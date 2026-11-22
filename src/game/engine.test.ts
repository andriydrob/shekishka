import { describe, expect, it } from 'vitest'
import { ringCell, special } from './board'
import { chooseAction, type Level } from './bot'
import { apply, isFinished, legalActions, newGame, roll, type Action, type Piece, type State } from './engine'

// Гравець 0 знизу (side 2), гравець 1 зверху (side 0). Старт низу = ring 30, верху = ring 6.
function make(p0: Piece[], p1: Piece[] = [], dice: [number, number] = [1, 2], turn = 5): State {
  const fill = (a: Piece[]) => [...a, ...Array(4 - a.length).fill({ at: 'home' })]
  return { sides: [2, 0], pieces: [fill(p0), fill(p1)], current: 0, turn, dice, used: [false, false], winner: null, places: [], frozen: null, bonus: [0, 0] }
}
const use = (piece: number, ...dice: (0 | 1)[]): Action => ({ type: 'use', piece, dice })
// друга фішка на ходу: коли ходить лише одна — дозволена тільки сума кубиків, а тут перевіряємо окремі кубики
const spare: Piece = { at: 'ring', p: 40 }
const jailSpare: Piece = { at: 'jail', p: 14, stage: 0, since: 0 } // ходить лише на 3

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
  it('шістка вводить фішку в гру (лишається в рукаві)', () => {
    expect(apply(make([], [], [3, 3]), use(0, 0, 1))).toBeNull()
    const s = apply(make([], [], [6, 2]), use(0, 0))!
    expect(s.pieces[0][0]).toEqual({ at: 'ready' })
  })

  it('після виходу клітинка під рукавом = 1-й крок', () => {
    const out = (d2: number) => apply(apply(make([], [], [6, d2]), use(0, 0))!, use(0, 1))!.pieces[0][0]
    expect(out(1)).toEqual({ at: 'ring', p: 0 }) // 6 і 1 — просто вивести на клітинку під рукавом
    expect(out(3)).toMatchObject({ at: 'jail', p: 2, stage: 0 }) // 6 і 3 — під рукавом, П, стрілка → тюрма
    expect(out(5)).toEqual({ at: 'ring', p: 4 }) // 6 і 5 — п’ять кроків від клітинки під рукавом
  })

  it('дві шістки — дві фішки або вивести й пройти 6', () => {
    const s = apply(make([], [], [6, 6]), use(0, 0))!
    expect(s.current).toBe(0) // хід ще не закінчився
    expect(apply(s, use(1, 1))!.pieces[0].slice(0, 2)).toEqual([{ at: 'ready' }, { at: 'ready' }])
    expect(apply(s, use(0, 1))!.pieces[0][0]).toEqual({ at: 'ring', p: 5 })
  })

  it('окремо кубики або сума', () => {
    const st = make([{ at: 'ring', p: 20 }, spare], [], [3, 4])
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
    // у рукаві теж не можна перестрибувати
    expect(apply(make([{ at: 'ring', p: 47 }, { at: 'done', slot: 0 }], [], [3, 1]), use(0, 0))).toBeNull()
    expect(apply(make([{ at: 'ring', p: 1 }, { at: 'ring', p: 4 }], [], [3, 5]), use(0, 0))).toBeNull()
  })

  it('П летить +10, В повертає −10', () => {
    // П на ring 43 (side 3 pos 7) → для нас p=13
    expect(apply(make([{ at: 'ring', p: 10 }, spare], [], [3, 5]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 23 })
    // В на ring 39 (side 3 pos 3) → p=9 → назад на −1
    expect(apply(make([{ at: 'ring', p: 7 }, spare], [], [2, 5]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: -1 })
  })

  it('тюрма: стрілка → Т, потім 3, потім 6 у різних кидках, вихід від клітинки під «6»', () => {
    // стрілка на ring 44 → p=14
    let s = apply(make([{ at: 'ring', p: 10 }, spare], [], [4, 3]), use(0, 0))!
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
    expect(apply(s, use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 17 })
    expect(apply(s, use(0, 1))!.pieces[0][0]).toEqual({ at: 'ring', p: 16 }) // 1 = клітинка під «6» (стрілка p=14 + 2)
  })

  it('у тюрмі можна бити чужі фішки, на свою ставати не можна', () => {
    // стрілка правої тюрми = ring 44: для нас (side 2) p=14, для суперника (side 0) p=38
    const oppInT: Piece = { at: 'jail', p: 38, stage: 0, since: 0 }
    const s = apply(make([{ at: 'ring', p: 10 }, spare], [oppInT], [4, 1]), use(0, 0))!
    expect(s.pieces[0][0]).toMatchObject({ at: 'jail', stage: 0 })
    expect(s.pieces[1][0]).toEqual({ at: 'captured', by: 0 })
    // крок «3» на клітинку, де стоїть чужа — теж б'є
    const oppOn3: Piece = { at: 'jail', p: 38, stage: 1, since: 0 }
    const s2 = apply(make([{ at: 'jail', p: 14, stage: 0, since: 0 }], [oppOn3], [3, 1]), use(0, 0))!
    expect(s2.pieces[1][0]).toEqual({ at: 'captured', by: 0 })
    // своя вже на «Т» — заходити не можна
    expect(apply(make([{ at: 'ring', p: 10 }, { at: 'jail', p: 14, stage: 0, since: 0 }], [], [4, 1]), use(0, 0))).toBeNull()
  })

  it('після биття або П/В цією фішкою до кінця ходу не ходиш', () => {
    // побили (p1 + 3 → p4, де суперник) — другий кубик цією фішкою не можна, інших ходів нема → можна пропустити
    const afterCapture = apply(make([{ at: 'ring', p: 1 }, jailSpare], [{ at: 'ring', p: 28 }], [3, 1]), use(0, 0))!
    expect(apply(afterCapture, use(0, 1))).toBeNull()
    expect(apply(afterCapture, { type: 'pass' })!.current).toBe(1)
    // П (p10 + 3 → p13 → p23): другий кубик цією фішкою не можна
    const afterFly = apply(make([{ at: 'ring', p: 10 }, jailSpare], [], [3, 1]), use(0, 0))!
    expect(afterFly.pieces[0][0]).toEqual({ at: 'ring', p: 23 })
    expect(apply(afterFly, use(0, 1))).toBeNull()
    // В теж
    const afterBack = apply(make([{ at: 'ring', p: 7 }, { at: 'ring', p: 20 }], [], [2, 1]), use(0, 0))!
    expect(apply(afterBack, use(0, 1))).toBeNull()
    expect(apply(afterBack, use(1, 1))).not.toBeNull() // іншою фішкою — можна
    // наступного ходу заморозка знімається
    expect(apply(afterCapture, { type: 'pass' })!.frozen).toBeNull()
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
    expect(s.pieces[0][0]).toEqual({ at: 'ready' })
    expect(apply(make([{ at: 'captured', by: 1 }], [], [3, 3]), use(0, 0, 1))).toBeNull() // лише 6 на одному кубику
  })

  it('фішки в полоні в різних гравців — можна вибрати, у кого викупити', () => {
    const st: State = { ...make([{ at: 'captured', by: 1 }, { at: 'captured', by: 2 }], [], [6, 1]), sides: [2, 0, 3], bonus: [0, 0, 0],
      pieces: [[{ at: 'captured', by: 1 }, { at: 'captured', by: 2 }, { at: 'home' }, { at: 'home' }], [{ at: 'home' }, { at: 'home' }, { at: 'home' }, { at: 'home' }], [{ at: 'home' }, { at: 'home' }, { at: 'home' }, { at: 'home' }]] }
    const buy = legalActions(st).filter((m) => m.action.type === 'use' && st.pieces[0][m.action.piece].at === 'captured')
    expect(buy.map((m) => m.action)).toEqual([use(0, 0), use(1, 0)])
    expect(apply(st, use(0, 0))!.bonus).toEqual([0, 1, 0]) // викупив у гравця 1 — 6 кроків йому
    expect(apply(st, use(1, 0))!.bonus).toEqual([0, 0, 1]) // у гравця 2 — йому
  })

  it('у кого викупили — 6 кроків на початку свого ходу, до кидка; вивести чи викупити ними не можна', () => {
    // гравець 0 викуповує фішку в гравця 1 → у гравця 1 бонус
    let s = apply(make([{ at: 'captured', by: 1 }], [{ at: 'ring', p: 4 }, { at: 'captured', by: 0 }], [6, 2]), use(0, 0))!
    expect(s.bonus).toEqual([0, 1])
    s = apply(s, use(0, 1)) ?? apply(s, { type: 'pass' })!
    expect(s.current).toBe(1)
    expect(roll(s)).toBe(s) // кидати не можна, поки є хід бонусом
    const legal = legalActions(s)
    expect(legal.map((m) => m.action)).toEqual([{ type: 'bonus', piece: 0 }]) // лише фішка на полі; не вивести й не викупити
    s = apply(s, { type: 'bonus', piece: 0 })!
    expect(s.pieces[1][0]).toEqual({ at: 'ring', p: 10 })
    expect(s.bonus).toEqual([0, 0])
    expect(roll(s).dice).not.toBeNull()
    // якщо піти нічим — бонус пропадає, кидаєш як завжди
    const stuck = { ...make([], [], [1, 1]), dice: null, bonus: [1, 0] }
    expect(legalActions(stuck)).toEqual([])
    expect(roll(stuck).bonus).toEqual([0, 0])
  })

  it('у рукаві фішку треба довести до кінця: ходить далі точним числом, зараховується лише в кінці', () => {
    const st = make([{ at: 'done', slot: 1 }, { at: 'done', slot: 3 }], [], [1, 2])
    expect(isFinished(st.pieces[0], 1)).toBe(true)
    expect(isFinished(st.pieces[0], 0)).toBe(false) // між нею і кінцем порожньо
    const s = apply(st, use(0, 0))!
    expect(s.pieces[0][0]).toEqual({ at: 'done', slot: 2 })
    expect(isFinished(s.pieces[0], 0)).toBe(true)
    expect(apply(st, use(0, 1))).toBeNull() // 2: на свою в кінці не можна
    expect(apply(st, use(0, 0, 1))).toBeNull() // 3: за межі рукава не можна
    expect(apply(make([{ at: 'done', slot: 0 }, { at: 'done', slot: 1 }], [], [2, 3]), use(0, 0))).toBeNull() // через свою в рукаві не можна
  })

  it('коло замикається на клітинці під рукавом, у рукав — наступним кроком', () => {
    // з клітинки перед стартом: 1 → на клітинку під рукавом, 2 → перша клітинка рукава
    expect(apply(make([{ at: 'ring', p: 47 }, spare], [], [1, 2]), use(0, 0))!.pieces[0][0]).toEqual({ at: 'ring', p: 48 })
    expect(apply(make([{ at: 'ring', p: 47 }, spare], [], [1, 2]), use(0, 1))!.pieces[0][0]).toEqual({ at: 'done', slot: 0 })
  })

  it('фініш лише точним числом, перемога', () => {
    const done = (slot: number): Piece => ({ at: 'done', slot })
    const st = make([{ at: 'ring', p: 47 }, done(3), done(2), done(1)], [], [6, 2])
    expect(apply(st, use(0, 0))).toBeNull() // перебір
    const s = apply(st, use(0, 1))!
    expect(s.pieces[0][0]).toEqual({ at: 'done', slot: 0 })
    expect(s.places).toEqual([0])
    expect(s.winner).toBe(0) // удвох: один фінішував — другий програв, гра скінчилась
  })

  it('утрьох після першого фінішу гра триває, фінішний гравець більше не ходить', () => {
    const done = (slot: number): Piece => ({ at: 'done', slot })
    const home: Piece = { at: 'home' }
    const st: State = {
      sides: [2, 3, 0], current: 0, turn: 5, dice: [6, 2], used: [false, false], winner: null, places: [], frozen: null, bonus: [0, 0, 0],
      pieces: [[{ at: 'ring', p: 47 }, done(3), done(2), done(1)], [home, home, home, home], [home, home, home, home]],
    }
    let s = apply(st, use(0, 1))!
    expect(s.places).toEqual([0])
    expect(s.winner).toBeNull() // ще двоє грають
    expect(s.current).toBe(1) // хід одразу переходить далі, навіть із невикористаним кубиком
    s = apply({ ...s, current: 2, dice: [1, 2] }, { type: 'pass' })!
    expect(s.current).toBe(1) // гравця 0 пропускаємо
  })
})

describe('історія кидків', () => {
  it('кожен кидок записується: хто й що викинув; зберігаються останні 30', () => {
    let s: State = { ...make([], [], [1, 2]), dice: null }
    s = roll(s, () => 0.99) // 6 і 6
    expect(s.history).toEqual([{ pl: 0, dice: [6, 6] }])
    for (let i = 0; i < 40; i++) s = roll({ ...s, dice: null, current: i % 2 }, () => 0)
    expect(s.history).toHaveLength(30)
    expect(s.history!.at(-1)).toEqual({ pl: 1, dice: [1, 1] })
  })
})

describe('одна фішка на ходу', () => {
  it('ходить сумою обох кубиків, окремим кубиком не можна', () => {
    const done = (slot: number): Piece => ({ at: 'done', slot })
    const st = make([{ at: 'ring', p: 10 }, done(3), done(2), done(1)], [], [2, 3])
    const legal = legalActions(st)
    expect(legal.map((m) => m.action)).toEqual([use(0, 0, 1)])
    expect(apply(st, use(0, 0))).toBeNull()
    expect(apply(st, use(0, 0, 1))!.pieces[0][0]).toEqual({ at: 'ring', p: 15 })
  })

  it('коли сумою не можна (перебір у рукаві) — ходить окремим кубиком', () => {
    const done = (slot: number): Piece => ({ at: 'done', slot })
    const st = make([{ at: 'ring', p: 47 }, done(3), done(2), done(1)], [], [2, 3])
    expect(legalActions(st).map((m) => m.action)).toEqual([use(0, 0)]) // 47+2 — вільне місце в рукаві; 47+3 і 47+5 — на свої
  })

  it('дві фішки на ходу — кубики окремо можна', () => {
    const done = (slot: number): Piece => ({ at: 'done', slot })
    const st = make([{ at: 'ring', p: 10 }, { at: 'ring', p: 20 }, done(3), done(2)], [], [2, 3])
    expect(apply(st, use(0, 0))).not.toBeNull()
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
    expect(s.places).toHaveLength(n - 1) // гра йде, доки не лишиться один — той, хто програв
    expect(new Set(s.places).size).toBe(n - 1)
  })
})
