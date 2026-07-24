import * as THREE from 'three'
import {
  createPoseBuffer,
  resetPoseToReference,
  type LocalPoseBuffer,
} from './poseBuffer'
import type { RigDefinition } from './rig'

export interface PoseDeltaThresholds {
  readonly localPositionMeters: number
  readonly localRotationDegrees: number
  readonly localScale: number
  readonly componentPositionMeters: number
  readonly componentRotationDegrees: number
}

export const DEFAULT_POSE_DELTA_THRESHOLDS: PoseDeltaThresholds = {
  localPositionMeters: 1e-5,
  localRotationDegrees: 0.01,
  localScale: 1e-5,
  componentPositionMeters: 1e-4,
  componentRotationDegrees: 0.01,
}

export type PoseDeltaBoneGroup =
  | 'Root'
  | 'Pelvis'
  | 'Spine'
  | 'Head'
  | 'ArmLeft'
  | 'ArmRight'
  | 'HandLeft'
  | 'HandRight'
  | 'LegLeft'
  | 'LegRight'
  | 'Ik'
  | 'Virtual'
  | 'Other'

export interface BonePoseDelta {
  readonly boneIndex: number
  readonly boneName: string
  readonly group: PoseDeltaBoneGroup
  readonly localPositionMeters: number
  readonly localRotationDegrees: number
  readonly localScale: number
  readonly componentPositionMeters: number
  readonly componentRotationDegrees: number
}

export interface CollapsedSidePair {
  readonly leftBone: string
  readonly rightBone: string
  readonly expectedRotationSeparationDegrees: number
  readonly actualRotationSeparationDegrees: number
  readonly expectedPositionSeparationMeters: number
  readonly actualPositionSeparationMeters: number
}

export interface PoseDeltaGroupSummary {
  readonly group: PoseDeltaBoneGroup
  readonly divergentBoneCount: number
  readonly maximumLocalPositionMeters: number
  readonly maximumLocalRotationDegrees: number
  readonly maximumComponentPositionMeters: number
}

export interface PoseDeltaReport {
  readonly matches: boolean
  readonly boneCount: number
  readonly comparedBoneCount: number
  readonly divergentBoneCount: number
  readonly thresholds: PoseDeltaThresholds
  readonly groups: readonly PoseDeltaGroupSummary[]
  readonly worstBones: readonly BonePoseDelta[]
  readonly collapsedSidePairs: readonly CollapsedSidePair[]
}

export interface PoseDeltaOptions {
  readonly thresholds?: Partial<PoseDeltaThresholds>
  readonly includeVirtualBones?: boolean
  readonly includedBoneNames?: ReadonlySet<string>
  readonly maximumReportedBones?: number
}

interface ComponentPose {
  readonly positions: Float64Array
  readonly rotations: Float64Array
  readonly scales: Float64Array
}

const ARM_NAMES = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/
const HAND_NAMES = /^(hand|thumb|index|middle|ring|pinky)_/
const LEG_NAMES = /^(thigh|calf|foot|ball)_/
const HEAD_NAMES = /^(neck|head|jaw|eye)_/

function boneGroup(name: string): PoseDeltaBoneGroup {
  if (name.startsWith('VB ')) return 'Virtual'
  if (name.startsWith('ik_')) return 'Ik'
  if (name === 'root') return 'Root'
  if (name === 'pelvis') return 'Pelvis'
  if (name.startsWith('spine_')) return 'Spine'
  if (HEAD_NAMES.test(name)) return 'Head'
  if (HAND_NAMES.test(name)) {
    if (name.endsWith('_l')) return 'HandLeft'
    if (name.endsWith('_r')) return 'HandRight'
  }
  if (ARM_NAMES.test(name)) {
    if (name.endsWith('_l')) return 'ArmLeft'
    if (name.endsWith('_r')) return 'ArmRight'
  }
  if (LEG_NAMES.test(name)) {
    if (name.endsWith('_l')) return 'LegLeft'
    if (name.endsWith('_r')) return 'LegRight'
  }
  return 'Other'
}

