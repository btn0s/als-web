import type { ClipCurveSamplers } from '../../engine/curves'
import { ALS_LAYER_REGIONS } from '../Utility/AlsConstants'
import type { AlsLayerRegion, RegionName } from '../Utility/AlsConstants'

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
 * VERIFIED from AB_Als_Rifle.uasset's tagged properties:
 *
 *   dotnet run -- inspect <stage> AB_Als_Rifle <out.json>
 *
 * Default__AB_Als_Rifle_C serializes every Sequence Evaluator ExplicitTime, while
 * BakedStateMachines and the graph's Idle/Standing/Crouching comments identify their state
 * branches. The pose bank is twelve frames at 30 fps; evaluators intentionally sample between
 * authored frames. Keep the Relaxed/Ready table here so later state work does not have to probe
 * the Blueprint again.
 */
export const RIFLE_POSE_BANK_EXPLICIT_TIMES = {
  Relaxed: {
    /** Relaxed state's Idle branch; the standing default until its full state graph is ported. */
    standingIdle: 0.05,
    walking: 0.05,
    running: [0, 0.05, 0.216667],
    crouching: 0.05,
    inAir: [0.316667, 0.35],
  },
  Ready: {
    /** TwoWayBlend inputs inside the graph's Standing comment. */
    standing: [0.083333, 0.116667],
    /** Evaluator inside the graph's Crouching comment. */
    crouching: 0.25,
  },
} as const

export const RIFLE_RELAXED_POSE_TIME =
  RIFLE_POSE_BANK_EXPLICIT_TIMES.Relaxed.standingIdle

/**
 * The web port currently exposes one held-Rifle state rather than AB_Als_Rifle's full
 * Relaxed/Ready/Aiming state machine. Preserve its verified standing low-ready pose, but follow
 * the graph's authored crouching evaluator as PoseCrouching blends in. All linked-layer regions,
 * including the root-level IK-hand group, must sample this same stance-selected source.
 */
export function resolveRiflePoseBankTime(crouchingAmount: number) {
  const stanceAlpha = clamp01(crouchingAmount)
  return RIFLE_RELAXED_POSE_TIME
    + (
      RIFLE_POSE_BANK_EXPLICIT_TIMES.Ready.crouching
      - RIFLE_RELAXED_POSE_TIME
    ) * stanceAlpha
}

export interface RifleOverlayRegionPolicy {
  readonly region: RegionName
  readonly layer?: AlsLayerRegion
  readonly baseCurve: string
  /**
   * AB_Als_Layering first installs the linked-layer pose for additive regions, then reapplies
   * locomotion delta using the authored Layer*Additive/LocalSpace curve. This distinguishes that
   * graph operation from a plain replacement even though both need an evaluator overlay entry.
   */
  readonly composition: 'replace' | 'locomotionAdditive'
  /** Optional IK-specific gate layered on top of the owning arm's Layer* curve. */
  readonly ikCurve?: string
}

const layerByRegion = new Map(ALS_LAYER_REGIONS.map((layer) => [layer.region, layer]))

function rifleLayer(
  region: AlsLayerRegion['region'],
  composition: RifleOverlayRegionPolicy['composition'],
): RifleOverlayRegionPolicy {
  const layer = layerByRegion.get(region)!
  return { region, layer, baseCurve: layer.baseCurve, composition }
}

/**
 * Rifle linked-layer ownership.
 *
 * VERIFIED: Content/ALS/Character/AnimationInstances/Overlays/AB_Als_Rifle.uasset implements
 * ALI_Overlay, and its Relaxed graph blends full-pose Sequence Evaluators with arms-only run /
 * sprint players. A_Als_Rifle_Poses carries the Layer* curves consumed by AB_Als_Layering.
 * AB_Als_Layering.uasset's hand branch filters also name both
 * `VB hand_*_to_ik_hand_gun` virtual bones. ALS's Rifle character preserves its locomotion legs
 * and visibly crouches while holding the rifle.
 *
 * INFERRED where AB_Als_Rifle's compiled linked-layer graph is opaque: arms/hands are the
 * replacement slots, spine/head use the already-ported additive slots, and pelvis/legs are absent
 * so locomotion passes through. The IK-hand chain follows the corresponding arm source;
 * A_Als_Rifle_Poses authors HandLeftIk, while the right chain falls back to LayerArmRight because
 * that asset does not author HandRightIk. This policy is independently pinned by the crouch and
 * gun-height evaluator regressions.
 */
export const RIFLE_OVERLAY_REGION_POLICY: readonly RifleOverlayRegionPolicy[] = [
  rifleLayer('head', 'locomotionAdditive'),
  rifleLayer('armLeft', 'replace'),
  rifleLayer('armRight', 'replace'),
  rifleLayer('handLeft', 'replace'),
  rifleLayer('handRight', 'replace'),
  rifleLayer('spine', 'locomotionAdditive'),
  {
    region: 'ikHandLeft',
    baseCurve: 'LayerArmLeft',
    ikCurve: 'HandLeftIk',
    composition: 'replace',
  },
  {
    region: 'ikHandRight',
    baseCurve: 'LayerArmRight',
    ikCurve: 'HandRightIk',
    composition: 'replace',
  },
] as const

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

export function sampleRifleOverlayPolicyWeight(
  source: OverlayCurveSource,
  policy: RifleOverlayRegionPolicy,
): number {
  const layerAmount = source.curves?.[policy.baseCurve]?.(source.time) ?? 0
  if (!policy.ikCurve) return clamp01(layerAmount)
  const ikSampler = source.curves?.[policy.ikCurve]
  // HandRightIk is an AnimGraph default for this bank rather than an authored asset curve. When
  // the active source does author an IK curve (HandLeftIk does), it remains authoritative.
  const ikAmount = ikSampler ? ikSampler(source.time) : 1
  return clamp01(layerAmount * ikAmount)
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
