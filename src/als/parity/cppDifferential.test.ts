import { describe, expect, it } from 'vitest'
import {
  ExponentialDecay,
  GetRelativeAccelerationAmount,
  PlayQuickStopAnimation,
  ProcessFootLockBaseChange,
  ProcessFootLockTeleport,
  RefreshFootLock,
  RefreshGroundedLean,
  RefreshGroundPrediction,
  RefreshInAirLean,
  RefreshLook,
  RefreshPose as RefreshPoseReference,
  RefreshRotateInPlace as RefreshRotateInPlaceReference,
  RefreshSpine,
  RefreshTurnInPlace as RefreshTurnInPlaceReference,
  RefreshVelocityBlend as RefreshVelocityBlendReference,
} from '../reference/AlsAnimationInstance.reference'
import type {
  FAlsFootState,
  FAlsGeneralTurnInPlaceSettings,
  FAlsMovementBaseState,
  FQuat4f,
  FTransform3f,
  FAlsTurnInPlaceClipSettings,
  FAlsVelocityBlendState,
  FVector3f,
} from '../reference/AlsAnimationInstance.reference'
import {
  getRelativeAccelerationAmount,
  refreshPose,
  refreshRotateInPlace,
  refreshTurnInPlace,
  refreshVelocityBlend,
} from '../AlsAnimationInstance'
import { playQuickStopAnimation } from '../AnimGraph/quickStop'
import { ALS_ROTATE_IN_PLACE_SETTINGS } from '../Settings/AlsRotateInPlaceSettings'
import { ALS_TURN_IN_PLACE_SETTINGS } from '../Settings/AlsTurnInPlaceSettings'
import type {
  AlsTurnInPlaceClipSettings,
} from '../Settings/AlsTurnInPlaceSettings'
import {
  createAlsRotateInPlaceState,
} from '../State/AlsRotateInPlaceState'
import {
  createAlsTurnInPlaceState,
  resetTurnInPlaceFrame,
} from '../State/AlsTurnInPlaceState'
import {
  createVelocityBlend,
  exponentialDecay,
} from '../State/AlsGroundedState'
import {
  createAlsLeanState,
  refreshGroundedLean,
  refreshInAirLean,
} from '../State/AlsLeanState'
import {
  createAlsLookState,
  refreshLook,
} from '../State/AlsLookState'
import {
  createAlsSpineState,
  refreshSpine,
} from '../State/AlsSpineState'
import {
  createAlsInAirState,
  refreshGroundPrediction,
} from '../State/AlsInAirState'
import {
  createAlsFootState,
  processFootLockBaseChange,
  processFootLockTeleport,
  refreshFootLock,
} from '../State/AlsFeetState'
import type {
  AlsFootLockMovementBase,
  AlsFootState,
  AlsQuaternion,
  AlsTransform,
} from '../State/AlsFeetState'
import {
  ALS_PARITY_DELTA_REPORT,
} from './deltaReport'

const PROPERTY_CASES = 320
const EPSILON = 1e-4

function seededRandom(seed = 0x41_4c_53_15) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_00_00_00_00
  }
}

function range(random: () => number, minimum: number, maximum: number) {
  return minimum + (maximum - minimum) * random()
}

function yawQuaternion(yawRadians: number) {
  const half = yawRadians * 0.5
  return { X: 0, Y: 0, Z: Math.sin(half), W: Math.cos(half) }
}

function expectClose(actual: number, expected: number, epsilon = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon)
}

function footYawQuaternion(yawDegrees: number): AlsQuaternion {
  const half = yawDegrees * Math.PI / 360
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }
}

function referenceFootVector(
  value: { readonly x: number; readonly y: number; readonly z: number },
  scale = 100,
): FVector3f {
  return { X: value.x * scale, Y: value.y * scale, Z: value.z * scale }
}

function referenceFootQuaternion(value: Readonly<AlsQuaternion>): FQuat4f {
  return { X: value.x, Y: value.y, Z: value.z, W: value.w }
}

function referenceFootTransform(value: AlsTransform): FTransform3f {
  return {
    Location: referenceFootVector(value.location),
    Rotation: referenceFootQuaternion(value.rotation),
  }
}

function referenceFootMovementBase(
  value: AlsFootLockMovementBase,
): FAlsMovementBaseState {
  return {
    bHasRelativeLocation: value.hasRelativeLocation,
    bHasRelativeRotation: false,
    Location: referenceFootVector(value.location),
    Rotation: referenceFootQuaternion(value.rotation),
    DeltaRotationYaw: 0,
  }
}

function referenceFootState(value: AlsFootState): FAlsFootState {
  return {
    ThighAxis: referenceFootVector(value.thighAxis, 1),
    LockAmount: value.lockAmount,
    TargetLocation: referenceFootVector(value.targetLocation),
    TargetRotation: referenceFootQuaternion(value.targetRotation),
    LockLocation: referenceFootVector(value.lockLocation),
    LockRotation: referenceFootQuaternion(value.lockRotation),
    LockComponentRelativeLocation:
      referenceFootVector(value.lockComponentRelativeLocation),
    LockComponentRelativeRotation:
      referenceFootQuaternion(value.lockComponentRelativeRotation),
    LockMovementBaseRelativeLocation:
      referenceFootVector(value.lockMovementBaseRelativeLocation),
    LockMovementBaseRelativeRotation:
      referenceFootQuaternion(value.lockMovementBaseRelativeRotation),
    FinalLocation: referenceFootVector(value.finalLocation),
    FinalRotation: referenceFootQuaternion(value.finalRotation),
  }
}

