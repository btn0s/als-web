import type { LocalPoseBuffer } from './poseBuffer'

export type UeCurveValues = ReadonlyMap<string, number>

export interface UePoseNode {
  readonly pose: LocalPoseBuffer
  readonly curves: UeCurveValues
}

export interface MutableUePoseNode {
  readonly pose: LocalPoseBuffer
  readonly curves: Map<string, number>
}

const QUATERNION_NORMALIZE_TOLERANCE = 1e-8

function assertCompatiblePose(
  source: LocalPoseBuffer,
  out: LocalPoseBuffer,
) {
  if (source.boneCount !== out.boneCount) {
    throw new Error(
      `Pose bone-count mismatch: ${source.boneCount} !== ${out.boneCount}`,
    )
  }
}

function writeNormalizedQuaternion(
  out: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const squareLength = x * x + y * y + z * z + w * w
  if (squareLength < QUATERNION_NORMALIZE_TOLERANCE) {
    out[offset] = 0
    out[offset + 1] = 0
    out[offset + 2] = 0
    out[offset + 3] = 1
    return
  }

  const inverseLength = 1 / Math.sqrt(squareLength)
  out[offset] = x * inverseLength
  out[offset + 1] = y * inverseLength
  out[offset + 2] = z * inverseLength
  out[offset + 3] = w * inverseLength
}

/**
 * Ports FAnimationRuntime::BlendTwoPosesTogether. `weightOfPoseOne` deliberately
 * follows Unreal's convention; pose two receives the complementary weight.
 *
 * Each transform atom is summed by weight and its quaternion is normalized once
 * at this node boundary. This is normalized linear blending, not SLERP.
 */
export function blendTwoPosesTogether(
  sourcePoseOne: LocalPoseBuffer,
  sourcePoseTwo: LocalPoseBuffer,
  weightOfPoseOne: number,
  out: LocalPoseBuffer,
): LocalPoseBuffer {
  assertCompatiblePose(sourcePoseOne, out)
  assertCompatiblePose(sourcePoseTwo, out)
  const weightOfPoseTwo = 1 - weightOfPoseOne

  for (let bone = 0; bone < out.boneCount; bone++) {
    const p = bone * 3
    const q = bone * 4

    for (let component = 0; component < 3; component++) {
      out.positions[p + component] =
        sourcePoseOne.positions[p + component] * weightOfPoseOne
        + sourcePoseTwo.positions[p + component] * weightOfPoseTwo
      out.scales[p + component] =
        sourcePoseOne.scales[p + component] * weightOfPoseOne
        + sourcePoseTwo.scales[p + component] * weightOfPoseTwo
    }

    const oneX = sourcePoseOne.rotations[q]
    const oneY = sourcePoseOne.rotations[q + 1]
    const oneZ = sourcePoseOne.rotations[q + 2]
    const oneW = sourcePoseOne.rotations[q + 3]
    let twoWeight = weightOfPoseTwo
    if (
      (oneX * weightOfPoseOne) * sourcePoseTwo.rotations[q]
      + (oneY * weightOfPoseOne) * sourcePoseTwo.rotations[q + 1]
      + (oneZ * weightOfPoseOne) * sourcePoseTwo.rotations[q + 2]
      + (oneW * weightOfPoseOne) * sourcePoseTwo.rotations[q + 3] < 0
    ) {
      twoWeight = -twoWeight
    }
    writeNormalizedQuaternion(
      out.rotations,
      q,
      oneX * weightOfPoseOne + sourcePoseTwo.rotations[q] * twoWeight,
      oneY * weightOfPoseOne + sourcePoseTwo.rotations[q + 1] * twoWeight,
      oneZ * weightOfPoseOne + sourcePoseTwo.rotations[q + 2] * twoWeight,
      oneW * weightOfPoseOne + sourcePoseTwo.rotations[q + 3] * twoWeight,
    )
  }

  return out
}

/**
 * Ports FAnimationRuntime::BlendPosesTogether. Like Unreal's lightweight
 * primitive, this does not cull weights or normalize their sum; the authored
 * graph node owns that policy.
 */
export function blendPosesTogether(
  sourcePoses: readonly LocalPoseBuffer[],
  sourceWeights: ArrayLike<number>,
  out: LocalPoseBuffer,
): LocalPoseBuffer {
  return blendPoseCollection(sourcePoses, sourceWeights, out, false)
}

