/**
 * The web boundary keeps Unreal's actor axes (+X forward, +Y right, +Z up) while rendering in
 * glTF/three.js (+X, +Y up, +Z). The extractor uses C:(x,y,z)->(x,z,y), whose reflection changes
 * yaw handedness: Unreal +yaw becomes three.js -rotation.y.
 */

const RADIANS_TO_DEGREES = 180 / Math.PI
const DEGREES_TO_RADIANS = Math.PI / 180

export interface UnrealVector3 {
  x: number
  y: number
  z: number
}

/**
 * AAlsCharacter mounts SK_Als at UE yaw -90 degrees. Under the extractor's C basis this is a
 * +90-degree three.js child rotation, aligning the raw mesh's +Z forward with actor +X forward.
 */
export const ALS_MESH_COMPONENT_YAW_RADIANS = Math.PI / 2

/** Extractor basis C: Unreal (X,Y,Z) → three.js (X,Z,Y). C is its own inverse. */
export function unrealToThreeVector(
  vector: Readonly<UnrealVector3>,
  out: UnrealVector3 = { x: 0, y: 0, z: 0 },
): UnrealVector3 {
  out.x = vector.x
  out.y = vector.z
  out.z = vector.y
  return out
}

export function threeToUnrealVector(
  vector: Readonly<UnrealVector3>,
  out: UnrealVector3 = { x: 0, y: 0, z: 0 },
): UnrealVector3 {
  out.x = vector.x
  out.y = vector.z
  out.z = vector.y
  return out
}

export function unrealYawDegreesToThreeRadians(yawDegrees: number): number {
  return -yawDegrees * DEGREES_TO_RADIANS
}

/**
 * Converts an extracted SK_Als root-bone translation into actor-world ALS axes.
 *
 * The sampled root is in the glTF mesh basis. AAlsCharacter's authored mesh yaw
 * (-90° in UE, +90° after the extractor reflection) maps local glTF +Z to actor
 * +X before the actor yaw is applied.
 */
export function alsMeshRootTranslationToUnrealWorld(
  translation: ArrayLike<number>,
  actorYawDegrees: number,
  out: UnrealVector3 = { x: 0, y: 0, z: 0 },
): UnrealVector3 {
  const actorLocalX = translation[2] ?? 0
  const actorLocalY = -(translation[0] ?? 0)
  const yaw = actorYawDegrees * DEGREES_TO_RADIANS
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  out.x = cosine * actorLocalX - sine * actorLocalY
  out.y = sine * actorLocalX + cosine * actorLocalY
  out.z = translation[1] ?? 0
  return out
}

/**
 * Converts a three.js world-view yaw delta and rendered actor yaw into ALS's actor-relative view
 * yaw. Both arguments are radians in the three.js basis; the result is unwound ALS degrees.
 */
export function threeViewRelativeYawToUnrealDegrees(
  viewWorldYawDelta: number,
  actorYaw: number,
): number {
  const relativeThreeYaw = viewWorldYawDelta - actorYaw
  return Math.atan2(
    -Math.sin(relativeThreeYaw),
    Math.cos(relativeThreeYaw),
  ) * RADIANS_TO_DEGREES
}

/**
 * OrbitControls measures the target-to-camera offset around +Y from three.js +Z. The camera's
 * horizontal forward yaw is therefore azimuth + 90 degrees in the three.js actor convention.
 */
export function threeOrbitAzimuthToUnrealViewRelativeYawDegrees(
  orbitAzimuth: number,
  actorYaw: number,
): number {
  return threeViewRelativeYawToUnrealDegrees(
    orbitAzimuth + Math.PI / 2,
    actorYaw,
  )
}
