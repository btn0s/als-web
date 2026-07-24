import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import oracleSource from '../../../scripts/extract-als/abp-graph.json?raw'
import {
  ALS_PARITY_ASSET_COVERAGE,
  ALS_PARITY_MACHINE_COVERAGE,
  ALS_PARITY_STAGE_COVERAGE,
  assertAlsParityCoverage,
  getAlsParityMachineKeys,
  getAlsParityTransitionSignatures,
  type AlsParityCoverageStatus,
  type AlsParitySourceEvidence,
} from './alsParityCoverage'

const oracle = JSON.parse(oracleSource)
const root = resolve(import.meta.dirname, '../../..')

function validateEvidence(entry: {
  status: AlsParityCoverageStatus
  evidence?: AlsParitySourceEvidence
}) {
  if (entry.status === 'unported') return expect(entry.evidence).toBeUndefined()
  expect(entry.evidence).toBeDefined()
  for (const evidence of [
    entry.evidence!.definition,
    entry.evidence!.productionCall,
  ].filter(Boolean) as readonly (readonly [string, string])[]) {
    expect(readFileSync(resolve(root, evidence[0]), 'utf8')).toContain(
      evidence[1],
    )
  }
  if (entry.status === 'live' || entry.status === 'partial-live') {
    expect(entry.evidence!.productionCall).toBeDefined()
  }
  if (entry.status === 'implemented-not-live') {
    expect(entry.evidence!.productionCall).toBeUndefined()
  }
  if (entry.evidence!.productionCall) {
    const [definitionPath, definitionPattern] = entry.evidence!.definition
    const [callPath, callPattern] = entry.evidence!.productionCall
    expect(entry.evidence!.productionCall).not.toEqual(entry.evidence!.definition)
    if (definitionPath === callPath) {
      const source = readFileSync(resolve(root, definitionPath), 'utf8')
      const definitionOffset = source.indexOf(definitionPattern)
      const callOffset = source.indexOf(callPattern)
      expect(callPattern.includes(definitionPattern)).toBe(false)
      expect(callOffset).not.toBe(definitionOffset)
    }
  }
}

describe('ALS extracted parity coverage', () => {
  it('accounts for every extracted asset, machine, and inspectable transition signature', () => {
    expect(assertAlsParityCoverage(oracle)).toMatchObject({
      assets: 23,
      machines: 24,
      transitions: 304,
    })
    const transitions = getAlsParityTransitionSignatures(oracle)
    expect(transitions).toHaveLength(304)
    expect(transitions[0]).toMatchObject({
      asset: 'AB_Als_Monolithic',
      machine: 'Crouching States',
      occurrence: 0,
    })
  })

  it('machine-checks every non-unported definition and every claimed production call site', () => {
    for (const entry of [
      ...ALS_PARITY_ASSET_COVERAGE,
      ...ALS_PARITY_MACHINE_COVERAGE,
      ...ALS_PARITY_STAGE_COVERAGE,
    ]) {
      validateEvidence(entry)
    }
  })

  it('rejects practical coverage omissions and duplicate declarations', () => {
    expect(() =>
      assertAlsParityCoverage(
        oracle,
        ALS_PARITY_ASSET_COVERAGE.slice(1),
      ),
    ).toThrow(/asset coverage/)
    expect(() =>
      assertAlsParityCoverage(
        oracle,
        ALS_PARITY_ASSET_COVERAGE,
        [
          ...ALS_PARITY_MACHINE_COVERAGE,
          ALS_PARITY_MACHINE_COVERAGE[0],
        ],
      ),
    ).toThrow(/state-machine coverage/)
  })

  it('rejects a changed serialized transition field rather than relying on its count', () => {
    const mutated = structuredClone(oracle)
    mutated.assets.AB_Als_View
      .stateMachines[0]
      .Transitions[0]
      .CrossfadeDuration = 0.123
    expect(() => assertAlsParityCoverage(mutated)).toThrow(/transition inventory/)
  })

  it('keeps a zero-transition machine in inventory', () => {
    const fixture = {
      assets: {
        AB_Test: {
          stateMachines: [{ MachineName: 'Empty', States: [], Transitions: [] }],
        },
      },
    }
    expect(getAlsParityMachineKeys(fixture)).toEqual(['AB_Test:Empty:0'])
    expect(getAlsParityTransitionSignatures(fixture)).toEqual([])
  })
})
