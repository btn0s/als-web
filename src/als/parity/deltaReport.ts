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
] as const

export function getAlsParityDelta(id: string): AlsParityDelta {
  const delta = ALS_PARITY_DELTA_REPORT.find((entry) => entry.id === id)
  if (!delta) throw new Error(`Missing ALS parity delta report entry: ${id}`)
  return delta
}
