import * as THREE from 'three'

const EPSILON = 1e-6

export interface TwoBoneIkResult {
  /** Reused output: the knee position that satisfies both bone lengths. */
  kneePosition: THREE.Vector3
  /** Reused output: target clamped to the chain's reachable range. */
  anklePosition: THREE.Vector3
  /** Hip-to-ankle distance after reach clamping. */
  distance: number
  /** True when the requested target was farther away than the chain can reach. */
  clamped: boolean
}

export interface TwoBoneIkScratch {
  toTarget: THREE.Vector3
  bend: THREE.Vector3
  fallback: THREE.Vector3
}

export function createTwoBoneIkResult(): TwoBoneIkResult {
  return {
    kneePosition: new THREE.Vector3(),
    anklePosition: new THREE.Vector3(),
    distance: 0,
    clamped: false,
  }
}

export function createTwoBoneIkScratch(): TwoBoneIkScratch {
  return {
    toTarget: new THREE.Vector3(),
    bend: new THREE.Vector3(),
    fallback: new THREE.Vector3(),
  }
}

/**
 * Pure analytic hip -> knee -> ankle position solve. `poleDirection` is a world-space direction
 * from the hip toward the side of the chain on which the knee should lie. The solver projects it
 * perpendicular to the hip/target axis, so it controls bend without changing reach.
 *
 * All outputs and scratch storage are supplied by the caller; this function allocates nothing.
 */
export function solveTwoBoneIk(
  hipPosition: THREE.Vector3,
  currentKneePosition: THREE.Vector3,
  targetAnklePosition: THREE.Vector3,
  upperLength: number,
  lowerLength: number,
  poleDirection: THREE.Vector3,
  out: TwoBoneIkResult,
  scratch: TwoBoneIkScratch,
): TwoBoneIkResult {
  const maxReach = Math.max(upperLength + lowerLength, EPSILON)
  const minReach = Math.max(Math.abs(upperLength - lowerLength), EPSILON)
  const requestedDistance = scratch.toTarget.subVectors(targetAnklePosition, hipPosition).length()
  const distance = THREE.MathUtils.clamp(requestedDistance, minReach, maxReach)

  if (requestedDistance > EPSILON) scratch.toTarget.multiplyScalar(1 / requestedDistance)
  else scratch.toTarget.set(0, -1, 0)

  out.anklePosition.copy(hipPosition).addScaledVector(scratch.toTarget, distance)
  out.distance = distance
  out.clamped = requestedDistance > maxReach

  // Project the requested pole into the plane perpendicular to the chain axis.
  scratch.bend.copy(poleDirection)
  scratch.bend.addScaledVector(scratch.toTarget, -scratch.bend.dot(scratch.toTarget))
  if (scratch.bend.lengthSq() < EPSILON * EPSILON) {
    // A parallel/zero pole cannot define a bend plane. Preserve the animated knee's side first;
    // only use a deterministic perpendicular when the current chain is straight too.
    scratch.bend.subVectors(currentKneePosition, hipPosition)
    scratch.bend.addScaledVector(scratch.toTarget, -scratch.bend.dot(scratch.toTarget))
    if (scratch.bend.lengthSq() < EPSILON * EPSILON) {
      scratch.fallback.set(0, 1, 0)
      if (Math.abs(scratch.fallback.dot(scratch.toTarget)) > 0.99) scratch.fallback.set(1, 0, 0)
      scratch.bend.crossVectors(scratch.toTarget, scratch.fallback)
    }
  }
  scratch.bend.normalize()

  // Law of cosines, expressed as axial distance from hip plus perpendicular bend height.
  const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance)
  const bendHeight = Math.sqrt(Math.max(upperLength * upperLength - along * along, 0))
  out.kneePosition
    .copy(hipPosition)
    .addScaledVector(scratch.toTarget, along)
    .addScaledVector(scratch.bend, bendHeight)

  return out
}
