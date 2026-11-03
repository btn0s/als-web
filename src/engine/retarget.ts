import { Matrix4, Quaternion, Vector3 } from 'three'

import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

export interface RetargetAnatomicalFrame {
  readonly bone: string
  readonly childBone: string
  readonly secondaryAxis: readonly [fromBone: string, toBone: string]
}

export interface RetargetProfile {
  readonly anatomicalFrames: ReadonlyArray<RetargetAnatomicalFrame>
  readonly facing: readonly [number, number, number, number]
  readonly mapping: 'identity'
  readonly pelvisMotionBone: string
  readonly rootMotionBone: string
}

export interface RetargetDiagnostics {
  readonly calibratedBoneCount: number
  readonly mappedBoneCount: number
  readonly maxReferenceDirectionErrorDegrees: number
  readonly sourceBoneCount: number
  readonly targetBoneCount: number
  readonly translationScale: number
  readonly unmappedSourceBones: ReadonlyArray<string>
  readonly unmappedTargetBones: ReadonlyArray<string>
}

export interface CompiledRetargeter {
  apply(sourcePose: LocalPoseBuffer, targetPose: LocalPoseBuffer): void
  readonly diagnostics: RetargetDiagnostics
}

export const ALS_TRIPO_HUMANOID_PROFILE: RetargetProfile = {
  anatomicalFrames: [
    {
      bone: 'upperarm_l',
      childBone: 'lowerarm_l',
      secondaryAxis: ['pelvis', 'neck_01'],
    },
    {
      bone: 'lowerarm_l',
      childBone: 'hand_l',
      secondaryAxis: ['pinky_01_l', 'index_01_l'],
    },
    {
      bone: 'hand_l',
      childBone: 'middle_01_l',
      secondaryAxis: ['pinky_01_l', 'index_01_l'],
    },
    {
      bone: 'upperarm_r',
      childBone: 'lowerarm_r',
      secondaryAxis: ['pelvis', 'neck_01'],
    },
    {
      bone: 'lowerarm_r',
      childBone: 'hand_r',
      secondaryAxis: ['pinky_01_r', 'index_01_r'],
    },
    {
      bone: 'hand_r',
      childBone: 'middle_01_r',
      secondaryAxis: ['pinky_01_r', 'index_01_r'],
    },
    {
      bone: 'thigh_l',
      childBone: 'calf_l',
      secondaryAxis: ['foot_l', 'ball_l'],
    },
    {
      bone: 'calf_l',
      childBone: 'foot_l',
      secondaryAxis: ['foot_l', 'ball_l'],
    },
    {
      bone: 'foot_l',
      childBone: 'ball_l',
      secondaryAxis: ['pelvis', 'neck_01'],
    },
    {
      bone: 'thigh_r',
      childBone: 'calf_r',
      secondaryAxis: ['foot_r', 'ball_r'],
    },
    {
      bone: 'calf_r',
      childBone: 'foot_r',
      secondaryAxis: ['foot_r', 'ball_r'],
    },
    {
      bone: 'foot_r',
      childBone: 'ball_r',
      secondaryAxis: ['pelvis', 'neck_01'],
    },
  ],
  facing: [0, 0, 0, 1],
  mapping: 'identity',
  pelvisMotionBone: 'pelvis',
  rootMotionBone: 'root',
}

const QUATERNION_EPSILON = 1e-8

function writeQuaternionProduct(
  output: Float32Array,
  offset: number,
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
): void {
  let x = aw * bx + ax * bw + ay * bz - az * by
  let y = aw * by - ax * bz + ay * bw + az * bx
  let z = aw * bz + ax * by - ay * bx + az * bw
  let w = aw * bw - ax * bx - ay * by - az * bz
  const length = Math.hypot(x, y, z, w)
  if (!Number.isFinite(length) || length <= QUATERNION_EPSILON) {
    throw new Error('Retarget pose contains an invalid quaternion')
  }
  const inverseLength = 1 / length
  x *= inverseLength
  y *= inverseLength
  z *= inverseLength
  w *= inverseLength
  output[offset] = x
  output[offset + 1] = y
  output[offset + 2] = z
  output[offset + 3] = w
}

