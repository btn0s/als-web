import { describe, expect, it, vi } from 'vitest'
import type {
  AlsCapturedMantlingTarget,
  AlsMantlingCollisionQuery,
  AlsMantlingSweepHit,
  AlsStartMantlingCharacterState,
  StartAlsMantlingInput,
} from './AlsCharacter_Actions'
import {
  startMantling,
  startMantlingGrounded,
  startMantlingInAir,
} from './AlsCharacter_Actions'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
} from './Settings/AlsMantlingSettings'

const targetPrimitive = {}

const forwardHit: AlsMantlingSweepHit = {
  bBlockingHit: true,
  bStartPenetrating: false,
  Location: { x: 0.46, y: 0, z: 1.351 },
  ImpactPoint: { x: 0.75, y: 0, z: 0.8 },
  ImpactNormal: { x: -1, y: 0, z: 0 },
  TargetPrimitive: targetPrimitive,
  TargetPrimitiveVelocity: { x: 0, y: 0, z: 0 },
  bCanCharacterStepUp: true,
  bWalkable: false,
}

const downwardHit: AlsMantlingSweepHit = {
  bBlockingHit: true,
  bStartPenetrating: false,
  Location: { x: 0.9, y: 0, z: 1.29 },
  ImpactPoint: { x: 0.9, y: 0, z: 1 },
  ImpactNormal: { x: 0, y: 0, z: 1 },
  TargetPrimitive: targetPrimitive,
  TargetPrimitiveVelocity: { x: 0, y: 0, z: 0 },
  bCanCharacterStepUp: true,
  bWalkable: true,
}

function character(
  overrides: Partial<AlsStartMantlingCharacterState> = {},
): AlsStartMantlingCharacterState {
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
    ...overrides,
  }
}

function collision(
  events: unknown[] = [],
): AlsMantlingCollisionQuery {
  return {
    SweepCapsule(query) {
      events.push(query)
      return forwardHit
    },
    SweepSphere(query) {
      events.push(query)
      return downwardHit
    },
    OverlapCapsule(query) {
      events.push(query)
      return false
    },
  }
}

function targetSpace(events: unknown[] = []) {
  return {
    CaptureTarget(
      TargetPrimitive: unknown,
      TargetLocation: Readonly<{ x: number; y: number; z: number }>,
      TargetYawAngle: number,
    ): AlsCapturedMantlingTarget {
      events.push('CaptureTarget')
      return {
        TargetPrimitive,
        TargetRelativeLocation: { ...TargetLocation },
        TargetRelativeRotation: {
          Pitch: 0,
          Yaw: TargetYawAngle,
          Roll: 0,
        },
      }
    },
  }
}

function input(
  overrides: Partial<StartAlsMantlingInput> = {},
): StartAlsMantlingInput {
  return {
    Character: character(),
    TraceSettings: ALS_GENERAL_MANTLING_SETTINGS.GroundedTrace,
    MantlingSettings: ALS_GENERAL_MANTLING_SETTINGS,
    Collision: collision(),
    TargetSpace: targetSpace(),
    ...overrides,
  }
}

