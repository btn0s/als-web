import { readFileSync } from 'node:fs'
import { beforeAll, expect, it, vi } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createAlsCharacter } from '../als/AlsCharacter'
import { createAlsAnimationInstance } from '../als/AlsAnimationInstance'
import { createAlsRagdollRuntime } from './alsRagdollRuntime'

beforeAll(async () => { await RAPIER.init(); vi.stubGlobal('window', { performance }) })
it('retains ALS startup limiting for impulses, detaches mesh inheritance and plays a grounded get-up', async () => {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  gltf.scene.position.set(5, 0, -3)
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const owner = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5, .9, -3))
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(.6, .3), owner)
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, .1, 20).setTranslation(0, .1, 0))
  world.step()
  const animation = createAlsAnimationInstance(gltf)
  const character = createAlsCharacter()
  const runtime = createAlsRagdollRuntime({ world, animation, character,
    owner: () => owner, colliders: () => [collider], halfHeight: () => .9, ownerAnchorHalfHeight: .9, radius: .3 })
  expect(runtime.handle.StartRagdolling({ initialImpulse: {
    boneName: 'pelvis', impulse: { x: 600, y: 100, z: 0 },
  } })).toBe(true)
  expect(world.bodies.len()).toBe(22)
  expect(collider.isEnabled()).toBe(false)
  expect(gltf.scene.matrixWorldAutoUpdate).toBe(false)
  expect(character.locomotionAction).toBe('Ragdolling')
  expect(character.ragdollingState.SpeedLimitFrameTimeRemaining).toBe(8)
  runtime.refresh(1 / 60)
  expect(runtime.handle.pelvis.velocity.length()).toBeLessThanOrEqual(2.000001)
  expect(character.ragdollingState.SpeedLimitFrameTimeRemaining).toBe(7)
  const pelvisBefore = animation.ragdolling.bridge.captureWorldPoses(['pelvis']).get('pelvis')!
  gltf.scene.position.x += 20
  const detachedPelvis = animation.ragdolling.bridge.captureWorldPoses(['pelvis']).get('pelvis')!
  expect(new Vector3().copy(detachedPelvis.translation).distanceTo(pelvisBefore.translation)).toBeLessThan(1e-7)
  gltf.scene.position.x -= 20
  runtime.beforePhysics(world.timestep); world.step(); runtime.afterPhysics(world.timestep)
  expect(runtime.handle.pelvis.position.toArray().every(Number.isFinite)).toBe(true)
  expect(runtime.handle.StopRagdolling()).toBe(true)
  expect(runtime.handle.active).toBe(false)
  expect(gltf.scene.matrixWorldAutoUpdate).toBe(true)
  expect(collider.isEnabled()).toBe(true)
  expect(world.bodies.len()).toBe(1)
  expect(character.locomotionAction).toBe('GettingUp')
  expect(character.movement.inputBlocked).toBe(true)
  expect(runtime.selectedGetUpMontage).toMatch(/^AM_Als_GetUp_(Front|Back)$/)
  expect(animation.ragdolling.state.FinalRagdollPose).not.toBe(null)
  runtime.dispose(); world.free()
})
