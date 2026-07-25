import { describe, expect, it } from 'vitest'
import {
  createWorldTimeState,
  getWorldDeltaTime,
  setGlobalTimeDilation,
} from './timeDilation'

describe('world time dilation', () => {
  it('scales game time without changing the real-time input', () => {
    const state = createWorldTimeState()
    expect(getWorldDeltaTime(state, 1 / 60)).toBe(1 / 60)

    setGlobalTimeDilation(state, 0.35)
    expect(getWorldDeltaTime(state, 1 / 60)).toBeCloseTo(
      0.35 / 60,
      15,
    )
  })

  it('rejects invalid global dilation values', () => {
    const state = createWorldTimeState()
    expect(() => setGlobalTimeDilation(state, 0)).toThrow(
      'finite and positive',
    )
    expect(() => setGlobalTimeDilation(state, Number.NaN)).toThrow(
      'finite and positive',
    )
  })
})
