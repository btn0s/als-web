import type { AlsVector3 } from '../State/AlsLocomotionState'
import { unwindDegrees } from '../State/AlsLocomotionState'
import { exponentialDecay } from '../State/AlsGroundedState'
import {
  ALS_CAMERA_SETTINGS,
  type AlsCameraSettings,
  type AlsThirdPersonCameraSettings,
} from './AlsCameraSettings'
import {
  CAMERA_OFFSET_X_CURVE_NAME,
  CAMERA_OFFSET_Y_CURVE_NAME,
  CAMERA_OFFSET_Z_CURVE_NAME,
  FIRST_PERSON_OVERRIDE_CURVE_NAME,
  FOV_OFFSET_CURVE_NAME,
  LOCATION_LAG_X_CURVE_NAME,
  LOCATION_LAG_Y_CURVE_NAME,
  LOCATION_LAG_Z_CURVE_NAME,
  PIVOT_OFFSET_X_CURVE_NAME,
  PIVOT_OFFSET_Y_CURVE_NAME,
  PIVOT_OFFSET_Z_CURVE_NAME,
  ROTATION_LAG_CURVE_NAME,
  TRACE_OVERRIDE_CURVE_NAME,
  type AlsCameraCurveName,
} from './Utility/AlsCameraConstants'

/**
 * Framework-free port of UAlsCameraComponent's pure tick math.
 *
 * Coordinates retain ALS/Unreal's +X forward, +Y right, +Z up convention. Locations are metres
 * at this public boundary; only authored `PivotOffset*` / `CameraOffset*` curve values enter in
 * centimetres and are converted exactly once by `calculatePivotOffset()` /
 * `calculateCameraOffset()`. Rotations are FRotator-style degrees.
 */

const CENTIMETRES_TO_METRES = 0.01
const COUNTER_CLOCKWISE_ROTATION_ANGLE_THRESHOLD = 5
const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5
// UE_KINDA_SMALL_NUMBER is 1e-4 Unreal centimetres; scale the physical epsilon with the world.
const UE_KINDA_SMALL_NUMBER_METRES = 1e-6

export interface AlsCameraRotation {
  pitch: number
  yaw: number
  roll: number
}

export interface AlsCameraQuaternion {
  x: number
  y: number
  z: number
  w: number
}

export type AlsCameraMovementBaseKey = object | string | number

export interface AlsCameraMovementBase {
  readonly key: AlsCameraMovementBaseKey
  readonly boneName: string
  readonly hasRelativeRotation: boolean
  readonly location: Readonly<AlsVector3>
  readonly rotation: Readonly<AlsCameraQuaternion>
}

/**
 * Spatial offset curves are authored centimetres. Lag/override curves are unitless and FovOffset
 * is degrees, matching UAlsCameraConstants and AB_Als_Camera.
 */
export type AlsCameraCurveValues =
  Readonly<Partial<Record<AlsCameraCurveName, number>>>

export interface AlsCameraComponentState {
  overrideFieldOfView: boolean
  fieldOfViewOverride: number
  postProcessWeight: number
  previousGlobalTimeDilation: number
  pivotTargetLocation: AlsVector3
  pivotLagLocation: AlsVector3
  pivotLocation: AlsVector3
  cameraLocation: AlsVector3
  cameraRotation: AlsCameraRotation
  movementBaseKey: AlsCameraMovementBaseKey | null
  movementBaseBoneName: string
  pivotMovementBaseRelativeLagLocation: AlsVector3
  cameraMovementBaseRelativeRotation: AlsCameraQuaternion
  traceDistanceRatio: number
  cameraFieldOfView: number
  rightShoulder: boolean
}

export interface AlsCameraTraceRequest {
  readonly start: Readonly<AlsVector3>
  readonly end: Readonly<AlsVector3>
  readonly radius: number
  /** ALS's overlap-recovery sphere uses `(TraceRadius + 1 cm) * MeshScale`. */
  readonly penetrationAdjustmentRadius: number
  readonly ownerLocation: Readonly<AlsVector3>
  readonly channel: AlsThirdPersonCameraSettings['traceChannel']
}

/**
 * Geometry adapters return C++'s post-sweep `TraceResult`. If start penetration forced
 * TryAdjustLocationBlockedByGeometry() to move TraceStart, return that adjusted start too because
 * trace-distance smoothing is evaluated from the adjusted point.
 */
export interface AlsCameraCollisionResult {
  readonly traceResult: Readonly<AlsVector3>
  readonly adjustedTraceStart?: Readonly<AlsVector3>
}

