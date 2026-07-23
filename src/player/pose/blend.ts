import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

export type BoneMask = Float32Array
export type BonePredicate = (boneName: string) => boolean

export interface PoseAccumulator {
  readonly boneCount: number
  readonly positions: Float32Array
  readonly rotations: Float32Array
  readonly scales: Float32Array
  readonly weights: Float32Array
}

export interface MeshSpaceBlendScratch {
  readonly boneCount: number
  readonly baseRotations: Float32Array
  readonly outputRotations: Float32Array
}

export function compileBoneMask(
  rig: RigDefinition,
  predicate: BonePredicate,
  alpha = 1,
): BoneMask {
  const mask = new Float32Array(rig.boneCount)
  for (let i = 0; i < rig.boneCount; i++) {
    mask[i] = predicate(rig.boneNames[i]) ? alpha : 0
  }
  return mask
}

export function createPoseAccumulator(boneCount: number): PoseAccumulator {
  return {
    boneCount,
    positions: new Float32Array(boneCount * 3),
    rotations: new Float32Array(boneCount * 4),
    scales: new Float32Array(boneCount * 3),
    weights: new Float32Array(boneCount),
  }
}

export function createMeshSpaceBlendScratch(boneCount: number): MeshSpaceBlendScratch {
  return {
    boneCount,
    baseRotations: new Float32Array(boneCount * 4),
    outputRotations: new Float32Array(boneCount * 4),
  }
}

export function clearPoseAccumulator(accumulator: PoseAccumulator): PoseAccumulator {
  accumulator.positions.fill(0)
  accumulator.rotations.fill(0)
  accumulator.scales.fill(0)
  accumulator.weights.fill(0)
  return accumulator
}

export function accumulatePose(
  accumulator: PoseAccumulator,
  pose: LocalPoseBuffer,
  weight: number,
  mask?: BoneMask,
): PoseAccumulator {
  if (weight <= 0) return accumulator
  if (pose.boneCount !== accumulator.boneCount || (mask && mask.length !== pose.boneCount)) {
    throw new Error('Pose accumulator input has an incompatible bone count')
  }

  for (let bone = 0; bone < pose.boneCount; bone++) {
    const boneWeight = weight * (mask ? mask[bone] : 1)
    if (boneWeight <= 0) continue

    const p = bone * 3
    const q = bone * 4
    accumulator.positions[p] += pose.positions[p] * boneWeight
    accumulator.positions[p + 1] += pose.positions[p + 1] * boneWeight
    accumulator.positions[p + 2] += pose.positions[p + 2] * boneWeight
    accumulator.scales[p] += pose.scales[p] * boneWeight
    accumulator.scales[p + 1] += pose.scales[p + 1] * boneWeight
    accumulator.scales[p + 2] += pose.scales[p + 2] * boneWeight

    let sign = 1
    if (
      accumulator.weights[bone] > 0
      && accumulator.rotations[q] * pose.rotations[q]
        + accumulator.rotations[q + 1] * pose.rotations[q + 1]
        + accumulator.rotations[q + 2] * pose.rotations[q + 2]
        + accumulator.rotations[q + 3] * pose.rotations[q + 3] < 0
    ) {
      sign = -1
    }
    accumulator.rotations[q] += pose.rotations[q] * boneWeight * sign
    accumulator.rotations[q + 1] += pose.rotations[q + 1] * boneWeight * sign
    accumulator.rotations[q + 2] += pose.rotations[q + 2] * boneWeight * sign
    accumulator.rotations[q + 3] += pose.rotations[q + 3] * boneWeight * sign
    accumulator.weights[bone] += boneWeight
  }

  return accumulator
}

