import { expect, it } from 'vitest'
import { AlsAnimationUpdateRate, selectAlsAnimationInterval } from './animationUpdateRate'

it('selects distance and visibility rates with focus overriding all clamps', () => {
  expect([0, 12, 20, 34].map(distance => selectAlsAnimationInterval({ distance }))).toEqual([1, 2, 3, 4])
  expect(selectAlsAnimationInterval({ distance: 0, visible: false })).toBe(8)
  expect(selectAlsAnimationInterval({ distance: 0, visible: false, shadow: true })).toBe(3)
  expect(selectAlsAnimationInterval({ distance: 0, minInterval: 2 })).toBe(2)
  expect(selectAlsAnimationInterval({ distance: 100, maxInterval: 2 })).toBe(2)
  expect(selectAlsAnimationInterval({ visible: false, focused: true, minInterval: 4 })).toBe(1)
})

const ticks = (rate: AlsAnimationUpdateRate, frames: number, significance: Parameters<AlsAnimationUpdateRate['next']>[1], heard: boolean) =>
  Array.from({ length: frames }, () => {
    const tick = rate.next(0.01, significance, false, heard)
    return tick.update ? `${tick.evaluate ? 'E' : 'U'}${Math.round(tick.delta * 100)}` : '-'
  })

it('updates a heard character every frame and evaluates it every interval', () => {
  expect(ticks(new AlsAnimationUpdateRate(0), 7, { distance: 30 }, true)).toEqual(['E1', 'U1', 'U1', 'E1', 'U1', 'U1', 'E1'])
})

it('ticks an unheard character only when it evaluates, carrying the skipped time', () => {
  expect(ticks(new AlsAnimationUpdateRate(0), 7, { distance: 30 }, false)).toEqual(['E1', '-', '-', 'E3', '-', '-', 'E3'])
})

it('ticks every frame on focus or action and restarts after a reset', () => {
  const rate = new AlsAnimationUpdateRate(3)
  const hidden = { visible: false }
  expect(ticks(rate, 2, hidden, false)).toEqual(['E1', '-'])
  expect(ticks(rate, 1, { ...hidden, focused: true }, false)).toEqual(['E2'])
  const action = rate.next(0.01, hidden, true, false)
  expect([action.update, action.evaluate, action.delta]).toEqual([true, true, 0.01])
  expect(ticks(rate, 1, hidden, false)).toEqual(['-'])
  rate.reset()
  expect(ticks(rate, 1, hidden, false)).toEqual(['E1'])
})