export type AlsCameraTrace = (
  request: AlsCameraTraceRequest,
) => AlsCameraCollisionResult | null

export interface AlsCameraTraceCalculationInput {
  readonly cameraTargetLocation: Readonly<AlsVector3>
  readonly pivotTargetLocation: Readonly<AlsVector3>
  readonly pivotOffset: Readonly<AlsVector3>
  readonly thirdPersonTraceStartLocation: Readonly<AlsVector3>
  readonly traceOverrideAmount: number
  readonly meshScale: number
  readonly ownerLocation: Readonly<AlsVector3>
  readonly deltaTime: number
  readonly allowLag: boolean
  readonly previousTraceDistanceRatio: number
  readonly settings: AlsThirdPersonCameraSettings
  readonly trace: AlsCameraTrace
}

export interface AlsCameraTraceCalculation {
  readonly location: AlsVector3
  readonly traceStart: AlsVector3
  readonly traceEnd: AlsVector3
  readonly traceResult: AlsVector3
  readonly traceDistanceRatio: number
}

export interface AlsCameraComponentInput {
  readonly deltaTime: number
  readonly allowLag?: boolean
  /** GetThirdPersonPivotLocation(), already converted to metres. */
  readonly pivotTargetLocation: Readonly<AlsVector3>
  /** GetFirstPersonCameraLocation(), already converted to metres. */
  readonly firstPersonCameraLocation: Readonly<AlsVector3>
  /** GetThirdPersonTraceStartLocation(), already converted to metres. */
  readonly thirdPersonTraceStartLocation: Readonly<AlsVector3>
  /** Character actor location used by ALS's penetration-adjustment direction guard. */
  readonly ownerLocation: Readonly<AlsVector3>
  readonly cameraTargetRotation: Readonly<AlsCameraRotation>
  readonly meshRotation: Readonly<AlsCameraRotation>
  readonly movementBase?: AlsCameraMovementBase | null
  /** Character mesh component scale Z, which ALS applies to offsets and trace radius. */
  readonly meshScale?: number
  readonly curves: AlsCameraCurveValues
  readonly settings?: AlsCameraSettings
  readonly trace: AlsCameraTrace
}

export interface AlsThirdPersonPivotLocationInput {
  /** `Character->GetMesh()->GetAttachParent()` validity. */
  readonly meshHasAttachParent: boolean
  /** `FirstPivotSocketName` location from the evaluated character pose, in metres. */
  readonly firstPivotSocketLocation: Readonly<AlsVector3>
  /** `SecondPivotSocketName` location from the evaluated character pose, in metres. */
  readonly secondPivotSocketLocation: Readonly<AlsVector3>
  /** Character root-component location, in metres. */
  readonly characterRootComponentLocation: Readonly<AlsVector3>
  /** Character root-component bounds box extent, in metres. */
  readonly characterRootBoundsBoxExtent: Readonly<AlsVector3>
  readonly settings?: AlsThirdPersonCameraSettings
}

export interface AlsCameraComponentTick {
  readonly state: AlsCameraComponentState
  readonly lagAllowed: boolean
  readonly firstPersonOverride: number
  readonly firstPersonFastPath: boolean
  readonly pivotOffset: AlsVector3 | null
  readonly cameraOffset: AlsVector3 | null
  readonly cameraTargetLocation: AlsVector3 | null
  readonly trace: AlsCameraTraceCalculation | null
}

function vector(x = 0, y = 0, z = 0): AlsVector3 {
  return { x, y, z }
}

function rotation(pitch = 0, yaw = 0, roll = 0): AlsCameraRotation {
  return { pitch, yaw, roll }
}

function quaternion(x = 0, y = 0, z = 0, w = 1): AlsCameraQuaternion {
  return { x, y, z, w }
}

function copyVector(value: Readonly<AlsVector3>): AlsVector3 {
  return vector(value.x, value.y, value.z)
}

function copyRotation(value: Readonly<AlsCameraRotation>): AlsCameraRotation {
  return rotation(value.pitch, value.yaw, value.roll)
}

function copyQuaternion(
  value: Readonly<AlsCameraQuaternion>,
): AlsCameraQuaternion {
  return quaternion(value.x, value.y, value.z, value.w)
}

function add(
  first: Readonly<AlsVector3>,
  second: Readonly<AlsVector3>,
): AlsVector3 {
  return vector(
    first.x + second.x,
    first.y + second.y,
    first.z + second.z,
  )
}

function subtract(
  first: Readonly<AlsVector3>,
  second: Readonly<AlsVector3>,
): AlsVector3 {
  return vector(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  )
}

