import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createAlsAnimationInstance } from './AlsAnimationInstance'
import { createAlsCharacterAnimationControls } from './AlsCharacter.hooks'
import { AlsRemoteCharacter } from './AlsRemoteCharacter'
import { AlsSnapshotBuffer } from './AlsSnapshotBuffer'
import { ALS_ROLLING_SETTINGS } from './Settings/AlsRollingSettings'

let gltf: GLTF
beforeAll(async () => {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
})
afterEach(() => vi.unstubAllGlobals())

describe('local and interpolated remote animation clocks', () => {
  it('separates the graph clock from cadence caused by an incorrectly classified gait', () => {
    vi.stubGlobal('window', {})
    const rates = (['Walking', 'Running'] as const).map(gait => {
      const instance = createAlsAnimationInstance({ scene: clone(gltf.scene), animations: gltf.animations, publishDiagnostics: false })
      const controls = createAlsCharacterAnimationControls()
      Object.assign(controls, { speed: 3.75, velocity: { x: 3.75, y: 0, z: 0 }, gait, moving: true, movingSmooth: true, hasInput: true, overlayMode: 'Rifle' })
      for (let frame = 0; frame < 60; frame++) instance.refresh(1 / 60, controls)
      expect(instance.clock.elapsedSeconds).toBeCloseTo(1, 12)
      return instance.state.standingMovement.playRate
    })
    expect(rates[0]).toBeCloseTo(375 / 150, 10)
    expect(rates[1]).toBeCloseTo(375 / 350, 10)
  })

  it.each([30, 60, 144])('advances one second at %i render Hz while packets arrive at 20 Hz', renderHz => {
    vi.stubGlobal('window', {})
    const local = createAlsAnimationInstance({ scene: clone(gltf.scene), animations: gltf.animations, publishDiagnostics: false })
    const remote = createAlsAnimationInstance({ scene: clone(gltf.scene), animations: gltf.animations, publishDiagnostics: false })
    const controls = createAlsCharacterAnimationControls()
    Object.assign(controls, { speed: 3.75, velocity: { x: 3.75, y: 0, z: 0 }, gait: 'Running', moving: true, movingSmooth: true, hasInput: true, overlayMode: 'Rifle' })
    const driver = new AlsRemoteCharacter()
    const snapshots = new AlsSnapshotBuffer({ interpolationDelayMs: 100 })
    const epoch = 1792070000000
    for (let packet = 0; packet <= 22; packet++) {
      const seconds = packet / 20
      snapshots.push({ t: epoch + seconds * 1000, seq: packet, pos: [seconds * 3.75, 0.9, 0], vel: [3.75, 0, 0], actorYaw: 0, viewYaw: 0, viewPitch: 0,
        gait: 'running', stance: 'standing', rotationMode: 'viewDirection', locomotionMode: 'grounded', action: 'none', actionSeq: 0, overlay: 'rifle', aiming: false })
    }
    for (let frame = 1; frame <= renderHz; frame++) {
      const sample = snapshots.sample(epoch + 100 + frame * 1000 / renderHz)!
      driver.apply(sample.state)
      local.refresh(1 / renderHz, controls)
      remote.refresh(1 / renderHz, driver.controls)
      expect(driver.controls.speed).toBeCloseTo(3.75, 10)
      expect(driver.controls.gait).toBe('Running')
      expect(sample.state.pos[0]).toBeCloseTo(frame / renderHz * 3.75, 5)
    }
    for (const instance of [local, remote]) {
      expect(instance.clock.elapsedSeconds).toBeCloseTo(1, 12)
      expect(instance.clock.updates).toBe(renderHz)
      expect(instance.rollingMontage.Montage_Play(ALS_ROLLING_SETTINGS.Montage, 1)).toBeGreaterThan(0)
    }
    controls.locomotionAction = driver.controls.locomotionAction = 'Rolling'
    const deltas = [0.003, 0.052, 0.009, 0.1, 0.016, 0.07]
    for (const dt of deltas) {
      local.refresh(dt, controls)
      remote.refresh(dt, driver.controls)
    }
    for (const instance of [local, remote]) {
      expect(instance.clock.elapsedSeconds).toBeCloseTo(1.25, 12)
      expect(instance.clock.updates).toBe(renderHz + deltas.length)
      expect(instance.getRollingSnapshot()!.position).toBeCloseTo(0.25, 12)
    }
  })
})
