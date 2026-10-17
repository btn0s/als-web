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

it('evaluates every interval from its phase and on focus or action', () => {
  const rate = new AlsAnimationUpdateRate(0)
  const distant = { distance: 30 }
  expect([0, 1, 2, 3, 4, 5, 6].map(() => rate.evaluate(distant))).toEqual([
    true, false, false, true, false, false, true,
  ])
  expect(rate.evaluate(distant)).toBe(false)
  expect(rate.evaluate({ ...distant, focused: true })).toBe(true)
  expect(rate.evaluate(distant, true)).toBe(true)
  expect(rate.evaluate(undefined)).toBe(true)
})

it('evaluates on the first frame and after a reset whatever the phase', () => {
  const rate = new AlsAnimationUpdateRate(3)
  const hidden = { visible: false }
  expect(rate.evaluate(hidden)).toBe(true)
  expect(rate.evaluate(hidden)).toBe(false)
  rate.reset()
  expect(rate.evaluate(hidden)).toBe(true)
})
