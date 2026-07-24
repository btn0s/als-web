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
    id: 'cpp-velocity-normalize-tolerance', // RESOLVED 2026-07-23: UE_SMALL_NUMBER squared-length check in AlsGroundedState
    category: 'bug-in-ours',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:743-751 (FVector3f::Normalize)',
    observed:
      'At |velocity|=5e-5 cm/s, ALS returns ForwardAmount=0 while ours returns 1 (delta 1.0).',
    reason:
      'The runtime compares vector length with Number.EPSILON; Unreal Normalize compares squared length with SMALL_NUMBER (1e-8).',
  },
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
  {
    id: 'cpp-exp-decay',
    category: 'designed deviation',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:767; AlsMath.h:103-115',
    observed:
      'The seeded damped velocity sweep reaches a maximum component delta of 0.0175116885.',
    reason:
      'Runtime uses exact Math.exp decay; ALS calls Unreal InvExpApprox. Target/snap math matches, while damped values differ slightly at finite dt.',
  },
  {
    id: 'cpp-turn-delay-reset',
    category: 'designed deviation',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:1736-1805',
    observed:
      'On emitted requests ours resets to 0 while the seeded C++ oracle retains up to 0.98898691s.',
    reason:
      'Runtime clears activationDelay immediately when it emits a turn request; C++ retains it until the transitions gate resets it on a following frame.',
  },
] as const

export function getAlsParityDelta(id: string): AlsParityDelta {
  const delta = ALS_PARITY_DELTA_REPORT.find((entry) => entry.id === id)
  if (!delta) throw new Error(`Missing ALS parity delta report entry: ${id}`)
  return delta
}
