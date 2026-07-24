import { describe, expect, it, vi } from 'vitest'
import type {
  AlsCapturedMantlingTarget,
  AlsMantlingCollisionQuery,
  AlsMantlingLifecycleAdapter,
  AlsMantlingSweepHit,
  AlsStartMantlingCharacterState,
  StartAlsMantlingInput,
} from './AlsCharacter_Actions'
import {
  prepareCharacterMantling,
  refreshMantling,
  startMantling,
  startMantlingGrounded,
  startMantlingImplementation,
  startMantlingInAir,
  stopMantling,
} from './AlsCharacter_Actions'
import {
  createAlsCharacter,
  setLocomotionMode,
} from './AlsCharacter'
import type {
  AlsCharacter,
} from './AlsCharacter'
import type {
  AlsRootMotionSource_Mantling,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import {
  refreshAlsMantlingMontage,
} from './AnimGraph/mantling'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
  ALS_MANTLING_SETTINGS,
} from './Settings/AlsMantlingSettings'
import type {
  CompiledAuthoredRootMotion,
} from '../engine/rootMotion'

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

function syntheticRootMotion(
  clipName: string,
  duration: number,
): CompiledAuthoredRootMotion {
  return {
    clipName,
    duration,
    bEnableRootMotion: true,
    bForceRootLock: true,
    RootMotionRootLock: 'AnimFirstFrame',
    poseReset: {
      kind: 'animationFirstFrame',
      translation: new Float32Array(3),
      rotation: new Float32Array([0, 0, 0, 1]),
    },
    times: new Float32Array([0, duration]),
    // GLB basis: component Y is ALS/Unreal Z.
    translations: new Float32Array([
      0, 0, 0,
      0, 1, 0,
    ]),
    rotations: new Float32Array([
      0, 0, 0, 1,
      0, 0, 0, 1,
    ]),
  }
}

interface MantlingLifecycleHarness {
  readonly Lifecycle: AlsMantlingLifecycleAdapter
  readonly Events: unknown[]
  readonly RootMotionSources:
    Map<number, AlsRootMotionSource_Mantling>
  TargetPrimitiveValid: boolean
}

function mantlingLifecycle(
  Character: AlsCharacter,
  MontagePlayResult = 1,
): MantlingLifecycleHarness {
  const Events: unknown[] = []
  const RootMotionSources =
    new Map<number, AlsRootMotionSource_Mantling>()
  const harness: MantlingLifecycleHarness = {
    Events,
    RootMotionSources,
    TargetPrimitiveValid: true,
    Lifecycle: {
      SetNetworkSmoothingMode(mode) {
        Events.push(`NetworkSmoothing:${mode}`)
      },
      ResetMeshRelativeTransform() {
        Events.push('ResetMeshRelativeTransform')
      },
      SetMovementModeLocked(bLocked) {
        Events.push([
          'SetMovementModeLocked',
          bLocked,
          Character.locomotionMode,
          Character.locomotionAction,
        ])
      },
      SetBase(TargetPrimitive) {
        Events.push(['SetBase', TargetPrimitive])
      },
      ApplyRootMotionSource(RootMotionSource) {
        const RootMotionSourceId = 41
        RootMotionSources.set(RootMotionSourceId, RootMotionSource)
        Events.push([
          'ApplyRootMotionSource',
          Character.locomotionMode,
          Character.locomotionAction,
        ])
        return RootMotionSourceId
      },
      GetRootMotionSourceByID(RootMotionSourceId) {
        Events.push(['GetRootMotionSourceByID', RootMotionSourceId])
        return RootMotionSources.get(RootMotionSourceId) ?? null
      },
      AllocateMontageInstanceId() {
        Events.push('AllocateMontageInstanceId')
        return 73
      },
      Montage_Play(MontageState) {
        Events.push([
          'Montage_Play',
          MontageState.RequestId,
          Character.mantlingState.RootMotionSourceId,
          Character.locomotionAction,
        ])
        return MontagePlayResult
      },
      IsTargetPrimitiveValid(TargetPrimitive) {
        Events.push(['IsTargetPrimitiveValid', TargetPrimitive])
        return harness.TargetPrimitiveValid
      },
      OnMantlingStarted() {
        Events.push([
          'OnMantlingStarted',
          Character.locomotionAction,
        ])
      },
      OnMantlingEnded() {
        Events.push('OnMantlingEnded')
      },
      ForceNetUpdate() {
        Events.push('ForceNetUpdate')
      },
      StartRagdolling() {
        Events.push('StartRagdolling')
      },
    },
  }
  return harness
}

