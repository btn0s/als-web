import { describe, expect, it } from 'vitest'
import { createAlsCharacter, refreshView } from '../als/AlsCharacter'
import { createCharacterPoseSample } from './CharacterPoseSample'
import { refreshAlsCameraControlRotationFromSource } from './AlsCamera'

describe('externally owned ALS camera input', () => {
  it('does not alternate between native and consumer sensitivity on render-only frames', () => {
    const sample = createCharacterPoseSample()
    const legacy = createAlsCharacter()
    sample.character = createAlsCharacter()
    const command = { yaw: 0, pitch: 0 }
    const rotation = { yaw: 0, pitch: 0, roll: 0 }
    const source = () => command
    const dt = 1 / 144
    const physicsStep = 1 / 60
    let accumulator = 0
    let legacyMaximumError = 0
    let fixedMaximumError = 0
    let physicsSteps = 0
    for (let frame = 0; frame < 144; frame++) {
      command.yaw += 0.0022 * 180 / Math.PI
      command.pitch += 0.0011 * 180 / Math.PI
      refreshView(legacy, legacy.viewYawAngle + 1, dt, legacy.viewPitchAngle + 0.5)
      expect(refreshAlsCameraControlRotationFromSource(sample, rotation, dt, source)).toBe(true)
      accumulator += dt
      while (accumulator + 1e-12 >= physicsStep) {
        accumulator -= physicsStep
        physicsSteps++
        legacy.viewYawAngle = sample.character.viewYawAngle = command.yaw
        legacy.viewPitchAngle = sample.character.viewPitchAngle = command.pitch
      }
      legacyMaximumError = Math.max(legacyMaximumError, Math.abs(legacy.viewYawAngle - command.yaw))
      fixedMaximumError = Math.max(fixedMaximumError, Math.abs(sample.character.viewYawAngle - command.yaw), Math.abs(rotation.pitch - command.pitch))
    }
    expect(physicsSteps).toBe(60)
    expect(legacyMaximumError).toBeCloseTo(2 * (1 - 0.0022 * 180 / Math.PI), 10)
    expect(fixedMaximumError).toBeLessThan(1e-12)
  })
})
