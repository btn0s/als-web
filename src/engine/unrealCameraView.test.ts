import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  rotateCameraVector,
  type AlsCameraRotation,
} from '../als/AlsCamera/AlsCameraComponent'
import {
  unrealToThreeVector,
  type UnrealVector3,
} from './unrealCoordinateSpace'
import {
  unrealHorizontalFovDegreesToThreeVerticalFovDegrees,
  unrealRotatorToThreeCameraQuaternion,
} from './unrealCameraView'

const UE_FORWARD = { x: 1, y: 0, z: 0 } as const
const UE_RIGHT = { x: 0, y: 1, z: 0 } as const
const UE_UP = { x: 0, y: 0, z: 1 } as const

function expectedDirection(
  axis: Readonly<UnrealVector3>,
  rotation: Readonly<AlsCameraRotation>,
): THREE.Vector3 {
  const unrealDirection = rotateCameraVector(axis, rotation)
  const threeDirection = unrealToThreeVector(unrealDirection)
  return new THREE.Vector3(
    threeDirection.x,
    threeDirection.y,
    threeDirection.z,
  )
}

function expectVector(
  actual: Readonly<THREE.Vector3>,
  expected: Readonly<THREE.Vector3>,
) {
  expect(actual.x).toBeCloseTo(expected.x, 12)
  expect(actual.y).toBeCloseTo(expected.y, 12)
  expect(actual.z).toBeCloseTo(expected.z, 12)
}

describe('Unreal camera view renderer boundary', () => {
  it('maps the identity FRotator onto the three.js local camera basis', () => {
    const quaternion = unrealRotatorToThreeCameraQuaternion(
      { pitch: 0, yaw: 0, roll: 0 },
      new THREE.Quaternion(),
    )

    expect(quaternion.x).toBeCloseTo(0, 12)
    expect(quaternion.y).toBeCloseTo(-Math.SQRT1_2, 12)
    expect(quaternion.z).toBeCloseTo(0, 12)
    expect(quaternion.w).toBeCloseTo(Math.SQRT1_2, 12)
    expectVector(
      new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion),
      new THREE.Vector3(1, 0, 0),
    )
    expectVector(
      new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
      new THREE.Vector3(0, 0, 1),
    )
    expectVector(
      new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
      new THREE.Vector3(0, 1, 0),
    )
  })

  it.each([
    ['yaw', { pitch: 0, yaw: 90, roll: 0 }],
    ['pitch', { pitch: 35, yaw: 0, roll: 0 }],
    ['roll', { pitch: 0, yaw: 0, roll: 65 }],
    ['combined axes', { pitch: 27, yaw: -123, roll: 41 }],
  ] as const)(
    'matches independently transformed Unreal basis directions for %s',
    (_label, rotation) => {
      const quaternion = unrealRotatorToThreeCameraQuaternion(
        rotation,
        new THREE.Quaternion(),
      )
      const forward = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(quaternion)
      const right = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(quaternion)
      const up = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(quaternion)

      expectVector(forward, expectedDirection(UE_FORWARD, rotation))
      expectVector(right, expectedDirection(UE_RIGHT, rotation))
      expectVector(up, expectedDirection(UE_UP, rotation))
      expect(quaternion.length()).toBeCloseTo(1, 12)

      // A three.js camera's transformed +Z is backward: right × up = -forward.
      expectVector(
        right.clone().cross(up),
        forward.clone().negate(),
      )
    },
  )

  it('writes into a supplied THREE.Quaternion without replacing it', () => {
    const output = new THREE.Quaternion()
    expect(
      unrealRotatorToThreeCameraQuaternion(
        { pitch: -12, yaw: 34, roll: 5 },
        output,
      ),
    ).toBe(output)
  })

  it('converts known horizontal projection geometry to vertical FOV', () => {
    expect(
      unrealHorizontalFovDegreesToThreeVerticalFovDegrees(90, 1),
    ).toBeCloseTo(90, 12)
    expect(
      unrealHorizontalFovDegreesToThreeVerticalFovDegrees(90, 16 / 9),
    ).toBeCloseTo(58.71550708558255, 12)

    const horizontalFieldOfView = 110
    const aspectRatio = 2.39
    const verticalFieldOfView =
      unrealHorizontalFovDegreesToThreeVerticalFovDegrees(
        horizontalFieldOfView,
        aspectRatio,
      )
    const halfWidthAtUnitDistance = Math.tan(
      horizontalFieldOfView * Math.PI / 360,
    )
    const halfHeightAtUnitDistance = Math.tan(
      verticalFieldOfView * Math.PI / 360,
    )
    expect(halfWidthAtUnitDistance / halfHeightAtUnitDistance)
      .toBeCloseTo(aspectRatio, 12)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid aspect ratio %s',
    (aspectRatio) => {
      expect(() =>
        unrealHorizontalFovDegreesToThreeVerticalFovDegrees(
          90,
          aspectRatio,
        ),
      ).toThrowError(
        new RangeError('aspectRatio must be finite and greater than zero'),
      )
    },
  )
})