const lifecycleTarget = {}

function mantlingParameters() {
  return {
    TargetPrimitive: lifecycleTarget,
    TargetRelativeLocation: { x: 1, y: 2, z: 1 },
    TargetRelativeRotation: {
      Pitch: 0,
      Yaw: 450,
      Roll: 0,
    },
    MantlingHeight: 0.75,
    MantlingType: 'Low',
  } as const
}

function startImplementation(
  Character: AlsCharacter,
  harness: MantlingLifecycleHarness,
) {
  const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
  return startMantlingImplementation({
    Character,
    Parameters: mantlingParameters(),
    OverlayMode: 'Als.OverlayMode.Rifle',
    AuthoredRootMotion: syntheticRootMotion(
      settings.Montage.Sequence,
      settings.Montage.SequenceLength,
    ),
    bUseRelativeLocation: false,
    ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
    ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    Lifecycle: harness.Lifecycle,
  })
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

describe('AAlsCharacter live mantling lifecycle', () => {
  it('ports StartMantlingImplementation side effects in source order', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const result = startImplementation(Character, harness)

    expect(result).not.toBeNull()
    if (result === null) return
    expect(result.RootMotionSource.MantlingSettings.Name)
      .toBe('MS_Als_Low_Right')
    expect(result.RootMotionSource.MontageStartTime).toBeCloseTo(0.25, 7)
    expect(result.RootMotionSource.Duration).toBeCloseTo(1.25, 7)
    expect(result.RootMotionSource.TargetRelativeRotation)
      .toEqual({ Pitch: 0, Yaw: 90, Roll: 0 })
    expect(result.RootMotionSource.ActorFeetLocationOffset)
      .toEqual({ x: -0.5, y: -0.5, z: -0.75 })
    expect(result.MontageState).toMatchObject({
      RequestId: 73,
      MontagePosition: 0.25,
      Status: 'Playing',
    })
    expect(Character.locomotionMode).toBeNull()
    expect(Character.locomotionAction).toBe('Mantling')
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)
    expect(harness.Events).toEqual([
      'NetworkSmoothing:Disabled',
      'ResetMeshRelativeTransform',
      ['SetMovementModeLocked', true, null, null],
      ['SetBase', lifecycleTarget],
      ['ApplyRootMotionSource', null, null],
      'AllocateMontageInstanceId',
      ['Montage_Play', 73, 41, null],
      ['OnMantlingStarted', 'Mantling'],
    ])
    expect(result.MontageState?.RequestId)
      .not.toBe(Character.mantlingState.RootMotionSourceId)
  })

  it('rejects an occupied locomotion action before selecting or mutating', () => {
    const Character = createAlsCharacter()
    Character.locomotionAction = 'Rolling'
    const harness = mantlingLifecycle(Character)

    expect(startImplementation(Character, harness)).toBeNull()
    expect(Character.locomotionMode).toBe('Grounded')
    expect(Character.mantlingState.RootMotionSourceId).toBe(0)
    expect(harness.Events).toEqual([])
  })

  it('retains the applied root source when Montage_Play fails, then unwinds on the next refresh', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character, 0)
    const result = startImplementation(Character, harness)

    expect(result?.MontageState).toBeNull()
    expect(Character.locomotionMode).toBeNull()
    expect(Character.locomotionAction).toBeNull()
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)

    expect(refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: result?.MontageState ?? null,
    })).toBe(true)

    expect(result?.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(Character.mantlingState.RootMotionSourceId).toBe(0)
    expect(Character.locomotionMode).toBe('Grounded')
    expect(harness.Events.slice(-5)).toEqual([
      ['GetRootMotionSourceByID', 41],
      'NetworkSmoothing:Exponential',
      ['SetMovementModeLocked', false, null, null],
      'OnMantlingEnded',
      'ForceNetUpdate',
    ])
  })

  it('uses only the root-source playhead and lets the notify end own action exit', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(start?.MontageState).not.toBeNull()
    if (start === null || start.MontageState === null) return

    const result = prepareCharacterMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      RootMotionSource: start.RootMotionSource,
      MontageState: start.MontageState,
      SimulationDeltaTime: 0.75,
      DeltaTime: 1 / 60,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(result.Clock.RootMotionTime).toBeCloseTo(0.75, 12)
    expect(result.Clock.MontageTime).toBeCloseTo(1, 7)
    expect(result.Clock.MontagePosition)
      .toBeCloseTo(1 - 1 / 60, 7)
    expect(start.MontageState.MontagePosition)
      .toBe(result.Clock.MontagePosition)
    expect(start.MontageState.ElapsedTime).toBeCloseTo(1 / 60, 12)
    expect(start.MontageState.bMovementActionEndedThisFrame).toBe(true)
    expect(Character.locomotionAction).toBeNull()
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)

    const status = start.MontageState.Status
    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: start.MontageState,
    })
    expect(start.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(start.MontageState.Status).toBe(status)
    expect(Character.mantlingState.RootMotionSourceId).toBe(0)

    const retainedPosition = start.MontageState.MontagePosition
    refreshAlsMantlingMontage(start.MontageState, {
      DeltaTime: 0.1,
      bHasInput: Character.locomotionState.hasInput,
      LocomotionMode: Character.locomotionMode,
      RotationMode: Character.rotationMode,
      Stance: Character.stance,
    })
    expect(start.MontageState.MontagePosition)
      .toBeCloseTo(retainedPosition + 0.1, 7)
  })

  it('stops a mode-invalid mantle with the authored global blend duration', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(start?.MontageState).not.toBeNull()
    if (start === null || start.MontageState === null) return

    setLocomotionMode(Character, 'Grounded')
    expect(refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: start.MontageState,
    })).toBe(true)

    expect(start.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(start.MontageState.Status).toBe('BlendingOut')
    expect(start.MontageState.BlendOutDuration)
      .toBe(ALS_GENERAL_MANTLING_SETTINGS.BlendOutDuration)
    // StopMantling does not usurp the active montage notify.
    expect(Character.locomotionAction).toBe('Mantling')
    expect(Character.locomotionMode).toBe('Grounded')
  })

  it('stops and requests authored ragdoll behavior when the target is destroyed', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(start?.MontageState).not.toBeNull()
    if (start === null) return
    harness.TargetPrimitiveValid = false

    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: start.MontageState,
    })

    expect(start.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(start.MontageState?.Status).toBe('BlendingOut')
    expect(harness.Events.at(-1)).toBe('StartRagdolling')
  })

  it('does not stop a montage when its root source has already left the registry', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(start?.MontageState).not.toBeNull()
    if (start === null || start.MontageState === null) return
    harness.RootMotionSources.delete(41)
    setLocomotionMode(Character, 'Grounded')

    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: start.MontageState,
    })

    expect(start.MontageState.Status).toBe('Playing')
    expect(Character.mantlingState.RootMotionSourceId).toBe(0)
  })

  it('leaves a finished root source registered until notify exit drives RefreshMantling cleanup', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(start?.MontageState).not.toBeNull()
    if (start === null || start.MontageState === null) return

    const result = prepareCharacterMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      RootMotionSource: start.RootMotionSource,
      MontageState: start.MontageState,
      SimulationDeltaTime: start.RootMotionSource.Duration,
      DeltaTime: 1 / 60,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(result.finished).toBe(true)
    expect(start.RootMotionSource.Status).toBe('Finished')
    expect(Character.locomotionAction).toBeNull()
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)

    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: start.MontageState,
    })
    expect(start.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(Character.mantlingState.RootMotionSourceId).toBe(0)
  })

  it('keeps StopMantling idempotent after RootMotionSourceId is cleared', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)

    expect(stopMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      MontageState: null,
      bStopMontage: true,
    })).toBe(false)
    expect(harness.Events).toEqual([])
  })
})
