import { expect, it } from 'vitest'
import { AlsAnimationUpdateRate, selectAlsAnimationInterval } from './animationUpdateRate'
import { compileSequenceNotifies, gatherSequenceNotifies } from './sequenceNotifies'

it('selects distance and visibility rates with focus overriding all clamps', () => {
  expect([0, 12, 20, 34].map(distance => selectAlsAnimationInterval({ distance }))).toEqual([1, 2, 3, 4])
  expect(selectAlsAnimationInterval({ distance: 0, visible: false })).toBe(8)
  expect(selectAlsAnimationInterval({ distance: 0, visible: false, shadow: true })).toBe(3)
  expect(selectAlsAnimationInterval({ distance: 0, minInterval: 2 })).toBe(2)
  expect(selectAlsAnimationInterval({ distance: 100, maxInterval: 2 })).toBe(2)
  expect(selectAlsAnimationInterval({ visible: false, focused: true, minInterval: 4 })).toBe(1)
})

it('accumulates skipped time for one graph traversal and drains it on focus or action', () => {
  const rate = new AlsAnimationUpdateRate(0)
  const distant = { distance: 30 }
  expect(rate.next(0.01, distant)).toBe(0.01)
  expect(rate.next(0.01, distant)).toBeNull()
  expect(rate.next(0.01, distant)).toBeNull()
  expect(rate.next(0.01, distant)).toBeCloseTo(0.03)
  expect(rate.next(0.01, distant)).toBeNull()
  expect(rate.next(0.01, { ...distant, focused: true })).toBeCloseTo(0.02)
  expect(rate.next(0.01, distant, true)).toBeCloseTo(0.01)
})

it('crosses each notify once when a skipped interval is evaluated', () => {
  const rate = new AlsAnimationUpdateRate(0)
  const timeline = compileSequenceNotifies({ name: 'test', duration: 1, userData: {
    notifies: [{ name: 'first', time: 0.015 }, { name: 'second', time: 0.025 }],
  } })
  let cursor = 0
  const received: string[] = []
  for (let frame = 0; frame < 4; frame++) {
    const delta = rate.next(0.01, { distance: 30 })
    if (delta === null) continue
    const events: typeof timeline.notifies[number][] = []
    gatherSequenceNotifies(timeline, cursor, delta, {
      bAllowLooping: false, bSrcIsLeader: true, InstanceWeight: 1,
    }, events)
    received.push(...events.map(event => event.NotifyName))
    cursor += delta
  }
  expect(received).toEqual(['first', 'second'])
  expect(cursor).toBeCloseTo(0.04)
})