function writeComponentRotations(
  localRotations: Float32Array,
  rig: RigDefinition,
  output: Float32Array,
): void {
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const offset = bone * 4
    const parent = rig.parentIndices[bone]
    if (parent < 0) {
      writeQuaternionProduct(
        output,
        offset,
        0,
        0,
        0,
        1,
        localRotations[offset],
        localRotations[offset + 1],
        localRotations[offset + 2],
        localRotations[offset + 3],
      )
      continue
    }
    const parentOffset = parent * 4
    writeQuaternionProduct(
      output,
      offset,
      output[parentOffset],
      output[parentOffset + 1],
      output[parentOffset + 2],
      output[parentOffset + 3],
      localRotations[offset],
      localRotations[offset + 1],
      localRotations[offset + 2],
      localRotations[offset + 3],
    )
  }
}

function rotateVector(
  x: number,
  y: number,
  z: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  output: Float32Array,
  outputOffset = 0,
): void {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  output[outputOffset] = x + qw * tx + qy * tz - qz * ty
  output[outputOffset + 1] = y + qw * ty + qz * tx - qx * tz
  output[outputOffset + 2] = z + qw * tz + qx * ty - qy * tx
}

function writeReferenceComponentPositions(
  rig: RigDefinition,
  componentRotations: Float32Array,
): Float32Array {
  const componentPositions = new Float32Array(rig.boneCount * 3)
  const componentScales = new Float32Array(rig.boneCount * 3)
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const positionOffset = bone * 3
    const parent = rig.parentIndices[bone]
    if (parent < 0) {
      componentPositions[positionOffset] = rig.referencePositions[positionOffset]
      componentPositions[positionOffset + 1] = rig.referencePositions[positionOffset + 1]
      componentPositions[positionOffset + 2] = rig.referencePositions[positionOffset + 2]
      componentScales[positionOffset] = rig.referenceScales[positionOffset]
      componentScales[positionOffset + 1] = rig.referenceScales[positionOffset + 1]
      componentScales[positionOffset + 2] = rig.referenceScales[positionOffset + 2]
      continue
    }

    const parentPositionOffset = parent * 3
    const parentRotationOffset = parent * 4
    rotateVector(
      rig.referencePositions[positionOffset] * componentScales[parentPositionOffset],
      rig.referencePositions[positionOffset + 1] * componentScales[parentPositionOffset + 1],
      rig.referencePositions[positionOffset + 2] * componentScales[parentPositionOffset + 2],
      componentRotations[parentRotationOffset],
      componentRotations[parentRotationOffset + 1],
      componentRotations[parentRotationOffset + 2],
      componentRotations[parentRotationOffset + 3],
      componentPositions,
      positionOffset,
    )
    componentPositions[positionOffset] += componentPositions[parentPositionOffset]
    componentPositions[positionOffset + 1] += componentPositions[parentPositionOffset + 1]
    componentPositions[positionOffset + 2] += componentPositions[parentPositionOffset + 2]
    componentScales[positionOffset] =
      componentScales[parentPositionOffset] * rig.referenceScales[positionOffset]
    componentScales[positionOffset + 1] =
      componentScales[parentPositionOffset + 1] * rig.referenceScales[positionOffset + 1]
    componentScales[positionOffset + 2] =
      componentScales[parentPositionOffset + 2] * rig.referenceScales[positionOffset + 2]
  }
  return componentPositions
}

function measureReferenceSpan(
  componentPositions: Float32Array,
  rootIndex: number,
  pelvisIndex: number,
): number {
  const rootOffset = rootIndex * 3
  const pelvisOffset = pelvisIndex * 3
  const span = Math.hypot(
    componentPositions[pelvisOffset] - componentPositions[rootOffset],
    componentPositions[pelvisOffset + 1] - componentPositions[rootOffset + 1],
    componentPositions[pelvisOffset + 2] - componentPositions[rootOffset + 2],
  )
  if (!Number.isFinite(span) || span <= QUATERNION_EPSILON) {
    throw new Error('Retarget root-to-pelvis bind span is invalid')
  }
  return span
}

