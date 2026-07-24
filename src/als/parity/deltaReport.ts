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
    id: 'cpp-foot-lock',
    category: 'unported system',
    oracle: 'C++ differential',
    source: 'AlsAnimationInstance.cpp:1179-1376',
    observed:
      'Runtime curve debug values exist, but no teleport/base-change/lock transform state can be compared.',
    reason:
      'Runtime samples FootLock curves for debug state but has no ALS latch/decrease/capture/angle-limit state machine.',
  },
] as const

export function getAlsParityDelta(id: string): AlsParityDelta {
  const delta = ALS_PARITY_DELTA_REPORT.find((entry) => entry.id === id)
  if (!delta) throw new Error(`Missing ALS parity delta report entry: ${id}`)
  return delta
}
