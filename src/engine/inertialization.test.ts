import { describe, expect, it } from 'vitest'
import {
  applyInertialization,
  createInertialization,
  evaluateInertialDecay,
  measureInertializationCorrectionMagnitude,
} from './inertialization'
import { createPoseBuffer } from './poseBuffer'

function poseAt(x: number, angle = 0) {
  const pose = createPoseBuffer(1)
  pose.positions[0] = x
  pose.rotations[1] = Math.sin(angle * 0.5)
  pose.rotations[3] = Math.cos(angle * 0.5)
  pose.scales.fill(1)
  return pose
}

function poseWithRotation(axis: readonly [number, number, number], angle: number) {
  const pose = createPoseBuffer(1)
  const inverseLength = 1 / Math.hypot(...axis)
  const sine = Math.sin(angle * 0.5)
  pose.rotations[0] = axis[0] * inverseLength * sine
  pose.rotations[1] = axis[1] * inverseLength * sine
  pose.rotations[2] = axis[2] * inverseLength * sine
  pose.rotations[3] = Math.cos(angle * 0.5)
  pose.scales.fill(1)
  return pose
}

describe('inertialization', () => {
  it('decays exactly to zero by the requested duration', () => {
    expect(evaluateInertialDecay(2, 0, 0, 0.4)).toBe(2)
    expect(evaluateInertialDecay(2, 0, 0.2, 0.4)).toBeCloseTo(1)
    expect(evaluateInertialDecay(2, 0, 0.4, 0.4)).toBe(0)
    expect(evaluateInertialDecay(2, -100, 1, 0.4)).toBe(0)
  })

  it('preserves UE initial velocity and shortens extreme-velocity curves to avoid overshoot', () => {
    // With x0=1, v0=-4, t1=1, UE selects a0=12 and the polynomial is (1-t)^4.
    expect(evaluateInertialDecay(1, -4, 0.1, 1)).toBeCloseTo(0.6561)
    // v0=-10 shortens the effective duration to -5*x0/v0 = 0.5 seconds.
    expect(evaluateInertialDecay(1, -10, 0.5, 1)).toBe(0)
  })

  it('preserves the outgoing transform at zero elapsed for varied pose pairs', () => {
    const positions = [-7, -1.25, 0, 3, 11]
    const angles = [-Math.PI * 0.8, -0.2, 0, 0.7, Math.PI * 0.9]
    for (let i = 0; i < positions.length; i++) {
      const inertialization = createInertialization(1)
      const outgoing = poseAt(positions[i], angles[i])
      applyInertialization(inertialization, outgoing, 1 / 60)

      inertialization.requestInertialization(0.25)
      const incoming = poseAt(positions.at(-(i + 1))!, angles.at(-(i + 1))!)
      applyInertialization(inertialization, incoming, 0)

      expect(incoming.positions[0]).toBeCloseTo(positions[i], 6)
      const expectedY = Math.sin(angles[i] * 0.5)
      const expectedW = Math.cos(angles[i] * 0.5)
      const orientationDot = incoming.rotations[1] * expectedY
        + incoming.rotations[3] * expectedW
      expect(Math.abs(orientationDot)).toBeCloseTo(1, 6)
    }
  })

  it('consumes the current frame delta immediately when a request is captured', () => {
    const inertialization = createInertialization(1)
    applyInertialization(inertialization, poseAt(10), 0.25)
    inertialization.requestInertialization(1)
    const incoming = poseAt(0)

    applyInertialization(inertialization, incoming, 0.25)

    expect(incoming.positions[0]).toBeCloseTo(
      evaluateInertialDecay(10, 0, 0.25, 1),
    )
    expect(inertialization.elapsed).toBeCloseTo(0.25)
  })

  it('captures UE twist velocity against the incoming pose for non-commuting rotations', () => {
    const inertialization = createInertialization(1)
    applyInertialization(
      inertialization,
      poseWithRotation([1, 0, 0], -0.9),
      0.1,
    )
    applyInertialization(
      inertialization,
      poseWithRotation([1, 0, 0], 0.3),
      0.1,
    )
    inertialization.requestInertialization(1)

    applyInertialization(
      inertialization,
      poseWithRotation([1, 1, 0], 0.9),
      0,
    )

    expect(inertialization.rotation.speeds[0]).toBeCloseTo(-6.380038, 4)
  })

  it('merges same-frame requests using the shortest valid duration', () => {
    const inertialization = createInertialization(1)
    applyInertialization(inertialization, poseAt(10), 0)
    inertialization.requestInertialization(0.4)
    inertialization.requestInertialization(Number.NaN)
    inertialization.requestInertialization(-1)
    inertialization.requestInertialization(0.1)
    inertialization.requestInertialization(0.3)

    applyInertialization(inertialization, poseAt(0), 0)

    expect(inertialization.duration).toBeCloseTo(0.1)
    expect(inertialization.requestCount).toBe(3)
  })

  it('restarts from the current output and applies UE interruption deficit', () => {
    const inertialization = createInertialization(1)
    applyInertialization(inertialization, poseAt(10), 0.1)

    inertialization.requestInertialization(1)
    const firstTarget = poseAt(0)
    applyInertialization(inertialization, firstTarget, 0.1)
    const decayed = poseAt(0)
    applyInertialization(inertialization, decayed, 0.25)
    expect(decayed.positions[0]).toBeLessThan(10)
    expect(decayed.positions[0]).toBeGreaterThan(0)

    inertialization.requestInertialization(0.5)
    const secondTarget = poseAt(-20)
    applyInertialization(inertialization, secondTarget, 0.1)
    expect(secondTarget.positions[0]).toBeLessThan(decayed.positions[0])
    expect(secondTarget.positions[0]).toBeGreaterThan(-20)
    expect(inertialization.duration).toBe(0.5)
    expect(inertialization.elapsed).toBeCloseTo(0.1)

    inertialization.requestInertialization(0.5)
    applyInertialization(inertialization, poseAt(5), 0)
    expect(inertialization.duration).toBeCloseTo(0.1)
  })

  it('reduces a single request correction below 1e-3 within its duration', () => {
    const inertialization = createInertialization(1)
    applyInertialization(inertialization, poseAt(10, 0.8), 1 / 60)
    inertialization.requestInertialization(0.2)
    applyInertialization(inertialization, poseAt(-5, -0.6), 1 / 60)
    expect(measureInertializationCorrectionMagnitude(inertialization))
      .toBeGreaterThan(1)

    for (let frame = 0; frame < 12; frame++) {
      applyInertialization(inertialization, poseAt(-5, -0.6), 1 / 60)
    }
    expect(measureInertializationCorrectionMagnitude(inertialization))
      .toBeLessThan(1e-3)
  })
})