interface ReferenceCalibration {
  readonly calibratedBoneCount: number
  readonly calibratedComponents: Float32Array
  readonly maxDirectionErrorDegrees: number
}

function readReferenceDirection(
  componentPositions: Float32Array,
  fromIndex: number,
  toIndex: number,
  output: Vector3,
): Vector3 {
  const fromOffset = fromIndex * 3
  const toOffset = toIndex * 3
  return output.set(
    componentPositions[toOffset] - componentPositions[fromOffset],
    componentPositions[toOffset + 1] - componentPositions[fromOffset + 1],
    componentPositions[toOffset + 2] - componentPositions[fromOffset + 2],
  )
}

function createAnatomicalFrameQuaternion(
  componentPositions: Float32Array,
  boneIndex: number,
  childIndex: number,
  secondaryFromIndex: number,
  secondaryToIndex: number,
  label: string,
): Quaternion {
  const primary = readReferenceDirection(componentPositions, boneIndex, childIndex, new Vector3())
  const primaryLengthSquared = primary.lengthSq()
  if (!Number.isFinite(primaryLengthSquared) || primaryLengthSquared <= QUATERNION_EPSILON) {
    throw new Error(`Retarget anatomical frame "${label}" has a degenerate primary axis`)
  }
  primary.normalize()
  const secondary = readReferenceDirection(
    componentPositions,
    secondaryFromIndex,
    secondaryToIndex,
    new Vector3(),
  )
  secondary.addScaledVector(primary, -secondary.dot(primary))
  const secondaryLengthSquared = secondary.lengthSq()
  if (!Number.isFinite(secondaryLengthSquared) || secondaryLengthSquared <= QUATERNION_EPSILON) {
    throw new Error(`Retarget anatomical frame "${label}" has a degenerate secondary axis`)
  }
  secondary.normalize()
  const normal = new Vector3().crossVectors(primary, secondary).normalize()
  secondary.crossVectors(normal, primary).normalize()
  return new Quaternion()
    .setFromRotationMatrix(new Matrix4().makeBasis(primary, secondary, normal))
    .normalize()
}

