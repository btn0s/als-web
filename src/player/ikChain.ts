import * as THREE from 'three'
import {
  createTwoBoneIkResult,
  createTwoBoneIkScratch,
  solveTwoBoneIk,
  type TwoBoneIkResult,
  type TwoBoneIkScratch,
} from './footIk'

/**
 * A three-bone transform chain driven by a two-segment positional solve. The anatomical names
 * match the existing foot-IK implementation, but shoulders/elbows/hands intentionally use the
 * same shape: `hip` is the root joint, `knee` the bend joint, and `ankle` the end effector.
 *
 * Operative resolves rig bones as nullable, so this shape accepts the records it already owns and
 * the apply helper preserves the existing "missing chain = skip" behavior. When present, both
 * driven joints must have parents, just as the inline implementations require when converting
 * target world rotations back into local bone rotations.
 */
export interface TwoBoneIkChain {
  hip: THREE.Bone | null
  knee: THREE.Bone | null
  ankle: THREE.Bone | null
}

/**
 * The historical call sites disagree about which root transform should be present while deriving
 * the lower-joint target:
 *
 * - `sequential` is the hang-arm behavior: blend the shoulder first, then derive and blend elbow.
 * - `full-root-first` is the foot behavior: derive the knee target under the FULL hip target, then
 *   restore and independently blend both joints.
 *
 * Keeping this choice explicit prevents the TD 4.1 dedupe from silently "fixing" TD 4.2.
 */
export type TwoBoneIkApplyMode = 'sequential' | 'full-root-first'

/**
 * Caller-owned storage for `applyTwoBoneIkToChain`. It intentionally mirrors the fields already
 * carried by Operative's arm/leg records, so wave 2 can initially pass those records themselves as
 * scratch without allocating or reshaping anything per frame. New call sites should create this
 * once with `createTwoBoneIkChainScratch`.
 */
export interface TwoBoneIkChainScratch {
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

/** Creates reusable storage for chain application. Allocate once, never in a frame loop. */
export function createTwoBoneIkChainScratch(): TwoBoneIkChainScratch {
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
 * Solves and applies a positional two-bone IK target through world-delta → local-quaternion edits.
 * The function is three-only, mutates only the supplied chain/scratch, and allocates nothing.
 *
 * Partial weight is intentionally historical rather than end-effector-correct. In
 * `full-root-first` mode the knee target is computed while the hip is at its full target rotation,
 * after which hip and knee are independently slerped from their animated rotations. At weights
 * between 0 and 1 the resulting ankle therefore is not guaranteed to approach `target` smoothly;
 * that is the explicitly deferred TD 4.2 behavior, not something TD 4.1 may change.
 *
 * Wave-2 Operative mapping:
 *
 * - hang arm: `applyTwoBoneIkToChain(arm, arm.target, arm.poleDirection, s.weight, 'sequential',
 *   arm)`, then keep the existing caller-owned hand grip-orientation slerp unchanged.
 * - foot: `applyTwoBoneIkToChain(leg, leg.target, leg.poleDirection, leg.weight,
 *   'full-root-first', leg)`; feet currently have no separate ankle-orientation step.
 *
 * The current arm/leg state objects already satisfy both `TwoBoneIkChain` and
 * `TwoBoneIkChainScratch`. Wave 2 may instead consolidate their scratch fields under one
 * `createTwoBoneIkChainScratch()` result without changing this algorithm.
 *
 * Returns the reused positional solve result for optional diagnostics, or `null` for an unresolved
 * chain (matching the existing call-site guard); callers need not consume it. The end-effector's
 * own local quaternion is never edited, leaving grip/sole orientation to a caller-supplied
 * post-step.
 */
export function applyTwoBoneIkToChain(
  chain: TwoBoneIkChain,
  target: THREE.Vector3,
  poleDirection: THREE.Vector3,
  weight: number,
  mode: TwoBoneIkApplyMode,
  scratch: TwoBoneIkChainScratch,
): TwoBoneIkResult | null {
  const { hip, knee, ankle } = chain
  if (!hip || !knee || !ankle) return null

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

  // `deltaQuaternion` is a world-space rotation from the animated upper-bone direction to the
  // solved direction. Multiplying it onto the current bone world rotation and premultiplying by
  // the inverse parent world rotation reproduces the target in the bone's local frame.
  scratch.upperDirection.subVectors(scratch.kneePosition, scratch.hipPosition).normalize()
  scratch.desiredDirection
    .subVectors(scratch.solveResult.kneePosition, scratch.hipPosition)
    .normalize()
  scratch.deltaQuaternion.setFromUnitVectors(scratch.upperDirection, scratch.desiredDirection)
  hip.getWorldQuaternion(scratch.boneWorldQuaternion)
  scratch.targetHipQuaternion.copy(scratch.deltaQuaternion).multiply(scratch.boneWorldQuaternion)
  hip.parent!.getWorldQuaternion(scratch.parentQuaternion).invert()
  scratch.targetHipQuaternion.premultiply(scratch.parentQuaternion)

  // This is the one intentional call-site divergence. The arm observes its partially weighted
  // shoulder; the foot observes the full target hip and only restores partial weight afterward.
  if (mode === 'sequential') {
    hip.quaternion
      .copy(scratch.originalHipQuaternion)
      .slerp(scratch.targetHipQuaternion, weight)
  } else {
    hip.quaternion.copy(scratch.targetHipQuaternion)
  }
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

  if (mode === 'full-root-first') {
    hip.quaternion
      .copy(scratch.originalHipQuaternion)
      .slerp(scratch.targetHipQuaternion, weight)
  }
  knee.quaternion
    .copy(scratch.originalKneeQuaternion)
    .slerp(scratch.targetKneeQuaternion, weight)

  // Match the inline hierarchy refresh exactly: the sequential arm path updates the lower joint
  // before its caller's grip step; the foot path refreshes from the restored/blended hip once.
  if (mode === 'sequential') knee.updateWorldMatrix(false, true)
  else hip.updateWorldMatrix(false, true)

  return scratch.solveResult
}