function expectFootStateToMatchReference(
  actual: AlsFootState,
  expected: FAlsFootState,
): void {
  expectClose(actual.lockAmount, expected.LockAmount)
  for (const [runtime, reference, scale] of [
    [actual.thighAxis, expected.ThighAxis, 1],
    [actual.targetLocation, expected.TargetLocation, 100],
    [actual.lockLocation, expected.LockLocation, 100],
    [
      actual.lockComponentRelativeLocation,
      expected.LockComponentRelativeLocation,
      100,
    ],
    [
      actual.lockMovementBaseRelativeLocation,
      expected.LockMovementBaseRelativeLocation,
      100,
    ],
    [actual.finalLocation, expected.FinalLocation, 100],
  ] as const) {
    expectClose(runtime.x * scale, reference.X)
    expectClose(runtime.y * scale, reference.Y)
    expectClose(runtime.z * scale, reference.Z)
  }
  for (const [runtime, reference] of [
    [actual.targetRotation, expected.TargetRotation],
    [actual.lockRotation, expected.LockRotation],
    [
      actual.lockComponentRelativeRotation,
      expected.LockComponentRelativeRotation,
    ],
    [
      actual.lockMovementBaseRelativeRotation,
      expected.LockMovementBaseRelativeRotation,
    ],
    [actual.finalRotation, expected.FinalRotation],
  ] as const) {
    expectClose(runtime.x, reference.X)
    expectClose(runtime.y, reference.Y)
    expectClose(runtime.z, reference.Z)
    expectClose(runtime.w, reference.W)
  }
}

function referenceVelocityState(
  state: ReturnType<typeof createVelocityBlend>,
  initialize: boolean,
): FAlsVelocityBlendState {
  return {
    bInitializationRequired: initialize,
    ForwardAmount: state.forwardAmount,
    BackwardAmount: state.backwardAmount,
    LeftAmount: state.leftAmount,
    RightAmount: state.rightAmount,
  }
}

function referenceLeanState(state: ReturnType<typeof createAlsLeanState>) {
  return {
    RightAmount: state.rightAmount,
    ForwardAmount: state.forwardAmount,
  }
}

function referenceLookState(state: ReturnType<typeof createAlsLookState>) {
  return {
    bInitializationRequired: state.initializationRequired,
    WorldYawAngle: state.worldYawAngle,
    YawAngle: state.yawAngle,
    PitchAngle: state.pitchAngle,
    YawForwardAmount: state.yawForwardAmount,
    YawLeftAmount: state.yawLeftAmount,
    YawRightAmount: state.yawRightAmount,
  }
}

function referenceSpineState(state: ReturnType<typeof createAlsSpineState>) {
  return {
    bSpineRotationAllowed: state.spineRotationAllowed,
    SpineAmount: state.spineAmount,
    SpineAmountScale: state.spineAmountScale,
    SpineAmountBias: state.spineAmountBias,
    LastYawAngle: state.lastYawAngle,
    LastActorYawAngle: state.lastActorYawAngle,
    CurrentYawAngle: state.currentYawAngle,
    YawAngle: state.yawAngle,
  }
}

function referenceTurnClip(
  settings: AlsTurnInPlaceClipSettings,
): FAlsTurnInPlaceClipSettings {
  return {
    clip: settings.clip,
    PlayRate: settings.playRate,
    bScalePlayRateByAnimatedTurnAngle:
      settings.scalePlayRateByAnimatedTurnAngle,
    AnimatedTurnAngle: settings.animatedTurnAngle,
  }
}

function referenceTurnSettings(): FAlsGeneralTurnInPlaceSettings {
  return {
    ViewYawAngleThreshold: ALS_TURN_IN_PLACE_SETTINGS.viewYawAngleThreshold,
    ViewYawSpeedThreshold: ALS_TURN_IN_PLACE_SETTINGS.viewYawSpeedThreshold,
    ViewYawAngleToActivationDelay:
      ALS_TURN_IN_PLACE_SETTINGS.viewYawAngleToActivationDelay,
    Turn180AngleThreshold: ALS_TURN_IN_PLACE_SETTINGS.turn180AngleThreshold,
    clips: {
      Standing: {
        90: {
          Left: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Standing[90].Left,
          ),
          Right: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Standing[90].Right,
          ),
        },
        180: {
          Left: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Standing[180].Left,
          ),
          Right: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Standing[180].Right,
          ),
        },
      },
      Crouching: {
        90: {
          Left: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Crouching[90].Left,
          ),
          Right: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Crouching[90].Right,
          ),
        },
        180: {
          Left: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Crouching[180].Left,
          ),
          Right: referenceTurnClip(
            ALS_TURN_IN_PLACE_SETTINGS.clips.Crouching[180].Right,
          ),
        },
      },
    },
  }
}

