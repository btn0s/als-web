import { describe, expect, it, vi } from 'vitest'
import type {
  AlsCapturedMantlingTarget,
  AlsMantlingCollisionQuery,
  AlsMantlingLifecycleAdapter,
  AlsMantlingNotifyRuntime,
  AlsMantlingSweepHit,
  AlsRagdollingGroundSweep,
  AlsRagdollingLifecycleAdapter,
  AlsRollingPhysicsAdapter,
  AlsRollingMontageBridge,
  AlsStartMantlingCharacterState,
  StartAlsMantlingInput,
} from './AlsCharacter_Actions'
import {
  ALS_RAGDOLLING_PELVIS_BONE_NAME,
  ALS_RAGDOLLING_SPINE_03_BONE_NAME,
  compileAlsMantlingEarlyBlendOutNotify,
  compileAlsMantlingLocomotionActionNotify,
  constraintRagdollSpeed,
  createAlsMantlingNotifyRuntime,
  isRagdollingAllowedToStart,
  isRagdollingAllowedToStop,
  isRollingAllowedToStart,
  prepareCharacterMantling,
  refreshAlsMantlingNotifyRuntime,
  refreshMantling,
  refreshRagdolling,
  refreshRollingPhysics,
  ragdollTraceGround,
  serverStartRagdolling,
  serverStopRagdolling,
  setRagdollTargetLocation,
  startRagdolling,
  startRagdollingImplementation,
  startRolling,
  startRollingImplementation,
  startMantling,
  startMantlingGrounded,
  startMantlingImplementation,
  startMantlingInAir,
  stopMantling,
  stopRagdolling,
  stopRagdollingImplementation,
} from './AlsCharacter_Actions'
import {
  ALS_CHARACTER_SETTINGS,
  createAlsCharacter,
  refreshInput,
  setLocomotionAction,
  setLocomotionMode,
} from './AlsCharacter'
import type {
  AlsCharacter,
} from './AlsCharacter'
import type {
  AlsMantlingMontageBridge,
  AlsMantlingMontageNotifyEvent,
} from './AlsAnimationInstance'
import type {
  AlsRootMotionSource_Mantling,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
  ALS_MANTLING_SETTINGS,
} from './Settings/AlsMantlingSettings'
import type {
  AlsMantlingSettings,
} from './Settings/AlsMantlingSettings'
import type {
  CompiledAuthoredRootMotion,
} from '../engine/rootMotion'
import {
  notifyAlsAnimNotifyStateSetLocomotionActionEnd,
} from './Notifies/AlsAnimNotifyState_SetLocomotionAction'
import physicsAssetSource
  from '../../scripts/extract-als/physics-asset.json?raw'

// ALS Refactored 4.15:
// Source/ALS/Private/AlsCharacter_Actions.cpp:22-100.
describe('AAlsCharacter rolling lifecycle', () => {
  function rollingAnimation(
    Character: AlsCharacter,
    Events: unknown[],
    options: {
      readonly bPlaying?: boolean
      readonly MontagePlayResult?: number
    } = {},
  ): AlsRollingMontageBridge {
    return {
      Montage_IsPlaying(Montage) {
        Events.push(['Montage_IsPlaying', Montage])
        return options.bPlaying ?? false
      },
      Montage_Play(Montage, PlayRate) {
        Events.push([
          'Montage_Play',
          Montage,
          PlayRate,
          Character.locomotionAction,
          Character.rollingState.TargetYawAngle,
        ])
        return options.MontagePlayResult ?? 1.6
      },
    }
  }

  it('uses input yaw, then lets successful montage playback own Roll', () => {
    const Character = createAlsCharacter({
      actorYawAngle: 225,
      desiredStance: 'Standing',
    })
    refreshInput(Character, { x: 0, y: 1, z: 0 })
    const Events: unknown[] = []
    let MovementStance = Character.movement.stance
    let MovementStanceWrites = 0
    Object.defineProperty(Character.movement, 'stance', {
      configurable: true,
      get() {
        return MovementStance
      },
      set(value) {
        MovementStanceWrites += 1
        MovementStance = value
      },
    })

    expect(startRolling(
      Character,
      1.3,
      rollingAnimation(Character, Events),
    )).toBe(true)

    // A null action short-circuits both IsRollingAllowedToStart() calls.
    expect(Events).toEqual([
      ['Montage_Play', 'AM_Als_Roll', 1.3, null, 0],
    ])
    expect(Character.rollingState.TargetYawAngle).toBe(90)
    expect(Character.actorYawAngle).toBe(-135)
    expect(Character.locomotionState.targetYawAngle).toBe(-135)
    expect(Character.locomotionState.smoothTargetYawAngle).toBe(-135)
    expect(Character.locomotionAction).toBe('Rolling')
    expect(Character.stance).toBe('Crouching')
    expect(Character.movement.stance).toBe('Crouching')
    expect(MovementStanceWrites).toBe(1)
  })

  it('uses actor yaw when rotate-to-input is disabled or input is absent', () => {
    const disabled = createAlsCharacter({
      actorYawAngle: 200,
      settings: {
        Rolling: {
          ...ALS_CHARACTER_SETTINGS.Rolling,
          bRotateToInputOnStart: false,
        },
      },
    })
    refreshInput(disabled, { x: 0, y: 1, z: 0 })
    expect(startRolling(
      disabled,
      1,
      rollingAnimation(disabled, []),
    )).toBe(true)
    expect(disabled.rollingState.TargetYawAngle).toBe(-160)

    const withoutInput = createAlsCharacter({ actorYawAngle: 190 })
    expect(startRolling(
      withoutInput,
      1,
      rollingAnimation(withoutInput, []),
    )).toBe(true)
    expect(withoutInput.rollingState.TargetYawAngle).toBe(-170)
  })

  it('checks Grounded only in the player-request overload', () => {
    const Character = createAlsCharacter({
      locomotionMode: 'InAir',
      actorYawAngle: 45,
    })
    const Events: unknown[] = []
    const Animation = rollingAnimation(Character, Events)

    expect(startRolling(Character, 1.3, Animation)).toBe(false)
    expect(Events).toEqual([])

    expect(startRolling(Character, 1.3, 270, Animation)).toBe(true)
    expect(Character.rollingState.TargetYawAngle).toBe(270)
    expect(Character.actorYawAngle).toBe(45)
    expect(Character.locomotionAction).toBe('Rolling')
  })

  it('preserves the two eligibility checks for replaying a stopped Roll', () => {
    const Character = createAlsCharacter()
    setLocomotionAction(Character, 'Rolling')
    const Events: unknown[] = []
    const Animation = rollingAnimation(Character, Events)

    expect(isRollingAllowedToStart(
      Character,
      'AM_Als_Roll',
      Animation,
    )).toBe(true)
    Events.length = 0

    expect(startRolling(Character, 1.1, 75, Animation)).toBe(true)
    expect(Events).toEqual([
      ['Montage_IsPlaying', 'AM_Als_Roll'],
      ['Montage_IsPlaying', 'AM_Als_Roll'],
      ['Montage_Play', 'AM_Als_Roll', 1.1, 'Rolling', 0],
    ])

    const activeEvents: unknown[] = []
    const activeAnimation = rollingAnimation(
      Character,
      activeEvents,
      { bPlaying: true },
    )
    expect(startRolling(
      Character,
      1.1,
      90,
      activeAnimation,
    )).toBe(false)
    expect(activeEvents).toEqual([
      ['Montage_IsPlaying', 'AM_Als_Roll'],
    ])
  })

  it('does not mutate rolling state when Montage_Play fails', () => {
    const Character = createAlsCharacter({ actorYawAngle: 30 })
    const Events: unknown[] = []
    let MovementStance = Character.movement.stance
    let MovementStanceWrites = 0
    Object.defineProperty(Character.movement, 'stance', {
      configurable: true,
      get() {
        return MovementStance
      },
      set(value) {
        MovementStanceWrites += 1
        MovementStance = value
      },
    })

    expect(startRollingImplementation(
      Character,
      'AM_Als_Roll',
      1.3,
      -45,
      120,
      rollingAnimation(Character, Events, {
        MontagePlayResult: 0,
      }),
    )).toBe(false)

    expect(Events).toEqual([
      ['Montage_Play', 'AM_Als_Roll', 1.3, null, 0],
    ])
    expect(Character.rollingState.TargetYawAngle).toBe(0)
    expect(Character.actorYawAngle).toBe(30)
    expect(Character.locomotionState.targetYawAngle).toBe(30)
    expect(Character.locomotionAction).toBeNull()
    expect(Character.stance).toBe('Standing')
    expect(Character.movement.stance).toBe('Standing')
    expect(MovementStanceWrites).toBe(0)
  })

  it('leaves Roll exit to the authored action-notify identity guard', () => {
    const Character = createAlsCharacter({
      desiredStance: 'Standing',
    })
    expect(startRolling(
      Character,
      1.3,
      rollingAnimation(Character, []),
    )).toBe(true)
    expect(Character.locomotionAction).toBe('Rolling')
    expect(Character.stance).toBe('Crouching')

    notifyAlsAnimNotifyStateSetLocomotionActionEnd(Character, {
      LocomotionAction: 'Mantling',
    })
    expect(Character.locomotionAction).toBe('Rolling')

    notifyAlsAnimNotifyStateSetLocomotionActionEnd(Character, {
      LocomotionAction: 'Rolling',
    })
    expect(Character.locomotionAction).toBeNull()
    expect(Character.stance).toBe('Standing')
  })

  it('moves UpdatedComponent with ALS roll interpolation and overload flags', () => {
    const Character = createAlsCharacter({ actorYawAngle: 25 })
    Character.rollingState.TargetYawAngle = -170
    setLocomotionAction(Character, 'Rolling')
    const Events: unknown[] = []
    const Physics: AlsRollingPhysicsAdapter = {
      GetUpdatedComponentRotation() {
        Events.push('GetUpdatedComponentRotation')
        return { Pitch: 3, Yaw: 170, Roll: 4 }
      },
      MoveUpdatedComponent(
        Delta,
        NewRotation,
        bSweep,
        Teleport,
      ) {
        Events.push([
          'MoveUpdatedComponent',
          Delta,
          NewRotation,
          bSweep,
          Teleport,
        ])
      },
    }

    expect(refreshRollingPhysics(
      Character,
      0.1,
      Physics,
    )).toBe(true)
    expect(Character.actorYawAngle)
      .toBeCloseTo(-177.3664825, 6)
    expect(Events).toEqual([
      'GetUpdatedComponentRotation',
      [
        'MoveUpdatedComponent',
        { x: 0, y: 0, z: 0 },
        {
          Pitch: 3,
          Yaw: Character.actorYawAngle,
          Roll: 4,
        },
        false,
        'None',
      ],
    ])
  })

  it('uses TeleportPhysics only for the non-interpolated roll branch', () => {
    const Character = createAlsCharacter({
      settings: {
        Rolling: {
          ...ALS_CHARACTER_SETTINGS.Rolling,
          RotationInterpolationSpeed: 0,
        },
      },
    })
    Character.rollingState.TargetYawAngle = 270
    setLocomotionAction(Character, 'Rolling')
    const MoveUpdatedComponent = vi.fn()
    const Physics: AlsRollingPhysicsAdapter = {
      GetUpdatedComponentRotation: () => ({
        Pitch: 1,
        Yaw: -25,
        Roll: 2,
      }),
      MoveUpdatedComponent,
    }

    expect(refreshRollingPhysics(
      Character,
      1 / 60,
      Physics,
    )).toBe(true)
    expect(MoveUpdatedComponent).toHaveBeenCalledWith(
      { x: 0, y: 0, z: 0 },
      { Pitch: 1, Yaw: 270, Roll: 2 },
      false,
      'TeleportPhysics',
    )
    expect(Character.actorYawAngle).toBe(-90)

    setLocomotionAction(Character, null)
    MoveUpdatedComponent.mockClear()
    expect(refreshRollingPhysics(
      Character,
      1 / 60,
      Physics,
    )).toBe(false)
    expect(MoveUpdatedComponent).not.toHaveBeenCalled()
  })
})

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
  readonly MantlingMontage: AlsMantlingMontageBridge
  readonly Events: unknown[]
  readonly RootMotionSources:
    Map<number, AlsRootMotionSource_Mantling>
  readonly NotifyEvents: AlsMantlingMontageNotifyEvent[]
  ActiveMontageInstanceId: number | null
  ActiveMantlingSettings: AlsMantlingSettings | null
  TargetPrimitiveValid: boolean
}