function compileReferenceCalibration(
  sourceRig: RigDefinition,
  targetRig: RigDefinition,
  sourceIndices: ReadonlyMap<string, number>,
  targetIndices: ReadonlyMap<string, number>,
  profile: RetargetProfile,
  facing: Float32Array,
  targetReferenceComponents: Float32Array,
  sourceReferencePositions: Float32Array,
  targetReferencePositions: Float32Array,
): ReferenceCalibration {
  const calibratedComponents = new Float32Array(targetRig.boneCount * 4)
  const componentCorrections = new Float32Array(targetRig.boneCount * 4)
  const frameByTarget = new Map<number, RetargetAnatomicalFrame>()
  for (const frame of profile.anatomicalFrames) {
    const targetIndex = targetIndices.get(frame.bone)
    if (targetIndex === undefined) {
      throw new Error(`Retarget anatomical bone "${frame.bone}" is missing from target rig`)
    }
    if (frameByTarget.has(targetIndex)) {
      throw new Error(`Retarget anatomical bone "${frame.bone}" is configured more than once`)
    }
    frameByTarget.set(targetIndex, frame)
  }

  const facingQuaternion = new Quaternion().fromArray(facing)
  const targetReference = new Quaternion()
  let calibratedBoneCount = 0
  let maxDirectionErrorRadians = 0

  for (let target = 0; target < targetRig.boneCount; target++) {
    const targetOffset = target * 4
    const parent = targetRig.parentIndices[target]
    const correctionOffset = targetOffset
    if (parent < 0) {
      // Facing maps source motion into target bind space. The display transform
      // maps it back; rotating the target rest root here would cancel that display basis.
      componentCorrections[correctionOffset + 3] = 1
    } else {
      const parentOffset = parent * 4
      componentCorrections.set(
        componentCorrections.subarray(parentOffset, parentOffset + 4),
        correctionOffset,
      )
    }

    const frame = frameByTarget.get(target)
    if (frame !== undefined) {
      const sourceBone = sourceIndices.get(frame.bone)
      const sourceChild = sourceIndices.get(frame.childBone)
      const sourceSecondaryFrom = sourceIndices.get(frame.secondaryAxis[0])
      const sourceSecondaryTo = sourceIndices.get(frame.secondaryAxis[1])
      const targetChild = targetIndices.get(frame.childBone)
      const targetSecondaryFrom = targetIndices.get(frame.secondaryAxis[0])
      const targetSecondaryTo = targetIndices.get(frame.secondaryAxis[1])
      if (
        sourceBone === undefined ||
        sourceChild === undefined ||
        sourceSecondaryFrom === undefined ||
        sourceSecondaryTo === undefined
      ) {
        throw new Error(`Retarget anatomical frame "${frame.bone}" is missing from source rig`)
      }
      if (
        targetChild === undefined ||
        targetSecondaryFrom === undefined ||
        targetSecondaryTo === undefined
      ) {
        throw new Error(`Retarget anatomical frame "${frame.bone}" is incomplete in target rig`)
      }
      // Tripo's UE5 hierarchy inserts metacarpals between hands and fingers. The
      // anatomical direction still spans the same endpoints across those rest bones.
      const isDescendant = (rig: RigDefinition, child: number, ancestor: number) => {
        for (let parent = rig.parentIndices[child]; parent >= 0; parent = rig.parentIndices[parent]) {
          if (parent === ancestor) return true
        }
        return false
      }
      if (!isDescendant(sourceRig, sourceChild, sourceBone)
        || !isDescendant(targetRig, targetChild, target)) {
        throw new Error(`Retarget anatomical child "${frame.childBone}" has an invalid ancestor`)
      }

      const sourceFrame = createAnatomicalFrameQuaternion(
        sourceReferencePositions,
        sourceBone,
        sourceChild,
        sourceSecondaryFrom,
        sourceSecondaryTo,
        `${frame.bone}:source`,
      ).premultiply(facingQuaternion)
      const targetFrame = createAnatomicalFrameQuaternion(
        targetReferencePositions,
        target,
        targetChild,
        targetSecondaryFrom,
        targetSecondaryTo,
        `${frame.bone}:target`,
      )
      const correction = sourceFrame.multiply(targetFrame.invert()).normalize()
      correction.toArray(componentCorrections, correctionOffset)

      const sourceDirection = readReferenceDirection(
        sourceReferencePositions,
        sourceBone,
        sourceChild,
        new Vector3(),
      )
        .normalize()
        .applyQuaternion(facingQuaternion)
      const targetDirection = readReferenceDirection(
        targetReferencePositions,
        target,
        targetChild,
        new Vector3(),
      )
        .normalize()
        .applyQuaternion(correction)
      maxDirectionErrorRadians = Math.max(
        maxDirectionErrorRadians,
        sourceDirection.angleTo(targetDirection),
      )
      calibratedBoneCount++
    }

    targetReference.fromArray(targetReferenceComponents, targetOffset)
    new Quaternion()
      .fromArray(componentCorrections, correctionOffset)
      .multiply(targetReference)
      .normalize()
      .toArray(calibratedComponents, targetOffset)
  }

  return {
    calibratedBoneCount,
    calibratedComponents,
    maxDirectionErrorDegrees: (maxDirectionErrorRadians * 180) / Math.PI,
  }
}