function multiply(value: Readonly<AlsVector3>, scale: number): AlsVector3 {
  return vector(value.x * scale, value.y * scale, value.z * scale)
}

function lerpVector(
  from: Readonly<AlsVector3>,
  to: Readonly<AlsVector3>,
  ratio: number,
): AlsVector3 {
  return vector(
    from.x + (to.x - from.x) * ratio,
    from.y + (to.y - from.y) * ratio,
    from.z + (to.z - from.z) * ratio,
  )
}

function sizeSquared(value: Readonly<AlsVector3>): number {
  return value.x * value.x + value.y * value.y + value.z * value.z
}

function distanceSquared(
  first: Readonly<AlsVector3>,
  second: Readonly<AlsVector3>,
): number {
  return sizeSquared(subtract(first, second))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function isRelevant(weight: number): boolean {
  return weight > ZERO_ANIMATION_WEIGHT_THRESHOLD
}

function isFullWeight(weight: number): boolean {
  return weight >= 1 - ZERO_ANIMATION_WEIGHT_THRESHOLD
}

/**
 * Exact `UAlsCameraComponent::GetThirdPersonPivotLocation()`.
 *
 * The normal path is the midpoint of the evaluated first and second pivot sockets (`root` and
 * `head` in `CS_Als_Default`). A detached mesh can leave its root bone fixed, so ALS substitutes
 * the capsule bottom only when the configured first pivot is the root bone.
 */
export function getThirdPersonPivotLocation(
  input: AlsThirdPersonPivotLocationInput,
): AlsVector3 {
  const settings = input.settings ?? ALS_CAMERA_SETTINGS.thirdPerson
  const firstPivotLocation =
    !input.meshHasAttachParent
    && settings.firstPivotSocketName === 'root'
      ? vector(
          input.characterRootComponentLocation.x,
          input.characterRootComponentLocation.y,
          input.characterRootComponentLocation.z
            - input.characterRootBoundsBoxExtent.z,
        )
      : input.firstPivotSocketLocation

  return multiply(
    add(firstPivotLocation, input.secondPivotSocketLocation),
    0.5,
  )
}

function normalizeQuaternion(
  value: Readonly<AlsCameraQuaternion>,
): AlsCameraQuaternion {
  const magnitude = Math.hypot(value.x, value.y, value.z, value.w)
  if (magnitude <= Number.EPSILON) {
    return quaternion()
  }
  const inverseMagnitude = 1 / magnitude
  return quaternion(
    value.x * inverseMagnitude,
    value.y * inverseMagnitude,
    value.z * inverseMagnitude,
    value.w * inverseMagnitude,
  )
}

function inverseQuaternion(
  value: Readonly<AlsCameraQuaternion>,
): AlsCameraQuaternion {
  const squaredMagnitude =
    value.x * value.x
    + value.y * value.y
    + value.z * value.z
    + value.w * value.w
  if (squaredMagnitude <= Number.EPSILON) {
    return quaternion()
  }
  return quaternion(
    -value.x / squaredMagnitude,
    -value.y / squaredMagnitude,
    -value.z / squaredMagnitude,
    value.w / squaredMagnitude,
  )
}

function multiplyQuaternions(
  first: Readonly<AlsCameraQuaternion>,
  second: Readonly<AlsCameraQuaternion>,
): AlsCameraQuaternion {
  return normalizeQuaternion(quaternion(
    first.w * second.x
      + first.x * second.w
      + first.y * second.z
      - first.z * second.y,
    first.w * second.y
      - first.x * second.z
      + first.y * second.w
      + first.z * second.x,
    first.w * second.z
      + first.x * second.y
      - first.y * second.x
      + first.z * second.w,
    first.w * second.w
      - first.x * second.x
      - first.y * second.y
      - first.z * second.z,
  ))
}

function rotateVectorByQuaternion(
  value: Readonly<AlsVector3>,
  valueRotation: Readonly<AlsCameraQuaternion>,
): AlsVector3 {
  const normalized = normalizeQuaternion(valueRotation)
  const crossX = normalized.y * value.z - normalized.z * value.y
  const crossY = normalized.z * value.x - normalized.x * value.z
  const crossZ = normalized.x * value.y - normalized.y * value.x
  const secondCrossX = normalized.y * crossZ - normalized.z * crossY
  const secondCrossY = normalized.z * crossX - normalized.x * crossZ
  const secondCrossZ = normalized.x * crossY - normalized.y * crossX
  return vector(
    value.x + 2 * (normalized.w * crossX + secondCrossX),
    value.y + 2 * (normalized.w * crossY + secondCrossY),
    value.z + 2 * (normalized.w * crossZ + secondCrossZ),
  )
}

function unrotateVectorByQuaternion(
  value: Readonly<AlsVector3>,
  valueRotation: Readonly<AlsCameraQuaternion>,
): AlsVector3 {
  return rotateVectorByQuaternion(value, inverseQuaternion(valueRotation))
}

/** FRotator::Quaternion() in ALS/Unreal's axis and sign convention. */
export function cameraRotationToQuaternion(
  value: Readonly<AlsCameraRotation>,
): AlsCameraQuaternion {
  const pitch = value.pitch * Math.PI / 360
  const yaw = value.yaw * Math.PI / 360
  const roll = value.roll * Math.PI / 360
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  return normalizeQuaternion(quaternion(
    cr * sp * sy - sr * cp * cy,
    -cr * sp * cy - sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ))
}

/** FQuat::Rotator(), including Unreal's singularity branches. */
export function quaternionToCameraRotation(
  value: Readonly<AlsCameraQuaternion>,
): AlsCameraRotation {
  const normalized = normalizeQuaternion(value)
  const singularityTest =
    normalized.z * normalized.x - normalized.w * normalized.y
  const yawY = 2 * (
    normalized.w * normalized.z + normalized.x * normalized.y
  )
  const yawX = 1 - 2 * (
    normalized.y * normalized.y + normalized.z * normalized.z
  )
  const radiansToDegrees = 180 / Math.PI
  const singularityThreshold = 0.4999995

  if (singularityTest < -singularityThreshold) {
    const yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    return rotation(
      -90,
      unwindDegrees(yaw),
      unwindDegrees(
        -yaw
        - 2 * Math.atan2(normalized.x, normalized.w) * radiansToDegrees,
      ),
    )
  }
  if (singularityTest > singularityThreshold) {
    const yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    return rotation(
      90,
      unwindDegrees(yaw),
      unwindDegrees(
        yaw
        - 2 * Math.atan2(normalized.x, normalized.w) * radiansToDegrees,
      ),
    )
  }

  return rotation(
    Math.asin(2 * singularityTest) * radiansToDegrees,
    unwindDegrees(Math.atan2(yawY, yawX) * radiansToDegrees),
    unwindDegrees(
      Math.atan2(
        -2 * (
          normalized.w * normalized.x
          + normalized.y * normalized.z
        ),
        1 - 2 * (
          normalized.x * normalized.x
          + normalized.y * normalized.y
        ),
      ) * radiansToDegrees,
    ),
  )
}

function curveValue(
  curves: AlsCameraCurveValues,
  name: AlsCameraCurveName,
): number {
  return curves[name] ?? 0
}

function remapAngleForCounterClockwiseRotation(angle: number): number {
  return angle > 180 - COUNTER_CLOCKWISE_ROTATION_ANGLE_THRESHOLD
    ? angle - 360
    : angle
}

function decayValue(
  current: number,
  target: number,
  deltaTime: number,
  lambda: number,
): number {
  return lambda > 0
    ? current + (target - current) * exponentialDecay(deltaTime, lambda)
    : target
}

/**
 * FRotationMatrix-compatible vector rotation for FRotator(Pitch, Yaw, Roll).
 *
 * Pitch rotates about +Y, yaw about +Z, and roll about +X in ALS/Unreal space.
 */
export function rotateCameraVector(
  value: Readonly<AlsVector3>,
  valueRotation: Readonly<AlsCameraRotation>,
): AlsVector3 {
  const pitch = valueRotation.pitch * Math.PI / 180
  const yaw = valueRotation.yaw * Math.PI / 180
  const roll = valueRotation.roll * Math.PI / 180
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)

  const forward = vector(cp * cy, cp * sy, sp)
  const right = vector(
    sr * sp * cy - cr * sy,
    sr * sp * sy + cr * cy,
    -sr * cp,
  )
  const up = vector(
    -(cr * sp * cy + sr * sy),
    cy * sr - cr * sp * sy,
    cr * cp,
  )

  return vector(
    forward.x * value.x + right.x * value.y + up.x * value.z,
    forward.y * value.x + right.y * value.y + up.y * value.z,
    forward.z * value.x + right.z * value.y + up.z * value.z,
  )
}

