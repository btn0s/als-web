import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { sampleRichCurve } from '../../engine/richCurve'
import type { RichCurveKey } from '../../engine/richCurve'

/**
 * The single source of truth for ALS locomotion tuning.
 *
 * ALS locomotion loops are authored in place, so their constant root tracks contain no usable
 * ground distance. Ground speeds come from ALS Refactored's movement settings; each clip's native
 * duration still supplies its cadence, with stride derived as authored speed × clip duration.
 *
 * Everything downstream derives from these two numbers per gait:
 *   - movement target speeds (Player)              = gait.speed
 *   - blendspace crossfade thresholds (blendspace) = gait.speed
 *   - foot-locked animation cadence (blendspace)   = currentSpeed / gait.stride
 */

export const MODEL_PATH = '/assets/skm-als.glb'

// ALS Refactored: AlsMovementSettings.h defaults, as configured by MS_Als_Normal.
export const ALS_AUTHORED_GAIT_SPEEDS = {
  standing: {
    walk: 1.75,
    run: 3.75,
    sprint: 6.5,
  },
  crouching: {
    walk: 1.5,
    run: 2.0,
  },
} as const

export const ALS_GAITS = ['Walking', 'Running', 'Sprinting'] as const
export type AlsGait = (typeof ALS_GAITS)[number]

export const ALS_STANCES = ['Standing', 'Crouching'] as const
export type AlsStance = (typeof ALS_STANCES)[number]

export const ALS_ROTATION_MODES = [
  'VelocityDirection',
  'ViewDirection',
  'Aiming',
] as const
export type AlsRotationMode = (typeof ALS_ROTATION_MODES)[number]

export interface AlsMovementGaitSettings {
  readonly walkForwardSpeed: number
  readonly walkBackwardSpeed: number
  readonly runForwardSpeed: number
  readonly runBackwardSpeed: number
  readonly sprintSpeed: number
  readonly movementCurve: 'normal' | 'responsive'
  readonly rotationCurve: 'normal' | 'responsive'
}

const STANDING_NORMAL_SPEEDS = {
  walkForwardSpeed: 1.75,
  walkBackwardSpeed: 1.75,
  runForwardSpeed: 3.75,
  runBackwardSpeed: 3.75,
  sprintSpeed: 6.5,
} as const

const STANDING_AIMING_SPEEDS = {
  ...STANDING_NORMAL_SPEEDS,
  walkForwardSpeed: 1.65,
  walkBackwardSpeed: 1.65,
} as const

const CROUCHING_SPEEDS = {
  walkForwardSpeed: 1.5,
  walkBackwardSpeed: 1.5,
  runForwardSpeed: 2,
  runBackwardSpeed: 2,
  sprintSpeed: 3,
} as const

/**
 * Direct content transcription of MS_Als_Normal.uasset. Speeds are converted from cm/s to m/s;
 * curve names preserve the data asset's references verbatim.
 */
export const ALS_MOVEMENT_SETTINGS: Readonly<
  Record<AlsRotationMode, Readonly<Record<AlsStance, AlsMovementGaitSettings>>>
> = {
  VelocityDirection: {
    Standing: {
      ...STANDING_NORMAL_SPEEDS,
      movementCurve: 'normal',
      rotationCurve: 'responsive',
    },
    Crouching: {
      ...CROUCHING_SPEEDS,
      movementCurve: 'responsive',
      rotationCurve: 'normal',
    },
  },
  ViewDirection: {
    Standing: {
      ...STANDING_NORMAL_SPEEDS,
      movementCurve: 'normal',
      rotationCurve: 'normal',
    },
    Crouching: {
      ...CROUCHING_SPEEDS,
      movementCurve: 'responsive',
      rotationCurve: 'normal',
    },
  },
  Aiming: {
    Standing: {
      ...STANDING_AIMING_SPEEDS,
      movementCurve: 'normal',
      rotationCurve: 'normal',
    },
    Crouching: {
      ...CROUCHING_SPEEDS,
      movementCurve: 'responsive',
      rotationCurve: 'normal',
    },
  },
}

interface AlsMovementCurve {
  readonly acceleration: readonly RichCurveKey[]
  readonly brakingDeceleration: readonly RichCurveKey[]
  readonly groundFriction: readonly RichCurveKey[]
}

/**
 * CV_Als_AccelerationAndDecelerationAndGroundFriction_{Normal,Responsive}.uasset, converted from
 * cm/s² to m/s² for the first two channels. Tangents receive the same unit conversion.
 */
