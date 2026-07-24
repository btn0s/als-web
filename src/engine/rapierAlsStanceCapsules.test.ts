import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { setRapierAlsStanceCapsules } from './rapierAlsStanceCapsules'

beforeAll(async () => {
  await RAPIER.init()
})

describe('Rapier ALS stance capsules', () => {
  it('selects exactly one prebuilt stance collider', () => {
    const standingStates: boolean[] = []
    const crouchingStates: boolean[] = []
    const standing = {
      setEnabled: (enabled: boolean) => standingStates.push(enabled),
    }
    const crouching = {
      setEnabled: (enabled: boolean) => crouchingStates.push(enabled),
    }

    setRapierAlsStanceCapsules(standing, crouching, 'Standing')
    setRapierAlsStanceCapsules(standing, crouching, 'Crouching')

    expect(standingStates).toEqual([true, false])
    expect(crouchingStates).toEqual([false, true])
  })

  it('preserves the base of an awake grounded body when crouching', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.timestep = 1 / 60
    try {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(10, 0.05, 10)
          .setTranslation(0, -0.05, 0),
      )
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(0, 0.9, 0)
          .lockRotations()
          .setCanSleep(false),
      )
      const standing = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.6, 0.3),
        body,
      )
      const crouching = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.26, 0.3)
          .setTranslation(0, -0.34, 0)
          .setEnabled(false),
        body,
      )
      for (let index = 0; index < 120; index += 1) world.step()
      const groundedBodyHeight = body.translation().y
      const standingBase = standing.translation().y - 0.9

      setRapierAlsStanceCapsules(standing, crouching, 'Crouching')
      for (let index = 0; index < 12; index += 1) world.step()

      expect(standing.isEnabled()).toBe(false)
      expect(crouching.isEnabled()).toBe(true)
      expect(body.translation().y).toBeCloseTo(groundedBodyHeight, 3)
      expect(crouching.translation().y - 0.56).toBeCloseTo(
        standingBase,
        3,
      )
    } finally {
      world.free()
    }
  })
})
