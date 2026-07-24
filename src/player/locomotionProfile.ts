import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'

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
 * the walk mode, applied to both walk and crouch-walk. Single source consumed by BOTH Player
 * (target speed) and Operative (crossfade thresholds), so they can't diverge.
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