function rotateYaw(
  value: Readonly<AlsVector3>,
  yawAngle: number,
): AlsVector3 {
  const yaw = yawAngle * Math.PI / 180
  const sine = Math.sin(yaw)
  const cosine = Math.cos(yaw)
  return vector(
    cosine * value.x - sine * value.y,
    sine * value.x + cosine * value.y,
    value.z,
  )
}

function unrotateYaw(
  value: Readonly<AlsVector3>,
  yawAngle: number,
): AlsVector3 {
  return rotateYaw(value, -yawAngle)
}

/** UAlsRotation::ExponentialDecayRotation(), including the +175° counterclockwise bias. */
export function calculateCameraRotation(
  current: Readonly<AlsCameraRotation>,
  target: Readonly<AlsCameraRotation>,
  deltaTime: number,
  rotationLag: number,
  allowLag: boolean,
): AlsCameraRotation {
  if (!allowLag || rotationLag <= 0) {
    return copyRotation(target)
  }

  const ratio = exponentialDecay(deltaTime, rotationLag)
  const delta = rotation(
    remapAngleForCounterClockwiseRotation(
      unwindDegrees(target.pitch - current.pitch),
    ),
    remapAngleForCounterClockwiseRotation(
      unwindDegrees(target.yaw - current.yaw),
    ),
    remapAngleForCounterClockwiseRotation(
      unwindDegrees(target.roll - current.roll),
    ),
  )
  return rotation(
    unwindDegrees(current.pitch + delta.pitch * ratio),
    unwindDegrees(current.yaw + delta.yaw * ratio),
    unwindDegrees(current.roll + delta.roll * ratio),
  )
}

