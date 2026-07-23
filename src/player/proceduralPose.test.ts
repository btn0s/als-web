import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  additiveDeltaQuat,
  applyOffset,
  applyProceduralPose,
  createDriver,
  createOffset,
  distributeAngle,
  shortestAngleDelta,
  stepDriver,
} from './proceduralPose'

describe('stepDriver', () => {
  it('moves the driver value toward target, never overshooting for dt >= 0', () => {
    const driver = createDriver(0)
    stepDriver(driver, 1, 10, 1 / 60)
    expect(driver.value).toBeGreaterThan(0)
    expect(driver.value).toBeLessThan(1)
  })

  it('converges to target over many small steps', () => {
    const driver = createDriver(0)
    for (let i = 0; i < 600; i++) stepDriver(driver, 1, 10, 1 / 60)
    expect(driver.value).toBeCloseTo(1, 3)
  })

  it('handles a negative (signed) target', () => {
    const driver = createDriver(0)
    for (let i = 0; i < 600; i++) stepDriver(driver, -0.5, 10, 1 / 60)
    expect(driver.value).toBeCloseTo(-0.5, 3)
  })

  it('is a no-op when dt is 0', () => {
    const driver = createDriver(0.3)
    stepDriver(driver, 1, 10, 0)
    expect(driver.value).toBe(0.3)
  })

  it('a higher rate converges faster than a lower rate over the same dt', () => {
    const slow = createDriver(0)
    const fast = createDriver(0)
    stepDriver(slow, 1, 2, 1 / 60)
    stepDriver(fast, 1, 20, 1 / 60)
    expect(fast.value).toBeGreaterThan(slow.value)
  })
})