function blendPoseCollection(
  sources: readonly LocalPoseBuffer[] | readonly UePoseNode[],
  sourceWeights: ArrayLike<number>,
  out: LocalPoseBuffer,
  sourcesAreNodes: boolean,
): LocalPoseBuffer {
  if (sources.length === 0) {
    throw new Error('Pose blend requires at least one source')
  }
  if (sources.length !== sourceWeights.length) {
    throw new Error(
      `Pose/weight count mismatch: ${sources.length} !== ${sourceWeights.length}`,
    )
  }
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sourcesAreNodes
      ? (sources as readonly UePoseNode[])[sourceIndex].pose
      : (sources as readonly LocalPoseBuffer[])[sourceIndex]
    assertCompatiblePose(source, out)
  }

  for (let bone = 0; bone < out.boneCount; bone++) {
    const p = bone * 3
    const q = bone * 4
    let positionX = 0
    let positionY = 0
    let positionZ = 0
    let scaleX = 0
    let scaleY = 0
    let scaleZ = 0
    let rotationX = 0
    let rotationY = 0
    let rotationZ = 0
    let rotationW = 0

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sourcesAreNodes
        ? (sources as readonly UePoseNode[])[sourceIndex].pose
        : (sources as readonly LocalPoseBuffer[])[sourceIndex]
      const weight = sourceWeights[sourceIndex]
      positionX += source.positions[p] * weight
      positionY += source.positions[p + 1] * weight
      positionZ += source.positions[p + 2] * weight
      scaleX += source.scales[p] * weight
      scaleY += source.scales[p + 1] * weight
      scaleZ += source.scales[p + 2] * weight

      let rotationWeight = weight
      if (
        rotationX * source.rotations[q]
        + rotationY * source.rotations[q + 1]
        + rotationZ * source.rotations[q + 2]
        + rotationW * source.rotations[q + 3] < 0
      ) {
        rotationWeight = -rotationWeight
      }
      rotationX += source.rotations[q] * rotationWeight
      rotationY += source.rotations[q + 1] * rotationWeight
      rotationZ += source.rotations[q + 2] * rotationWeight
      rotationW += source.rotations[q + 3] * rotationWeight
    }

    out.positions[p] = positionX
    out.positions[p + 1] = positionY
    out.positions[p + 2] = positionZ
    out.scales[p] = scaleX
    out.scales[p + 1] = scaleY
    out.scales[p + 2] = scaleZ
    writeNormalizedQuaternion(
      out.rotations,
      q,
      rotationX,
      rotationY,
      rotationZ,
      rotationW,
    )
  }

  return out
}

function assertDistinctCurveOutput(
  source: UeCurveValues,
  out: Map<string, number>,
) {
  if (source === out) {
    throw new Error('Curve blend output must not alias a source')
  }
}

/** Blends Unreal curve containers as a weighted union; an absent curve contributes zero. */
export function blendTwoCurvesTogether(
  sourceCurveOne: UeCurveValues,
  sourceCurveTwo: UeCurveValues,
  weightOfCurveOne: number,
  out: Map<string, number>,
): Map<string, number> {
  assertDistinctCurveOutput(sourceCurveOne, out)
  assertDistinctCurveOutput(sourceCurveTwo, out)
  out.clear()
  const weightOfCurveTwo = 1 - weightOfCurveOne
  for (const [name, value] of sourceCurveOne) {
    out.set(name, value * weightOfCurveOne)
  }
  for (const [name, value] of sourceCurveTwo) {
    out.set(name, (out.get(name) ?? 0) + value * weightOfCurveTwo)
  }
  return out
}

/** Multi-way counterpart to `blendTwoCurvesTogether`; weights are not normalized. */
export function blendCurves(
  sourceCurves: readonly UeCurveValues[],
  sourceWeights: ArrayLike<number>,
  out: Map<string, number>,
): Map<string, number> {
  if (sourceCurves.length !== sourceWeights.length) {
    throw new Error(
      `Curve/weight count mismatch: ${sourceCurves.length} !== ${sourceWeights.length}`,
    )
  }
  for (const source of sourceCurves) assertDistinctCurveOutput(source, out)
  out.clear()
  for (let sourceIndex = 0; sourceIndex < sourceCurves.length; sourceIndex++) {
    const weight = sourceWeights[sourceIndex]
    for (const [name, value] of sourceCurves[sourceIndex]) {
      out.set(name, (out.get(name) ?? 0) + value * weight)
    }
  }
  return out
}

/** Evaluates one authored two-way graph node, preserving its normalization boundary. */
export function blendTwoPoseNodesTogether(
  sourceOne: UePoseNode,
  sourceTwo: UePoseNode,
  weightOfSourceOne: number,
  out: MutableUePoseNode,
): MutableUePoseNode {
  assertDistinctCurveOutput(sourceOne.curves, out.curves)
  assertDistinctCurveOutput(sourceTwo.curves, out.curves)
  blendTwoPosesTogether(
    sourceOne.pose,
    sourceTwo.pose,
    weightOfSourceOne,
    out.pose,
  )
  blendTwoCurvesTogether(
    sourceOne.curves,
    sourceTwo.curves,
    weightOfSourceOne,
    out.curves,
  )
  return out
}

/** Evaluates one authored multi-way graph node without flattening its child nodes. */
export function blendPoseNodesTogether(
  sources: readonly UePoseNode[],
  sourceWeights: ArrayLike<number>,
  out: MutableUePoseNode,
): MutableUePoseNode {
  if (sources.length !== sourceWeights.length) {
    throw new Error(
      `Curve/weight count mismatch: ${sources.length} !== ${sourceWeights.length}`,
    )
  }
  for (const source of sources) {
    assertDistinctCurveOutput(source.curves, out.curves)
  }
  blendPoseCollection(sources, sourceWeights, out.pose, true)
  out.curves.clear()
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const weight = sourceWeights[sourceIndex]
    for (const [name, value] of sources[sourceIndex].curves) {
      out.curves.set(
        name,
        (out.curves.get(name) ?? 0) + value * weight,
      )
    }
  }
  return out
}
