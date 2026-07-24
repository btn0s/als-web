/**
 * Final parity-harness delta ledger.
 *
 * This is executable test evidence rather than a standing prose/history document. Tests assert
 * that every deliberately non-failing mismatch or skip has an entry here.
 */

export type AlsParityDeltaCategory =
  | 'bug-in-ours'
  | 'designed deviation'
  | 'unported system'

export interface AlsParityDelta {
  readonly id: string
  readonly category: AlsParityDeltaCategory
  readonly oracle: 'C++ differential' | 'content-derived pose'
  readonly source: string
  readonly observed: string
  readonly reason: string
}

export const ALS_PARITY_DELTA_REPORT: readonly AlsParityDelta[] = [
  {
    id: 'cpp-relative-acceleration',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:713-733',
    observed: 'No runtime value exists to compare.',
    reason:
      'No runtime GetRelativeAccelerationAmount seam; ALS performs a 3D magnitude clamp before discarding local Z.',
  },
  {
    id: 'cpp-pose-unweighted',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:313-351',
    observed:
      'GaitAmount and its three ramps match; six raw Pose* fields and four unweighted gait fields have no runtime representation.',
    reason:
      'Runtime refreshPose exposes only GaitAmount and its three ramps; raw Pose* and UnweightedGaitAmount fields are absent.',
  },
  {
    id: 'cpp-lean',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:787-803, 1102-1126',
    observed: 'Neither grounded nor in-air LeanState has a runtime representation.',
    reason:
      'RefreshGroundedLean and RefreshInAirLean have no runtime state seam.',
  },
  {
    id: 'cpp-look',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:494-581',
    observed: 'No runtime LookState exists to compare.',
    reason:
      'RefreshLook interpolation and its body-turn direction bias are not ported.',
  },
  {
    id: 'cpp-spine',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:386-487',
    observed: 'No runtime SpineState exists to compare.',
    reason:
      'RefreshSpine amount/scale/bias continuity machinery is not ported.',
  },
  {
    id: 'cpp-foot-lock',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:1179-1376',
    observed:
      'Runtime curve debug values exist, but no teleport/base-change/lock transform state can be compared.',
    reason:
      'Runtime samples FootLock curves for debug state but has no ALS latch/decrease/capture/angle-limit state machine.',
  },
  {
    id: 'cpp-quick-stop',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:1378-1414',
    observed: 'No runtime quick-stop request or play-rate value exists to compare.',
    reason:
      'PlayQuickStopAnimation yaw-remap, side selection, and unclamped play-rate mapping are not ported.',
  },
  {
    id: 'cpp-ground-prediction',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:1028-1100',
    observed: 'No runtime sweep vector or GroundPredictionAmount exists to compare.',
    reason:
      'No runtime RefreshGroundPrediction mapping seam exists; Rapier sweep integration is also absent.',
  },
] as const

export function getAlsParityDelta(id: string): AlsParityDelta {
  const delta = ALS_PARITY_DELTA_REPORT.find((entry) => entry.id === id)
  if (!delta) throw new Error(`Missing ALS parity delta report entry: ${id}`)
  return delta
}
