/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { Bone } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createAlsAnimationInstance } from './AlsAnimationInstance'
import { AlsRemoteCharacter } from './AlsRemoteCharacter'
import { AlsCharacterRecorder } from './AlsCharacterRecorder'
import { createAlsCharacter, refreshLocomotion } from './AlsCharacter'
import { createAlsCharacterAnimationControls } from './AlsCharacter.hooks'
import { ALS_ROLLING_SETTINGS } from './Settings/AlsRollingSettings'
import { ALS_MANTLING_SETTINGS } from './Settings/AlsMantlingSettings'
import { clearAlsCharacterGltf, preloadAlsCharacterGltf } from '../app/AlsCharacterGltf'
import { attachPistolOverlayObject, detachOverlayObject } from './AlsCharacter.overlayObjects'

afterEach(() => {
  vi.unstubAllGlobals()
  clearAlsCharacterGltf()
})

it('runs the shipped full graph on an independent remote skeleton and preserves local diagnostics', async () => {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const fetch = vi.fn(async () => {
    const response = new Response(bytes)
    Object.defineProperty(response, 'url', { value: 'https://example.test/assets/skm-als.glb' })
    return response
  })
  vi.stubGlobal('fetch', fetch)
  const gltf = await preloadAlsCharacterGltf()
  expect(await preloadAlsCharacterGltf()).toBe(gltf)
  expect(fetch).toHaveBeenCalledTimes(1)
  const scene = clone(gltf.scene)
  const otherScene = clone(gltf.scene)
  const sentinel = { localOnly: 42 }
  vi.stubGlobal('window', { __weightTable: sentinel })
  const animation = createAlsAnimationInstance({ scene, animations: gltf.animations, publishDiagnostics: false, groundPredictionSweep: () => null })
  expect(() => createAlsAnimationInstance({ scene: otherScene, animations: gltf.animations, publishDiagnostics: false })).not.toThrow()
  const propBytes = readFileSync(new URL('../../public/assets/skm-als-pistol.glb', import.meta.url))
  const pistol = (await new GLTFLoader().parseAsync(propBytes.buffer.slice(
    propBytes.byteOffset, propBytes.byteOffset + propBytes.byteLength), '')).scene
  const otherPistol = clone(pistol)
  attachPistolOverlayObject(scene, pistol)
  attachPistolOverlayObject(otherScene, otherPistol)
  expect(pistol.parent).not.toBe(otherPistol.parent)
  const remote = new AlsRemoteCharacter()
  const local = { character: createAlsCharacter(), controls: createAlsCharacterAnimationControls(),
    position: { x: 0, y: 0.922, z: 0 } }
  const recorder = new AlsCharacterRecorder(60)
  const original = gltf.scene.getObjectByName('hand_r')!.quaternion.clone()
  local.controls.overlayMode = 'Rifle'
  local.character.locomotionState.hasInput = true
  local.character.rotationMode = 'Aiming'
  local.character.viewPitchAngle = 35
  local.character.gait = 'Running'
  refreshLocomotion(local.character, { x: 3.75, y: 0, z: 0 })
  for (let frame = 0; frame < 30; frame++) {
    if (frame === 10) {
      local.character.stance = 'Crouching'
      local.controls.overlayMode = 'PistolTwoHanded'
    }
    if (frame === 20) {
      local.controls.overlayMode = 'PistolOneHanded'
      local.character.locomotionMode = 'InAir'
      refreshLocomotion(local.character, { x: 3, y: 0, z: 4.2 })
    }
    const result = remote.apply(recorder.capture(frame * 20, local)!)
    expect(remote.controls.overlayMode).toBe(local.controls.overlayMode)
    if (result.jumped) animation.jump()
    animation.refresh(0.02, remote.controls)
  }
  expect(scene.getObjectByName('hand_r')).not.toBe(gltf.scene.getObjectByName('hand_r'))
  expect(scene.getObjectByName('hand_r')!.quaternion.angleTo(original)).toBeGreaterThan(0.01)
  expect(gltf.scene.getObjectByName('hand_r')!.quaternion.angleTo(original)).toBeLessThan(1e-6)
  expect(otherScene.getObjectByName('hand_r')!.quaternion.angleTo(original)).toBeLessThan(1e-6)
  expect(pistol.position.toArray()).toEqual([0, 0, 0])
  expect(pistol.quaternion.toArray()).toEqual([0, 0, 0, 1])
  expect(pistol.matrixWorld.elements.every(Number.isFinite)).toBe(true)
  detachOverlayObject(pistol)
  expect(otherPistol.parent).not.toBeNull()
  scene.traverse((object) => {
    if (object instanceof Bone) {
      expect([...object.position.toArray(), ...object.quaternion.toArray()].every(Number.isFinite)).toBe(true)
    }
  })
  expect(window.__weightTable).toBe(sentinel)

  expect(animation.rollingMontage.Montage_Play(ALS_ROLLING_SETTINGS.Montage, 1.3)).toBeGreaterThan(0)
  remote.controls.locomotionAction = 'Rolling'
  animation.refresh(0.1, remote.controls)
  const roll = animation.getRollingSnapshot()!
  expect(roll.position).toBeCloseTo(0.13)
  expect(roll.playRate).toBeCloseTo(1.3)
  animation.setRollingPosition(0.3)
  expect(animation.getRollingSnapshot()!.position).toBeCloseTo(0.3)

  const settings = ALS_MANTLING_SETTINGS.MS_Als_High
  expect(animation.mantlingMontage.play(settings, 0.2)).not.toBeNull()
  expect(animation.getMantlingSnapshot()).toEqual({ settings: settings.Name, position: 0.2 })
  remote.controls.locomotionAction = 'Mantling'
  animation.refresh(0.02, remote.controls)
  expect(animation.getMantlingSnapshot()!.position).toBeGreaterThan(0.2)
})
