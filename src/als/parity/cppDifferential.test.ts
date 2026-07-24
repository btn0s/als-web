import { describe, expect, it } from 'vitest'
import {
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
  FAlsGeneralTurnInPlaceSettings,
  FAlsTurnInPlaceClipSettings,
  FAlsVelocityBlendState,
} from '../reference/AlsAnimationInstance.reference'
import {
  refreshPose,
  refreshRotateInPlace,
  refreshTurnInPlace,
  refreshVelocityBlend,
} from '../AlsAnimationInstance'
import { ALS_ROTATE_IN_PLACE_SETTINGS } from '../Settings/AlsRotateInPlaceSettings'
import { ALS_TURN_IN_PLACE_SETTINGS } from '../Settings/AlsTurnInPlaceSettings'
import type {
  AlsTurnInPlaceClipSettings,
} from '../Settings/AlsTurnInPlaceSettings'
import {
  createAlsRotateInPlaceState,
} from '../State/AlsRotateInPlaceState'
import { createAlsTurnInPlaceState } from '../State/AlsTurnInPlaceState'
import { createVelocityBlend } from '../State/AlsGroundedState'
import {
  ALS_PARITY_DELTA_REPORT,
  getAlsParityDelta,
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

  it(`characterizes the exact-exp vs InvExpApprox delta across ${PROPERTY_CASES} damped cases`, () => {
    const random = seededRandom(0xdecafbad)
    let maximumDelta = 0
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

      maximumDelta = Math.max(
        maximumDelta,
        Math.abs(runtime.forwardAmount - reference.ForwardAmount),
        Math.abs(runtime.backwardAmount - reference.BackwardAmount),
        Math.abs(runtime.leftAmount - reference.LeftAmount),
        Math.abs(runtime.rightAmount - reference.RightAmount),
      )
    }

    expect(getAlsParityDelta('cpp-exp-decay').category).toBe('designed deviation')
    expect(maximumDelta).toBeGreaterThan(EPSILON)
    expect(maximumDelta).toBeLessThan(0.1)
  })

  it.skip('DESIGNED DEVIATION cpp-exp-decay: exact Math.exp differs from ALS InvExpApprox by up to 0.0175116885 in the seeded sweep', () => {
    // Unskip only when the runtime intentionally adopts Unreal's approximation.
    expect(getAlsParityDelta('cpp-exp-decay').category).toBe('designed deviation')
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

  it(`RefreshPose gait family matches for ${PROPERTY_CASES} seeded and threshold cases`, () => {
    const random = seededRandom(0x0badf00d)
    const edges = [-1, 0, 1e-8, 1, 2, 3, 4]
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const gait = edges[index] ?? range(random, -2, 5)
      const grounded = index === 0
        ? 0
        : index === 1 ? 1e-8 : range(random, 0, 1)
      const reference = RefreshPoseReference({
        PoseGait: gait,
        PoseGrounded: grounded,
      })
      const runtime = refreshPose(gait)

      expectClose(runtime.amount, reference.GaitAmount)
      expectClose(runtime.walking, reference.GaitWalkingAmount)
      expectClose(runtime.running, reference.GaitRunningAmount)
      expectClose(runtime.sprinting, reference.GaitSprintingAmount)
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
        expect(runtimeState.activationDelay).toBe(0)
        expect(referenceState.ActivationDelay).toBeGreaterThan(0)
      } else {
        expectClose(runtimeState.activationDelay, referenceState.ActivationDelay)
      }
    }

    expect(triggeredCases).toBeGreaterThan(0)
    expect(getAlsParityDelta('cpp-turn-delay-reset').category)
      .toBe('designed deviation')
  })

  it.skip('DESIGNED DEVIATION cpp-turn-delay-reset: emitted runtime requests clear delay while ALS retains up to 0.98898691s in the seeded sweep', () => {
    // Unskip only if repeated-request suppression moves to the same next-frame gate as ALS.
    expect(getAlsParityDelta('cpp-turn-delay-reset').category)
      .toBe('designed deviation')
  })

  it.skip('UNPORTED SYSTEM cpp-relative-acceleration: GetRelativeAccelerationAmount has no runtime seam', () => {
    void GetRelativeAccelerationAmount
  })

  it.skip('UNPORTED SYSTEM cpp-pose-unweighted: raw Pose* and UnweightedGaitAmount fields have no runtime seam', () => {
    expect(getAlsParityDelta('cpp-pose-unweighted').category)
      .toBe('unported system')
  })

  it.skip('UNPORTED SYSTEM cpp-lean: RefreshGroundedLean has no runtime state seam', () => {
    void RefreshGroundedLean
  })

  it.skip('UNPORTED SYSTEM cpp-lean: RefreshInAirLean has no runtime state seam', () => {
    void RefreshInAirLean
  })

  it.skip('UNPORTED SYSTEM cpp-look: RefreshLook interpolation and direction bias have no runtime seam', () => {
    void RefreshLook
  })

  it.skip('UNPORTED SYSTEM cpp-spine: RefreshSpine amount/scale/bias machinery has no runtime seam', () => {
    void RefreshSpine
  })

  it.skip('UNPORTED SYSTEM cpp-foot-lock: teleport/base-change/latch/decrease/angle-limit state has no runtime seam', () => {
    void ProcessFootLockTeleport
    void ProcessFootLockBaseChange
    void RefreshFootLock
  })

  it.skip('UNPORTED SYSTEM cpp-quick-stop: PlayQuickStopAnimation play-rate math has no runtime seam', () => {
    void PlayQuickStopAnimation
  })

  it.skip('UNPORTED SYSTEM cpp-ground-prediction: RefreshGroundPrediction mapping and sweep have no runtime seam', () => {
    void RefreshGroundPrediction
  })

  it('delta report categorizes every final C++ mismatch and skip', () => {
    const cppDeltas = ALS_PARITY_DELTA_REPORT.filter(
      (entry) => entry.oracle === 'C++ differential',
    )
    expect(cppDeltas).toHaveLength(11)
    expect(new Set(cppDeltas.map((entry) => entry.id)).size).toBe(11)
  })
})