export function finalizePose(
  accumulator: PoseAccumulator,
  reference: LocalPoseBuffer,
  out: LocalPoseBuffer,
): LocalPoseBuffer {
  if (
    reference.boneCount !== accumulator.boneCount
    || out.boneCount !== accumulator.boneCount
  ) {
    throw new Error('Pose finalization input has an incompatible bone count')
  }

  for (let bone = 0; bone < accumulator.boneCount; bone++) {
    const p = bone * 3
    const q = bone * 4
    const weight = accumulator.weights[bone]
    if (weight <= 0) {
      out.positions[p] = reference.positions[p]
      out.positions[p + 1] = reference.positions[p + 1]
      out.positions[p + 2] = reference.positions[p + 2]
      out.rotations[q] = reference.rotations[q]
      out.rotations[q + 1] = reference.rotations[q + 1]
      out.rotations[q + 2] = reference.rotations[q + 2]
      out.rotations[q + 3] = reference.rotations[q + 3]
      out.scales[p] = reference.scales[p]
      out.scales[p + 1] = reference.scales[p + 1]
      out.scales[p + 2] = reference.scales[p + 2]
      continue
    }

    const inverseWeight = 1 / weight
    out.positions[p] = accumulator.positions[p] * inverseWeight
    out.positions[p + 1] = accumulator.positions[p + 1] * inverseWeight
    out.positions[p + 2] = accumulator.positions[p + 2] * inverseWeight
    out.scales[p] = accumulator.scales[p] * inverseWeight
    out.scales[p + 1] = accumulator.scales[p + 1] * inverseWeight
    out.scales[p + 2] = accumulator.scales[p + 2] * inverseWeight

    const x = accumulator.rotations[q]
    const y = accumulator.rotations[q + 1]
    const z = accumulator.rotations[q + 2]
    const w = accumulator.rotations[q + 3]
    const inverseLength = 1 / Math.hypot(x, y, z, w)
    out.rotations[q] = x * inverseLength
    out.rotations[q + 1] = y * inverseLength
    out.rotations[q + 2] = z * inverseLength
    out.rotations[q + 3] = w * inverseLength
  }

  return out
}

/**
 * Applies a three.js-style local additive pose in place. Rotation is pre-multiplied
 * (`add * base`) to match ALS local-space layering; translation and scale are additive deltas.
 */
export function applyAdditivePose(
  base: LocalPoseBuffer,
  additive: LocalPoseBuffer,
  weight: number,
  mask?: BoneMask,
): LocalPoseBuffer {
  if (weight <= 0) return base
  if (base.boneCount !== additive.boneCount || (mask && mask.length !== base.boneCount)) {
    throw new Error('Additive pose input has an incompatible bone count')
  }

  for (let bone = 0; bone < base.boneCount; bone++) {
    const alpha = weight * (mask ? mask[bone] : 1)
    if (alpha <= 0) continue
    const p = bone * 3
    const q = bone * 4

    base.positions[p] += additive.positions[p] * alpha
    base.positions[p + 1] += additive.positions[p + 1] * alpha
    base.positions[p + 2] += additive.positions[p + 2] * alpha
    base.scales[p] += additive.scales[p] * alpha
    base.scales[p + 1] += additive.scales[p + 1] * alpha
    base.scales[p + 2] += additive.scales[p + 2] * alpha

    let ax = additive.rotations[q]
    let ay = additive.rotations[q + 1]
    let az = additive.rotations[q + 2]
    let aw = additive.rotations[q + 3]
    if (aw < 0) {
      ax = -ax
      ay = -ay
      az = -az
      aw = -aw
    }
    const dot = Math.min(1, aw)
    let identityWeight = 1 - alpha
    let additiveWeight = alpha
    if (dot < 0.9995) {
      const theta = Math.acos(dot)
      const sinTheta = Math.sin(theta)
      identityWeight = Math.sin((1 - alpha) * theta) / sinTheta
      additiveWeight = Math.sin(alpha * theta) / sinTheta
    }
    ax *= additiveWeight
    ay *= additiveWeight
    az *= additiveWeight
    aw = identityWeight + aw * additiveWeight
    const additiveInverseLength = 1 / Math.hypot(ax, ay, az, aw)
    ax *= additiveInverseLength
    ay *= additiveInverseLength
    az *= additiveInverseLength
    aw *= additiveInverseLength
    const bx = base.rotations[q]
    const by = base.rotations[q + 1]
    const bz = base.rotations[q + 2]
    const bw = base.rotations[q + 3]
    base.rotations[q] = aw * bx + ax * bw + ay * bz - az * by
    base.rotations[q + 1] = aw * by - ax * bz + ay * bw + az * bx
    base.rotations[q + 2] = aw * bz + ax * by - ay * bx + az * bw
    base.rotations[q + 3] = aw * bw - ax * bx - ay * by - az * bz
  }

  return base
}

function multiplyQuaternions(
  out: Float32Array,
  outOffset: number,
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
) {
  out[outOffset] = aw * bx + ax * bw + ay * bz - az * by
  out[outOffset + 1] = aw * by - ax * bz + ay * bw + az * bx
  out[outOffset + 2] = aw * bz + ax * by - ay * bx + az * bw
  out[outOffset + 3] = aw * bw - ax * bx - ay * by - az * bz
}