/**
 * UAlsCameraComponent::CalculatePivotLagLocation(): unrotate into camera-yaw space, decay each
 * axis independently, then rotate back.
 */
export function calculatePivotLagLocation(
  pivotLagLocation: Readonly<AlsVector3>,
  pivotTargetLocation: Readonly<AlsVector3>,
  cameraYawAngle: number,
  deltaTime: number,
  locationLag: Readonly<AlsVector3>,
  allowLag: boolean,
): AlsVector3 {
  if (!allowLag) {
    return copyVector(pivotTargetLocation)
  }

  const relativeInitial = unrotateYaw(pivotLagLocation, cameraYawAngle)
  const relativeTarget = unrotateYaw(pivotTargetLocation, cameraYawAngle)
  return rotateYaw(
    vector(
      decayValue(
        relativeInitial.x,
        relativeTarget.x,
        deltaTime,
        locationLag.x,
      ),
      decayValue(
        relativeInitial.y,
        relativeTarget.y,
        deltaTime,
        locationLag.y,
      ),
      decayValue(
        relativeInitial.z,
        relativeTarget.z,
        deltaTime,
        locationLag.z,
      ),
    ),
    cameraYawAngle,
  )
}

/** UAlsCameraComponent::CalculatePivotOffset(), returned in metres. */
export function calculatePivotOffset(
  curves: AlsCameraCurveValues,
  meshRotation: Readonly<AlsCameraRotation>,
  meshScale: number,
): AlsVector3 {
  const authoredCentimetres = vector(
    curveValue(curves, PIVOT_OFFSET_X_CURVE_NAME),
    curveValue(curves, PIVOT_OFFSET_Y_CURVE_NAME),
    curveValue(curves, PIVOT_OFFSET_Z_CURVE_NAME),
  )
  return rotateCameraVector(
    multiply(authoredCentimetres, CENTIMETRES_TO_METRES * meshScale),
    meshRotation,
  )
}

/** UAlsCameraComponent::CalculateCameraOffset(), returned in metres. */
export function calculateCameraOffset(
  curves: AlsCameraCurveValues,
  cameraRotation: Readonly<AlsCameraRotation>,
  meshScale: number,
): AlsVector3 {
  const authoredCentimetres = vector(
    curveValue(curves, CAMERA_OFFSET_X_CURVE_NAME),
    curveValue(curves, CAMERA_OFFSET_Y_CURVE_NAME),
    curveValue(curves, CAMERA_OFFSET_Z_CURVE_NAME),
  )
  return rotateCameraVector(
    multiply(authoredCentimetres, CENTIMETRES_TO_METRES * meshScale),
    cameraRotation,
  )
}

/**
 * UAlsCameraComponent::CalculateCameraTrace() after platform collision resolution.
 *
 * Obstruction contraction is immediate. Recovery toward the unobstructed distance is exponential.
 */
