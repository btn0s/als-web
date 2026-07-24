import type { ClipCurveSamplers } from '../../engine/curves'
import { ALS_LAYER_REGIONS } from '../Utility/AlsConstants'
import type { AlsLayerRegion } from '../Utility/AlsConstants'

export { ALS_LAYER_REGIONS }
export type { AlsLayerRegion }

export const ALS_OVERLAY_MODES = ['Default', 'Rifle'] as const
export type AlsOverlayMode = (typeof ALS_OVERLAY_MODES)[number]

export const RIFLE_OVERLAY_CLIPS = {
  poses: 'A_Als_Rifle_Poses',
  runArms: 'A_Als_Rifle_Run_Arms',
  sprintArms: 'A_Als_Rifle_Sprint_Arms',
} as const

/**
 * AB_Als_Rifle contains Sequence Evaluators at authored fixed times throughout the 12-frame pose
 * bank. Until the Ready/Relaxed state machine is ported, frame 0 is the deterministic
 * standing-relaxed pose and preserves the curves authored on that exact frame.
 */
export const RIFLE_RELAXED_POSE_TIME = 0

export interface RifleOverlaySourceWeights {
  poses: number
  runArms: number
  sprintArms: number
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * The linked rifle layer uses the ALS PoseGait overlapping ramps. Convert those nested ramps into
 * exclusive pose-bank/run-arms/sprint-arms shares so the authored source pose and its curves blend
 * together before AB_Als_Layering consumes them.
 */
export function resolveRifleOverlaySourceWeights(
  gaitAmount: number,
  out: RifleOverlaySourceWeights = { poses: 1, runArms: 0, sprintArms: 0 },
): RifleOverlaySourceWeights {
  const running = clamp01(gaitAmount - 1)
  const sprinting = clamp01(gaitAmount - 2)
  out.poses = 1 - running
  out.runArms = running * (1 - sprinting)
  out.sprintArms = sprinting
  return out
}

export interface OverlayCurveSource {
  readonly curves?: ClipCurveSamplers
  readonly time: number
  readonly weight: number
}

/** Blends an overlay source's own Layer* curve samples; missing curves contribute zero. */
export function blendOverlayCurve(
  sources: readonly OverlayCurveSource[],
  curveName: string,
): number {
  let value = 0
  for (const source of sources) {
    if (source.weight <= 0) continue
    value += (source.curves?.[curveName]?.(source.time) ?? 0) * source.weight
  }
  // Authored zeroes can arrive as tiny negative float noise (for example -4.32134e-8).
  return clamp01(value)
}

/**
 * RefreshLayering's arm-space pair: local follows the authored curve, while mesh remains fully
 * enabled until local reaches full weight (AlsAnimationInstance.cpp:283-297).
 */
export function resolveArmAdditiveSpaceAmounts(localSpaceAmount: number) {
  const local = clamp01(localSpaceAmount)
  return {
    local,
    mesh: local >= 0.999 ? 0 : 1,
  }
}
