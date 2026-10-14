import { expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import { rotateCameraVector } from '../als/AlsCamera/AlsCameraComponent'
import { applyUnrealActorMeshTransform } from './unrealActorTransform'

it.each([[0, 0, 0], [90, 0, 0], [37, -12, 8], [-179, 5, -11]])(
  'preserves the Unreal actor basis and rotates its offset: %s %s %s',
  (yaw, pitch, roll) => {
    const root = new Object3D()
    applyUnrealActorMeshTransform(root, yaw, pitch, roll, -0.92)
    for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -0.92]]) {
      const native = rotateCameraVector({ x, y, z }, { yaw, pitch, roll })
      const actual = new Vector3(x, z, y).applyQuaternion(root.quaternion)
      expect(actual.x).toBeCloseTo(native.x, 12)
      expect(actual.y).toBeCloseTo(native.z, 12)
      expect(actual.z).toBeCloseTo(native.y, 12)
      if (z === -0.92) expect(root.position.distanceTo(actual)).toBeLessThan(1e-12)
    }
  },
)
