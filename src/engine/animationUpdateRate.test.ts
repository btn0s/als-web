import { expect, it } from 'vitest'
import { AlsAnimationUpdateRate } from './animationUpdateRate'

const ticks = (rate: AlsAnimationUpdateRate, frames: number, significance: Parameters<AlsAnimationUpdateRate['next']>[1], heard: boolean) =>
  Array.from({ length: frames }, () => {
    const tick = rate.next(0.01, significance, false, heard)
    return tick.update ? `${tick.evaluate ? 'E' : 'U'}${Math.round(tick.delta * 100)}` : '-'
  })

it('evaluates visible bodies and visible shadows on every frame', () => {
  for (const visibility of [{}, { visible: true }, { visible: false, shadow: true }]) {
    expect(ticks(new AlsAnimationUpdateRate(), 7, visibility, false)).toEqual(Array(7).fill('E1'))
  }
})

it('ticks every frame on re-entry or action and restarts after a reset', () => {
  const rate = new AlsAnimationUpdateRate()
  const hidden = { visible: false }
  expect(ticks(rate, 2, hidden, false)).toEqual(['-', '-'])
  expect(ticks(rate, 1, { visible: true }, false)).toEqual(['E3'])
  const action = rate.next(0.01, hidden, true, false)
  expect([action.update, action.evaluate, action.delta]).toEqual([true, true, 0.01])
  expect(ticks(rate, 1, hidden, false)).toEqual(['-'])
  rate.reset()
  expect(ticks(rate, 1, hidden, false)).toEqual(['-'])
  expect(ticks(rate, 1, {visible:false,shadow:true}, false)).toEqual(['E2'])
})

it('keeps audible clocks current while an invisible pose is skipped', () => {
  expect(ticks(new AlsAnimationUpdateRate(),3,{visible:false},true)).toEqual(['U1','U1','U1'])
})