describe('ALS C++ differential oracle', () => {
  it(`RefreshVelocityBlend target/snap path matches for ${PROPERTY_CASES} seeded cases`, () => {
    const random = seededRandom()
    const edges = [
      { yaw: 0, velocity: { x: 0, y: 0, z: 0 } },
      { yaw: Math.PI, velocity: { x: 1, y: 0, z: 0 } },
      { yaw: -Math.PI, velocity: { x: 0, y: 1, z: 0 } },
      { yaw: Math.PI / 4, velocity: { x: 1, y: 1, z: 1 } },
    ]

    for (let index = 0; index < PROPERTY_CASES; index++) {
      const edge = edges[index] 
      const yaw = edge?.yaw ?? range(random, -Math.PI, Math.PI)
      const velocity = edge?.velocity ?? {
        x: range(random, -1000, 1000),
        y: range(random, -1000, 1000),
        z: range(random, -1000, 1000),
      }
      const runtime = createVelocityBlend()
      const reference = referenceVelocityState(runtime, true)

      refreshVelocityBlend(runtime, velocity, yaw, index === 0 ? 0 : 1 / 60, true)
      RefreshVelocityBlendReference({
        VelocityBlend: reference,
        RotationQuaternion: yawQuaternion(yaw),
        Velocity: { X: velocity.x, Y: velocity.y, Z: velocity.z },
        DeltaTime: index === 0 ? 0 : 1 / 60,
        VelocityBlendInterpolationSpeed: 12,
      })

      expectClose(runtime.forwardAmount, reference.ForwardAmount)
      expectClose(runtime.backwardAmount, reference.BackwardAmount)
      expectClose(runtime.leftAmount, reference.LeftAmount)
      expectClose(runtime.rightAmount, reference.RightAmount)
    }
  })

  it(`RefreshVelocityBlend damped path matches for ${PROPERTY_CASES} seeded cases`, () => {
    const random = seededRandom(0xdecafbad)
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const yaw = range(random, -Math.PI, Math.PI)
      const velocity = {
        x: range(random, -1000, 1000),
        y: range(random, -1000, 1000),
        z: range(random, -1000, 1000),
      }
      const runtime = {
        forwardAmount: random(),
        backwardAmount: random(),
        leftAmount: random(),
        rightAmount: random(),
      }
      const reference = referenceVelocityState(runtime, false)
      const delta = index < 4
        ? [0, 1 / 240, 1 / 60, 0.25][index]
        : range(random, 0, 0.25)

      refreshVelocityBlend(runtime, velocity, yaw, delta, false)
      RefreshVelocityBlendReference({
        VelocityBlend: reference,
        RotationQuaternion: yawQuaternion(yaw),
        Velocity: { X: velocity.x, Y: velocity.y, Z: velocity.z },
        DeltaTime: delta,
        VelocityBlendInterpolationSpeed: 12,
      })

      expectClose(runtime.forwardAmount, reference.ForwardAmount)
      expectClose(runtime.backwardAmount, reference.BackwardAmount)
      expectClose(runtime.leftAmount, reference.LeftAmount)
      expectClose(runtime.rightAmount, reference.RightAmount)
    }
  })

  it(`UAlsMath::ExponentialDecay matches across ${PROPERTY_CASES} seeded cases`, () => {
    const random = seededRandom(0x1eafcafe)
    const deltaEdges = [0, 1e-8, 1 / 240, 1 / 60, 0.25, 1]
    const lambdaEdges = [0, 1e-8, 1, 12, 100]

    for (let index = 0; index < PROPERTY_CASES; index++) {
      const delta = deltaEdges[index] ?? range(random, 0, 1)
      const lambda = lambdaEdges[index] ?? range(random, 0, 100)
      expectClose(
        exponentialDecay(delta, lambda),
        ExponentialDecay(delta, lambda),
        Number.EPSILON,
      )
    }
  })

  it('cpp-velocity-normalize-tolerance: near-zero velocity matches ALS GetSafeNormal semantics (fixed)', () => {
    // AlsAnimationInstance.cpp:743-751; FVector3f::Normalize compares squared length to 1e-8.
    const runtime = createVelocityBlend()
    const reference = referenceVelocityState(runtime, true)
    refreshVelocityBlend(runtime, { x: 5e-5, y: 0, z: 0 }, 0, 0, true)
    RefreshVelocityBlendReference({
      VelocityBlend: reference,
      RotationQuaternion: yawQuaternion(0),
      Velocity: { X: 5e-5, Y: 0, Z: 0 },
      DeltaTime: 0,
      VelocityBlendInterpolationSpeed: 12,
    })
    expect(runtime.forwardAmount).toBe(reference.ForwardAmount)
  })

  it(`GetRelativeAccelerationAmount matches for ${PROPERTY_CASES} seeded and 3D clamp cases`, () => {
    const random = seededRandom(0xacc311)
    const maximumEdges = [0, 1e-8, 1e-4, 1.00001e-4, 1, 5]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const actorYaw = range(random, -Math.PI, Math.PI)
      const acceleration = index === 0
        ? { x: 1, y: 0, z: 10 }
        : {
            x: range(random, -20, 20),
            y: range(random, -20, 20),
            z: range(random, -20, 20),
          }
      const velocity = index === 1
        ? { x: -1, y: 0, z: 0 }
        : {
            x: range(random, -10, 10),
            y: range(random, -10, 10),
            z: range(random, -10, 10),
          }
      const maxAcceleration =
        maximumEdges[index] ?? range(random, 0, 20)
      const maxBrakingDeceleration =
        maximumEdges[(index + 2) % maximumEdges.length]
        ?? range(random, 0, 20)

      const runtime = getRelativeAccelerationAmount({
        actorYaw,
        acceleration,
        velocity,
        maxAcceleration,
        maxBrakingDeceleration,
      })
      const reference = GetRelativeAccelerationAmount({
        RotationQuaternion: yawQuaternion(actorYaw),
        Acceleration: {
          X: acceleration.x,
          Y: acceleration.y,
          Z: acceleration.z,
        },
        Velocity: {
          X: velocity.x,
          Y: velocity.y,
          Z: velocity.z,
        },
        MaxAcceleration: maxAcceleration,
        MaxBrakingDeceleration: maxBrakingDeceleration,
      })

      expectClose(runtime.x, reference.X)
      expectClose(runtime.y, reference.Y)
    }
  })

  it(`RefreshPose matches all fields for ${PROPERTY_CASES} seeded and threshold cases`, () => {
    const random = seededRandom(0x0badf00d)
    const edges = [-1, 0, 1e-8, 1, 2, 3, 4]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const gait = edges[index] ?? range(random, -2, 5)
      const grounded = index === 0
        ? 0
        : index === 1
          ? 1e-8
          : index === 2
            ? 1.00001e-8
            : range(random, -0.5, 1.5)
      const curves = {
        PoseGrounded: grounded,
        PoseInAir: range(random, -0.5, 1.5),
        PoseStanding: range(random, -0.5, 1.5),
        PoseCrouching: range(random, -0.5, 1.5),
        PoseMoving: range(random, -0.5, 1.5),
        PoseGait: gait,
      }
      const reference = RefreshPoseReference(curves)
      const runtime = refreshPose(new Map(Object.entries(curves)))

      expectClose(runtime.groundedAmount, reference.GroundedAmount)
      expectClose(runtime.inAirAmount, reference.InAirAmount)
      expectClose(runtime.standingAmount, reference.StandingAmount)
      expectClose(runtime.crouchingAmount, reference.CrouchingAmount)
      expectClose(runtime.movingAmount, reference.MovingAmount)
      expectClose(runtime.amount, reference.GaitAmount)
      expectClose(runtime.walking, reference.GaitWalkingAmount)
      expectClose(runtime.running, reference.GaitRunningAmount)
      expectClose(runtime.sprinting, reference.GaitSprintingAmount)
      expectClose(runtime.unweightedAmount, reference.UnweightedGaitAmount)
      expectClose(
        runtime.unweightedWalking,
        reference.UnweightedGaitWalkingAmount,
      )
      expectClose(
        runtime.unweightedRunning,
        reference.UnweightedGaitRunningAmount,
      )
      expectClose(
        runtime.unweightedSprinting,
        reference.UnweightedGaitSprintingAmount,
      )
    }
  })

  it(`RefreshGroundedLean matches for ${PROPERTY_CASES} seeded and snap cases`, () => {
    const random = seededRandom(0x1ea0cafe)
    const deltaEdges = [0, 1e-8, 1 / 240, 1 / 60, 0.25]
    const speedEdges = [0, 1e-8, 4, 20]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const runtime = createAlsLeanState()
      runtime.rightAmount = range(random, -2, 2)
      runtime.forwardAmount = range(random, -2, 2)
      const reference = referenceLeanState(runtime)
      const relativeAccelerationAmount = {
        x: range(random, -1, 1),
        y: range(random, -1, 1),
      }
      const pendingUpdate = index === 0 || random() < 0.2
      const deltaTime =
        deltaEdges[index] ?? range(random, 0, 0.5)
      const leanInterpolationSpeed =
        speedEdges[index] ?? range(random, 0, 20)

      refreshGroundedLean(runtime, {
        relativeAccelerationAmount,
        pendingUpdate,
        deltaTime,
        leanInterpolationSpeed,
      })
      RefreshGroundedLean({
        LeanState: reference,
        RelativeAccelerationAmount: {
          X: relativeAccelerationAmount.x,
          Y: relativeAccelerationAmount.y,
        },
        bPendingUpdate: pendingUpdate,
        DeltaTime: deltaTime,
        LeanInterpolationSpeed: leanInterpolationSpeed,
      })

      expectClose(runtime.rightAmount, reference.RightAmount)
      expectClose(runtime.forwardAmount, reference.ForwardAmount)
    }
  })

  it(`RefreshInAirLean matches for ${PROPERTY_CASES} seeded, unit, and snap cases`, () => {
    const random = seededRandom(0x1ea1cafe)
    const deltaEdges = [0, 1e-8, 1 / 240, 1 / 60, 0.25]
    const speedEdges = [0, 1e-8, 4, 20]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const runtime = createAlsLeanState()
      runtime.rightAmount = range(random, -2, 2)
      runtime.forwardAmount = range(random, -2, 2)
      const reference = referenceLeanState(runtime)
      const relativeVelocity = {
        x: range(random, -15, 15),
        y: range(random, -15, 15),
        z: range(random, -15, 15),
      }
      const verticalVelocity = range(random, -15, 15)
      const leanAmountCurveValue = range(random, -2, 2)
      const pendingUpdate = index === 0 || random() < 0.2
      const deltaTime =
        deltaEdges[index] ?? range(random, 0, 0.5)
      const leanInterpolationSpeed =
        speedEdges[index] ?? range(random, 0, 20)

      refreshInAirLean(runtime, {
        relativeVelocity,
        verticalVelocity,
        leanAmountCurve: () => leanAmountCurveValue,
        pendingUpdate,
        deltaTime,
        leanInterpolationSpeed,
      })
      RefreshInAirLean({
        LeanState: reference,
        RelativeVelocity: {
          X: relativeVelocity.x * 100,
          Y: relativeVelocity.y * 100,
          Z: relativeVelocity.z * 100,
        },
        VerticalVelocity: verticalVelocity * 100,
        LeanAmountCurveValue: leanAmountCurveValue,
        bPendingUpdate: pendingUpdate,
        DeltaTime: deltaTime,
        LeanInterpolationSpeed: leanInterpolationSpeed,
      })

      expectClose(runtime.rightAmount, reference.RightAmount)
      expectClose(runtime.forwardAmount, reference.ForwardAmount)
    }
  })

  it(`RefreshLook matches for ${PROPERTY_CASES} seeded and angle-edge cases`, () => {
    const random = seededRandom(0x100cafe)
    const angleEdges = [-180, -175, -90, 0, 90, 175, 180]
    const modes = [
      'VelocityDirection',
      'ViewDirection',
      'Aiming',
    ] as const
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const runtime = createAlsLookState()
      runtime.initializationRequired = index === 0 || random() < 0.2
      runtime.worldYawAngle =
        angleEdges[index] ?? range(random, -180, 180)
      runtime.yawAngle = range(random, -180, 180)
      runtime.pitchAngle = range(random, -90, 90)
      runtime.yawForwardAmount = range(random, 0, 1)
      runtime.yawLeftAmount = range(random, 0, 1)
      runtime.yawRightAmount = range(random, 0, 1)
      const reference = referenceLookState(runtime)
      const input = {
        rotationMode: modes[index % modes.length],
        actorYawAngle: range(random, -180, 180),
        movementBaseHasRelativeRotation: random() < 0.25,
        movementBaseDeltaRotationYaw: range(random, -180, 180),
        hasInput: random() < 0.5,
        inputYawAngle: range(random, -180, 180),
        targetYawAngle: range(random, -180, 180),
        viewYawAngle:
          angleEdges[(index + 2) % angleEdges.length]
          ?? range(random, -180, 180),
        viewPitchAngle: range(random, -90, 90),
        locomotionYawSpeed:
          index < 3 ? [-1e-8, 0, 1e-8][index] : range(random, -500, 500),
        deltaTime: index < 4
          ? [0, 1e-8, 1 / 240, 1 / 60][index]
          : range(random, 0, 0.5),
      }
      const settings = {
        lookTowardsInputYawAngleInterpolationSpeed:
          index === 1 ? 0 : range(random, 0, 20),
        lookTowardsCameraRotationInterpolationSpeed:
          index === 2 ? 0 : range(random, 0, 20),
      }

      refreshLook(runtime, input, settings)
      RefreshLook({
        LookState: reference,
        RotationMode: input.rotationMode,
        ActorYawAngle: input.actorYawAngle,
        bMovementBaseHasRelativeRotation:
          input.movementBaseHasRelativeRotation,
        MovementBaseDeltaRotationYaw: input.movementBaseDeltaRotationYaw,
        bHasInput: input.hasInput,
        InputYawAngle: input.inputYawAngle,
        TargetYawAngle: input.targetYawAngle,
        ViewYawAngle: input.viewYawAngle,
        ViewPitchAngle: input.viewPitchAngle,
        LocomotionYawSpeed: input.locomotionYawSpeed,
        DeltaTime: input.deltaTime,
        LookTowardsInputYawAngleInterpolationSpeed:
          settings.lookTowardsInputYawAngleInterpolationSpeed,
        LookTowardsCameraRotationInterpolationSpeed:
          settings.lookTowardsCameraRotationInterpolationSpeed,
      })

      expect(runtime.initializationRequired)
        .toBe(reference.bInitializationRequired)
      expectClose(runtime.worldYawAngle, reference.WorldYawAngle)
      expectClose(runtime.yawAngle, reference.YawAngle)
      expectClose(runtime.pitchAngle, reference.PitchAngle)
      expectClose(runtime.yawForwardAmount, reference.YawForwardAmount)
      expectClose(runtime.yawLeftAmount, reference.YawLeftAmount)
      expectClose(runtime.yawRightAmount, reference.YawRightAmount)
    }
  })

  it(`RefreshSpine matches for ${PROPERTY_CASES} seeded and weight-edge cases`, () => {
    const random = seededRandom(0x5a1ecafe)
    const amountEdges = [0, 1e-5, 1.00001e-5, 0.5, 0.999989, 0.99999, 1]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const runtime = createAlsSpineState()
      runtime.spineRotationAllowed = random() < 0.5
      runtime.spineAmount =
        amountEdges[index] ?? range(random, 0, 1)
      runtime.spineAmountScale = range(random, 0.1, 4)
      runtime.spineAmountBias = range(random, -2, 2)
      runtime.lastYawAngle = range(random, -180, 180)
      runtime.currentYawAngle = range(random, -180, 180)
      runtime.yawAngle = range(random, -180, 180)
      runtime.lastActorYawAngle = range(random, -180, 180)
      const reference = referenceSpineState(runtime)
      const input = {
        spineRotationAllowed: random() < 0.5,
        spineBlendAmount: range(random, -0.5, 1.5),
        deltaTime: index < 4
          ? [0, 1e-8, 1 / 240, 1 / 60][index]
          : range(random, 0, 0.5),
        pendingUpdate: random() < 0.2,
        viewYawAngle: range(random, -180, 180),
        viewYawSpeed: range(random, -500, 500),
        actorYawAngle: range(random, -180, 180),
        movementBaseHasRelativeRotation: random() < 0.25,
        movementBaseDeltaRotationYaw: range(random, -180, 180),
      }

      refreshSpine(runtime, input)
      RefreshSpine({
        SpineState: reference,
        bSpineRotationAllowed: input.spineRotationAllowed,
        SpineBlendAmount: input.spineBlendAmount,
        DeltaTime: input.deltaTime,
        bPendingUpdate: input.pendingUpdate,
        ViewYawAngle: input.viewYawAngle,
        ViewYawSpeed: input.viewYawSpeed,
        ActorYawAngle: input.actorYawAngle,
        bMovementBaseHasRelativeRotation:
          input.movementBaseHasRelativeRotation,
        MovementBaseDeltaRotationYaw: input.movementBaseDeltaRotationYaw,
      })

      expect(runtime.spineRotationAllowed)
        .toBe(reference.bSpineRotationAllowed)
      expectClose(runtime.spineAmount, reference.SpineAmount)
      expectClose(runtime.spineAmountScale, reference.SpineAmountScale)
      expectClose(runtime.spineAmountBias, reference.SpineAmountBias)
      expectClose(runtime.lastYawAngle, reference.LastYawAngle)
      expectClose(runtime.lastActorYawAngle, reference.LastActorYawAngle)
      expectClose(runtime.currentYawAngle, reference.CurrentYawAngle)
      expectClose(runtime.yawAngle, reference.YawAngle)
    }
  })

  it(`RefreshRotateInPlace matches for ${PROPERTY_CASES} seeded and exact-threshold cases`, () => {
    const random = seededRandom(0x1234abcd)
    const yawEdges = [-180, -50, -49.999, 0, 49.999, 50, 180]
    const deltaEdges = [0, 1e-8, 1 / 240, 1 / 60, 1]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const runtime = createAlsRotateInPlaceState()
      runtime.playRate = range(random, 0, 4)
      const reference = {
        bUpdatedThisFrame: false,
        bRotatingLeft: false,
        bRotatingRight: false,
        PlayRate: runtime.playRate,
      }
      const input = {
        delta: deltaEdges[index] ?? range(random, 0, 0.5),
        moving: random() < 0.25,
        allowed: random() >= 0.25,
        pendingUpdate: random() < 0.2,
        viewYawAngle: yawEdges[index] ?? range(random, -180, 180),
        viewYawSpeed: range(random, 0, 600),
      }

      refreshRotateInPlace(runtime, input)
      RefreshRotateInPlaceReference({
        RotateInPlaceState: reference,
        bMoving: input.moving,
        bRotateInPlaceAllowed: input.allowed,
        bPendingUpdate: input.pendingUpdate,
        ViewYawAngle: input.viewYawAngle,
        ViewYawSpeed: input.viewYawSpeed,
        DeltaTime: input.delta,
        ViewYawAngleThreshold:
          ALS_ROTATE_IN_PLACE_SETTINGS.viewYawAngleThreshold,
        ReferenceViewYawSpeed:
          ALS_ROTATE_IN_PLACE_SETTINGS.referenceViewYawSpeed,
        PlayRate: ALS_ROTATE_IN_PLACE_SETTINGS.playRate,
      })

      expect(runtime.updatedThisFrame).toBe(reference.bUpdatedThisFrame)
      expect(runtime.rotatingLeft).toBe(reference.bRotatingLeft)
      expect(runtime.rotatingRight).toBe(reference.bRotatingRight)
      expectClose(runtime.playRate, reference.PlayRate)
    }
  })

  it(`RefreshTurnInPlace trigger and selection match for ${PROPERTY_CASES} seeded and angle-edge cases`, () => {
    const random = seededRandom(0x51515151)
    const settings = referenceTurnSettings()
    const yawEdges = [-180, -130, -45, 45, 130, 175, 180]
    let triggeredCases = 0

    for (let index = 0; index < PROPERTY_CASES; index++) {
      const runtimeState = createAlsTurnInPlaceState()
      const startingDelay = range(random, 0, 0.8)
      runtimeState.activationDelay = startingDelay
      const referenceState = {
        bUpdatedThisFrame: false,
        ActivationDelay: startingDelay,
      }
      const input = {
        delta: index < 4 ? [0, 1e-8, 1 / 240, 1][index] : range(random, 0, 0.2),
        transitionsAllowed: random() > 0.1,
        viewYawAngle: yawEdges[index] ?? range(random, -180, 180),
        viewYawSpeed: index === 1 ? 50 : range(random, 0, 80),
        stance: random() < 0.5 ? 'Standing' as const : 'Crouching' as const,
      }

      const runtime = refreshTurnInPlace(runtimeState, input)
      const reference = RefreshTurnInPlaceReference({
        TurnInPlaceState: referenceState,
        bTransitionsAllowed: input.transitionsAllowed,
        bTurnInPlaceAllowed: true,
        ViewYawAngle: input.viewYawAngle,
        ViewYawSpeed: input.viewYawSpeed,
        DeltaTime: input.delta,
        Stance: input.stance,
        Settings: settings,
      })

      expect(runtime === null).toBe(reference === null)
      if (runtime && reference) {
        triggeredCases++
        expect(runtime.stance).toBe(reference.Stance)
        expect(runtime.angle).toBe(reference.Angle)
        expect(runtime.direction).toBe(reference.Direction)
        expect(runtime.settings.clip).toBe(reference.Settings.clip)
        expectClose(runtime.playRate, reference.PlayRate)
      }
      expectClose(runtimeState.activationDelay, referenceState.ActivationDelay)
    }

    expect(triggeredCases).toBeGreaterThan(0)
  })

  it('RefreshTurnInPlace retains emitted delay, suppresses duplicate graph calls, and resets at the next transition gate', () => {
    const runtimeState = createAlsTurnInPlaceState()
    const referenceState = {
      bUpdatedThisFrame: false,
      ActivationDelay: 0.75,
    }
    runtimeState.activationDelay = referenceState.ActivationDelay
    const input = {
      delta: 0.01,
      transitionsAllowed: true,
      viewYawAngle: 180,
      viewYawSpeed: 0,
      stance: 'Standing' as const,
    }
    const settings = referenceTurnSettings()

    const runtimeRequest = refreshTurnInPlace(runtimeState, input)
    const referenceRequest = RefreshTurnInPlaceReference({
      TurnInPlaceState: referenceState,
      bTransitionsAllowed: input.transitionsAllowed,
      bTurnInPlaceAllowed: true,
      ViewYawAngle: input.viewYawAngle,
      ViewYawSpeed: input.viewYawSpeed,
      DeltaTime: input.delta,
      Stance: input.stance,
      Settings: settings,
    })
    expect(runtimeRequest === null).toBe(referenceRequest === null)
    expectClose(runtimeState.activationDelay, referenceState.ActivationDelay)

    expect(refreshTurnInPlace(runtimeState, input)).toBeNull()
    expect(RefreshTurnInPlaceReference({
      TurnInPlaceState: referenceState,
      bTransitionsAllowed: input.transitionsAllowed,
      bTurnInPlaceAllowed: true,
      ViewYawAngle: input.viewYawAngle,
      ViewYawSpeed: input.viewYawSpeed,
      DeltaTime: input.delta,
      Stance: input.stance,
      Settings: settings,
    })).toBeNull()
    expectClose(runtimeState.activationDelay, referenceState.ActivationDelay)

    resetTurnInPlaceFrame(runtimeState)
    referenceState.bUpdatedThisFrame = false
    expect(refreshTurnInPlace(runtimeState, {
      ...input,
      transitionsAllowed: false,
    })).toBeNull()
    expect(RefreshTurnInPlaceReference({
      TurnInPlaceState: referenceState,
      bTransitionsAllowed: false,
      bTurnInPlaceAllowed: true,
      ViewYawAngle: input.viewYawAngle,
      ViewYawSpeed: input.viewYawSpeed,
      DeltaTime: input.delta,
      Stance: input.stance,
      Settings: settings,
    })).toBeNull()
    expect(runtimeState.activationDelay).toBe(0)
    expect(runtimeState.activationDelay).toBe(referenceState.ActivationDelay)
  })

  it(`foot-lock state matches for ${PROPERTY_CASES} seeded metre-boundary cases`, () => {
    const random = seededRandom(0xf0_07_10_cc)
    const randomVector = (extent = 5) => ({
      x: range(random, -extent, extent),
      y: range(random, -extent, extent),
      z: range(random, -extent, extent),
    })
    const randomRotation = () => footYawQuaternion(range(random, -180, 180))
    const randomTransform = (): AlsTransform => ({
      location: randomVector(),
      rotation: randomRotation(),
    })
    const randomMovementBase = (): AlsFootLockMovementBase => ({
      hasRelativeLocation: random() > 0.5,
      location: randomVector(),
      rotation: randomRotation(),
    })
    const randomState = (): AlsFootState => {
      const thighAngle = range(random, -Math.PI, Math.PI)
      const state = createAlsFootState({
        x: Math.cos(thighAngle),
        y: Math.sin(thighAngle),
        z: 0,
      })
      state.lockAmount = random()
      state.targetLocation = randomVector(2)
      state.targetRotation = randomRotation()
      state.lockLocation = randomVector(2)
      state.lockRotation = randomRotation()
      state.lockComponentRelativeLocation = randomVector(2)
      state.lockComponentRelativeRotation = randomRotation()
      state.lockMovementBaseRelativeLocation = randomVector(2)
      state.lockMovementBaseRelativeRotation = randomRotation()
      state.finalLocation = randomVector(2)
      state.finalRotation = randomRotation()
      return state
    }

    for (let index = 0; index < PROPERTY_CASES; index++) {
      const componentTransform = randomTransform()
      const movementBase = randomMovementBase()

      const teleportState = randomState()
      const teleportReference = referenceFootState(teleportState)
      const teleportInput = {
        ikAmount: random(),
        pendingUpdate: random() > 0.8,
        timeSinceTeleported: range(random, 0, 0.4),
        componentTransform,
        movementBase,
      }
      processFootLockTeleport(teleportState, teleportInput)
      ProcessFootLockTeleport({
        IkAmount: teleportInput.ikAmount,
        FootState: teleportReference,
        bPendingUpdate: teleportInput.pendingUpdate,
        TimeSinceTeleported: teleportInput.timeSinceTeleported,
        ComponentTransform: referenceFootTransform(componentTransform),
        MovementBase: referenceFootMovementBase(movementBase),
      })
      expectFootStateToMatchReference(teleportState, teleportReference)

      const baseChangeState = randomState()
      const baseChangeReference = referenceFootState(baseChangeState)
      const baseChangeInput = {
        ikAmount: random(),
        pendingUpdate: random() > 0.8,
        baseChanged: random() > 0.5,
        componentTransform,
        movementBase,
      }
      processFootLockBaseChange(baseChangeState, baseChangeInput)
      ProcessFootLockBaseChange({
        IkAmount: baseChangeInput.ikAmount,
        FootState: baseChangeReference,
        bPendingUpdate: baseChangeInput.pendingUpdate,
        bBaseChanged: baseChangeInput.baseChanged,
        ComponentTransform: referenceFootTransform(componentTransform),
        MovementBase: referenceFootMovementBase(movementBase),
      })
      expectFootStateToMatchReference(baseChangeState, baseChangeReference)

      const refreshState = randomState()
      const refreshReference = referenceFootState(refreshState)
      const pelvisRotation = randomRotation()
      const refreshInput = {
        ikAmount: random(),
        lockCurveAmount: range(random, -1, 2),
        componentTransform,
        deltaTime: range(random, 0, 0.1),
        movingSmooth: random() > 0.5,
        grounded: random() > 0.35,
        pendingUpdate: random() > 0.85,
        disableFootLock: random() > 0.9,
        movementBase,
        pelvisRotation,
        footLockAngleLimit: range(random, 0, 180),
      }
      refreshFootLock(refreshState, refreshInput)
      RefreshFootLock({
        IkAmount: refreshInput.ikAmount,
        NewLockCurveAmount: refreshInput.lockCurveAmount,
        FootState: refreshReference,
        ComponentTransform: referenceFootTransform(componentTransform),
        DeltaTime: refreshInput.deltaTime,
        bMovingSmooth: refreshInput.movingSmooth,
        bGrounded: refreshInput.grounded,
        bPendingUpdate: refreshInput.pendingUpdate,
        bDisableFootLock: refreshInput.disableFootLock,
        MovementBase: referenceFootMovementBase(movementBase),
        PelvisRotation: referenceFootQuaternion(pelvisRotation),
        FootLockAngleLimit: refreshInput.footLockAngleLimit,
      })
      expectFootStateToMatchReference(refreshState, refreshReference)
    }
  })

  it(`PlayQuickStopAnimation matches for ${PROPERTY_CASES} seeded and angle-edge cases`, () => {
    const random = seededRandom(0x5105709)
    const angleEdges = [-540, -180, -175, 0, 175, 175.000_001, 180, 540]
    const rotationModes = [
      'VelocityDirection',
      'ViewDirection',
      'Aiming',
    ] as const
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const input = {
        rotationMode: rotationModes[index % rotationModes.length],
        stance: index % 2 === 0 ? 'Standing' as const : 'Crouching' as const,
        hasInput: random() < 0.5,
        inputYawAngle:
          angleEdges[index] ?? range(random, -2_000, 2_000),
        targetYawAngle: range(random, -2_000, 2_000),
        actorYawAngle: range(random, -2_000, 2_000),
      }
      const runtime = playQuickStopAnimation(input)
      const reference = PlayQuickStopAnimation({
        RotationMode: input.rotationMode,
        bHasInput: input.hasInput,
        InputYawAngle: input.inputYawAngle,
        TargetYawAngle: input.targetYawAngle,
        ActorYawAngle: input.actorYawAngle,
        QuickStopPlayRate: [1.75, 3],
      })

      expect(runtime.direction).toBe(reference.Direction)
      expectClose(runtime.playRate, reference.PlayRate)
      expect(runtime.blendInDuration).toBe(0.1)
      expect(runtime.blendOutDuration).toBe(0.2)
      expect(runtime.startTime).toBe(0.3)
    }
  })

  it(`RefreshGroundPrediction matches for ${PROPERTY_CASES} seeded metre-boundary cases`, () => {
    const random = seededRandom(0x6a_72_6f_75)
    const amountCurve = (hitTime: number) => 0.2 + hitTime * 1.4

    for (let index = 0; index < PROPERTY_CASES; index++) {
      const verticalVelocity = range(random, -60, 5)
      const velocity = {
        x: range(random, -12, 12),
        y: range(random, -12, 12),
        z: range(random, -60, 15),
      }
      const scale = range(random, 0.2, 3)
      const blockAmount = range(random, -0.5, 1.5)
      const groundValid = random() > 0.3
      const hitTime = range(random, -0.25, 1.25)
      const state = createAlsInAirState()
      state.verticalVelocity = verticalVelocity

      const runtime = refreshGroundPrediction(state, {
        location: {
          x: range(random, -100, 100),
          y: range(random, -100, 100),
          z: range(random, -100, 100),
        },
        velocity,
        scale,
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.7,
        groundPredictionBlockCurveValue: blockAmount,
        groundPredictionAmountCurve: amountCurve,
        sweepCapsule: () => groundValid
          ? {
              validBlockingHit: true,
              time: hitTime,
              impactNormal: { x: 0, y: 0, z: 1 },
            }
          : null,
      })
      const reference = RefreshGroundPrediction({
        VerticalVelocity: verticalVelocity * 100,
        Velocity: {
          X: velocity.x * 100,
          Y: velocity.y * 100,
          Z: velocity.z * 100,
        },
        Scale: scale,
        GroundPredictionBlockCurveValue: blockAmount,
        bGroundValid: groundValid,
        HitTime: hitTime,
        GroundPredictionAmountCurveValue: amountCurve,
      })

      expectClose(runtime.groundPredictionAmount, reference.GroundPredictionAmount)
      expectClose(runtime.sweepVector.x * 100, reference.SweepVector.X)
      expectClose(runtime.sweepVector.y * 100, reference.SweepVector.Y)
      expectClose(runtime.sweepVector.z * 100, reference.SweepVector.Z)
    }
  })

  it('delta report categorizes every final C++ mismatch and skip', () => {
    const cppDeltaIds = ALS_PARITY_DELTA_REPORT
      .filter((entry) => entry.oracle === 'C++ differential')
      .map((entry) => entry.id)
      .sort()
    expect(cppDeltaIds).toEqual([])
  })
})