interface MantlingLifecycleOptions {
  readonly MontagePlaySucceeds?: boolean
  readonly MontageInstanceId?: number
  readonly RootMotionSourceId?: number
}

function mantlingLifecycle(
  Character: AlsCharacter,
  options: Readonly<MantlingLifecycleOptions> = {},
): MantlingLifecycleHarness {
  const Events: unknown[] = []
  const NotifyEvents: AlsMantlingMontageNotifyEvent[] = []
  const RootMotionSources =
    new Map<number, AlsRootMotionSource_Mantling>()
  let harness: MantlingLifecycleHarness
  const MantlingMontage: AlsMantlingMontageBridge = {
    play(settings, startTime) {
      Events.push([
        'Montage_Play',
        settings.Name,
        startTime,
        Character.mantlingState.RootMotionSourceId,
        Character.locomotionAction,
      ])
      if (options.MontagePlaySucceeds === false) return null
      const instanceId = options.MontageInstanceId ?? 0
      harness.ActiveMontageInstanceId = instanceId
      harness.ActiveMantlingSettings = settings
      return {
        instanceId,
        duration: settings.Montage.PlayLength,
      }
    },
    montageSetPosition(settings, position) {
      const found = (
        harness.ActiveMantlingSettings?.Montage
        === settings.Montage
      )
      Events.push([
        'Montage_SetPosition',
        settings.Name,
        position,
        found ? harness.ActiveMontageInstanceId : null,
        found,
      ])
      return found
    },
    montageStop(settings, blendOutDuration) {
      const stopped = (
        harness.ActiveMantlingSettings?.Montage
        === settings.Montage
      )
      Events.push([
        'Montage_Stop',
        settings.Name,
        stopped ? harness.ActiveMontageInstanceId : null,
        blendOutDuration,
        stopped,
      ])
      if (stopped) {
        harness.ActiveMontageInstanceId = null
        harness.ActiveMantlingSettings = null
      }
      return stopped
    },
    stopMontageInstance(instanceId, blendOutDuration) {
      const stopped =
        harness.ActiveMontageInstanceId === instanceId
      Events.push([
        'MontageInstance_Stop',
        instanceId,
        blendOutDuration,
        stopped,
      ])
      if (stopped) {
        harness.ActiveMontageInstanceId = null
        harness.ActiveMantlingSettings = null
      }
      return stopped
    },
    takeNotifyEvents() {
      return NotifyEvents.splice(0, NotifyEvents.length)
    },
  }
  harness = {
    Events,
    RootMotionSources,
    NotifyEvents,
    MantlingMontage,
    ActiveMontageInstanceId: null,
    ActiveMantlingSettings: null,
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
        const RootMotionSourceId =
          options.RootMotionSourceId ?? 41
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
      MantlingMontage,
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

function mantlingNotifyEvent(
  settings: AlsMantlingSettings,
  StateClassType: string,
  notifyEventType: 'Begin' | 'End',
  instanceId = 0,
): AlsMantlingMontageNotifyEvent {
  const notifyIndex = settings.Montage.Notifies.findIndex(
    (notify) => notify.StateClassType === StateClassType,
  )
  const notify = settings.Montage.Notifies[notifyIndex]
  const marker = settings.Montage.BranchingPointMarkers.find(
    (candidate) => (
      candidate.NotifyIndex === notifyIndex
      && candidate.NotifyEventType === notifyEventType
    ),
  )
  if (!notify || !marker) {
    throw new Error(
      `${settings.Montage.Name} is missing ${StateClassType} `
      + `${notifyEventType}`,
    )
  }
  return {
    instanceId,
    mantlingSettings: settings,
    notify,
    notifyEventType,
    triggerTime: marker.TriggerTime,
  }
}

function activeEarlyBlendOutCount(
  Runtime: AlsMantlingNotifyRuntime,
) {
  let count = 0
  for (
    const states
    of Runtime.ActiveEarlyBlendOutStates.values()
  ) {
    count += states.size
  }
  return count
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

// ALS Refactored 4.15:
// Source/ALS/Private/AlsCharacter_Actions.cpp:454-676.
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
    // FAlsMantlingState stores exactly the root-source ID. The animation
    // runtime may allocate montage instance zero, but Character never stores
    // that engine-private identity.
    expect(result).toEqual({
      RootMotionSource: result.RootMotionSource,
    })
    expect(harness.ActiveMontageInstanceId).toBe(0)
    expect(Character.locomotionMode).toBeNull()
    expect(Character.locomotionAction).toBe('Mantling')
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)
    expect(harness.Events).toEqual([
      'NetworkSmoothing:Disabled',
      'ResetMeshRelativeTransform',
      ['SetMovementModeLocked', true, null, null],
      ['SetBase', lifecycleTarget],
      ['ApplyRootMotionSource', null, null],
      ['Montage_Play', 'MS_Als_Low_Right', 0, 41, null],
      ['OnMantlingStarted', 'Mantling'],
    ])
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
    const harness = mantlingLifecycle(Character, {
      MontagePlaySucceeds: false,
    })
    const result = startImplementation(Character, harness)

    expect(harness.ActiveMontageInstanceId).toBeNull()
    expect(Character.locomotionMode).toBeNull()
    expect(Character.locomotionAction).toBeNull()
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)

    expect(refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
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

  it('sets high-RateScale M - DeltaTime on the active montage asset', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const settings = ALS_MANTLING_SETTINGS.MS_Als_High
    const start = startMantlingImplementation({
      Character,
      Parameters: {
        ...mantlingParameters(),
        MantlingType: 'High',
      },
      AuthoredRootMotion: syntheticRootMotion(
        settings.Montage.Sequence,
        settings.Montage.SequenceLength,
      ),
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
      Lifecycle: harness.Lifecycle,
    })
    expect(harness.ActiveMontageInstanceId).toBe(0)
    if (start === null) return

    const result = prepareCharacterMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      RootMotionSource: start.RootMotionSource,
      SimulationDeltaTime: 0.5,
      DeltaTime: 0.125,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    const expectedMontageTime = (
      start.RootMotionSource.MontageStartTime
      + 0.5 * settings.Montage.RateScale
    )
    expect(settings.Montage.RateScale)
      .toBe(1.2000000476837158)
    expect(result.Clock.RootMotionTime).toBeCloseTo(0.5, 12)
    expect(result.Clock.MontageTime)
      .toBeCloseTo(expectedMontageTime, 12)
    expect(result.Clock.MontagePosition)
      .toBeCloseTo(expectedMontageTime - 0.125, 12)
    expect(harness.Events.at(-2)).toEqual([
      'IsTargetPrimitiveValid',
      lifecycleTarget,
    ])
    expect(harness.Events.at(-1)).toEqual([
      'Montage_SetPosition',
      'MS_Als_High',
      result.Clock.MontagePosition,
      0,
      true,
    ])
    // PrepareRootMotion never owns action-notify advancement.
    expect(Character.locomotionAction).toBe('Mantling')
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)
  })

  it('synchronizes a same-asset replacement but not a different asset', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    if (start === null) return

    harness.ActiveMontageInstanceId = 17
    harness.ActiveMantlingSettings =
      start.RootMotionSource.MantlingSettings
    const sameAsset = prepareCharacterMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      RootMotionSource: start.RootMotionSource,
      SimulationDeltaTime: 0.1,
      DeltaTime: 1 / 60,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    expect(harness.Events.at(-1)).toEqual([
      'Montage_SetPosition',
      'MS_Als_Low_Right',
      sameAsset.Clock.MontagePosition,
      17,
      true,
    ])

    harness.ActiveMontageInstanceId = 18
    harness.ActiveMantlingSettings =
      ALS_MANTLING_SETTINGS.MS_Als_High
    const differentAsset = prepareCharacterMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      RootMotionSource: start.RootMotionSource,
      SimulationDeltaTime: 0.1,
      DeltaTime: 1 / 60,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    expect(harness.Events.at(-1)).toEqual([
      'Montage_SetPosition',
      'MS_Als_Low_Right',
      differentAsset.Clock.MontagePosition,
      null,
      false,
    ])
    expect(harness.ActiveMontageInstanceId).toBe(18)
  })

  it('stops a mode-invalid mantle with the authored global blend duration', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(harness.ActiveMontageInstanceId).toBe(0)
    if (start === null) return

    setLocomotionMode(Character, 'Grounded')
    expect(refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
    })).toBe(true)

    expect(start.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(harness.Events).toContainEqual([
      'Montage_Stop',
      'MS_Als_Low_Right',
      0,
      ALS_GENERAL_MANTLING_SETTINGS.BlendOutDuration,
      true,
    ])
    // StopMantling does not usurp the active montage notify.
    expect(Character.locomotionAction).toBe('Mantling')
    expect(Character.locomotionMode).toBe('Grounded')
  })

  it('stops and requests authored ragdoll behavior when the target is destroyed', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(harness.ActiveMontageInstanceId).toBe(0)
    if (start === null) return
    harness.TargetPrimitiveValid = false

    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
    })

    expect(start.RootMotionSource.Status).toBe('MarkedForRemoval')
    expect(harness.Events).toContainEqual([
      'Montage_Stop',
      'MS_Als_Low_Right',
      0,
      ALS_GENERAL_MANTLING_SETTINGS.BlendOutDuration,
      true,
    ])
    expect(harness.Events.at(-1)).toBe('StartRagdolling')
  })

  it('does not stop a montage when its root source has already left the registry', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(harness.ActiveMontageInstanceId).toBe(0)
    if (start === null) return
    harness.RootMotionSources.delete(41)
    setLocomotionMode(Character, 'Grounded')

    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
    })

    expect(
      harness.Events.some(
        (event) => Array.isArray(event) && event[0] === 'Montage_Stop',
      ),
    ).toBe(false)
    expect(harness.ActiveMontageInstanceId).toBe(0)
    expect(Character.mantlingState.RootMotionSourceId).toBe(0)
  })

  it('stops the active same-asset replacement, not the original instance ID', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(harness.ActiveMontageInstanceId).toBe(0)
    if (start === null) return

    // ActiveMontagesMap.Add() replaces the asset's active pointer when the
    // same UAnimMontage is replayed.
    harness.ActiveMontageInstanceId = 17
    harness.ActiveMantlingSettings =
      start.RootMotionSource.MantlingSettings
    setLocomotionMode(Character, 'Grounded')
    expect(refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
    })).toBe(true)

    expect(harness.Events).toContainEqual([
      'Montage_Stop',
      'MS_Als_Low_Right',
      17,
      ALS_GENERAL_MANTLING_SETTINGS.BlendOutDuration,
      true,
    ])
    expect(harness.ActiveMontageInstanceId).toBeNull()
  })

  it('does not stop a different-asset replacement in the Slot Group', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    if (start === null) return

    harness.ActiveMontageInstanceId = 17
    harness.ActiveMantlingSettings =
      ALS_MANTLING_SETTINGS.MS_Als_High
    setLocomotionMode(Character, 'Grounded')
    expect(refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
    })).toBe(true)

    expect(harness.Events).toContainEqual([
      'Montage_Stop',
      'MS_Als_Low_Right',
      null,
      ALS_GENERAL_MANTLING_SETTINGS.BlendOutDuration,
      false,
    ])
    expect(harness.ActiveMontageInstanceId).toBe(17)
  })

  it('leaves a finished root source registered until notify exit drives RefreshMantling cleanup', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const start = startImplementation(Character, harness)
    expect(harness.ActiveMontageInstanceId).toBe(0)
    if (start === null) return

    const result = prepareCharacterMantling({
      Character,
      Lifecycle: harness.Lifecycle,
      RootMotionSource: start.RootMotionSource,
      SimulationDeltaTime: start.RootMotionSource.Duration,
      DeltaTime: 1 / 60,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0.5, y: 1.5, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(result.finished).toBe(true)
    expect(start.RootMotionSource.Status).toBe('Finished')
    expect(Character.locomotionAction).toBe('Mantling')
    expect(Character.mantlingState.RootMotionSourceId).toBe(41)

    const movementAction =
      start.RootMotionSource.MantlingSettings.Montage.Notifies[0]
    refreshAlsMantlingNotifyRuntime(
      createAlsMantlingNotifyRuntime(),
      {
        Character,
        MantlingMontage: harness.MantlingMontage,
        NotifyEvents: [{
          instanceId: 0,
          mantlingSettings:
            start.RootMotionSource.MantlingSettings,
          notify: movementAction,
          notifyEventType: 'End',
          triggerTime: movementAction.EndTime,
        }],
      },
    )
    expect(Character.locomotionAction).toBeNull()

    refreshMantling({
      Character,
      Lifecycle: harness.Lifecycle,
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
      bStopMontage: true,
    })).toBe(false)
    expect(harness.Events).toEqual([])
  })
})