describe('AAlsCharacter::StartMantling()', () => {
  it('issues the exact four queries in order before capturing the target', () => {
    const events: unknown[] = []
    const result = startMantling(input({
      Collision: collision(events),
      TargetSpace: targetSpace(events),
    }))

    expect(result).toEqual({
      TargetPrimitive: targetPrimitive,
      TargetRelativeLocation: { x: 0.9, y: 0, z: 1.019 },
      TargetRelativeRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
      MantlingHeight: 1.019,
      MantlingType: 'Low',
    })
    expect(events).toEqual([
      {
        Start: { x: -0.3, y: 0, z: 1.351 },
        End: { x: 0.76, y: 0, z: 1.351 },
        Radius: 0.29,
        HalfHeight: 0.875,
        TraceTag: 'StartMantling (Forward Trace)',
        TraceChannel: 'Visibility',
        TraceResponseChannels: [
          'WorldStatic',
          'WorldDynamic',
          'Destructible',
        ],
        bIgnoreOwningActor: true,
      },
      {
        Start: { x: 0.9, y: 0, z: 2.494 },
        End: { x: 0.9, y: 0, z: 0.766 },
        Radius: 0.29,
        TraceTag: 'StartMantling (Downward Trace)',
        TraceChannel: 'Visibility',
        TraceResponseChannels: [
          'WorldStatic',
          'WorldDynamic',
          'Destructible',
        ],
        bIgnoreOwningActor: true,
      },
      {
        Location: { x: 0.9, y: 0, z: 1.919 },
        Radius: 0.3,
        HalfHeight: 0.9,
        TraceTag: 'StartMantling (Target Location Overlap)',
        TraceChannel: 'Visibility',
        TraceResponseChannels: [
          'WorldStatic',
          'WorldDynamic',
          'Destructible',
        ],
        bIgnoreOwningActor: true,
      },
      {
        Location: { x: 0.19999999999999996, y: 0, z: 1.028 },
        Radius: 0.29,
        HalfHeight: 0.552,
        TraceTag: 'StartMantling (Start Location Overlap)',
        TraceChannel: 'Visibility',
        TraceResponseChannels: [
          'WorldStatic',
          'WorldDynamic',
          'Destructible',
        ],
        bIgnoreOwningActor: true,
      },
      'CaptureTarget',
    ])
  })

  it('uses wrapped input-to-velocity reach and the strict trace angle test', () => {
    let queryCount = 0
    const Collision: AlsMantlingCollisionQuery = {
      SweepCapsule() {
        queryCount++
        return null
      },
      SweepSphere() {
        throw new Error('unexpected downward query')
      },
      OverlapCapsule() {
        throw new Error('unexpected overlap query')
      },
    }

    startMantling(input({
      Character: character({
        ActorYawAngle: 179,
        LocomotionState: {
          bHasVelocity: true,
          VelocityYawAngle: -179,
          bHasInput: true,
          InputYawAngle: 179,
        },
      }),
      Collision,
    }))
    expect(queryCount).toBe(1)

    const rejected = startMantling(input({
      Character: character({
        LocomotionState: {
          bHasVelocity: false,
          VelocityYawAngle: 0,
          bHasInput: true,
          InputYawAngle:
            ALS_GENERAL_MANTLING_SETTINGS.TraceAngleThreshold + 0.001,
        },
      }),
      Collision,
    }))
    expect(rejected).toBeNull()
    expect(queryCount).toBe(1)
  })

  it('uses valid-blocking, strict speed, step-up, and walkability gates', () => {
    const variants: Array<Partial<AlsMantlingSweepHit>> = [
      { bBlockingHit: false },
      { bStartPenetrating: true },
      {
        TargetPrimitiveVelocity: {
          x: (
            ALS_GENERAL_MANTLING_SETTINGS
              .TargetPrimitiveSpeedThreshold + 0.0001
          ),
          y: 0,
          z: 0,
        },
      },
      { bCanCharacterStepUp: false },
      { bWalkable: true },
    ]

    for (const variant of variants) {
      let queryCount = 0
      const result = startMantling(input({
        Collision: {
          SweepCapsule() {
            queryCount++
            return { ...forwardHit, ...variant }
          },
          SweepSphere() {
            queryCount++
            return downwardHit
          },
          OverlapCapsule() {
            queryCount++
            return false
          },
        },
      }))
      expect(result).toBeNull()
      expect(queryCount).toBe(1)
    }

    let acceptedCount = 0
    startMantling(input({
      Collision: {
        SweepCapsule() {
          acceptedCount++
          return {
            ...forwardHit,
            TargetPrimitiveVelocity: {
              x: (
                ALS_GENERAL_MANTLING_SETTINGS
                  .TargetPrimitiveSpeedThreshold
              ),
              y: 0,
              z: 0,
            },
          }
        },
        SweepSphere() {
          acceptedCount++
          return downwardHit
        },
        OverlapCapsule() {
          acceptedCount++
          return false
        },
      },
    }))
    expect(acceptedCount).toBe(4)
  })

  it('requires both measured and approximate slopes to pass', () => {
    const results = [
      {
        ...downwardHit,
        ImpactNormal: { x: 0, y: 0, z: 0.8 },
      },
      {
        ...downwardHit,
        Location: { x: 1.19, y: 0, z: 1.01 },
      },
      {
        ...downwardHit,
        bWalkable: false,
      },
    ]

    for (const downward of results) {
      let queryCount = 0
      expect(startMantling(input({
        Collision: {
          SweepCapsule() {
            queryCount++
            return forwardHit
          },
          SweepSphere() {
            queryCount++
            return downward
          },
          OverlapCapsule() {
            queryCount++
            return false
          },
        },
      }))).toBeNull()
      expect(queryCount).toBe(2)
    }
  })

  it('stops at the first blocked target/start capsule overlap', () => {
    for (const blockedOverlap of [1, 2]) {
      let overlap = 0
      let queryCount = 0
      expect(startMantling(input({
        Collision: {
          SweepCapsule() {
            queryCount++
            return forwardHit
          },
          SweepSphere() {
            queryCount++
            return downwardHit
          },
          OverlapCapsule() {
            queryCount++
            overlap++
            return overlap === blockedOverlap
          },
        },
      }))).toBeNull()
      expect(queryCount).toBe(2 + blockedOverlap)
    }
  })

  it('preserves the grounded and locally-controlled InAir entry guards', () => {
    const SweepCapsule = vi.fn(() => null)
    const Collision: AlsMantlingCollisionQuery = {
      SweepCapsule,
      SweepSphere() {
        throw new Error('unexpected downward query')
      },
      OverlapCapsule() {
        throw new Error('unexpected overlap query')
      },
    }
    const shared = {
      MantlingSettings: ALS_GENERAL_MANTLING_SETTINGS,
      Collision,
      TargetSpace: targetSpace(),
    }

    expect(startMantlingGrounded({
      ...shared,
      Character: character({ LocomotionMode: 'InAir' }),
    })).toBeNull()
    expect(startMantlingInAir({
      ...shared,
      Character: character({
        LocomotionMode: 'InAir',
        bIsLocallyControlled: false,
      }),
    })).toBeNull()
    expect(SweepCapsule).not.toHaveBeenCalled()

    startMantlingGrounded({
      ...shared,
      Character: character({ LocomotionMode: 'Grounded' }),
    })
    startMantlingInAir({
      ...shared,
      Character: character({ LocomotionMode: 'InAir' }),
    })
    expect(SweepCapsule).toHaveBeenCalledTimes(2)
  })

  it('rejects disabled, simulated, and action-occupied characters pre-query', () => {
    const SweepCapsule = vi.fn(() => null)
    const Collision: AlsMantlingCollisionQuery = {
      SweepCapsule,
      SweepSphere: vi.fn(),
      OverlapCapsule: vi.fn(),
    }
    const disabledSettings = {
      ...ALS_GENERAL_MANTLING_SETTINGS,
      bAllowMantling: false,
    }

    startMantling(input({
      MantlingSettings: disabledSettings,
      Collision,
    }))
    startMantling(input({
      Character: character({ LocalRole: 'SimulatedProxy' }),
      Collision,
    }))
    startMantling(input({
      Character: character({ bIsMantlingAllowedToStart: false }),
      Collision,
    }))
    expect(SweepCapsule).not.toHaveBeenCalled()
  })
})
