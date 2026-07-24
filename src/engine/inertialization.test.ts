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

describe('inertialization', () => {
  it('decays exactly to zero by the requested duration', () => {
    expect(evaluateInertialDecay(2, 0, 0, 0.4)).toBe(2)
    expect(evaluateInertialDecay(2, 0, 0.2, 0.4)).toBeCloseTo(1)
    expect(evaluateInertialDecay(2, 0, 0.4, 0.4)).toBe(0)
    expect(evaluateInertialDecay(2, -100, 1, 0.4)).toBe(0)
  })

  it('preserves the outgoing transform on the request frame for varied pose pairs', () => {
    const positions = [-7, -1.25, 0, 3, 11]
    const angles = [-Math.PI * 0.8, -0.2, 0, 0.7, Math.PI * 0.9]
    for (let i = 0; i < positions.length; i++) {
      const inertialization = createInertialization(1)
      const outgoing = poseAt(positions[i], angles[i])
      applyInertialization(inertialization, outgoing, 1 / 60)

      inertialization.requestInertialization(0.25)
      const incoming = poseAt(positions.at(-(i + 1))!, angles.at(-(i + 1))!)
      applyInertialization(inertialization, incoming, 1 / 60)

      expect(incoming.positions[0]).toBeCloseTo(positions[i], 6)
      const expectedY = Math.sin(angles[i] * 0.5)
      const expectedW = Math.cos(angles[i] * 0.5)
      const orientationDot = incoming.rotations[1] * expectedY
        + incoming.rotations[3] * expectedW
      expect(Math.abs(orientationDot)).toBeCloseTo(1, 6)
    }
  })

  it('restarts capture from the current output when a request overlaps an active one', () => {
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
    expect(secondTarget.positions[0]).toBeCloseTo(decayed.positions[0], 6)
    expect(inertialization.duration).toBe(0.5)
    expect(inertialization.elapsed).toBe(0)
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