function compileTranslationCalibration(
  sourceRig: RigDefinition,
  targetRig: RigDefinition,
  sourceIndex: number,
  targetIndex: number,
  facing: Float32Array,
): Float32Array {
  const sourceReferenceComponents = new Float32Array(sourceRig.boneCount * 4)
  const targetReferenceComponents = new Float32Array(targetRig.boneCount * 4)
  writeComponentRotations(sourceRig.referenceRotations, sourceRig, sourceReferenceComponents)
  writeComponentRotations(targetRig.referenceRotations, targetRig, targetReferenceComponents)

  const sourceParent = sourceRig.parentIndices[sourceIndex]
  const targetParent = targetRig.parentIndices[targetIndex]
  const sourceOffset = sourceParent * 4
  const targetOffset = targetParent * 4
  const intermediate = new Float32Array(4)
  const calibration = new Float32Array(4)
  writeQuaternionProduct(
    intermediate,
    0,
    facing[0],
    facing[1],
    facing[2],
    facing[3],
    sourceParent < 0 ? 0 : sourceReferenceComponents[sourceOffset],
    sourceParent < 0 ? 0 : sourceReferenceComponents[sourceOffset + 1],
    sourceParent < 0 ? 0 : sourceReferenceComponents[sourceOffset + 2],
    sourceParent < 0 ? 1 : sourceReferenceComponents[sourceOffset + 3],
  )
  writeQuaternionProduct(
    calibration,
    0,
    targetParent < 0 ? 0 : -targetReferenceComponents[targetOffset],
    targetParent < 0 ? 0 : -targetReferenceComponents[targetOffset + 1],
    targetParent < 0 ? 0 : -targetReferenceComponents[targetOffset + 2],
    targetParent < 0 ? 1 : targetReferenceComponents[targetOffset + 3],
    intermediate[0],
    intermediate[1],
    intermediate[2],
    intermediate[3],
  )
  return calibration
}

