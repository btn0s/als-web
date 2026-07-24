import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createPoseDeltaReport,
  formatPoseDeltaReport,
} from './poseDelta'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToReference,
} from './poseBuffer'
import { createRigDefinition } from './rig'

function testRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  const thighLeft = new THREE.Bone()
  thighLeft.name = 'thigh_l'
  const calfLeft = new THREE.Bone()
  calfLeft.name = 'calf_l'
  const thighRight = new THREE.Bone()
  thighRight.name = 'thigh_r'
  const calfRight = new THREE.Bone()
  calfRight.name = 'calf_r'
  root.add(pelvis)
  pelvis.add(thighLeft, thighRight)
  thighLeft.add(calfLeft)
  thighRight.add(calfRight)
  return createRigDefinition(root)
}

describe('pose delta report', () => {
  it('passes an identical pose without dumping bone rows', () => {
    const rig = testRig()
    const expected = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const actual = copyPose(expected, createPoseBuffer(rig.boneCount))
    const report = createPoseDeltaReport(rig, expected, actual)

    expect(report.matches).toBe(true)
    expect(report.divergentBoneCount).toBe(0)
    expect(formatPoseDeltaReport('identity', report)).toBe(
      'PASS identity\n  bones: 0/6 divergent',
    )
  })

  it('ranks the affected branch by visible component displacement', () => {
    const rig = testRig()
    const expected = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const actual = copyPose(expected, createPoseBuffer(rig.boneCount))
    const thighRight = rig.boneNames.indexOf('thigh_r')
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ).toArray(actual.rotations, thighRight * 4)

    const report = createPoseDeltaReport(rig, expected, actual)

    expect(report.matches).toBe(false)
    expect(report.groups[0]).toMatchObject({
      group: 'LegRight',
      divergentBoneCount: 2,
    })
    expect(report.worstBones.map(({ boneName }) => boneName))
      .toContain('calf_r')
    expect(formatPoseDeltaReport('roll', report))
      .toMatch(/FAIL roll[\s\S]*regions: LegRight 2/)
  })

  it('calls out a left/right collapse only when the authored pair is distinct', () => {
    const rig = testRig()
    const expected = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const actual = copyPose(expected, createPoseBuffer(rig.boneCount))
    const left = rig.boneNames.indexOf('thigh_l')
    const right = rig.boneNames.indexOf('thigh_r')
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 3,
    ).toArray(expected.rotations, right * 4)
    actual.positions.set(expected.positions.subarray(left * 3, left * 3 + 3), right * 3)
    actual.rotations.set(expected.rotations.subarray(left * 4, left * 4 + 4), right * 4)

    const report = createPoseDeltaReport(rig, expected, actual)

    expect(report.collapsedSidePairs).toEqual([
      expect.objectContaining({
        leftBone: 'thigh_l',
        rightBone: 'thigh_r',
        expectedRotationSeparationDegrees: expect.closeTo(60, 5),
        actualRotationSeparationDegrees: 0,
      }),
    ])
  })

  it('can restrict a diagnostic to the intended skeleton branches', () => {
    const rig = testRig()
    const expected = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const actual = copyPose(expected, createPoseBuffer(rig.boneCount))
    actual.positions[rig.boneNames.indexOf('calf_l') * 3] = 1
    actual.positions[rig.boneNames.indexOf('calf_r') * 3] = 2

    const report = createPoseDeltaReport(rig, expected, actual, {
      includedBoneNames: new Set(['calf_l']),
    })

    expect(report.comparedBoneCount).toBe(1)
    expect(report.divergentBoneCount).toBe(1)
    expect(report.worstBones[0].boneName).toBe('calf_l')
  })
})