export function calculateCameraTrace(
  input: AlsCameraTraceCalculationInput,
): AlsCameraTraceCalculation {
  const overrideTarget = add(
    add(input.pivotTargetLocation, input.pivotOffset),
    input.settings.traceOverrideOffset,
  )
  let traceStart = lerpVector(
    input.thirdPersonTraceStartLocation,
    overrideTarget,
    clamp01(input.traceOverrideAmount),
  )
  const traceEnd = copyVector(input.cameraTargetLocation)
  const collision = input.trace({
    start: copyVector(traceStart),
    end: copyVector(traceEnd),
    radius: input.settings.traceRadius * input.meshScale,
    penetrationAdjustmentRadius:
      (input.settings.traceRadius + CENTIMETRES_TO_METRES)
      * input.meshScale,
    ownerLocation: copyVector(input.ownerLocation),
    channel: input.settings.traceChannel,
  })
  if (collision?.adjustedTraceStart) {
    traceStart = copyVector(collision.adjustedTraceStart)
  }
  const traceResult = collision
    ? copyVector(collision.traceResult)
    : copyVector(traceEnd)

  if (!input.allowLag || !input.settings.enableTraceDistanceSmoothing) {
    return {
      location: copyVector(traceResult),
      traceStart,
      traceEnd,
      traceResult,
      traceDistanceRatio: 1,
    }
  }

  const traceVector = subtract(traceEnd, traceStart)
  const traceDistance = Math.sqrt(sizeSquared(traceVector))
  if (traceDistance <= UE_KINDA_SMALL_NUMBER_METRES) {
    return {
      location: copyVector(traceResult),
      traceStart,
      traceEnd,
      traceResult,
      traceDistanceRatio: 1,
    }
  }

  const targetTraceDistanceRatio =
    Math.sqrt(distanceSquared(traceResult, traceStart)) / traceDistance
  const traceDistanceRatio =
    targetTraceDistanceRatio <= input.previousTraceDistanceRatio
      ? targetTraceDistanceRatio
      : decayValue(
          input.previousTraceDistanceRatio,
          targetTraceDistanceRatio,
          input.deltaTime,
          input.settings.traceDistanceSmoothing.interpolationSpeed,
        )

  return {
    location: add(traceStart, multiply(traceVector, traceDistanceRatio)),
    traceStart,
    traceEnd,
    traceResult,
    traceDistanceRatio,
  }
}

export function createAlsCameraComponentState(
  overrides: Partial<AlsCameraComponentState> = {},
): AlsCameraComponentState {
  return {
    overrideFieldOfView: overrides.overrideFieldOfView ?? false,
    fieldOfViewOverride: clamp(
      overrides.fieldOfViewOverride ?? 90,
      5,
      175,
    ),
    postProcessWeight: clamp01(overrides.postProcessWeight ?? 0),
    previousGlobalTimeDilation:
      overrides.previousGlobalTimeDilation ?? 1,
    pivotTargetLocation: copyVector(
      overrides.pivotTargetLocation ?? vector(),
    ),
    pivotLagLocation: copyVector(overrides.pivotLagLocation ?? vector()),
    pivotLocation: copyVector(overrides.pivotLocation ?? vector()),
    cameraLocation: copyVector(overrides.cameraLocation ?? vector()),
    cameraRotation: copyRotation(overrides.cameraRotation ?? rotation()),
    movementBaseKey: overrides.movementBaseKey ?? null,
    movementBaseBoneName: overrides.movementBaseBoneName ?? '',
    pivotMovementBaseRelativeLagLocation: copyVector(
      overrides.pivotMovementBaseRelativeLagLocation ?? vector(),
    ),
    cameraMovementBaseRelativeRotation: copyQuaternion(
      overrides.cameraMovementBaseRelativeRotation ?? quaternion(),
    ),
    traceDistanceRatio: overrides.traceDistanceRatio ?? 1,
    cameraFieldOfView: overrides.cameraFieldOfView ?? 90,
    rightShoulder: overrides.rightShoulder ?? true,
  }
}

/** UAlsCameraComponent::SetFieldOfViewOverriden(). */
export function setFieldOfViewOverriden(
  state: AlsCameraComponentState,
  overridden: boolean,
): void {
  state.overrideFieldOfView = overridden
}

/** UAlsCameraComponent::SetFieldOfViewOverride(). */
export function setFieldOfViewOverride(
  state: AlsCameraComponentState,
  fieldOfView: number,
): void {
  state.fieldOfViewOverride = clamp(fieldOfView, 5, 175)
}

/** UAlsCameraComponent::SetPostProcessWeight(). */
export function setPostProcessWeight(
  state: AlsCameraComponentState,
  weight: number,
): void {
  state.postProcessWeight = clamp01(weight)
}