describe('shortestAngleDelta', () => {
  it('returns 0 for equal angles', () => {
    expect(shortestAngleDelta(1.2, 1.2)).toBeCloseTo(0, 10)
  })

  it('returns the direct difference for a small delta with no wrap', () => {
    expect(shortestAngleDelta(0, 0.5)).toBeCloseTo(0.5, 10)
    expect(shortestAngleDelta(0.5, 0)).toBeCloseTo(-0.5, 10)
  })

  it('takes the short way around the +/-PI wrap boundary', () => {
    // From just past +PI to just past -PI is a short hop across the seam, not the long way
    // around through 0.
    const from = Math.PI - 0.1
    const to = -Math.PI + 0.1
    const delta = shortestAngleDelta(from, to)
    expect(Math.abs(delta)).toBeCloseTo(0.2, 10)
  })

  it('result stays within [-PI, PI]', () => {
    for (let from = -6; from <= 6; from += 0.7) {
      for (let to = -6; to <= 6; to += 0.9) {
        const delta = shortestAngleDelta(from, to)
        expect(delta).toBeGreaterThanOrEqual(-Math.PI - 1e-9)
        expect(delta).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })

  it('applying the delta to `from` reconstructs `to` modulo 2*PI', () => {
    const from = 2.9
    const to = -2.9
    const delta = shortestAngleDelta(from, to)
    const reconstructed = from + delta
    const wrapped = Math.atan2(Math.sin(reconstructed), Math.cos(reconstructed))
    const wrappedTo = Math.atan2(Math.sin(to), Math.cos(to))
    expect(wrapped).toBeCloseTo(wrappedTo, 10)
  })
})

describe('distributeAngle', () => {
  it('scales each fraction by the total angle', () => {
    expect(distributeAngle(1, [0.5, 0.3, 0.2])).toEqual([0.5, 0.3, 0.2])
    expect(distributeAngle(0.4, [0.5, 0.5])).toEqual([0.2, 0.2])
  })

  it('the chain sums back to the total when fractions sum to 1', () => {
    const parts = distributeAngle(0.7, [0.5, 0.3, 0.2])
    const sum = parts.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(0.7, 10)
  })

  it('handles a negative total angle (signed offsets)', () => {
    expect(distributeAngle(-1, [0.5, 0.5])).toEqual([-0.5, -0.5])
  })

  it('returns an empty array for an empty fraction list', () => {
    expect(distributeAngle(1, [])).toEqual([])
  })
})

describe('additiveDeltaQuat', () => {
  it('is identity at driver = 0', () => {
    const axis = new THREE.Vector3(0, 1, 0)
    const out = new THREE.Quaternion()
    additiveDeltaQuat(axis, Math.PI / 2, 0, out)
    expect(out.x).toBeCloseTo(0, 10)
    expect(out.y).toBeCloseTo(0, 10)
    expect(out.z).toBeCloseTo(0, 10)
    expect(out.w).toBeCloseTo(1, 10)
  })

  it('is the full axis-angle rotation at driver = 1', () => {
    const axis = new THREE.Vector3(0, 1, 0)
    const maxAngle = Math.PI / 3
    const out = new THREE.Quaternion()
    additiveDeltaQuat(axis, maxAngle, 1, out)
    const expected = new THREE.Quaternion().setFromAxisAngle(axis, maxAngle)
    expect(out.angleTo(expected)).toBeCloseTo(0, 10)
  })

  it('matches slerp(identity, target, driver) for driver in [0, 1] (documented equivalence)', () => {
    const axis = new THREE.Vector3(1, 0, 0)
    const maxAngle = Math.PI / 4
    const identity = new THREE.Quaternion()
    const target = new THREE.Quaternion().setFromAxisAngle(axis, maxAngle)
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const out = new THREE.Quaternion()
      additiveDeltaQuat(axis, maxAngle, t, out)
      const slerped = new THREE.Quaternion().slerpQuaternions(identity, target, t)
      expect(out.angleTo(slerped)).toBeCloseTo(0, 6)
    }
  })

  it('a negative driver rotates the opposite direction (unlike slerp, which can flip)', () => {
    const axis = new THREE.Vector3(0, 1, 0)
    const maxAngle = Math.PI / 4
    const positive = new THREE.Quaternion()
    const negative = new THREE.Quaternion()
    additiveDeltaQuat(axis, maxAngle, 0.5, positive)
    additiveDeltaQuat(axis, maxAngle, -0.5, negative)
    // The negative-driver quaternion should be the inverse rotation of the positive one.
    const positiveInverse = positive.clone().invert()
    expect(negative.angleTo(positiveInverse)).toBeCloseTo(0, 6)
  })

  it('writes into and returns the same `out` instance (no allocation)', () => {
    const axis = new THREE.Vector3(0, 0, 1)
    const out = new THREE.Quaternion()
    const returned = additiveDeltaQuat(axis, 1, 0.5, out)
    expect(returned).toBe(out)
  })
})

describe('applyOffset / applyProceduralPose', () => {
  it('post-multiplies the additive rotation onto the bone quaternion', () => {
    const bone = new THREE.Bone()
    bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3) // pretend "base pose" from the mixer
    const driver = createDriver(1)
    const axis = new THREE.Vector3(0, 1, 0)
    const maxAngle = Math.PI / 6
    const offset = createOffset(bone, axis, maxAngle, driver)

    applyOffset(offset)

    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3)
      .multiply(new THREE.Quaternion().setFromAxisAngle(axis, maxAngle))
    expect(bone.quaternion.angleTo(expected)).toBeCloseTo(0, 6)
  })

  it('is a no-op when the offset has no resolved bone', () => {
    const offset = createOffset(null, new THREE.Vector3(0, 1, 0), 1, createDriver(1))
    expect(() => applyOffset(offset)).not.toThrow()
  })

  it('composes multiple offsets on the same bone in application order', () => {
    const bone = new THREE.Bone()
    const yawDriver = createDriver(1)
    const pitchDriver = createDriver(1)
    const yawOffset = createOffset(bone, new THREE.Vector3(0, 1, 0), Math.PI / 6, yawDriver)
    const pitchOffset = createOffset(bone, new THREE.Vector3(1, 0, 0), Math.PI / 8, pitchDriver)

    applyProceduralPose([yawOffset, pitchOffset])

    const expected = new THREE.Quaternion()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 8))
    expect(bone.quaternion.angleTo(expected)).toBeCloseTo(0, 6)
  })

  it('mutating axis/maxAngle in place (as a live-Leva consumer would) changes the next apply', () => {
    const bone = new THREE.Bone()
    const driver = createDriver(1)
    const offset = createOffset(bone, new THREE.Vector3(0, 1, 0), Math.PI / 6, driver)

    applyOffset(offset)
    const first = bone.quaternion.clone()

    bone.quaternion.identity()
    offset.axis.set(1, 0, 0)
    offset.maxAngle = Math.PI / 3
    applyOffset(offset)

    expect(bone.quaternion.angleTo(first)).toBeGreaterThan(0.01)
  })
})