/**
 * Applies rotation deltas authored in mesh/component space, then converts the result back to the
 * rig's local-pose representation. Translation and scale remain local additive channels.
 */
export function applyMeshSpaceAdditivePose(
  base: LocalPoseBuffer,
  additive: LocalPoseBuffer,
  rig: RigDefinition,
  weight: number,
  scratch: MeshSpaceBlendScratch,
  mask?: BoneMask,
): LocalPoseBuffer {
  if (weight <= 0) return base
  if (
    base.boneCount !== additive.boneCount
    || base.boneCount !== rig.boneCount
    || scratch.boneCount !== base.boneCount
    || (mask && mask.length !== base.boneCount)
  ) {
    throw new Error('Mesh-space additive input has an incompatible bone count')
  }

  for (let bone = 0; bone < base.boneCount; bone++) {
    const parent = rig.parentIndices[bone]
    const p = bone * 3
    const q = bone * 4
    const lx = base.rotations[q]
    const ly = base.rotations[q + 1]
    const lz = base.rotations[q + 2]
    const lw = base.rotations[q + 3]

    if (parent < 0) {
      scratch.baseRotations[q] = lx
      scratch.baseRotations[q + 1] = ly
      scratch.baseRotations[q + 2] = lz
      scratch.baseRotations[q + 3] = lw
    } else {
      const parentOffset = parent * 4
      multiplyQuaternions(
        scratch.baseRotations,
        q,
        scratch.baseRotations[parentOffset],
        scratch.baseRotations[parentOffset + 1],
        scratch.baseRotations[parentOffset + 2],
        scratch.baseRotations[parentOffset + 3],
        lx,
        ly,
        lz,
        lw,
      )
    }

    const alpha = weight * (mask ? mask[bone] : 1)
    base.positions[p] += additive.positions[p] * alpha
    base.positions[p + 1] += additive.positions[p + 1] * alpha
    base.positions[p + 2] += additive.positions[p + 2] * alpha
    base.scales[p] += additive.scales[p] * alpha
    base.scales[p + 1] += additive.scales[p + 1] * alpha
    base.scales[p + 2] += additive.scales[p + 2] * alpha

    let dx = additive.rotations[q]
    let dy = additive.rotations[q + 1]
    let dz = additive.rotations[q + 2]
    let dw = additive.rotations[q + 3]
    if (dw < 0) {
      dx = -dx
      dy = -dy
      dz = -dz
      dw = -dw
    }
    const dot = Math.min(1, dw)
    let identityWeight = 1 - alpha
    let additiveWeight = alpha
    if (dot < 0.9995) {
      const theta = Math.acos(dot)
      const sinTheta = Math.sin(theta)
      identityWeight = Math.sin((1 - alpha) * theta) / sinTheta
      additiveWeight = Math.sin(alpha * theta) / sinTheta
    }
    dx *= additiveWeight
    dy *= additiveWeight
    dz *= additiveWeight
    dw = identityWeight + dw * additiveWeight
    const inverseLength = 1 / Math.hypot(dx, dy, dz, dw)
    dx *= inverseLength
    dy *= inverseLength
    dz *= inverseLength
    dw *= inverseLength

    multiplyQuaternions(
      scratch.outputRotations,
      q,
      dx,
      dy,
      dz,
      dw,
      scratch.baseRotations[q],
      scratch.baseRotations[q + 1],
      scratch.baseRotations[q + 2],
      scratch.baseRotations[q + 3],
    )

    if (parent < 0) {
      base.rotations[q] = scratch.outputRotations[q]
      base.rotations[q + 1] = scratch.outputRotations[q + 1]
      base.rotations[q + 2] = scratch.outputRotations[q + 2]
      base.rotations[q + 3] = scratch.outputRotations[q + 3]
    } else {
      const parentOffset = parent * 4
      multiplyQuaternions(
        base.rotations,
        q,
        -scratch.outputRotations[parentOffset],
        -scratch.outputRotations[parentOffset + 1],
        -scratch.outputRotations[parentOffset + 2],
        scratch.outputRotations[parentOffset + 3],
        scratch.outputRotations[q],
        scratch.outputRotations[q + 1],
        scratch.outputRotations[q + 2],
        scratch.outputRotations[q + 3],
      )
    }
  }

  return base
}
