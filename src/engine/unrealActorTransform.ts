import type { Object3D } from 'three'

/** Apply C R C to the mesh and its actor-relative offset. Capsule orientation stays upright. */
export function applyUnrealActorMeshTransform(
  root: Object3D,
  yawDegrees: number,
  pitchDegrees: number,
  rollDegrees: number,
  relativeY: number,
): void {
  const half = Math.PI / 360
  const sp = Math.sin(pitchDegrees * half), cp = Math.cos(pitchDegrees * half)
  const sy = Math.sin(yawDegrees * half), cy = Math.cos(yawDegrees * half)
  const sr = Math.sin(rollDegrees * half), cr = Math.cos(rollDegrees * half)
  root.quaternion.set(
    sr * cp * cy - cr * sp * sy,
    sr * sp * cy - cr * cp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * cy + sr * sp * sy,
  )
  root.position.set(0, relativeY, 0).applyQuaternion(root.quaternion)
}
