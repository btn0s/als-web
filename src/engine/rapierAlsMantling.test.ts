import RAPIER from '@dimforge/rapier3d-compat'
import type {
  Collider,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat'
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import {
  startMantling,
} from '../als/AlsCharacter_Actions'
import type {
  AlsStartMantlingCharacterState,
} from '../als/AlsCharacter_Actions'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
} from '../als/Settings/AlsMantlingSettings'
import {
  createRapierAlsMantling,
} from './rapierAlsMantling'

const worlds: World[] = []

beforeAll(async () => {
  await RAPIER.init()
})

afterEach(() => {
  for (const world of worlds.splice(0)) world.free()
})

function createWorld(): World {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  worlds.push(world)
  return world
}

function character(): AlsStartMantlingCharacterState {
  return {
    ActorLocation: { x: 0, y: 0, z: 0.9 },
    ActorYawAngle: 0,
    CapsuleScale: 1,
    CapsuleRadius: 0.3,
    CapsuleHalfHeight: 0.9,
    LocalRole: 'Authority',
    bIsLocallyControlled: true,
    bIsMantlingAllowedToStart: true,
    LocomotionMode: 'Grounded',
    LocomotionState: {
      bHasVelocity: false,
      VelocityYawAngle: 0,
      bHasInput: false,
      InputYawAngle: 0,
    },
  }
}

function createAdapter(
  world: World,
  owner?: RigidBody,
) {
  return createRapierAlsMantling({
    world,
    walkableFloorAngleCos: 0.71,
    queryFilterForChannel: (channel, responseChannels) => {
      expect(channel).toBe('Visibility')
      expect(responseChannels).toEqual([
        'WorldStatic',
        'WorldDynamic',
        'Destructible',
      ])
      return {}
    },
    getOwnerRigidBody: () => owner ?? null,
    canCharacterStepUp: () => true,
  })
}

