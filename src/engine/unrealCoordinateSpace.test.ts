import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ALS_MESH_COMPONENT_YAW_RADIANS,
  threeOrbitAzimuthToUnrealViewRelativeYawDegrees,
  threeToUnrealVector,
  threeViewRelativeYawToUnrealDegrees,
  unrealToThreeVector,
  unrealYawDegreesToThreeRadians,
} from './unrealCoordinateSpace'

describe('Unreal to three.js coordinate space', () => {
  it('maps UE positive yaw to negative three.js Y rotation', () => {
    const forward = new THREE.Vector3(1, 0, 0)
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        unrealYawDegreesToThreeRadians(90),
      )

    // UE +X rotated +90 points UE +Y; extractor C maps UE +Y to three.js +Z.
    expect(forward.x).toBeCloseTo(0, 7)
    expect(forward.z).toBeCloseTo(1, 7)
  })

  it('ports AAlsCharacter mesh yaw -90 so raw mesh +Z aligns with actor +X', () => {
    const rawMeshForward = new THREE.Vector3(0, 0, 1)
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        ALS_MESH_COMPONENT_YAW_RADIANS,
      )

    expect(rawMeshForward.x).toBeCloseTo(1, 7)
    expect(rawMeshForward.z).toBeCloseTo(0, 7)
  })

  it('maps extractor vectors and round-trips the reflected basis', () => {
    expect(unrealToThreeVector({ x: 1, y: 0, z: 0 }))
      .toEqual({ x: 1, y: 0, z: 0 })
    expect(unrealToThreeVector({ x: 0, y: 1, z: 0 }))
      .toEqual({ x: 0, y: 0, z: 1 })
    expect(unrealToThreeVector({ x: 0, y: 0, z: 1 }))
      .toEqual({ x: 0, y: 1, z: 0 })

    const source = { x: 2.5, y: -7, z: 0.25 }
    const rendered = unrealToThreeVector(source)
    expect(threeToUnrealVector(rendered)).toEqual(source)
    expect(Math.hypot(rendered.x, rendered.y, rendered.z))
      .toBeCloseTo(Math.hypot(source.x, source.y, source.z), 12)
  })

  it('closes actor-relative view yaw after the actor turns to the view', () => {
    const viewWorldYawThree = unrealYawDegreesToThreeRadians(120)
    expect(
      threeViewRelativeYawToUnrealDegrees(viewWorldYawThree, 0),
    ).toBeCloseTo(120, 7)

    const actorYawThree = unrealYawDegreesToThreeRadians(120)
    expect(
      threeViewRelativeYawToUnrealDegrees(viewWorldYawThree, actorYawThree),
    ).toBeCloseTo(0, 7)
  })

  it('unwinds relative view yaw at the ±180-degree boundary', () => {
    expect(
      threeViewRelativeYawToUnrealDegrees(
        unrealYawDegreesToThreeRadians(-170),
        unrealYawDegreesToThreeRadians(170),
      ),
    ).toBeCloseTo(20, 7)
  })

  it('derives physical ALS view yaw from OrbitControls azimuth', () => {
    // Camera behind actor +X: target-to-camera points -X and camera-forward points +X.
    expect(
      threeOrbitAzimuthToUnrealViewRelativeYawDegrees(-Math.PI / 2, 0),
    ).toBeCloseTo(0, 7)

    // Camera on +Z looks toward -Z, which is Unreal -Y / yaw -90.
    expect(
      threeOrbitAzimuthToUnrealViewRelativeYawDegrees(0, 0),
    ).toBeCloseTo(-90, 7)

    // Actor and camera both face Unreal +Y / three.js +Z.
    expect(
      threeOrbitAzimuthToUnrealViewRelativeYawDegrees(
        Math.PI,
        unrealYawDegreesToThreeRadians(90),
      ),
    ).toBeCloseTo(0, 7)
  })
})
