import { describe, expect, it } from 'vitest'
import { createAlsCharacter, refreshLocomotion } from './AlsCharacter'
import { createAlsCharacterAnimationControls } from './AlsCharacter.hooks'
import { AlsCharacterRecorder, type AlsCharacterRecordingSource } from './AlsCharacterRecorder'
import { AlsRemoteCharacter } from './AlsRemoteCharacter'
import { AlsSnapshotBuffer } from './AlsSnapshotBuffer'
import { ALS_OVERLAY_MODES } from './AnimGraph/overlayMode'

function source(): AlsCharacterRecordingSource {
  return { character: createAlsCharacter(), controls: createAlsCharacterAnimationControls(),
    position: { x: 1, y: 2, z: 3 } }
}

describe('ALS recording and remote animation boundary', () => {
  it('replays both pistol modes through the ghost buffer and keeps base-wire pistol compatible', () => {
    const local = source()
    const recorder = new AlsCharacterRecorder()
    const remote = new AlsRemoteCharacter()
    const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 0 })
    for (const [index, mode] of ALS_OVERLAY_MODES.entries()) {
      local.controls.overlayMode = mode
      const t = index * 50
      const snapshot = recorder.capture(t, local)!
      expect(snapshot.overlay).toBe(mode === 'Launcher' ? 'launcher' : mode === 'Default' ? 'default' : mode === 'Rifle' ? 'rifle' : 'pistol')
      buffer.push(snapshot)
      expect(remote.apply(buffer.sample(t)!.state).unsupported).toEqual([])
      expect(remote.controls.overlayMode).toBe(mode)
    }
    local.controls.overlayMode = 'PistolOneHanded'
    const legacy = recorder.capture(250, local)!
    delete legacy.animation
    remote.apply(legacy)
    expect(remote.controls.overlayMode).toBe('PistolTwoHanded')
  })
  it('records at 20Hz without frame-rate drift or catch-up bursts', () => {
    const recorder = new AlsCharacterRecorder()
    const local = source()
    let count = 0
    for (let frame = 0; frame <= 60; frame++) {
      if (recorder.capture(frame * 1000 / 60, local)) count++
    }
    expect(count).toBe(21)
    expect(recorder.capture(5000, local)).not.toBeNull()
    expect(recorder.capture(5001, local)).toBeNull()
    expect(recorder.capture(0, local)).toBeNull()
    expect(() => new AlsCharacterRecorder(0)).toThrow()
  })
  it('records action edges once, snapshots by value, and maps three.js axes', () => {
    const recorder = new AlsCharacterRecorder(10)
    const local = source()
    refreshLocomotion(local.character, { x: 1, y: 2, z: 3 })
    const first = recorder.capture(0, local)!
    expect(first.vel).toEqual([1, 3, 2])
    local.character.locomotionAction = 'Rolling'
    expect(recorder.capture(50, local)).toBeNull()
    expect(recorder.capture(100, local)).toMatchObject({ action: 'roll', actionSeq: 1, seq: 1 })
    expect(recorder.capture(200, local)).toMatchObject({ actionSeq: 1 })
    local.character.locomotionAction = null
    recorder.capture(250, local)
    local.character.locomotionAction = 'Rolling'
    expect(recorder.capture(300, local)).toMatchObject({ actionSeq: 2 })
    expect(first.actionSeq).toBe(0)
    expect(first.vel).toEqual([1, 3, 2])
  })
  it('publishes authoritative crouch, gait, relative aim, velocity and mantle metadata to ALS', () => {
    const local = source()
    Object.assign(local.character, { gait: 'Running', stance: 'Crouching', rotationMode: 'Aiming',
      desiredAiming: true, actorYawAngle: 170, viewYawAngle: -170, viewPitchAngle: 35 })
    local.character.locomotionState.hasInput = true
    local.character.locomotionState.inputYawAngle = 45
    refreshLocomotion(local.character, { x: 3, y: 4, z: 0 })
    local.controls.overlayMode = 'Rifle'
    local.controls.relativeAccelerationAmount = { x: 0.2, y: -0.3 }
    const recorder = new AlsCharacterRecorder()
    const remote = new AlsRemoteCharacter()
    remote.apply(recorder.capture(0, local)!)
    expect(remote.controls).toMatchObject({ stance: 'Crouching', gait: 'Running',
      overlayMode: 'Rifle', rotationMode: 'Aiming', speed: 5, hasInput: true,
      viewYawAngle: 20, viewPitchAngle: 35, velocity: { x: 3, y: 4, z: 0 },
      location: { x: 1, y: 3 }, relativeAccelerationAmount: { x: 0.2, y: -0.3 } })
    expect(remote.controls.location.z).toBeCloseTo(1.66)
    local.character.locomotionAction = 'Mantling'
    local.mantle = { settings: 'MS_Als_High', position: 0.4 }
    const mantle = recorder.capture(50, local)!
    remote.apply(mantle)
    expect(remote.controls.locomotionMode).toBeNull()
    expect(remote.controls.locomotionAction).toBe('Mantling')
    expect(mantle.animation?.mantle).toEqual(local.mantle)
  })
  it('infers jump once from an upward in-air edge and preserves fall/landing', () => {
    const recorder = new AlsCharacterRecorder(60)
    const local = source()
    const remote = new AlsRemoteCharacter()
    expect(remote.apply(recorder.capture(0, local)!).jumped).toBe(false)
    local.character.locomotionMode = 'InAir'
    refreshLocomotion(local.character, { x: 0, y: 0, z: 4.2 })
    expect(remote.apply(recorder.capture(20, local)!).jumped).toBe(true)
    expect(remote.apply(recorder.capture(40, local)!).jumped).toBe(false)
    refreshLocomotion(local.character, { x: 0, y: 0, z: -2 })
    expect(remote.apply(recorder.capture(60, local)!).jumped).toBe(false)
    expect(remote.controls.velocity?.z).toBe(-2)
    local.character.locomotionMode = 'Grounded'
    remote.apply(recorder.capture(80, local)!)
    expect(remote.controls.locomotionMode).toBe('Grounded')
  })
})