export function createCompiledRetargeter(
  sourceRig: RigDefinition,
  targetRig: RigDefinition,
  profile: RetargetProfile,
): CompiledRetargeter {
  const sourceIndices = new Map(sourceRig.boneNames.map((name, index) => [name, index]))
  const targetIndices = new Map(targetRig.boneNames.map((name, index) => [name, index]))
  const mappedSourceByTarget = new Int16Array(targetRig.boneCount)
  mappedSourceByTarget.fill(-1)
  for (let target = 0; target < targetRig.boneCount; target++) {
    const source = sourceIndices.get(targetRig.boneNames[target])
    if (source !== undefined) {
      mappedSourceByTarget[target] = source
    }
  }

  const mappedSourceNames = new Set(targetRig.boneNames.filter((name) => sourceIndices.has(name)))

  const sourceReferenceComponents = new Float32Array(sourceRig.boneCount * 4)
  const sourceComponents = new Float32Array(sourceRig.boneCount * 4)
  const targetReferenceComponents = new Float32Array(targetRig.boneCount * 4)
  const targetComponents = new Float32Array(targetRig.boneCount * 4)
  writeComponentRotations(sourceRig.referenceRotations, sourceRig, sourceReferenceComponents)
  writeComponentRotations(targetRig.referenceRotations, targetRig, targetReferenceComponents)

  const facing = new Float32Array(profile.facing)
  const facingLength = Math.hypot(facing[0], facing[1], facing[2], facing[3])
  if (!Number.isFinite(facingLength) || facingLength <= QUATERNION_EPSILON) {
    throw new Error('Retarget profile has an invalid facing quaternion')
  }
  for (let component = 0; component < 4; component++) {
    facing[component] /= facingLength
  }
  const temporaryQuaternions = new Float32Array(8)
  const temporaryVector = new Float32Array(3)

  const rootSource = sourceIndices.get(profile.rootMotionBone)
  const rootTarget = targetIndices.get(profile.rootMotionBone)
  const pelvisSource = sourceIndices.get(profile.pelvisMotionBone)
  const pelvisTarget = targetIndices.get(profile.pelvisMotionBone)
  if (
    rootSource === undefined ||
    rootTarget === undefined ||
    pelvisSource === undefined ||
    pelvisTarget === undefined
  ) {
    throw new Error('Retarget profile translation bones are missing from a rig')
  }
  const sourceReferencePositions = writeReferenceComponentPositions(
    sourceRig,
    sourceReferenceComponents,
  )
  const targetReferencePositions = writeReferenceComponentPositions(
    targetRig,
    targetReferenceComponents,
  )
  const referenceCalibration = compileReferenceCalibration(
    sourceRig,
    targetRig,
    sourceIndices,
    targetIndices,
    profile,
    facing,
    targetReferenceComponents,
    sourceReferencePositions,
    targetReferencePositions,
  )
  const calibratedTargetReferenceComponents = referenceCalibration.calibratedComponents
  const translationScale =
    measureReferenceSpan(targetReferencePositions, rootTarget, pelvisTarget) /
    measureReferenceSpan(sourceReferencePositions, rootSource, pelvisSource)
  const diagnostics: RetargetDiagnostics = {
    calibratedBoneCount: referenceCalibration.calibratedBoneCount,
    mappedBoneCount: mappedSourceNames.size,
    maxReferenceDirectionErrorDegrees: referenceCalibration.maxDirectionErrorDegrees,
    sourceBoneCount: sourceRig.boneCount,
    targetBoneCount: targetRig.boneCount,
    translationScale,
    unmappedSourceBones: sourceRig.boneNames.filter((name) => !mappedSourceNames.has(name)),
    unmappedTargetBones: targetRig.boneNames.filter((name) => !sourceIndices.has(name)),
  }
  const rootTranslationCalibration = compileTranslationCalibration(
    sourceRig,
    targetRig,
    rootSource,
    rootTarget,
    facing,
  )
  const pelvisTranslationCalibration = compileTranslationCalibration(
    sourceRig,
    targetRig,
    pelvisSource,
    pelvisTarget,
    facing,
  )

  const writeTranslationDelta = (
    sourcePose: LocalPoseBuffer,
    targetPose: LocalPoseBuffer,
    sourceIndex: number,
    targetIndex: number,
    calibration: Float32Array,
  ) => {
    const sourceOffset = sourceIndex * 3
    const targetOffset = targetIndex * 3
    rotateVector(
      sourcePose.positions[sourceOffset] - sourceRig.referencePositions[sourceOffset],
      sourcePose.positions[sourceOffset + 1] - sourceRig.referencePositions[sourceOffset + 1],
      sourcePose.positions[sourceOffset + 2] - sourceRig.referencePositions[sourceOffset + 2],
      calibration[0],
      calibration[1],
      calibration[2],
      calibration[3],
      temporaryVector,
    )
    targetPose.positions[targetOffset] =
      targetRig.referencePositions[targetOffset] + temporaryVector[0] * translationScale
    targetPose.positions[targetOffset + 1] =
      targetRig.referencePositions[targetOffset + 1] + temporaryVector[1] * translationScale
    targetPose.positions[targetOffset + 2] =
      targetRig.referencePositions[targetOffset + 2] + temporaryVector[2] * translationScale
  }

  return {
    apply(sourcePose, targetPose) {
      if (
        sourcePose.boneCount !== sourceRig.boneCount ||
        targetPose.boneCount !== targetRig.boneCount
      ) {
        throw new Error('Retarget pose has an incompatible bone count')
      }

      targetPose.positions.set(targetRig.referencePositions)
      targetPose.rotations.set(targetRig.referenceRotations)
      targetPose.scales.set(targetRig.referenceScales)
      writeComponentRotations(sourcePose.rotations, sourceRig, sourceComponents)

      for (let target = 0; target < targetRig.boneCount; target++) {
        const source = mappedSourceByTarget[target]
        const targetOffset = target * 4
        const parent = targetRig.parentIndices[target]
        if (source >= 0) {
          const sourceOffset = source * 4
          writeQuaternionProduct(
            temporaryQuaternions,
            0,
            sourceComponents[sourceOffset],
            sourceComponents[sourceOffset + 1],
            sourceComponents[sourceOffset + 2],
            sourceComponents[sourceOffset + 3],
            -sourceReferenceComponents[sourceOffset],
            -sourceReferenceComponents[sourceOffset + 1],
            -sourceReferenceComponents[sourceOffset + 2],
            sourceReferenceComponents[sourceOffset + 3],
          )
          writeQuaternionProduct(
            temporaryQuaternions,
            4,
            facing[0],
            facing[1],
            facing[2],
            facing[3],
            temporaryQuaternions[0],
            temporaryQuaternions[1],
            temporaryQuaternions[2],
            temporaryQuaternions[3],
          )
          writeQuaternionProduct(
            temporaryQuaternions,
            0,
            temporaryQuaternions[4],
            temporaryQuaternions[5],
            temporaryQuaternions[6],
            temporaryQuaternions[7],
            -facing[0],
            -facing[1],
            -facing[2],
            facing[3],
          )
          writeQuaternionProduct(
            temporaryQuaternions,
            4,
            temporaryQuaternions[0],
            temporaryQuaternions[1],
            temporaryQuaternions[2],
            temporaryQuaternions[3],
            calibratedTargetReferenceComponents[targetOffset],
            calibratedTargetReferenceComponents[targetOffset + 1],
            calibratedTargetReferenceComponents[targetOffset + 2],
            calibratedTargetReferenceComponents[targetOffset + 3],
          )
          if (parent < 0) {
            targetPose.rotations[targetOffset] = temporaryQuaternions[4]
            targetPose.rotations[targetOffset + 1] = temporaryQuaternions[5]
            targetPose.rotations[targetOffset + 2] = temporaryQuaternions[6]
            targetPose.rotations[targetOffset + 3] = temporaryQuaternions[7]
          } else {
            const parentOffset = parent * 4
            writeQuaternionProduct(
              targetPose.rotations,
              targetOffset,
              -targetComponents[parentOffset],
              -targetComponents[parentOffset + 1],
              -targetComponents[parentOffset + 2],
              targetComponents[parentOffset + 3],
              temporaryQuaternions[4],
              temporaryQuaternions[5],
              temporaryQuaternions[6],
              temporaryQuaternions[7],
            )
          }
        }

        if (parent < 0) {
          targetComponents[targetOffset] = targetPose.rotations[targetOffset]
          targetComponents[targetOffset + 1] = targetPose.rotations[targetOffset + 1]
          targetComponents[targetOffset + 2] = targetPose.rotations[targetOffset + 2]
          targetComponents[targetOffset + 3] = targetPose.rotations[targetOffset + 3]
        } else {
          const parentOffset = parent * 4
          writeQuaternionProduct(
            targetComponents,
            targetOffset,
            targetComponents[parentOffset],
            targetComponents[parentOffset + 1],
            targetComponents[parentOffset + 2],
            targetComponents[parentOffset + 3],
            targetPose.rotations[targetOffset],
            targetPose.rotations[targetOffset + 1],
            targetPose.rotations[targetOffset + 2],
            targetPose.rotations[targetOffset + 3],
          )
        }
      }

      writeTranslationDelta(
        sourcePose,
        targetPose,
        rootSource,
        rootTarget,
        rootTranslationCalibration,
      )
      writeTranslationDelta(
        sourcePose,
        targetPose,
        pelvisSource,
        pelvisTarget,
        pelvisTranslationCalibration,
      )
    },
    diagnostics,
  }
}


/** ORIGINAL consumer rig boundary: infer bind-space yaw from clavicle landmarks.
 * Works with +X, +Z and -Z exports without inspecting the currently animated pose. */
export function detectRetargetFacing(sourceRig: RigDefinition, targetRig: RigDefinition): [number, number, number, number] {
  const sideAngle = (rig: RigDefinition) => {
    const left = rig.boneNames.indexOf('clavicle_l')
    const right = rig.boneNames.indexOf('clavicle_r')
    if (left < 0 || right < 0) throw new Error('Retarget facing requires clavicle_l and clavicle_r')
    const rotations = new Float32Array(rig.boneCount * 4)
    writeComponentRotations(rig.referenceRotations, rig, rotations)
    const positions = writeReferenceComponentPositions(rig, rotations)
    const x = positions[left * 3] - positions[right * 3]
    const z = positions[left * 3 + 2] - positions[right * 3 + 2]
    if (!Number.isFinite(x + z) || Math.hypot(x, z) <= QUATERNION_EPSILON) {
      throw new Error('Retarget clavicle landmarks have no horizontal span')
    }
    return Math.atan2(z, x)
  }
  const halfAngle = (sideAngle(sourceRig) - sideAngle(targetRig)) / 2
  return [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)]
}
