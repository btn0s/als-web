/**
 * Renderer-boundary conversion for an ALS/Unreal camera view.
 *
 * Unreal uses +X forward, +Y right, +Z up. The asset/world boundary reflects vectors with
 * C:(x,y,z)->(x,z,y), while a three.js camera uses local -Z forward, +X right, +Y up.
 */

const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI
const INVERSE_SQRT_TWO = Math.SQRT1_2

export interface UnrealCameraRotator {
  readonly pitch: number
  readonly yaw: number
  readonly roll: number
}

export interface ThreeCameraQuaternion {
  x: number
  y: number
  z: number
  w: number
}

function createQuaternion(): ThreeCameraQuaternion {
  return { x: 0, y: 0, z: 0, w: 1 }
}

/**
 * Converts an ALS FRotator into the world quaternion assigned to a three.js camera.
 *
 * If R is the Unreal rotation, the required three.js camera matrix is C R B, where B maps
 * three.js camera-local (+X,+Y,+Z) to Unreal-local (+Y,+Z,-X). Rewriting it as
 * (C R C)(C B) gives two proper rotations:
 *
 * - reflecting R maps its quaternion vector part by det(C)C: (x,y,z)->(-x,-z,-y);
 * - C B is the fixed -90 degree rotation about three.js +Y that aligns camera -Z with Unreal +X.
 *
 * `out` may be a THREE.Quaternion; accepting the structural subset keeps this module independent
 * of the renderer package and permits allocation-stable application.
 */
export function unrealRotatorToThreeCameraQuaternion(
  rotation: Readonly<UnrealCameraRotator>,
): ThreeCameraQuaternion
export function unrealRotatorToThreeCameraQuaternion<
  Output extends ThreeCameraQuaternion,
>(
  rotation: Readonly<UnrealCameraRotator>,
  out: Output,
): Output
export function unrealRotatorToThreeCameraQuaternion(
  rotation: Readonly<UnrealCameraRotator>,
  out: ThreeCameraQuaternion = createQuaternion(),
): ThreeCameraQuaternion {
  const halfPitch = rotation.pitch * DEGREES_TO_RADIANS * 0.5
  const halfYaw = rotation.yaw * DEGREES_TO_RADIANS * 0.5
  const halfRoll = rotation.roll * DEGREES_TO_RADIANS * 0.5
  const sp = Math.sin(halfPitch)
  const cp = Math.cos(halfPitch)
  const sy = Math.sin(halfYaw)
  const cy = Math.cos(halfYaw)
  const sr = Math.sin(halfRoll)
  const cr = Math.cos(halfRoll)

  // FRotator::Quaternion() in Unreal's axis/sign convention.
  const unrealX = cr * sp * sy - sr * cp * cy
  const unrealY = -cr * sp * cy - sr * cp * sy
  const unrealZ = cr * cp * sy - sr * sp * cy
  const unrealW = cr * cp * cy + sr * sp * sy

  // C R C: an axial quaternion vector gains det(C)=-1 under the reflection.
  const reflectedX = -unrealX
  const reflectedY = -unrealZ
  const reflectedZ = -unrealY
  const reflectedW = unrealW

  // (C R C) * Quaternion(Y=-90 degrees).
  const x =
    (reflectedX + reflectedZ) * INVERSE_SQRT_TWO
  const y =
    (reflectedY - reflectedW) * INVERSE_SQRT_TWO
  const z =
    (reflectedZ - reflectedX) * INVERSE_SQRT_TWO
  const w =
    (reflectedW + reflectedY) * INVERSE_SQRT_TWO
  const magnitude = Math.hypot(x, y, z, w)

  out.x = x / magnitude
  out.y = y / magnitude
  out.z = z / magnitude
  out.w = w / magnitude
  return out
}

/**
 * Converts Unreal's horizontal FOV to THREE.PerspectiveCamera's vertical FOV.
 *
 * `aspectRatio` is viewport width / height. Unreal clamps the ALS camera FOV before this boundary,
 * so this function preserves that value and only changes the projection-axis convention.
 */
export function unrealHorizontalFovDegreesToThreeVerticalFovDegrees(
  horizontalFieldOfView: number,
  aspectRatio: number,
): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError('aspectRatio must be finite and greater than zero')
  }

  const horizontalRadians = horizontalFieldOfView * DEGREES_TO_RADIANS
  return (
    2 * Math.atan(Math.tan(horizontalRadians * 0.5) / aspectRatio)
    * RADIANS_TO_DEGREES
  )
}
