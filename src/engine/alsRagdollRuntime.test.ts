import { readFileSync } from 'node:fs'
import { beforeAll, expect, it, vi } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createAlsCharacter } from '../als/AlsCharacter'
import { createAlsAnimationInstance } from '../als/AlsAnimationInstance'
import { createAlsRagdollRuntime } from './alsRagdollRuntime'

beforeAll(async () => { await RAPIER.init(); vi.stubGlobal('window', {}) })
it('retains death physics until reset, publishes the simulated pelvis and restores the capsule', async () => {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  gltf.scene.position.set(5, 2, -3)
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const owner = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5, 2.9, -3))
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(.6, .3), owner)
  const animation = createAlsAnimationInstance({ ...gltf, publishDiagnostics: false })
  const character = createAlsCharacter()
  const runtime = createAlsRagdollRuntime({ world, animation, character,
    owner: () => owner, colliders: () => [collider], halfHeight: () => .9, radius: .3 })
  const initialPelvis = animation.ragdolling.bridge.captureWorldPoses(['pelvis']).get('pelvis')!
  expect(runtime.handle.StartRagdolling({ keepRagdoll: true, initialImpulse: {
    boneName: 'head', impulse: { x: 60, y: 100, z: 0 }, torqueImpulse: { x: 0, y: 1, z: 0 },
  } })).toBe(true)
  expect(collider.isEnabled()).toBe(false)
  expect(character.locomotionAction).toBe('Ragdolling')
  runtime.refresh(1 / 60)
  expect(runtime.handle.pelvis.position.x).toBeCloseTo(initialPelvis.translation.x)
  expect(runtime.handle.StopRagdolling()).toBe(true)
  expect(runtime.handle.active).toBe(true)
  expect(character.ragdollingState.SpeedLimitFrameTimeRemaining).toBe(0)
  runtime.handle.ResetRagdolling()
  expect(runtime.handle.active).toBe(false)
  expect(collider.isEnabled()).toBe(true)
  expect(world.bodies.len()).toBe(1)
  expect(character.locomotionAction).toBe(null)
  // A consumer can promote an already active fall to a held death without recreating bodies.
  expect(runtime.handle.StartRagdolling()).toBe(true)
  expect(runtime.handle.StartRagdolling({ keepRagdoll: true, initialImpulse: {
    boneName: 'pelvis', impulse: { x: 10, y: 0, z: 0 },
  } })).toBe(true)
  runtime.dispose(); world.free()
})
