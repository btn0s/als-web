import type { LocalPoseBuffer } from '../../engine/poseBuffer'

/**
 * Framework-free counterpart of ALS Refactored's
 * `FAlsRagdollingAnimationState`.
 *
 * `null` is the honest equivalent of the default invalid `FPoseSnapshot`.
 * Snapshot capture and physics handoff remain animation-runtime concerns.
 */
export interface AlsRagdollingAnimationState {
  FinalRagdollPose: LocalPoseBuffer | null
  FlailPlayRate: number
}

export function createAlsRagdollingAnimationState(
): AlsRagdollingAnimationState {
  // State/AlsRagdollingAnimationState.h:11-15.
  return {
    FinalRagdollPose: null,
    FlailPlayRate: 1,
  }
}