/** UAlsCameraComponent::SetRightShoulder(). */
export function setRightShoulder(
  state: AlsCameraComponentState,
  rightShoulder: boolean,
): void {
  state.rightShoulder = rightShoulder
}

export interface AlsCameraDeltaTimeInput {
  readonly deltaTime: number
  readonly deltaRealTime: number
  readonly effectiveGlobalTimeDilation: number
  readonly customTimeDilation: number
}

/**
 * UAlsCameraComponent::TickComponent() time-dilation prelude. The previous frame's global
 * dilation is intentional: ALS avoids unscaling with a value that may not yet affect this frame.
 */
export function refreshCameraDeltaTime(
  state: AlsCameraComponentState,
  settings: AlsCameraSettings,
  input: AlsCameraDeltaTimeInput,
): number {
  let deltaTime = input.deltaTime
  if (settings.ignoreTimeDilation) {
    const timeDilation =
      state.previousGlobalTimeDilation * input.customTimeDilation
    deltaTime = timeDilation > 1e-8
      ? deltaTime / timeDilation
      : input.deltaRealTime
  }
  state.previousGlobalTimeDilation = input.effectiveGlobalTimeDilation
  return deltaTime
}

/**
 * Exact pure ordering of UAlsCameraComponent::TickCamera(). UE's geometry queries are owned by
 * the injected trace adapter, whose request includes every input used by the source recovery path.
 */