function quaternionAngleDegrees(
  a: ArrayLike<number>,
  aOffset: number,
  b: ArrayLike<number>,
  bOffset: number,
) {
  const dot = Math.abs(
    a[aOffset] * b[bOffset]
    + a[aOffset + 1] * b[bOffset + 1]
    + a[aOffset + 2] * b[bOffset + 2]
    + a[aOffset + 3] * b[bOffset + 3],
  )
  return THREE.MathUtils.radToDeg(
    2 * Math.acos(Math.min(1, Math.max(-1, dot))),
  )
}

function vectorDistance(
  a: ArrayLike<number>,
  aOffset: number,
  b: ArrayLike<number>,
  bOffset: number,
) {
  return Math.hypot(
    a[aOffset] - b[bOffset],
    a[aOffset + 1] - b[bOffset + 1],
    a[aOffset + 2] - b[bOffset + 2],
  )
}

function componentPose(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
): ComponentPose {
  const positions = new Float64Array(rig.boneCount * 3)
  const rotations = new Float64Array(rig.boneCount * 4)
  const scales = new Float64Array(rig.boneCount * 3)
  const localPosition = new THREE.Vector3()
  const componentPosition = new THREE.Vector3()
  const parentPosition = new THREE.Vector3()
  const localRotation = new THREE.Quaternion()
  const componentRotation = new THREE.Quaternion()
  const parentRotation = new THREE.Quaternion()
  const localScale = new THREE.Vector3()
  const parentScale = new THREE.Vector3()

  for (let bone = 0; bone < rig.boneCount; bone++) {
    const p = bone * 3
    const q = bone * 4
    const parent = rig.parentIndices[bone]
    localPosition.fromArray(pose.positions, p)
    localRotation.fromArray(pose.rotations, q).normalize()
    localScale.fromArray(pose.scales, p)
    if (parent < 0) {
      localPosition.toArray(positions, p)
      localRotation.toArray(rotations, q)
      localScale.toArray(scales, p)
      continue
    }

    const parentP = parent * 3
    const parentQ = parent * 4
    parentPosition.fromArray(positions, parentP)
    parentRotation.fromArray(rotations, parentQ)
    parentScale.fromArray(scales, parentP)
    componentPosition
      .copy(localPosition)
      .multiply(parentScale)
      .applyQuaternion(parentRotation)
      .add(parentPosition)
      .toArray(positions, p)
    componentRotation
      .copy(parentRotation)
      .multiply(localRotation)
      .normalize()
      .toArray(rotations, q)
    localScale.multiply(parentScale).toArray(scales, p)
  }
  return { positions, rotations, scales }
}

function validatePose(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
  label: string,
) {
  if (pose.boneCount !== rig.boneCount) {
    throw new Error(
      `${label} pose bone count ${pose.boneCount} differs from rig ${rig.boneCount}`,
    )
  }
}

/** Captures the currently published scene skeleton into rig-ordered local-pose storage. */
export function captureLocalPose(
  root: THREE.Object3D,
  rig: RigDefinition,
): LocalPoseBuffer {
  const pose = resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
  const bones = new Map<string, THREE.Bone>()
  root.traverse((object) => {
    if (object instanceof THREE.Bone && !bones.has(object.name)) {
      bones.set(object.name, object)
    }
  })
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const object = bones.get(rig.boneNames[bone])
    if (!object) {
      if (bone < rig.physicalBoneCount) {
        throw new Error(`Published skeleton is missing bone "${rig.boneNames[bone]}"`)
      }
      continue
    }
    const p = bone * 3
    const q = bone * 4
    object.position.toArray(pose.positions, p)
    object.quaternion.toArray(pose.rotations, q)
    object.scale.toArray(pose.scales, p)
  }
  return pose
}

function isDivergent(
  delta: BonePoseDelta,
  thresholds: PoseDeltaThresholds,
) {
  return (
    delta.localPositionMeters > thresholds.localPositionMeters
    || delta.localRotationDegrees > thresholds.localRotationDegrees
    || delta.localScale > thresholds.localScale
    || delta.componentPositionMeters > thresholds.componentPositionMeters
    || delta.componentRotationDegrees > thresholds.componentRotationDegrees
  )
}