// ALS Refactored 4.15 notify sources:
// Source/ALS/Private/Notifies/AlsAnimNotifyState_{SetLocomotionAction,
// EarlyBlendOut}.cpp. Exact tags, markers, and per-montage durations come from
// scripts/extract-als/mantling-content.json.
describe('ALS mantling branching-point runtime', () => {
  const settings = ALS_MANTLING_SETTINGS.MS_Als_Low
  const actionBegin = mantlingNotifyEvent(
    settings,
    'AlsAnimNotifyState_SetLocomotionAction',
    'Begin',
  )
  const actionEnd = mantlingNotifyEvent(
    settings,
    'AlsAnimNotifyState_SetLocomotionAction',
    'End',
  )
  const earlyBegin = mantlingNotifyEvent(
    settings,
    'AlsAnimNotifyState_EarlyBlendOut',
    'Begin',
  )
  const earlyEnd = mantlingNotifyEvent(
    settings,
    'AlsAnimNotifyState_EarlyBlendOut',
    'End',
  )

  it('compiles exact authored gameplay tags and rejects unknown tags', () => {
    expect(
      compileAlsMantlingLocomotionActionNotify(actionBegin.notify),
    ).toEqual({ LocomotionAction: 'Mantling' })
    expect(
      compileAlsMantlingEarlyBlendOutNotify(earlyBegin.notify),
    ).toEqual({
      BlendOutDuration: 0.35,
      bCheckInput: true,
      bCheckLocomotionMode: true,
      bCheckRotationMode: true,
      bCheckStance: true,
      LocomotionModeEquals: 'InAir',
      RotationModeEquals: 'Aiming',
      StanceEquals: 'Crouching',
    })

    expect(() => compileAlsMantlingLocomotionActionNotify({
      ...actionBegin.notify,
      LocomotionAction: 'Als.LocomotionAction.Unknown',
    })).toThrow('Unsupported ALS mantling LocomotionAction tag')
    expect(() => compileAlsMantlingEarlyBlendOutNotify({
      ...earlyBegin.notify,
      LocomotionModeEquals: 'Als.LocomotionMode.Unknown',
    })).toThrow('Unsupported ALS mantling LocomotionMode tag')
  })

  it('dispatches action Begin and applies NotifyEnd identity guard', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const Runtime = createAlsMantlingNotifyRuntime()

    refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [actionBegin],
    })
    expect(Character.locomotionAction).toBe('Mantling')

    Character.locomotionAction = 'Rolling'
    refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [actionEnd],
    })
    expect(Character.locomotionAction).toBe('Rolling')

    refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [actionBegin, actionEnd],
    })
    expect(Character.locomotionAction).toBeNull()
  })

  it('ticks EarlyBlendOut from Begin until End on the exact instance', () => {
    const Character = createAlsCharacter()
    const harness = mantlingLifecycle(Character)
    const Runtime = createAlsMantlingNotifyRuntime()
    harness.ActiveMontageInstanceId = 0

    expect(refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [earlyBegin],
    })).toBe(false)
    expect(activeEarlyBlendOutCount(Runtime)).toBe(1)

    Character.locomotionState.hasInput = true
    expect(refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [],
    })).toBe(true)
    expect(harness.Events).toContainEqual([
      'MontageInstance_Stop',
      0,
      0.35,
      true,
    ])
    expect(activeEarlyBlendOutCount(Runtime)).toBe(1)

    const stopEventCount = harness.Events.length
    refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [earlyEnd],
    })
    expect(activeEarlyBlendOutCount(Runtime)).toBe(0)
    expect(harness.Events).toHaveLength(stopEventCount)
  })

  it('ticks a same-frame Begin but not a state whose End also crossed', () => {
    const Character = createAlsCharacter()
    Character.locomotionState.hasInput = true
    const harness = mantlingLifecycle(Character)
    const Runtime = createAlsMantlingNotifyRuntime()
    harness.ActiveMontageInstanceId = 0

    // UpdateActiveStateBranchingPoints processes Begin and End in marker
    // traversal order. BranchingPointNotifyTick sees only states still active
    // after that traversal.
    expect(refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [earlyBegin, earlyEnd],
    })).toBe(false)
    expect(activeEarlyBlendOutCount(Runtime)).toBe(0)
    expect(harness.Events).toEqual([])

    expect(refreshAlsMantlingNotifyRuntime(Runtime, {
      Character,
      MantlingMontage: harness.MantlingMontage,
      NotifyEvents: [earlyBegin],
    })).toBe(true)
    expect(harness.Events).toEqual([[
      'MontageInstance_Stop',
      0,
      0.35,
      true,
    ]])
  })
})