export function tickAlsCameraComponent(
  state: AlsCameraComponentState,
  input: AlsCameraComponentInput,
): AlsCameraComponentTick {
  const curves = input.curves
  const settings = input.settings ?? ALS_CAMERA_SETTINGS
  const meshScale = input.meshScale ?? 1
  const requestedAllowLag = input.allowLag ?? true

  // Refresh movement base. This intentionally keys only on the base primitive and bone name,
  // matching BasedMovement.MovementBase / BasedMovement.BoneName in the C++ component.
  const movementBase = input.movementBase ?? null
  const movementBaseKey = movementBase?.key ?? null
  const movementBaseBoneName = movementBase?.boneName ?? ''
  const movementBaseHasRelativeRotation =
    movementBase?.hasRelativeRotation ?? false
  const movementBaseLocation = movementBaseHasRelativeRotation
    ? movementBase!.location
    : vector()
  const movementBaseRotation = movementBaseHasRelativeRotation
    ? normalizeQuaternion(movementBase!.rotation)
    : quaternion()

  if (
    state.movementBaseKey !== movementBaseKey
    || state.movementBaseBoneName !== movementBaseBoneName
  ) {
    state.movementBaseKey = movementBaseKey
    state.movementBaseBoneName = movementBaseBoneName

    if (movementBaseHasRelativeRotation) {
      state.pivotMovementBaseRelativeLagLocation =
        unrotateVectorByQuaternion(
          subtract(state.pivotLagLocation, movementBaseLocation),
          movementBaseRotation,
        )
      state.cameraMovementBaseRelativeRotation = multiplyQuaternions(
        inverseQuaternion(movementBaseRotation),
        cameraRotationToQuaternion(state.cameraRotation),
      )
    } else {
      state.pivotMovementBaseRelativeLagLocation = vector()
      state.cameraMovementBaseRelativeRotation = quaternion()
    }
  }

  const previousPivotTargetLocation = copyVector(state.pivotTargetLocation)
  state.pivotTargetLocation = copyVector(input.pivotTargetLocation)

  const firstPersonOverride = clamp01(
    curveValue(curves, FIRST_PERSON_OVERRIDE_CURVE_NAME),
  )
  if (isFullWeight(firstPersonOverride)) {
    // The C++ fast path returns before teleport checks, lag, trace, FovOffset, and final FOV clamp.
    state.pivotLagLocation = copyVector(state.pivotTargetLocation)
    state.pivotLocation = copyVector(state.pivotTargetLocation)
    state.cameraLocation = copyVector(input.firstPersonCameraLocation)
    state.cameraRotation = copyRotation(input.cameraTargetRotation)
    state.cameraFieldOfView = state.overrideFieldOfView
      ? state.fieldOfViewOverride
      : settings.firstPerson.fieldOfView
    return {
      state,
      lagAllowed: requestedAllowLag,
      firstPersonOverride,
      firstPersonFastPath: true,
      pivotOffset: null,
      cameraOffset: null,
      cameraTargetLocation: null,
      trace: null,
    }
  }

  const teleportDistanceThreshold = settings.teleportDistanceThreshold
  const lagAllowed = requestedAllowLag
    && (
      teleportDistanceThreshold <= 0
      || distanceSquared(
        previousPivotTargetLocation,
        state.pivotTargetLocation,
      ) <= teleportDistanceThreshold * teleportDistanceThreshold
    )

  if (movementBaseHasRelativeRotation) {
    state.cameraRotation = quaternionToCameraRotation(
      multiplyQuaternions(
        movementBaseRotation,
        state.cameraMovementBaseRelativeRotation,
      ),
    )
  }
  state.cameraRotation = calculateCameraRotation(
    state.cameraRotation,
    input.cameraTargetRotation,
    input.deltaTime,
    curveValue(curves, ROTATION_LAG_CURVE_NAME),
    lagAllowed,
  )
  if (movementBaseHasRelativeRotation) {
    state.cameraMovementBaseRelativeRotation = multiplyQuaternions(
      inverseQuaternion(movementBaseRotation),
      cameraRotationToQuaternion(state.cameraRotation),
    )
    state.pivotLagLocation = add(
      movementBaseLocation,
      rotateVectorByQuaternion(
        state.pivotMovementBaseRelativeLagLocation,
        movementBaseRotation,
      ),
    )
  }
  state.pivotLagLocation = calculatePivotLagLocation(
    state.pivotLagLocation,
    state.pivotTargetLocation,
    state.cameraRotation.yaw,
    input.deltaTime,
    vector(
      curveValue(curves, LOCATION_LAG_X_CURVE_NAME),
      curveValue(curves, LOCATION_LAG_Y_CURVE_NAME),
      curveValue(curves, LOCATION_LAG_Z_CURVE_NAME),
    ),
    lagAllowed,
  )
  if (movementBaseHasRelativeRotation) {
    state.pivotMovementBaseRelativeLagLocation =
      unrotateVectorByQuaternion(
        subtract(state.pivotLagLocation, movementBaseLocation),
        movementBaseRotation,
      )
  }

  const pivotOffset = calculatePivotOffset(
    curves,
    input.meshRotation,
    meshScale,
  )
  state.pivotLocation = add(state.pivotLagLocation, pivotOffset)
  const cameraOffset = calculateCameraOffset(
    curves,
    state.cameraRotation,
    meshScale,
  )
  const cameraTargetLocation = add(state.pivotLocation, cameraOffset)
  const trace = calculateCameraTrace({
    cameraTargetLocation,
    pivotTargetLocation: state.pivotTargetLocation,
    pivotOffset,
    thirdPersonTraceStartLocation: input.thirdPersonTraceStartLocation,
    traceOverrideAmount: curveValue(curves, TRACE_OVERRIDE_CURVE_NAME),
    meshScale,
    ownerLocation: input.ownerLocation,
    deltaTime: input.deltaTime,
    allowLag: lagAllowed,
    previousTraceDistanceRatio: state.traceDistanceRatio,
    settings: settings.thirdPerson,
    trace: input.trace,
  })
  state.traceDistanceRatio = trace.traceDistanceRatio

  if (!isRelevant(firstPersonOverride)) {
    state.cameraLocation = copyVector(trace.location)
    state.cameraFieldOfView = settings.thirdPerson.fieldOfView
  } else {
    state.cameraLocation = lerpVector(
      trace.location,
      input.firstPersonCameraLocation,
      firstPersonOverride,
    )
    state.cameraFieldOfView =
      settings.thirdPerson.fieldOfView
      + (
        settings.firstPerson.fieldOfView
        - settings.thirdPerson.fieldOfView
      ) * firstPersonOverride
  }

  if (state.overrideFieldOfView) {
    state.cameraFieldOfView = state.fieldOfViewOverride
  }
  state.cameraFieldOfView = clamp(
    state.cameraFieldOfView + curveValue(curves, FOV_OFFSET_CURVE_NAME),
    5,
    175,
  )

  return {
    state,
    lagAllowed,
    firstPersonOverride,
    firstPersonFastPath: false,
    pivotOffset,
    cameraOffset,
    cameraTargetLocation,
    trace,
  }
}

/**
 * UAlsCameraComponent::Activate(): initialize every derived camera value without startup lag.
 */
export function activateAlsCameraComponent(
  state: AlsCameraComponentState,
  input: Omit<AlsCameraComponentInput, 'deltaTime' | 'allowLag'>,
): AlsCameraComponentTick {
  return tickAlsCameraComponent(state, {
    ...input,
    deltaTime: 0,
    allowLag: false,
  })
}
