import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyTwoBoneIkToChain,
  createTwoBoneIkChainScratch,
  type TwoBoneIkApplyMode,
  type TwoBoneIkChain,
} from './ikChain'
import {
  createTwoBoneIkResult,
  createTwoBoneIkScratch,
  solveTwoBoneIk,
  type TwoBoneIkResult,
  type TwoBoneIkScratch,
} from './footIk'

interface TestChain extends TwoBoneIkChain {
  root: THREE.Bone
  hip: THREE.Bone
  knee: THREE.Bone
  ankle: THREE.Bone
}

interface ReferenceScratch {
  hipPosition: THREE.Vector3
  kneePosition: THREE.Vector3
  anklePosition: THREE.Vector3
  upperDirection: THREE.Vector3
  lowerDirection: THREE.Vector3
  desiredDirection: THREE.Vector3
  parentQuaternion: THREE.Quaternion
  boneWorldQuaternion: THREE.Quaternion
  deltaQuaternion: THREE.Quaternion
  targetHipQuaternion: THREE.Quaternion
  targetKneeQuaternion: THREE.Quaternion
  originalHipQuaternion: THREE.Quaternion
  originalKneeQuaternion: THREE.Quaternion
  solveResult: TwoBoneIkResult
  solveScratch: TwoBoneIkScratch
}

function createReferenceScratch(): ReferenceScratch {
  return {
    hipPosition: new THREE.Vector3(),
    kneePosition: new THREE.Vector3(),
    anklePosition: new THREE.Vector3(),
    upperDirection: new THREE.Vector3(),
    lowerDirection: new THREE.Vector3(),
    desiredDirection: new THREE.Vector3(),
    parentQuaternion: new THREE.Quaternion(),
    boneWorldQuaternion: new THREE.Quaternion(),
    deltaQuaternion: new THREE.Quaternion(),
    targetHipQuaternion: new THREE.Quaternion(),
    targetKneeQuaternion: new THREE.Quaternion(),
    originalHipQuaternion: new THREE.Quaternion(),
    originalKneeQuaternion: new THREE.Quaternion(),
    solveResult: createTwoBoneIkResult(),
    solveScratch: createTwoBoneIkScratch(),
  }
}

/**
 * A deliberately non-axis-aligned hierarchy exercises the important part of the production code:
 * the solver emits world-space directions, while the mutations must land in each bone's local
 * quaternion under already-rotated parents.
 */
function createTestChain(): TestChain {
  const root = new THREE.Bone()
  root.position.set(0.7, 0.4, -0.3)
  root.quaternion.setFromEuler(new THREE.Euler(0.18, -0.31, 0.12))

  const hip = new THREE.Bone()
  hip.position.set(0.15, 1.2, -0.08)
  hip.quaternion.setFromEuler(new THREE.Euler(-0.12, 0.16, 0.09))

  const knee = new THREE.Bone()
  knee.position.set(0.08, -1.05, 0.22)
  knee.quaternion.setFromEuler(new THREE.Euler(0.14, -0.07, 0.11))

  const ankle = new THREE.Bone()
  ankle.position.set(-0.04, -0.88, 0.13)
  ankle.quaternion.setFromEuler(new THREE.Euler(-0.08, 0.05, -0.03))

  root.add(hip)
  hip.add(knee)
  knee.add(ankle)
  root.updateMatrixWorld(true)

  return { root, hip, knee, ankle }
}

/**
 * Independent hang-arm oracle. Keep this mechanically explicit:
 * sharing helper internals here would let a common refactor bug make implementation and oracle pass
 * together. The shoulder is slerped before the elbow target is derived.
 */
function applyHangArmInlineReference(
  chain: TestChain,
  target: THREE.Vector3,
  poleDirection: THREE.Vector3,
  weight: number,
  scratch: ReferenceScratch,
): void {
  const { hip, knee, ankle } = chain

  hip.getWorldPosition(scratch.hipPosition)
  knee.getWorldPosition(scratch.kneePosition)
  ankle.getWorldPosition(scratch.anklePosition)
  const upperLength = scratch.hipPosition.distanceTo(scratch.kneePosition)
  const lowerLength = scratch.kneePosition.distanceTo(scratch.anklePosition)
  solveTwoBoneIk(
    scratch.hipPosition,
    scratch.kneePosition,
    target,
    upperLength,
    lowerLength,
    poleDirection,
    scratch.solveResult,
    scratch.solveScratch,
  )

  scratch.originalHipQuaternion.copy(hip.quaternion)
  scratch.originalKneeQuaternion.copy(knee.quaternion)

  scratch.upperDirection.subVectors(scratch.kneePosition, scratch.hipPosition).normalize()
  scratch.desiredDirection
    .subVectors(scratch.solveResult.kneePosition, scratch.hipPosition)
    .normalize()
  scratch.deltaQuaternion.setFromUnitVectors(scratch.upperDirection, scratch.desiredDirection)
  hip.getWorldQuaternion(scratch.boneWorldQuaternion)
  scratch.targetHipQuaternion.copy(scratch.deltaQuaternion).multiply(scratch.boneWorldQuaternion)
  hip.parent!.getWorldQuaternion(scratch.parentQuaternion).invert()
  scratch.targetHipQuaternion.premultiply(scratch.parentQuaternion)
  hip.quaternion
    .copy(scratch.originalHipQuaternion)
    .slerp(scratch.targetHipQuaternion, weight)
  hip.updateWorldMatrix(false, true)

  knee.getWorldPosition(scratch.kneePosition)
  ankle.getWorldPosition(scratch.anklePosition)
  scratch.lowerDirection.subVectors(scratch.anklePosition, scratch.kneePosition).normalize()
  scratch.desiredDirection
    .subVectors(scratch.solveResult.anklePosition, scratch.solveResult.kneePosition)
    .normalize()
  scratch.deltaQuaternion.setFromUnitVectors(scratch.lowerDirection, scratch.desiredDirection)
  knee.getWorldQuaternion(scratch.boneWorldQuaternion)
  scratch.targetKneeQuaternion.copy(scratch.deltaQuaternion).multiply(scratch.boneWorldQuaternion)
  knee.parent!.getWorldQuaternion(scratch.parentQuaternion).invert()
  scratch.targetKneeQuaternion.premultiply(scratch.parentQuaternion)
  knee.quaternion
    .copy(scratch.originalKneeQuaternion)
    .slerp(scratch.targetKneeQuaternion, weight)
  knee.updateWorldMatrix(false, true)
}

