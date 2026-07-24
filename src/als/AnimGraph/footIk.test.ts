import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTwoBoneIkResult, createTwoBoneIkScratch, solveTwoBoneIk } from './footIk'

const hip = new THREE.Vector3(0, 0, 0)
const currentKnee = new THREE.Vector3(0, 0, 1)
const pole = new THREE.Vector3(0, 0, 1)

function solve(target: THREE.Vector3) {
  return solveTwoBoneIk(
    hip,
    currentKnee,
    target,
    1,
    1,
    pole,
    createTwoBoneIkResult(),
    createTwoBoneIkScratch(),
  )
}

describe('solveTwoBoneIk', () => {
  it('places a reachable ankle target exactly while preserving both bone lengths', () => {
    const target = new THREE.Vector3(1, 0, 0)
    const result = solve(target)

    expect(result.anklePosition.distanceTo(target)).toBeLessThan(1e-7)
    expect(result.kneePosition.distanceTo(hip)).toBeCloseTo(1, 7)
    expect(result.kneePosition.distanceTo(result.anklePosition)).toBeCloseTo(1, 7)
    expect(result.clamped).toBe(false)
  })

  it('clamps an over-reach target to full extension', () => {
    const result = solve(new THREE.Vector3(3, 0, 0))

    expect(result.distance).toBeCloseTo(2, 7)
    expect(result.anklePosition.toArray()).toEqual([2, 0, 0])
    expect(result.kneePosition.toArray()).toEqual([1, 0, 0])
    expect(result.clamped).toBe(true)
  })

  it('bends the knee toward the supplied pole direction', () => {
    const result = solve(new THREE.Vector3(1, 0, 0))

    expect(result.kneePosition.z).toBeGreaterThan(0)
    expect(result.kneePosition.y).toBeCloseTo(0, 7)
  })
})
