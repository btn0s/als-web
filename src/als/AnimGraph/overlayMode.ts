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
  sprintImpulseArms: 'A_Als_Rifle_Sprint_Impulse_Arms',
} as const

export const DEFAULT_OVERLAY_CLIP = 'A_Als_Default_Poses'

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
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