describe('Rapier ALS mantling adapter', () => {
  it('finds the reference ledge with the four real shape queries', () => {
    const world = createWorld()
    const ledgeBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(1, 0.5, 0),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.5, 1.5),
      ledgeBody,
    )
    const owner = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.9, 0),
    )
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.6, 0.3),
      owner,
    )
    world.step()

    const adapter = createAdapter(world, owner)
    const parameters = startMantling({
      Character: character(),
      TraceSettings: ALS_GENERAL_MANTLING_SETTINGS.GroundedTrace,
      MantlingSettings: ALS_GENERAL_MANTLING_SETTINGS,
      Collision: adapter.Collision,
      TargetSpace: adapter,
    })

    expect(parameters).not.toBeNull()
    expect(parameters?.MantlingType).toBe('Low')
    expect(parameters?.TargetRelativeLocation.x).toBeCloseTo(0.9, 5)
    expect(parameters?.TargetRelativeLocation.y).toBeCloseTo(0, 2)
    expect(parameters?.TargetRelativeLocation.z).toBeCloseTo(1.019, 5)
    expect(Math.abs(
      parameters?.TargetRelativeRotation.Yaw ?? 1,
    )).toBeLessThan(0.01)
    expect(adapter.UseRelativeLocation(
      parameters!.TargetPrimitive,
    )).toBe(false)
    expect(adapter.ResolveTarget(
      parameters!.TargetPrimitive,
      parameters!.TargetRelativeLocation,
      parameters!.TargetRelativeRotation,
    ).Location).toEqual(parameters!.TargetRelativeLocation)
    expect(adapter.IsTargetValid(parameters!.TargetPrimitive)).toBe(true)
  })

  it('stores ALS inverse-relative target space on a moving primitive', () => {
    const world = createWorld()
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(2, 3, 4),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1),
      body,
    )
    world.step()
    const adapter = createAdapter(world)

    const captured = adapter.CaptureTarget(
      collider,
      { x: 3, y: 4, z: 3 },
      0,
    )
    // Primitive.GetRelativeTransform(Target), not target-local.
    expect(captured.TargetRelativeLocation).toEqual({
      x: -1,
      y: 0,
      z: 0,
    })
    expect(adapter.ResolveTarget(
      collider,
      captured.TargetRelativeLocation,
      captured.TargetRelativeRotation,
    ).Location).toEqual({ x: 3, y: 4, z: 3 })

    body.setNextKinematicTranslation({ x: 3, y: 4, z: 5 })
    body.setNextKinematicRotation({
      x: 0,
      y: -Math.SQRT1_2,
      z: 0,
      w: Math.SQRT1_2,
    })
    world.step()
    const resolved = adapter.ResolveTarget(
      collider,
      captured.TargetRelativeLocation,
      captured.TargetRelativeRotation,
    )
    expect(resolved.Location.x).toBeCloseTo(3, 12)
    expect(resolved.Location.y).toBeCloseTo(6, 12)
    expect(resolved.Location.z).toBeCloseTo(4, 12)
    expect(resolved.Rotation.z).toBeCloseTo(Math.SQRT1_2, 12)
    expect(resolved.Rotation.w).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it('round-trips a rotated primitive and independently rotated target', () => {
    const world = createWorld()
    const primitiveYaw = 70 * Math.PI / 180
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(2, 3, 4)
        .setRotation({
          x: 0,
          y: -Math.sin(primitiveYaw * 0.5),
          z: 0,
          w: Math.cos(primitiveYaw * 0.5),
        }),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1),
      body,
    )
    world.step()
    const adapter = createAdapter(world)
    const captured = adapter.CaptureTarget(
      collider,
      { x: 3.25, y: -1.5, z: 2.75 },
      -35,
    )

    expect(captured.TargetRelativeRotation.Yaw).toBeCloseTo(105, 5)
    const resolved = adapter.ResolveTarget(
      collider,
      captured.TargetRelativeLocation,
      captured.TargetRelativeRotation,
    )
    expect(resolved.Location.x).toBeCloseTo(3.25, 10)
    expect(resolved.Location.y).toBeCloseTo(-1.5, 10)
    expect(resolved.Location.z).toBeCloseTo(2.75, 10)
    expect(resolved.Rotation.z).toBeCloseTo(
      Math.sin(-35 * Math.PI / 360),
      10,
    )
    expect(resolved.Rotation.w).toBeCloseTo(
      Math.cos(-35 * Math.PI / 360),
      10,
    )
  })

  it('marks a cast that begins inside geometry as penetrating', () => {
    const world = createWorld()
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1),
      body,
    )
    world.step()
    const adapter = createAdapter(world)
    const hit = adapter.Collision.SweepSphere({
      Start: { x: 0, y: 0, z: 0 },
      End: { x: 0, y: 0, z: -2 },
      Radius: 0.25,
      TraceTag: 'StartMantling (Downward Trace)',
      TraceChannel: 'Visibility',
      TraceResponseChannels: [
        'WorldStatic',
        'WorldDynamic',
        'Destructible',
      ],
      bIgnoreOwningActor: true,
    })

    expect(hit?.TargetPrimitive).toBe(collider)
    expect(hit?.bStartPenetrating).toBe(true)
    expect(hit?.bWalkable).toBe(false)
  })

  it('excludes owner colliders and applies the blocking predicate', () => {
    const world = createWorld()
    const owner = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0.5, 0, 0),
    )
    const ownerCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 1, 1),
      owner,
    )
    const ignoredBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(1, 0, 0),
    )
    const ignoredCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 1, 1),
      ignoredBody,
    )
    const targetBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(2, 0, 0),
    )
    const targetCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 1, 1),
      targetBody,
    )
    world.step()

    const adapter = createRapierAlsMantling({
      world,
      walkableFloorAngleCos: 0.71,
      queryFilterForChannel: () => ({
        predicate: (candidate: Collider) => (
          candidate.handle !== ignoredCollider.handle
        ),
      }),
      getOwnerRigidBody: () => owner,
      getOwnerColliders: () => [ownerCollider],
      canCharacterStepUp: () => true,
    })
    const hit = adapter.Collision.SweepSphere({
      Start: { x: 0, y: 0, z: 0 },
      End: { x: 3, y: 0, z: 0 },
      Radius: 0.1,
      TraceTag: 'StartMantling (Downward Trace)',
      TraceChannel: 'Visibility',
      TraceResponseChannels: [],
      bIgnoreOwningActor: true,
    })

    expect(hit?.TargetPrimitive).toBe(targetCollider)
  })
})