const ALS_MOVEMENT_CURVES: Readonly<Record<'normal' | 'responsive', AlsMovementCurve>> = {
  normal: {
    acceleration: [
      { time: 0, value: 20, interpolation: 'linear' },
      { time: 1, value: 20, interpolation: 'linear' },
      {
        time: 2,
        value: 20,
        interpolation: 'cubic',
        leaveTangent: -36.42372,
      },
      { time: 3, value: 7.5, interpolation: 'linear', arriveTangent: 0 },
    ],
    brakingDeceleration: [
      { time: 0, value: 15, interpolation: 'linear' },
      { time: 1, value: 15, interpolation: 'linear' },
      { time: 2, value: 12.5, interpolation: 'linear' },
      { time: 3, value: 5, interpolation: 'linear' },
    ],
    groundFriction: [
      { time: 0, value: 5, interpolation: 'linear' },
      { time: 1, value: 5, interpolation: 'linear' },
      { time: 2, value: 4, interpolation: 'linear' },
      { time: 3, value: 0.5, interpolation: 'linear' },
    ],
  },
  responsive: {
    acceleration: [
      { time: 0, value: 25, interpolation: 'linear' },
      { time: 1, value: 25, interpolation: 'linear' },
      {
        time: 2,
        value: 25,
        interpolation: 'cubic',
        leaveTangent: -58.63394,
      },
      { time: 3, value: 5, interpolation: 'cubic', arriveTangent: 0 },
    ],
    brakingDeceleration: [
      { time: 0, value: 20, interpolation: 'linear' },
      { time: 1, value: 20, interpolation: 'linear' },
      {
        time: 2,
        value: 20,
        interpolation: 'cubic',
        leaveTangent: -27.156404,
      },
      { time: 3, value: 8, interpolation: 'cubic', arriveTangent: 0 },
    ],
    groundFriction: [
      { time: 0, value: 10, interpolation: 'linear' },
      { time: 1, value: 10, interpolation: 'linear' },
      { time: 2, value: 10, interpolation: 'cubic', leaveTangent: 0 },
      { time: 3, value: 5, interpolation: 'cubic', arriveTangent: 0 },
    ],
  },
}

/** CF_Als_RotationInterpolationSpeed_{Normal,Responsive}.uasset. */
const ALS_ROTATION_INTERPOLATION_CURVES: Readonly<
  Record<'normal' | 'responsive', readonly RichCurveKey[]>
> = {
  normal: [
    {
      time: 0,
      value: 0.5,
      interpolation: 'cubic',
      arriveTangent: 6.489353,
      leaveTangent: 6.489353,
    },
    {
      time: 1,
      value: 4,
      interpolation: 'cubic',
      arriveTangent: 0,
      leaveTangent: 0,
    },
    {
      time: 2,
      value: 5,
      interpolation: 'cubic',
      arriveTangent: 3.7926624,
      leaveTangent: 3.7926624,
    },
    {
      time: 3,
      value: 20,
      interpolation: 'cubic',
      arriveTangent: 26.585165,
      leaveTangent: 26.585165,
    },
  ],
  responsive: [
    {
      time: 0,
      value: 5,
      interpolation: 'cubic',
      arriveTangent: 2.470298,
      leaveTangent: 2.470298,
    },
    {
      time: 1,
      value: 8,
      interpolation: 'cubic',
      arriveTangent: 3.5,
      leaveTangent: 3.5,
    },
    {
      time: 2,
      value: 12,
      interpolation: 'cubic',
      arriveTangent: 4.6387124,
      leaveTangent: 4.6387124,
    },
    {
      time: 3,
      value: 20,
      interpolation: 'cubic',
      arriveTangent: 13.164665,
      leaveTangent: 13.164665,
    },
  ],
}

export interface AlsGroundedMovementParameters {
  readonly maxAcceleration: number
  readonly brakingDeceleration: number
  readonly groundFriction: number
  readonly rotationInterpolationSpeed: number
}

/** Mirrors UAlsCharacterMovementComponent::RefreshGroundedMovementSettings curve evaluation. */
export function sampleGroundedMovementParameters(
  settings: AlsMovementGaitSettings,
  gaitAmount: number,
): AlsGroundedMovementParameters {
  const movementCurve = ALS_MOVEMENT_CURVES[settings.movementCurve]
  return {
    maxAcceleration: sampleRichCurve(movementCurve.acceleration, gaitAmount),
    brakingDeceleration: sampleRichCurve(
      movementCurve.brakingDeceleration,
      gaitAmount,
    ),
    groundFriction: sampleRichCurve(movementCurve.groundFriction, gaitAmount),
    rotationInterpolationSpeed: sampleRichCurve(
      ALS_ROTATION_INTERPOLATION_CURVES[settings.rotationCurve],
      Math.max(1, gaitAmount),
    ),
  }
}

