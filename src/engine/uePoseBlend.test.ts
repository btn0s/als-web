import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  blendCurves,
  blendPoseNodesTogether,
  blendPosesTogether,
  blendTwoPoseNodesTogether,
  blendTwoPosesTogether,
  type MutableUePoseNode,
  type UePoseNode,
} from './uePoseBlend'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToReference,
  type LocalPoseBuffer,
} from './poseBuffer'
import { createRigDefinition } from './rig'

function setup() {
  const root = new THREE.Bone()
  root.name = 'root'
  const rig = createRigDefinition(root)
  const reference = resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
  return {
    reference,
    pose: () => copyPose(reference, createPoseBuffer(rig.boneCount)),
  }
}

function setQuaternion(
  pose: LocalPoseBuffer,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  pose.rotations.set([x, y, z, w])
}

function makeNode(
  pose: LocalPoseBuffer,
  curves: ReadonlyMap<string, number>,
): UePoseNode {
  return { pose, curves }
}

function makeOutput(
  pose: LocalPoseBuffer,
): MutableUePoseNode {
  return { pose, curves: new Map() }
}

describe('Unreal pose blending', () => {
  it('uses WeightOfPoseOne and a normalized atom sum for every transform component', () => {
    const { pose } = setup()
    const one = pose()
    const two = pose()
    const out = pose()
    one.positions.set([2, 4, 6])
    two.positions.set([10, 12, 14])
    one.scales.set([1, 2, 3])
    two.scales.set([5, 6, 7])
    setQuaternion(one, 0, 0, 0, 1)
    setQuaternion(two, Math.sqrt(3) / 2, 0, 0, 0.5)

    blendTwoPosesTogether(one, two, 0.25, out)

    expect([...out.positions]).toEqual([8, 10, 12])
    expect([...out.scales]).toEqual([4, 5, 6])
    const rawX = 0.75 * Math.sqrt(3) / 2
    const rawW = 0.25 + 0.75 * 0.5
    const inverseLength = 1 / Math.hypot(rawX, rawW)
    expect(out.rotations[0]).toBeCloseTo(rawX * inverseLength)
    expect(out.rotations[3]).toBeCloseTo(rawW * inverseLength)
    expect(Math.hypot(...out.rotations)).toBeCloseTo(1)
  })

  it('does not normalize multi-way weights and keeps quaternions in one hemisphere', () => {
    const { pose } = setup()
    const one = pose()
    const two = pose()
    const out = pose()
    one.positions.set([2, 4, 6])
    two.positions.set([10, 12, 14])
    one.scales.set([1, 2, 3])
    two.scales.set([5, 6, 7])
    setQuaternion(one, 0, 0, 0, 1)
    setQuaternion(two, 0, 0, 0, -1)

    blendPosesTogether([one, two], [0.25, 0.5], out)

    expect([...out.positions]).toEqual([5.5, 7, 8.5])
    expect([...out.scales]).toEqual([2.75, 3.5, 4.25])
    expect(out.rotations[0]).toBeCloseTo(0)
    expect(Math.abs(out.rotations[3])).toBeCloseTo(1)
  })

  it('preserves authored node boundaries instead of flattening nested quaternion blends', () => {
    const { pose } = setup()
    const identity = pose()
    const rotateX = pose()
    const rotateY = pose()
    setQuaternion(identity, 0, 0, 0, 1)
    setQuaternion(rotateX, Math.sqrt(3) / 2, 0, 0, 0.5)
    setQuaternion(rotateY, 0, Math.sqrt(3) / 2, 0, 0.5)
    const inner = pose()
    const nested = pose()
    const flattened = pose()

    blendTwoPosesTogether(identity, rotateX, 0.5, inner)
    blendTwoPosesTogether(inner, rotateY, 0.5, nested)
    blendPosesTogether(
      [identity, rotateX, rotateY],
      [0.25, 0.25, 0.5],
      flattened,
    )

    expect(nested.rotations[0]).toBeCloseTo(0.29534525, 6)
    expect(nested.rotations[1]).toBeCloseTo(0.51155297, 6)
    expect(nested.rotations[2]).toBeCloseTo(0, 6)
    expect(nested.rotations[3]).toBeCloseTo(0.80689822, 6)
    expect(flattened.rotations[0]).toBeCloseTo(0.27386128, 6)
    expect(flattened.rotations[1]).toBeCloseTo(0.54772256, 6)
    expect(flattened.rotations[3]).toBeCloseTo(0.79056942, 6)
    expect(nested.rotations[0]).not.toBeCloseTo(flattened.rotations[0], 3)
  })

  it('blends the curve union with the same source weights', () => {
    const out = new Map<string, number>([['stale', 99]])

    blendCurves(
      [
        new Map([
          ['Shared', 2],
          ['OnlyOne', 8],
        ]),
        new Map([
          ['Shared', 10],
          ['OnlyTwo', 4],
        ]),
      ],
      [0.25, 0.5],
      out,
    )

    expect([...out]).toEqual([
      ['Shared', 5.5],
      ['OnlyOne', 2],
      ['OnlyTwo', 2],
    ])
  })

  it('evaluates pose and curve nodes together at each graph boundary', () => {
    const { pose } = setup()
    const onePose = pose()
    const twoPose = pose()
    const threePose = pose()
    onePose.positions[0] = 2
    twoPose.positions[0] = 10
    threePose.positions[0] = 30
    const one = makeNode(onePose, new Map([['Layer', 0]]))
    const two = makeNode(twoPose, new Map([['Layer', 1]]))
    const three = makeNode(threePose, new Map([['Layer', 2]]))
    const inner = makeOutput(pose())
    const out = makeOutput(pose())

    blendTwoPoseNodesTogether(one, two, 0.25, inner)
    blendPoseNodesTogether([inner, three], [0.5, 0.5], out)

    expect(out.pose.positions[0]).toBeCloseTo(19)
    expect(out.curves.get('Layer')).toBeCloseTo(1.375)
  })
})