/**
 * Independent foot-chain oracle. Unlike the arm version, it temporarily
 * installs the full hip target before deriving the knee target, then restores/slerps both joints.
 * This is the TD 4.2 caveat under test, not duplication to "clean up" inside the test.
 */
function applyFootInlineReference(
  chain: TestChain,
  target: THREE.Vector3,
  poleDirection: THREE.Vector3,
  weight: number,
  scratch: ReferenceScratch,
): void {
  const { hip, knee, ankle } = chain

  hip.getWorldPosition(scratch.hipPosition)
  knee.getWorldPosition(scratch.kneePosition)
  ankle.getWorldPosition(scratch.anklePosition)
  const upperLength = scratch.hipPosition.distanceTo(scratch.kneePosition)
  const lowerLength = scratch.kneePosition.distanceTo(scratch.anklePosition)
  solveTwoBoneIk(
    scratch.hipPosition,
    scratch.kneePosition,
    target,
    upperLength,
    lowerLength,
    poleDirection,
    scratch.solveResult,
    scratch.solveScratch,
  )

  scratch.originalHipQuaternion.copy(hip.quaternion)
  scratch.originalKneeQuaternion.copy(knee.quaternion)

  scratch.upperDirection.subVectors(scratch.kneePosition, scratch.hipPosition).normalize()
  scratch.desiredDirection
    .subVectors(scratch.solveResult.kneePosition, scratch.hipPosition)
    .normalize()
  scratch.deltaQuaternion.setFromUnitVectors(scratch.upperDirection, scratch.desiredDirection)
  hip.getWorldQuaternion(scratch.boneWorldQuaternion)
  scratch.targetHipQuaternion.copy(scratch.deltaQuaternion).multiply(scratch.boneWorldQuaternion)
  hip.parent!.getWorldQuaternion(scratch.parentQuaternion).invert()
  scratch.targetHipQuaternion.premultiply(scratch.parentQuaternion)
  hip.quaternion.copy(scratch.targetHipQuaternion)
  hip.updateWorldMatrix(false, true)

  knee.getWorldPosition(scratch.kneePosition)
  ankle.getWorldPosition(scratch.anklePosition)
  scratch.lowerDirection.subVectors(scratch.anklePosition, scratch.kneePosition).normalize()
  scratch.desiredDirection
    .subVectors(scratch.solveResult.anklePosition, scratch.solveResult.kneePosition)
    .normalize()
  scratch.deltaQuaternion.setFromUnitVectors(scratch.lowerDirection, scratch.desiredDirection)
  knee.getWorldQuaternion(scratch.boneWorldQuaternion)
  scratch.targetKneeQuaternion.copy(scratch.deltaQuaternion).multiply(scratch.boneWorldQuaternion)
  knee.parent!.getWorldQuaternion(scratch.parentQuaternion).invert()
  scratch.targetKneeQuaternion.premultiply(scratch.parentQuaternion)

  hip.quaternion
    .copy(scratch.originalHipQuaternion)
    .slerp(scratch.targetHipQuaternion, weight)
  knee.quaternion
    .copy(scratch.originalKneeQuaternion)
    .slerp(scratch.targetKneeQuaternion, weight)
  hip.updateWorldMatrix(false, true)
}

function expectChainQuaternionsToMatch(actual: TestChain, expected: TestChain): void {
  expect(actual.hip.quaternion.angleTo(expected.hip.quaternion)).toBeLessThan(1e-6)
  expect(actual.knee.quaternion.angleTo(expected.knee.quaternion)).toBeLessThan(1e-6)
  expect(actual.ankle.quaternion.angleTo(expected.ankle.quaternion)).toBeLessThan(1e-6)
}

const MODES: ReadonlyArray<{
  label: string
  mode: TwoBoneIkApplyMode
  reference: typeof applyHangArmInlineReference
}> = [
  {
    label: 'hang-arm sequential weighting',
    mode: 'sequential',
    reference: applyHangArmInlineReference,
  },
  {
    label: 'foot full-root-first weighting',
    mode: 'full-root-first',
    reference: applyFootInlineReference,
  },
]

describe('applyTwoBoneIkToChain', () => {
  for (const { label, mode, reference } of MODES) {
    describe(label, () => {
      for (const weight of [0, 0.5, 1]) {
        it(`matches the inline oracle at weight ${weight}`, () => {
          const actual = createTestChain()
          const expected = createTestChain()
          const target = new THREE.Vector3()
          actual.hip.getWorldPosition(target)
          target.add(new THREE.Vector3(0.42, -1.38, 0.36))
          const poleDirection = new THREE.Vector3(0.2, 0.1, 1).normalize()

          applyTwoBoneIkToChain(
            actual,
            target,
            poleDirection,
            weight,
            mode,
            createTwoBoneIkChainScratch(),
          )
          reference(
            expected,
            target,
            poleDirection,
            weight,
            createReferenceScratch(),
          )

          expectChainQuaternionsToMatch(actual, expected)
        })
      }
    })
  }
})