function collapsedSidePairs(
  rig: RigDefinition,
  expected: LocalPoseBuffer,
  actual: LocalPoseBuffer,
  thresholds: PoseDeltaThresholds,
  includeVirtualBones: boolean,
  includedBoneNames: ReadonlySet<string> | undefined,
) {
  const indices = new Map(rig.boneNames.map((name, index) => [name, index]))
  const pairs: CollapsedSidePair[] = []
  for (let left = 0; left < rig.boneCount; left++) {
    const leftName = rig.boneNames[left]
    if (
      !leftName.endsWith('_l')
      || (!includeVirtualBones && left >= rig.physicalBoneCount)
      || (includedBoneNames && !includedBoneNames.has(leftName))
    ) {
      continue
    }
    const rightName = `${leftName.slice(0, -2)}_r`
    const right = indices.get(rightName)
    if (
      right === undefined
      || (!includeVirtualBones && right >= rig.physicalBoneCount)
      || (includedBoneNames && !includedBoneNames.has(rightName))
    ) {
      continue
    }
    const leftP = left * 3
    const rightP = right * 3
    const leftQ = left * 4
    const rightQ = right * 4
    const expectedRotationSeparationDegrees = quaternionAngleDegrees(
      expected.rotations,
      leftQ,
      expected.rotations,
      rightQ,
    )
    const actualRotationSeparationDegrees = quaternionAngleDegrees(
      actual.rotations,
      leftQ,
      actual.rotations,
      rightQ,
    )
    const expectedPositionSeparationMeters = vectorDistance(
      expected.positions,
      leftP,
      expected.positions,
      rightP,
    )
    const actualPositionSeparationMeters = vectorDistance(
      actual.positions,
      leftP,
      actual.positions,
      rightP,
    )
    const expectedIsDistinct = (
      expectedRotationSeparationDegrees
        > thresholds.localRotationDegrees
      || expectedPositionSeparationMeters
        > thresholds.localPositionMeters
    )
    const actualCollapsed = (
      actualRotationSeparationDegrees
        <= thresholds.localRotationDegrees
      && actualPositionSeparationMeters
        <= thresholds.localPositionMeters
    )
    if (expectedIsDistinct && actualCollapsed) {
      pairs.push({
        leftBone: leftName,
        rightBone: rightName,
        expectedRotationSeparationDegrees,
        actualRotationSeparationDegrees,
        expectedPositionSeparationMeters,
        actualPositionSeparationMeters,
      })
    }
  }
  return pairs
}

/**
 * Compares two full local poses and condenses the result into ranked bones and skeleton regions.
 * The report intentionally omits the hundreds of raw transform components that made earlier
 * animation traces expensive to interpret.
 */