interface RagdollTestBody {
  readonly BoneName: string
  Location: { x: number; y: number; z: number }
  LinearVelocity: { x: number; y: number; z: number }
  bRigidBody: boolean
}

interface RagdollLifecycleHarness {
  readonly Events: unknown[]
  readonly Bodies: Map<string, RagdollTestBody>
  readonly Sweeps: AlsRagdollingGroundSweep[]
  readonly Lifecycle: AlsRagdollingLifecycleAdapter
  TargetLocation: { x: number; y: number; z: number }
  ActorLocation: { x: number; y: number; z: number }
  ActorRotation: { Pitch: number; Yaw: number; Roll: number }
  GroundHit: { Location: { x: number; y: number; z: number } } | null
  MontagePlayResult: number
}

function ragdollTestBody(Body: unknown): RagdollTestBody {
  return Body as RagdollTestBody
}

function copyTestVector(
  Vector: Readonly<{ x: number; y: number; z: number }>,
) {
  return { x: Vector.x, y: Vector.y, z: Vector.z }
}

function ragdollLifecycle(
  Character: AlsCharacter,
  options: {
    readonly PelvisLocation?: Readonly<{
      x: number
      y: number
      z: number
    }>
    readonly PelvisVelocity?: Readonly<{
      x: number
      y: number
      z: number
    }>
    readonly SpineLocation?: Readonly<{
      x: number
      y: number
      z: number
    }>
    readonly SpineVelocity?: Readonly<{
      x: number
      y: number
      z: number
    }>
    readonly TargetLocation?: Readonly<{
      x: number
      y: number
      z: number
    }>
    readonly GroundHitLocation?: Readonly<{
      x: number
      y: number
      z: number
    }> | null
    readonly PelvisRotation?: Readonly<{
      Pitch: number
      Yaw: number
      Roll: number
    }>
    readonly MontagePlayResult?: number
    readonly bParallelEvaluation?: boolean
    readonly BoneSpaceTransformCount?: number
  } = {},
): RagdollLifecycleHarness {
  const Events: unknown[] = []
  const Bodies = new Map<string, RagdollTestBody>([
    [ALS_RAGDOLLING_PELVIS_BONE_NAME, {
      BoneName: ALS_RAGDOLLING_PELVIS_BONE_NAME,
      Location: copyTestVector(
        options.PelvisLocation ?? { x: 1, y: 2, z: 3 },
      ),
      LinearVelocity: copyTestVector(
        options.PelvisVelocity ?? { x: 0, y: 0, z: 0 },
      ),
      bRigidBody: true,
    }],
    [ALS_RAGDOLLING_SPINE_03_BONE_NAME, {
      BoneName: ALS_RAGDOLLING_SPINE_03_BONE_NAME,
      Location: copyTestVector(
        options.SpineLocation ?? { x: 1, y: 2, z: 3.5 },
      ),
      LinearVelocity: copyTestVector(
        options.SpineVelocity ?? { x: 0, y: 0, z: 0 },
      ),
      bRigidBody: true,
    }],
  ])
  const Sweeps: AlsRagdollingGroundSweep[] = []
  const FinalRagdollPose = { Name: 'FinalRagdollPose' }
  const PelvisTransform = {
    Name: 'PelvisTransform',
    Rotation: {
      Pitch: options.PelvisRotation?.Pitch ?? 0,
      Yaw: options.PelvisRotation?.Yaw ?? 0,
      Roll: options.PelvisRotation?.Roll ?? 0,
    },
  }
  const CollisionResponses = { Name: 'CollisionResponses' }
  let harness: RagdollLifecycleHarness
  const Lifecycle: AlsRagdollingLifecycleAdapter = {
    GetBodyInstance(BoneName) {
      Events.push(['GetBodyInstance', BoneName])
      return Bodies.get(BoneName) ?? null
    },
    ReadBodyState(Body) {
      const body = ragdollTestBody(Body)
      Events.push(['ReadBodyState', body.BoneName])
      return {
        Location: copyTestVector(body.Location),
        LinearVelocity: copyTestVector(body.LinearVelocity),
      }
    },
    IsRigidBody(Body) {
      const body = ragdollTestBody(Body)
      Events.push(['IsRigidBody', body.BoneName])
      return body.bRigidBody
    },
    GetBodyLocation(Body) {
      const body = ragdollTestBody(Body)
      Events.push(['GetBodyLocation', body.BoneName])
      return copyTestVector(body.Location)
    },
    AddForce(Body, Force, bAccelChange, bAutoWake) {
      Events.push([
        'AddForce',
        ragdollTestBody(Body).BoneName,
        copyTestVector(Force),
        bAccelChange,
        bAutoWake,
      ])
    },
    SetBodyLinearVelocity(Body, Velocity) {
      const body = ragdollTestBody(Body)
      body.LinearVelocity = copyTestVector(Velocity)
      Events.push([
        'SetBodyLinearVelocity',
        body.BoneName,
        copyTestVector(Velocity),
      ])
    },
    ForEachBodyBelow(
      BoneName,
      bIncludeSelf,
      bSkipCustomPhysicsType,
      Visitor,
    ) {
      Events.push([
        'ForEachBodyBelow',
        BoneName,
        bIncludeSelf,
        bSkipCustomPhysicsType,
      ])
      for (const Body of Bodies.values()) Visitor(Body)
    },
    SetUpdateJointsFromAnimation(bEnabled) {
      Events.push(['SetUpdateJointsFromAnimation', bEnabled])
    },
    IsRunningParallelEvaluation() {
      Events.push('IsRunningParallelEvaluation')
      return options.bParallelEvaluation ?? false
    },
    GetBoneSpaceTransformCount() {
      Events.push('GetBoneSpaceTransformCount')
      return options.BoneSpaceTransformCount ?? 1
    },
    UpdateRBJointMotors() {
      Events.push('UpdateRBJointMotors')
    },
    Montage_Stop(BlendOutDuration) {
      Events.push(['Montage_Stop', BlendOutDuration])
    },
    Montage_Play(Montage) {
      Events.push([
        'Montage_Play',
        Montage,
        Character.locomotionAction,
        Character.movement.inputBlocked,
      ])
      return harness.MontagePlayResult
    },
    SetNetworkSmoothingMode(mode) {
      Events.push(['SetNetworkSmoothingMode', mode])
    },
    SetIgnoreClientMovementErrorChecksAndCorrection(bIgnored) {
      Events.push([
        'SetIgnoreClientMovementErrorChecksAndCorrection',
        bIgnored,
      ])
    },
    DetachMeshKeepWorld() {
      Events.push('DetachMeshKeepWorld')
    },
    AttachMeshToCapsuleKeepWorld() {
      Events.push('AttachMeshToCapsuleKeepWorld')
    },
    SetCapsuleCollisionEnabled(CollisionEnabled) {
      Events.push([
        'SetCapsuleCollisionEnabled',
        CollisionEnabled,
      ])
    },
    SetMeshCollisionObjectType(CollisionObjectType) {
      Events.push([
        'SetMeshCollisionObjectType',
        CollisionObjectType,
      ])
    },
    SetMeshCollisionEnabled(CollisionEnabled) {
      Events.push([
        'SetMeshCollisionEnabled',
        CollisionEnabled,
      ])
    },
    SetMeshSimulatePhysics(bSimulatePhysics) {
      Events.push([
        'SetMeshSimulatePhysics',
        bSimulatePhysics,
      ])
    },
    SetAllMotorsAngularDriveParams(
      AngularSpring,
      AngularDamping,
      ForceLimit,
    ) {
      Events.push([
        'SetAllMotorsAngularDriveParams',
        AngularSpring,
        AngularDamping,
        ForceLimit,
      ])
    },
    GetRagdollTargetLocation() {
      return copyTestVector(harness.TargetLocation)
    },
    SetRagdollTargetLocation(NewTargetLocation) {
      harness.TargetLocation = copyTestVector(NewTargetLocation)
      Events.push([
        'SetRagdollTargetLocation',
        copyTestVector(NewTargetLocation),
      ])
    },
    ServerSetRagdollTargetLocation(NewTargetLocation) {
      Events.push([
        'ServerSetRagdollTargetLocation',
        copyTestVector(NewTargetLocation),
      ])
    },
    GetActorLocation() {
      Events.push('GetActorLocation')
      return copyTestVector(harness.ActorLocation)
    },
    GetActorRotation() {
      Events.push('GetActorRotation')
      return { ...harness.ActorRotation }
    },
    SetActorLocationTeleport(NewActorLocation) {
      harness.ActorLocation = copyTestVector(NewActorLocation)
      Events.push([
        'SetActorLocationTeleport',
        copyTestVector(NewActorLocation),
      ])
    },
    SetActorLocationAndRotationTeleport(
      NewActorLocation,
      NewActorRotation,
    ) {
      harness.ActorLocation = copyTestVector(NewActorLocation)
      harness.ActorRotation = { ...NewActorRotation }
      Events.push([
        'SetActorLocationAndRotationTeleport',
        copyTestVector(NewActorLocation),
        { ...NewActorRotation },
      ])
    },
    GetScaledCapsuleRadius() {
      Events.push('GetScaledCapsuleRadius')
      return 0.5
    },
    GetScaledCapsuleHalfHeight() {
      Events.push('GetScaledCapsuleHalfHeight')
      return 1
    },
    GetMovementCollisionObjectType() {
      Events.push('GetMovementCollisionObjectType')
      return 'PawnChannel'
    },
    InitCollisionParams(QueryParameters) {
      Events.push(['InitCollisionParams', QueryParameters])
      return CollisionResponses
    },
    SweepSingleByChannel(Sweep) {
      Sweeps.push(Sweep)
      Events.push('SweepSingleByChannel')
      return harness.GroundHit
    },
    SetMovementMode(MovementMode) {
      Events.push([
        'SetMovementMode',
        MovementMode,
        Character.locomotionMode,
        Character.locomotionAction,
      ])
    },
    SetMovementModeLocked(bLocked) {
      Events.push([
        'SetMovementModeLocked',
        bLocked,
        Character.locomotionMode,
        Character.locomotionAction,
      ])
    },
    SnapshotFinalRagdollPose() {
      Events.push('SnapshotFinalRagdollPose')
      return FinalRagdollPose
    },
    GetPelvisSocketTransform() {
      Events.push('GetPelvisSocketTransform')
      return PelvisTransform
    },
    GetTransformRotation(Transform) {
      Events.push('GetTransformRotation')
      return (Transform as typeof PelvisTransform).Rotation
    },
    RestoreMeshWorldTransformFromActorBaseOffsets() {
      Events.push(
        'RestoreMeshWorldTransformFromActorBaseOffsets',
      )
    },
    RefreshUpdateRateOptimizationsAfterRagdolling() {
      Events.push(
        'RefreshUpdateRateOptimizationsAfterRagdolling',
      )
    },
    RestoreFinalRagdollPosePelvisTransform(
      Pose,
      Transform,
    ) {
      Events.push([
        'RestoreFinalRagdollPosePelvisTransform',
        Pose === FinalRagdollPose,
        Transform === PelvisTransform,
      ])
    },
    FlushServerMoves() {
      Events.push('FlushServerMoves')
    },
    ServerStartRagdolling() {
      Events.push('ServerStartRagdolling')
    },
    MulticastStartRagdolling() {
      Events.push('MulticastStartRagdolling')
    },
    ServerStopRagdolling() {
      Events.push('ServerStopRagdolling')
    },
    MulticastStopRagdolling() {
      Events.push('MulticastStopRagdolling')
    },
    ForceNetUpdate() {
      Events.push('ForceNetUpdate')
    },
    OnRagdollingStarted() {
      Events.push([
        'OnRagdollingStarted',
        Character.locomotionMode,
        Character.locomotionAction,
      ])
    },
    OnRagdollingEnded() {
      Events.push([
        'OnRagdollingEnded',
        Character.locomotionMode,
        Character.locomotionAction,
        Character.movement.inputBlocked,
      ])
    },
  }
  harness = {
    Events,
    Bodies,
    Sweeps,
    Lifecycle,
    TargetLocation: copyTestVector(
      options.TargetLocation ?? { x: 0, y: 0, z: 0 },
    ),
    ActorLocation: { x: 10, y: 20, z: 30 },
    ActorRotation: { Pitch: 7, Yaw: 11, Roll: 9 },
    GroundHit: options.GroundHitLocation === null
      ? null
      : {
          Location: copyTestVector(
            options.GroundHitLocation ?? { x: 0, y: 0, z: 0 },
          ),
        },
    MontagePlayResult: options.MontagePlayResult ?? 1,
  }
  return harness
}