/**
 * Desired-gait target speed from MS_Als_Normal. ALS keeps DesiredGait selected while stopped;
 * the caller applies the separate Moving gate. Crouching has no sprint gait settings, so both
 * Running and Sprinting resolve to its authored 2m/s run cap.
 */
export function resolveDesiredGaitSpeed(
  gait: AlsGait,
  stance: AlsStance,
  rotationMode: AlsRotationMode = 'ViewDirection',
): number {
  const settings = ALS_MOVEMENT_SETTINGS[rotationMode][stance]
  if (gait === 'Walking') return settings.walkForwardSpeed
  if (gait === 'Running' || stance === 'Crouching') return settings.runForwardSpeed
  return settings.sprintSpeed
}

export interface Gait {
  /** Native clip length (s). */
  duration: number
  /** Ground distance per clip cycle (m) = authored speed × duration. */
  stride: number
  /** Authored ALS ground speed (m/s). 0 for in-place idles or a missing clip. */
  speed: number
}

export interface LocomotionProfile {
  idle: Gait
  walk: Gait
  run: Gait
  sprint: Gait
  crouchIdle: Gait
  crouchWalk: Gait
}

function gaitOf(
  clips: Map<string, THREE.AnimationClip>,
  name: string,
  authoredSpeed: number,
): Gait {
  const clip = clips.get(name)
  if (!clip) return { duration: 0, stride: 0, speed: 0 }

  const duration = clip.duration
  return {
    duration,
    stride: authoredSpeed * duration,
    speed: authoredSpeed,
  }
}

const profileCache = new WeakMap<THREE.AnimationClip[], LocomotionProfile>()

export function buildLocomotionProfile(animations: THREE.AnimationClip[]): LocomotionProfile {
  const cached = profileCache.get(animations)
  if (cached) return cached

  const byName = new Map(animations.map((clip) => [clip.name, clip]))
  const profile: LocomotionProfile = {
    idle: gaitOf(byName, 'A_Als_Idle', 0),
    walk: gaitOf(
      byName,
      'A_Als_Walk_Forward',
      ALS_AUTHORED_GAIT_SPEEDS.standing.walk,
    ),
    run: gaitOf(
      byName,
      'A_Als_Run_Forward',
      ALS_AUTHORED_GAIT_SPEEDS.standing.run,
    ),
    sprint: gaitOf(
      byName,
      'A_Als_Sprint',
      ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
    ),
    // The pack intentionally uses its one-frame authored crouch pose as the stance idle.
    crouchIdle: gaitOf(byName, 'A_Als_Crouch_Pose', 0),
    crouchWalk: gaitOf(
      byName,
      'A_Als_Crouch_Walk_Forward',
      ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    ),
  }
  profileCache.set(animations, profile)
  return profile
}

/** Hook form: derives the profile from the cached ALS character GLB. */
export function useLocomotionProfile(): LocomotionProfile {
  const { animations } = useGLTF(MODEL_PATH)
  return useMemo(() => buildLocomotionProfile(animations), [animations])
}

/**
 * Pace tuning (Leva). Multipliers on the clips' authored ground speed — 1 = authored; feet stay
 * locked at any value (cadence = speed/stride), so these trade limb-cadence naturalness for
 * traversal feel. Walk has `normal` and `slow` modes, toggled at runtime by Caps Lock (the same
 * mode applies while crouched). `run` is the Shift gait and is unaffected by the walk mode.
 */
export interface PaceTuning {
  normal: number
  slow: number
  run: number
}

// Retain the transplanted playtest tuning until movement is wired and playtested against ALS.
export const DEFAULT_PACE: PaceTuning = { normal: 1.65, slow: 0.7, run: 0.85 }

export interface ResolvedGaitSpeeds {
  walk: number
  run: number
  sprint: number
  crouchWalk: number
  crouchRun: number
}

/**
 * Resolves authored gait speeds × pace into movement/threshold speeds, keeping walk < run so
 * the blendspace crossfade can't invert however the sliders are set. `slowWalk` (Caps Lock) picks
 * the walk mode, applied to both walk and crouch-walk. Movement targets and animation crossfade
 * thresholds consume this single source so they can't diverge.
 */
export function resolveGaitSpeeds(
  profile: LocomotionProfile,
  tuning: PaceTuning,
  slowWalk: boolean,
): ResolvedGaitSpeeds {
  const walkMult = slowWalk ? tuning.slow : tuning.normal
  const walk = profile.walk.speed * walkMult
  const run = Math.max(profile.run.speed * tuning.run, walk * 1.05)
  const crouchWalk = profile.crouchWalk.speed * walkMult
  return {
    walk,
    run,
    sprint: profile.sprint.speed,
    crouchWalk,
    crouchRun: ALS_AUTHORED_GAIT_SPEEDS.crouching.run,
  }
}