export function createPoseDeltaReport(
  rig: RigDefinition,
  expected: LocalPoseBuffer,
  actual: LocalPoseBuffer,
  options: PoseDeltaOptions = {},
): PoseDeltaReport {
  validatePose(expected, rig, 'Expected')
  validatePose(actual, rig, 'Actual')
  const thresholds = {
    ...DEFAULT_POSE_DELTA_THRESHOLDS,
    ...options.thresholds,
  }
  const includeVirtualBones = options.includeVirtualBones === true
  const availableBoneCount = includeVirtualBones
    ? rig.boneCount
    : rig.physicalBoneCount
  const comparedBoneIndices = Array.from(
    { length: availableBoneCount },
    (_, bone) => bone,
  ).filter((bone) => (
    !options.includedBoneNames
    || options.includedBoneNames.has(rig.boneNames[bone])
  ))
  const comparedBoneCount = comparedBoneIndices.length
  const expectedComponent = componentPose(expected, rig)
  const actualComponent = componentPose(actual, rig)
  const divergent: BonePoseDelta[] = []

  for (const bone of comparedBoneIndices) {
    const p = bone * 3
    const q = bone * 4
    const delta: BonePoseDelta = {
      boneIndex: bone,
      boneName: rig.boneNames[bone],
      group: boneGroup(rig.boneNames[bone]),
      localPositionMeters: vectorDistance(
        expected.positions,
        p,
        actual.positions,
        p,
      ),
      localRotationDegrees: quaternionAngleDegrees(
        expected.rotations,
        q,
        actual.rotations,
        q,
      ),
      localScale: vectorDistance(
        expected.scales,
        p,
        actual.scales,
        p,
      ),
      componentPositionMeters: vectorDistance(
        expectedComponent.positions,
        p,
        actualComponent.positions,
        p,
      ),
      componentRotationDegrees: quaternionAngleDegrees(
        expectedComponent.rotations,
        q,
        actualComponent.rotations,
        q,
      ),
    }
    if (isDivergent(delta, thresholds)) divergent.push(delta)
  }

  divergent.sort((a, b) => (
    b.componentPositionMeters - a.componentPositionMeters
    || b.localRotationDegrees - a.localRotationDegrees
    || b.localPositionMeters - a.localPositionMeters
    || a.boneIndex - b.boneIndex
  ))
  const groupsByName = new Map<PoseDeltaBoneGroup, PoseDeltaGroupSummary>()
  for (const delta of divergent) {
    const previous = groupsByName.get(delta.group)
    groupsByName.set(delta.group, {
      group: delta.group,
      divergentBoneCount: (previous?.divergentBoneCount ?? 0) + 1,
      maximumLocalPositionMeters: Math.max(
        previous?.maximumLocalPositionMeters ?? 0,
        delta.localPositionMeters,
      ),
      maximumLocalRotationDegrees: Math.max(
        previous?.maximumLocalRotationDegrees ?? 0,
        delta.localRotationDegrees,
      ),
      maximumComponentPositionMeters: Math.max(
        previous?.maximumComponentPositionMeters ?? 0,
        delta.componentPositionMeters,
      ),
    })
  }
  const groups = [...groupsByName.values()].sort((a, b) => (
    b.maximumComponentPositionMeters - a.maximumComponentPositionMeters
    || b.maximumLocalRotationDegrees - a.maximumLocalRotationDegrees
    || a.group.localeCompare(b.group)
  ))
  const collapsed = collapsedSidePairs(
    rig,
    expected,
    actual,
    thresholds,
    includeVirtualBones,
    options.includedBoneNames,
  )
  return {
    matches: divergent.length === 0 && collapsed.length === 0,
    boneCount: rig.boneCount,
    comparedBoneCount,
    divergentBoneCount: divergent.length,
    thresholds,
    groups,
    worstBones: divergent.slice(0, options.maximumReportedBones ?? 8),
    collapsedSidePairs: collapsed,
  }
}

function fixed(value: number, digits: number) {
  return Number.isFinite(value) ? value.toFixed(digits) : String(value)
}

/** Human-first output for the deterministic CLI; JSON remains available for automation. */
export function formatPoseDeltaReport(
  label: string,
  report: PoseDeltaReport,
) {
  const lines = [
    `${report.matches ? 'PASS' : 'FAIL'} ${label}`,
    `  bones: ${report.divergentBoneCount}/${report.comparedBoneCount} divergent`,
  ]
  if (report.groups.length > 0) {
    lines.push(
      `  regions: ${report.groups.map((group) => (
        `${group.group} ${group.divergentBoneCount}`
      )).join(', ')}`,
    )
  }
  for (const delta of report.worstBones) {
    lines.push(
      `  ${delta.boneName}: component ${fixed(
        delta.componentPositionMeters * 100,
        2,
      )} cm, local rotation ${fixed(
        delta.localRotationDegrees,
        2,
      )}°, local translation ${fixed(
        delta.localPositionMeters * 100,
        2,
      )} cm`,
    )
  }
  for (const pair of report.collapsedSidePairs) {
    lines.push(
      `  collapsed sides: ${pair.leftBone}/${pair.rightBone} `
      + `expected ${fixed(pair.expectedRotationSeparationDegrees, 2)}° apart, `
      + `actual ${fixed(pair.actualRotationSeparationDegrees, 2)}°`,
    )
  }
  return lines.join('\n')
}
