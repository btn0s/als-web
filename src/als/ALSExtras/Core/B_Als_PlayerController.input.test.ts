import { describe, expect, it, vi } from 'vitest'
import { modifyAlsGamepadLook } from './B_Als_PlayerController.input'

describe('authored gamepad look modifier boundary', () => {
  const input = { yaw: 30, pitch: 10, yawDelta: 4, pitchDelta: -2, deltaTime: 1 / 60 }
  const gamepad = { index: 1 } as Gamepad

  it('passes the selected pad and authored deltas to the consumer', () => {
    const modifier = vi.fn(() => ({ yawDelta: 2, pitchDelta: -1 }))
    expect(modifyAlsGamepadLook(gamepad, input, modifier)).toEqual({ yawDelta: 2, pitchDelta: -1 })
    expect(modifier).toHaveBeenCalledExactlyOnceWith({ ...input, gamepad })
  })

  it('preserves authored look without a modifier or an enabled connected pad', () => {
    const modifier = vi.fn(() => ({ yawDelta: 0, pitchDelta: 0 }))
    expect(modifyAlsGamepadLook(gamepad, input)).toEqual({ yawDelta: 4, pitchDelta: -2 })
    expect(modifyAlsGamepadLook(null, input, modifier)).toEqual({ yawDelta: 4, pitchDelta: -2 })
    expect(modifier).not.toHaveBeenCalled()
  })

  it('falls back independently for nonfinite modified axes', () => {
    expect(modifyAlsGamepadLook(gamepad, input, () => ({ yawDelta: NaN, pitchDelta: 1 })))
      .toEqual({ yawDelta: 4, pitchDelta: 1 })
    expect(modifyAlsGamepadLook(gamepad, input, () => ({ yawDelta: 0, pitchDelta: Infinity })))
      .toEqual({ yawDelta: 0, pitchDelta: -2 })
  })
})