function ragdollInput(
  Character: AlsCharacter,
  harness: RagdollLifecycleHarness,
  options: {
    readonly LocalRole?: 'None'
      | 'SimulatedProxy'
      | 'AutonomousProxy'
      | 'Authority'
    readonly bIsLocallyControlled?: boolean
    readonly bHasValidController?: boolean
  } = {},
) {
  return {
    Character,
    Lifecycle: harness.Lifecycle,
    LocalRole: options.LocalRole ?? 'Authority',
    bIsLocallyControlled:
      options.bIsLocallyControlled ?? false,
    bHasValidController:
      options.bHasValidController ?? true,
  } as const
}

interface PhysicsAssetOracle {
  readonly schemaVersion: number
  readonly bodies: readonly {
    readonly boneName: string
  }[]
  readonly asset?: {
    readonly bodies?: readonly unknown[]
  }
}

// ALS Refactored 4.15:
// Source/ALS/Private/AlsCharacter_Actions.cpp:680-1126.
describe('AAlsCharacter ragdoll lifecycle', () => {
  it('uses PA_Als body names and preserves local RPC role routing', () => {
    const oracle = JSON.parse(
      physicsAssetSource,
    ) as PhysicsAssetOracle
    const bodies = (
      oracle.bodies
      ?? oracle.asset?.bodies
      ?? []
    ) as readonly { readonly boneName: string }[]
    expect(oracle.schemaVersion).toBe(1)
    expect(bodies).toHaveLength(21)
    expect(bodies.map(({ boneName }) => boneName)).toEqual(
      expect.arrayContaining([
        ALS_RAGDOLLING_PELVIS_BONE_NAME,
        ALS_RAGDOLLING_SPINE_03_BONE_NAME,
      ]),
    )

    const Character = createAlsCharacter()
    const authority = ragdollLifecycle(Character)
    expect(startRagdolling(ragdollInput(
      Character,
      authority,
    ))).toBe(true)
    expect(authority.Events).toEqual([
      ['GetBodyInstance', 'pelvis'],
      ['GetBodyInstance', 'spine_03'],
      'MulticastStartRagdolling',
    ])

    const autonomous = ragdollLifecycle(Character)
    expect(startRagdolling(ragdollInput(
      Character,
      autonomous,
      { LocalRole: 'AutonomousProxy' },
    ))).toBe(true)
    expect(autonomous.Events).toEqual([
      ['GetBodyInstance', 'pelvis'],
      ['GetBodyInstance', 'spine_03'],
      'FlushServerMoves',
      'ServerStartRagdolling',
    ])

    const simulated = ragdollLifecycle(Character)
    expect(startRagdolling(ragdollInput(
      Character,
      simulated,
      { LocalRole: 'SimulatedProxy' },
    ))).toBe(false)
    expect(simulated.Events).toEqual([])

    const missing = ragdollLifecycle(Character)
    missing.Bodies.delete('spine_03')
    expect(isRagdollingAllowedToStart(
      Character,
      missing.Lifecycle,
    )).toBe(false)
    expect(missing.Events).toEqual([
      ['GetBodyInstance', 'pelvis'],
      ['GetBodyInstance', 'spine_03'],
    ])
  })

  it('starts physics in ALS order and installs the eight-frame speed limit', () => {
    const Character = createAlsCharacter({
      locomotionMode: 'InAir',
      velocity: { x: 3, y: 4, z: 0 },
    })
    const harness = ragdollLifecycle(Character, {
      PelvisVelocity: { x: 0, y: 0, z: 12 },
      TargetLocation: { x: 9, y: 9, z: 9 },
    })

    expect(startRagdollingImplementation(ragdollInput(
      Character,
      harness,
    ))).toBe(true)
    expect(Character.ragdollingState).toEqual({
      Velocity: { x: 0, y: 0, z: 12 },
      PullForce: 0,
      SpeedLimitFrameTimeRemaining: 8,
      SpeedLimit: 5,
    })
    expect(
      harness.Bodies.get('pelvis')?.LinearVelocity,
    ).toEqual({ x: 0, y: 0, z: 5 })
    expect(Character.locomotionMode).toBeNull()
    expect(Character.locomotionAction).toBe('Ragdolling')
    expect(harness.Events).toEqual([
      ['GetBodyInstance', 'pelvis'],
      ['GetBodyInstance', 'spine_03'],
      ['SetUpdateJointsFromAnimation', true],
      'IsRunningParallelEvaluation',
      'GetBoneSpaceTransformCount',
      'UpdateRBJointMotors',
      ['Montage_Stop', 0.2],
      ['SetNetworkSmoothingMode', 'Disabled'],
      [
        'SetIgnoreClientMovementErrorChecksAndCorrection',
        true,
      ],
      'DetachMeshKeepWorld',
      ['SetCapsuleCollisionEnabled', 'NoCollision'],
      ['SetMeshCollisionObjectType', 'PhysicsBody'],
      ['SetMeshCollisionEnabled', 'QueryAndPhysics'],
      ['SetMeshSimulatePhysics', true],
      ['GetBodyInstance', 'pelvis'],
      ['ReadBodyState', 'pelvis'],
      ['ForEachBodyBelow', null, true, false],
      ['IsRigidBody', 'pelvis'],
      ['ReadBodyState', 'pelvis'],
      [
        'SetBodyLinearVelocity',
        'pelvis',
        { x: 0, y: 0, z: 5 },
      ],
      ['IsRigidBody', 'spine_03'],
      ['ReadBodyState', 'spine_03'],
      [
        'SetRagdollTargetLocation',
        { x: 0, y: 0, z: 0 },
      ],
      ['SetMovementMode', 'None', 'InAir', null],
      ['SetMovementModeLocked', true, null, null],
      [
        'OnRagdollingStarted',
        null,
        'Ragdolling',
      ],
    ])

    const stopped = createAlsCharacter()
    const stoppedHarness = ragdollLifecycle(stopped)
    startRagdollingImplementation(ragdollInput(
      stopped,
      stoppedHarness,
    ))
    expect(stopped.ragdollingState.SpeedLimit).toBe(2)
  })

  it('assigns target ownership to authority, owner, and proxy exactly', () => {
    const controlledAuthority = createAlsCharacter()
    const controlledHarness = ragdollLifecycle(
      controlledAuthority,
      {
        PelvisLocation: { x: 4, y: 5, z: 6 },
        TargetLocation: { x: 8, y: 8, z: 8 },
      },
    )
    startRagdollingImplementation(ragdollInput(
      controlledAuthority,
      controlledHarness,
    ))
    expect(controlledHarness.Events.filter(
      (event) => Array.isArray(event)
        && event[0] === 'SetRagdollTargetLocation',
    )).toEqual([[
      'SetRagdollTargetLocation',
      { x: 0, y: 0, z: 0 },
    ]])

    const listenServer = createAlsCharacter()
    const listenHarness = ragdollLifecycle(listenServer, {
      PelvisLocation: { x: 4, y: 5, z: 6 },
      TargetLocation: { x: 8, y: 8, z: 8 },
    })
    startRagdollingImplementation(ragdollInput(
      listenServer,
      listenHarness,
      { bHasValidController: false },
    ))
    expect(listenHarness.Events.filter(
      (event) => Array.isArray(event)
        && event[0] === 'SetRagdollTargetLocation',
    )).toEqual([
      [
        'SetRagdollTargetLocation',
        { x: 0, y: 0, z: 0 },
      ],
      [
        'SetRagdollTargetLocation',
        { x: 4, y: 5, z: 6 },
      ],
    ])

    const owner = createAlsCharacter()
    const ownerHarness = ragdollLifecycle(owner, {
      PelvisLocation: { x: 4, y: 5, z: 6 },
    })
    startRagdollingImplementation(ragdollInput(
      owner,
      ownerHarness,
      {
        LocalRole: 'AutonomousProxy',
        bIsLocallyControlled: true,
      },
    ))
    expect(ownerHarness.Events.filter(
      (event) => Array.isArray(event)
        && (
          event[0] === 'SetRagdollTargetLocation'
          || event[0] === 'ServerSetRagdollTargetLocation'
        ),
    )).toEqual([
      [
        'SetRagdollTargetLocation',
        { x: 4, y: 5, z: 6 },
      ],
      [
        'ServerSetRagdollTargetLocation',
        { x: 4, y: 5, z: 6 },
      ],
    ])

    const simulated = createAlsCharacter()
    const simulatedHarness = ragdollLifecycle(simulated, {
      TargetLocation: { x: 7, y: 8, z: 9 },
    })
    startRagdollingImplementation(ragdollInput(
      simulated,
      simulatedHarness,
      { LocalRole: 'SimulatedProxy' },
    ))
    expect(simulatedHarness.TargetLocation).toEqual({
      x: 7,
      y: 8,
      z: 9,
    })
  })

  it('selects, interpolates, and clamps remote correction force', () => {
    const Character = createAlsCharacter()
    setLocomotionAction(Character, 'Ragdolling')
    const harness = ragdollLifecycle(Character, {
      PelvisVelocity: { x: 4, y: 0, z: 0 },
      SpineLocation: { x: 0, y: 0, z: 0 },
      TargetLocation: { x: 2, y: 0, z: 0 },
      GroundHitLocation: null,
    })

    expect(refreshRagdolling({
      ...ragdollInput(
        Character,
        harness,
        { LocalRole: 'SimulatedProxy' },
      ),
      DeltaTime: 0.5,
    })).toBe(true)
    expect(Character.ragdollingState.PullForce).toBe(225)
    expect(harness.Events).toContainEqual([
      'AddForce',
      'spine_03',
      { x: 112.5, y: 0, z: 0 },
      true,
      true,
    ])
    expect(harness.Events).toContainEqual([
      'SetAllMotorsAngularDriveParams',
      10_000,
      0,
      0,
    ])

    harness.Events.length = 0
    harness.Bodies.get('pelvis')!.LinearVelocity = {
      x: 3,
      y: 0,
      z: 0,
    }
    harness.Bodies.get('pelvis')!.Location = {
      x: 1.96,
      y: 0,
      z: 0,
    }
    harness.TargetLocation = { x: 2, y: 0, z: 0 }
    refreshRagdolling({
      ...ragdollInput(
        Character,
        harness,
        { LocalRole: 'SimulatedProxy' },
      ),
      DeltaTime: 100,
    })
    expect(Character.ragdollingState.PullForce).toBe(750)
    expect(harness.Events).toContainEqual([
      'GetBodyInstance',
      'pelvis',
    ])
    expect(harness.Events.some(
      (event) => Array.isArray(event)
        && event[0] === 'AddForce',
    )).toBe(false)
  })

  it('applies stiffness and speed constraints for exactly eight refreshes', () => {
    const Character = createAlsCharacter()
    setLocomotionAction(Character, 'Ragdolling')
    Character.ragdollingState.SpeedLimit = 2
    Character.ragdollingState.SpeedLimitFrameTimeRemaining = 8
    const harness = ragdollLifecycle(Character, {
      PelvisVelocity: { x: 0, y: 0, z: 20 },
      TargetLocation: { x: 0, y: 0, z: 0 },
      GroundHitLocation: null,
    })

    for (let frame = 0; frame < 9; frame += 1) {
      harness.Bodies.get('pelvis')!.LinearVelocity = {
        x: 0,
        y: 0,
        z: 20,
      }
      refreshRagdolling({
        ...ragdollInput(Character, harness, {
          bIsLocallyControlled: true,
        }),
        DeltaTime: 1 / 60,
      })
    }

    expect(
      Character.ragdollingState.SpeedLimitFrameTimeRemaining,
    ).toBe(0)
    expect(harness.Events.filter(
      (event) => Array.isArray(event)
        && event[0] === 'ForEachBodyBelow',
    )).toHaveLength(8)
    expect(harness.Events.filter(
      (event) => Array.isArray(event)
        && event[0] === 'SetAllMotorsAngularDriveParams',
    )[0]).toEqual([
      'SetAllMotorsAngularDriveParams',
      25_000,
      0,
      0,
    ])
  })

  it('uses target-centered sphere geometry and MIN_FLOOR_DIST', () => {
    const Character = createAlsCharacter()
    const harness = ragdollLifecycle(Character, {
      TargetLocation: { x: 1, y: 2, z: 3 },
      GroundHitLocation: { x: 1, y: 2, z: 0.2 },
    })
    const result = ragdollTraceGround(ragdollInput(
      Character,
      harness,
    ))

    expect(harness.Sweeps).toEqual([{
      Start: { x: 1, y: 2, z: 4 },
      End: { x: 1, y: 2, z: 2.5 },
      Rotation: { x: 0, y: 0, z: 0, w: 1 },
      Radius: 0.5,
      CollisionChannel: 'PawnChannel',
      QueryParameters: {
        TraceTag: 'RagdollTraceGround',
        bTraceComplex: false,
        bIgnoreOwningActor: true,
      },
      CollisionResponses: { Name: 'CollisionResponses' },
    }])
    expect(result).toEqual({
      bGrounded: true,
      Location: { x: 1, y: 2, z: 0.719 },
    })

    harness.TargetLocation = { x: 0, y: 0, z: 0 }
    harness.GroundHit = null
    harness.Events.length = 0
    expect(ragdollTraceGround(ragdollInput(
      Character,
      harness,
    ))).toEqual({
      bGrounded: false,
      Location: { x: 10, y: 20, z: 30 },
    })
    expect(harness.Events[0]).toBe('GetActorLocation')
  })

  it('constrains only rigid bodies above the total 3D speed limit', () => {
    const Character = createAlsCharacter()
    Character.ragdollingState.SpeedLimit = 6.5
    const harness = ragdollLifecycle(Character, {
      PelvisVelocity: { x: 3, y: 4, z: 12 },
      SpineVelocity: { x: 0, y: 6.5, z: 0 },
    })
    const skipped = {
      BoneName: 'hand_l',
      Location: { x: 0, y: 0, z: 0 },
      LinearVelocity: { x: 20, y: 0, z: 0 },
      bRigidBody: false,
    }
    harness.Bodies.set(skipped.BoneName, skipped)

    constraintRagdollSpeed(Character, harness.Lifecycle)
    expect(
      Math.hypot(
        ...Object.values(
          harness.Bodies.get('pelvis')!.LinearVelocity,
        ),
      ),
    ).toBeCloseTo(6.5, 12)
    expect(harness.Bodies.get('spine_03')!.LinearVelocity)
      .toEqual({ x: 0, y: 6.5, z: 0 })
    expect(skipped.LinearVelocity).toEqual({ x: 20, y: 0, z: 0 })
  })

  it('restores grounded pose before playing the upward get-up montage', () => {
    const Character = createAlsCharacter({
      locomotionMode: 'InAir',
    })
    setLocomotionMode(Character, null)
    setLocomotionAction(Character, 'Ragdolling')
    Character.movement.inputBlocked = true
    const harness = ragdollLifecycle(Character, {
      TargetLocation: { x: 1, y: 2, z: 3 },
      GroundHitLocation: { x: 1, y: 2, z: 0.2 },
      PelvisRotation: { Pitch: 1, Yaw: 50, Roll: 350 },
      MontagePlayResult: 1.2,
    })

    expect(stopRagdollingImplementation(ragdollInput(
      Character,
      harness,
    ))).toEqual({
      bGrounded: true,
      bRagdollFacingUpward: true,
      bStartedGettingUp: true,
    })
    expect(harness.ActorLocation).toEqual({
      x: 1,
      y: 2,
      z: 0.719,
    })
    expect(harness.ActorRotation).toEqual({
      Pitch: 7,
      Yaw: -130,
      Roll: 9,
    })
    expect(Character.locomotionMode).toBe('Grounded')
    expect(Character.locomotionAction).toBe('GettingUp')
    expect(Character.movement.inputBlocked).toBe(true)

    const names = harness.Events.map(
      (event) => Array.isArray(event) ? event[0] : event,
    )
    expect(names).toEqual([
      'SnapshotFinalRagdollPose',
      'GetPelvisSocketTransform',
      'GetTransformRotation',
      'SetUpdateJointsFromAnimation',
      'SetMeshSimulatePhysics',
      'SetMeshCollisionEnabled',
      'SetMeshCollisionObjectType',
      'SetCapsuleCollisionEnabled',
      'SetNetworkSmoothingMode',
      'SetIgnoreClientMovementErrorChecksAndCorrection',
      'GetScaledCapsuleRadius',
      'GetScaledCapsuleHalfHeight',
      'GetMovementCollisionObjectType',
      'InitCollisionParams',
      'SweepSingleByChannel',
      'GetActorRotation',
      'SetActorLocationAndRotationTeleport',
      'RestoreMeshWorldTransformFromActorBaseOffsets',
      'AttachMeshToCapsuleKeepWorld',
      'RefreshUpdateRateOptimizationsAfterRagdolling',
      'RestoreFinalRagdollPosePelvisTransform',
      'SetMovementModeLocked',
      'SetMovementMode',
      'OnRagdollingEnded',
      'Montage_Play',
    ])
    expect(harness.Events).toContainEqual([
      'RestoreFinalRagdollPosePelvisTransform',
      true,
      true,
    ])
    expect(harness.Events).toContainEqual([
      'OnRagdollingEnded',
      'Grounded',
      null,
      false,
    ])
    expect(harness.Events.at(-1)).toEqual([
      'Montage_Play',
      'AM_Als_GetUp_Back',
      null,
      false,
    ])
  })

  it('leaves get-up unowned when Montage_Play fails', () => {
    const Character = createAlsCharacter()
    setLocomotionMode(Character, null)
    setLocomotionAction(Character, 'Ragdolling')
    Character.movement.inputBlocked = true
    const harness = ragdollLifecycle(Character, {
      TargetLocation: { x: 1, y: 2, z: 3 },
      PelvisRotation: { Pitch: 0, Yaw: 80, Roll: 10 },
      MontagePlayResult: 0,
    })

    expect(stopRagdollingImplementation(ragdollInput(
      Character,
      harness,
    ))).toEqual({
      bGrounded: true,
      bRagdollFacingUpward: false,
      bStartedGettingUp: false,
    })
    expect(harness.ActorRotation.Yaw).toBe(80)
    expect(harness.Events.at(-1)).toEqual([
      'Montage_Play',
      'AM_Als_GetUp_Front',
      null,
      false,
    ])
    expect(Character.locomotionAction).toBeNull()
    expect(Character.movement.inputBlocked).toBe(false)
  })

  it('hands the last pelvis velocity to Falling without get-up', () => {
    const Character = createAlsCharacter()
    setLocomotionMode(Character, null)
    setLocomotionAction(Character, 'Ragdolling')
    Character.ragdollingState.Velocity = {
      x: 1,
      y: 2,
      z: -3,
    }
    const harness = ragdollLifecycle(Character, {
      TargetLocation: { x: 1, y: 2, z: 3 },
      GroundHitLocation: null,
    })

    expect(stopRagdollingImplementation(ragdollInput(
      Character,
      harness,
    ))).toEqual({
      bGrounded: false,
      bRagdollFacingUpward: true,
      bStartedGettingUp: false,
    })
    expect(Character.locomotionMode).toBe('InAir')
    expect(Character.movement.velocity).toEqual({
      x: 1,
      y: 2,
      z: -3,
    })
    expect(Character.locomotionAction).toBeNull()
    expect(harness.Events.some(
      (event) => Array.isArray(event)
        && event[0] === 'Montage_Play',
    )).toBe(false)
  })

  it('preserves stop and server RPC role behavior', () => {
    const Character = createAlsCharacter()
    setLocomotionAction(Character, 'Ragdolling')

    const simulated = ragdollLifecycle(Character)
    expect(stopRagdolling(ragdollInput(
      Character,
      simulated,
      { LocalRole: 'SimulatedProxy' },
    ))).toBe(false)
    expect(simulated.Events).toEqual([])

    const authority = ragdollLifecycle(Character)
    expect(stopRagdolling(ragdollInput(
      Character,
      authority,
    ))).toBe(true)
    expect(authority.Events).toEqual([
      'MulticastStopRagdolling',
    ])

    const autonomous = ragdollLifecycle(Character)
    expect(stopRagdolling(ragdollInput(
      Character,
      autonomous,
      { LocalRole: 'AutonomousProxy' },
    ))).toBe(true)
    expect(autonomous.Events).toEqual([
      'ServerStopRagdolling',
    ])

    const server = ragdollLifecycle(Character)
    expect(serverStopRagdolling(ragdollInput(
      Character,
      server,
    ))).toBe(true)
    expect(server.Events).toEqual([
      'MulticastStopRagdolling',
      'ForceNetUpdate',
    ])

    setLocomotionAction(Character, null)
    const startServer = ragdollLifecycle(Character)
    expect(serverStartRagdolling(ragdollInput(
      Character,
      startServer,
    ))).toBe(true)
    expect(startServer.Events).toEqual([
      ['GetBodyInstance', 'pelvis'],
      ['GetBodyInstance', 'spine_03'],
      'MulticastStartRagdolling',
      'ForceNetUpdate',
    ])
    expect(isRagdollingAllowedToStop(Character)).toBe(false)
    expect(setRagdollTargetLocation(
      ragdollInput(
        Character,
        startServer,
        { LocalRole: 'AutonomousProxy' },
      ),
      { x: 0, y: 0, z: 0 },
    )).toBe(false)
  })
})
