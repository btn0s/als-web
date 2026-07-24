/**
 * First full parity-harness run delta ledger.
 *
 * This is executable test evidence rather than a standing prose/history document. Tests assert
 * that every deliberately non-failing mismatch or skip has an entry here.
 */

export type AlsParityDeltaCategory =
  | 'bug in ours'
  | 'designed deviation'
  | 'unported'

export interface AlsParityDelta {
  readonly id: string
  readonly category: AlsParityDeltaCategory
  readonly oracle: 'C++ differential' | 'content-derived pose'
  readonly reason: string
}

export const ALS_PARITY_DELTA_REPORT: readonly AlsParityDelta[] = [
  {
    id: 'cpp-relative-acceleration',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'No runtime GetRelativeAccelerationAmount seam; ALS performs a 3D magnitude clamp before discarding local Z.',
  },
  {
    id: 'cpp-pose-unweighted',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'Runtime refreshPose exposes only GaitAmount and its three ramps; raw Pose* and UnweightedGaitAmount fields are absent.',
  },
  {
    id: 'cpp-lean',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'RefreshGroundedLean and RefreshInAirLean have no runtime state seam.',
  },
  {
    id: 'cpp-look',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'RefreshLook interpolation and its body-turn direction bias are not ported.',
  },
  {
    id: 'cpp-spine',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'RefreshSpine amount/scale/bias continuity machinery is not ported.',
  },
  {
    id: 'cpp-foot-lock',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'Runtime samples FootLock curves for debug state but has no ALS latch/decrease/capture/angle-limit state machine.',
  },
  {
    id: 'cpp-quick-stop',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'PlayQuickStopAnimation yaw-remap, side selection, and unclamped play-rate mapping are not ported.',
  },
  {
    id: 'cpp-ground-prediction',
    category: 'unported',
    oracle: 'C++ differential',
    reason:
      'No runtime RefreshGroundPrediction mapping seam exists; Rapier sweep integration is also absent.',
  },
  {
    id: 'cpp-exp-decay',
    category: 'designed deviation',
    oracle: 'C++ differential',
    reason:
      'Runtime uses exact Math.exp decay; ALS calls Unreal InvExpApprox. Target/snap math matches, while damped values differ slightly at finite dt.',
  },
  {
    id: 'cpp-turn-delay-reset',
    category: 'designed deviation',
    oracle: 'C++ differential',
    reason:
      'Runtime clears activationDelay immediately when it emits a turn request; C++ retains it until the transitions gate resets it on a following frame.',
  },
  {
    id: 'content-rifle-lower-body',
    category: 'bug in ours',
    oracle: 'content-derived pose',
    reason:
      'First-run observation: rifle pose-bank LayerPelvis/LayerLegs ownership can replace crouching base locals; final recheck decides whether the parallel overlay correction resolved it.',
  },
  {
    id: 'content-rifle-ik-hand-gun',
    category: 'bug in ours',
    oracle: 'content-derived pose',
    reason:
      'First-run observation: ik_hand_gun is outside the current Layer* region predicates, so final rifle output does not trace to the rifle source track.',
  },
] as const

export function getAlsParityDelta(id: string): AlsParityDelta {
  const delta = ALS_PARITY_DELTA_REPORT.find((entry) => entry.id === id)
  if (!delta) throw new Error(`Missing ALS parity delta report entry: ${id}`)
  return delta
}
