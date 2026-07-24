import { alphaToBlendOption } from '../../engine/alphaBlend'
import {
  createAuthoredRootMotionSample,
  sampleAuthoredRootMotion,
} from '../../engine/rootMotion'
import type {
  AuthoredRootMotionSample,
  CompiledAuthoredRootMotion,
} from '../../engine/rootMotion'
import { sampleRichCurve } from '../../engine/richCurve'
import type {
  AlsMantlingMontage,
  AlsMantlingSettings,
} from '../Settings/AlsMantlingSettings'
import type { AlsQuaternion } from '../State/AlsFeetState'
import type { AlsVector3 } from '../State/AlsLocomotionState'

export interface AlsRotator {
  Pitch: number
  Yaw: number
  Roll: number
}

export interface AlsTransform {
  readonly Location: AlsVector3
  readonly Rotation: AlsQuaternion
}

export interface AlsPrimitiveTransform extends AlsTransform {
  readonly Scale3D: AlsVector3
}

export interface ResolveAlsMantlingTargetTransformInput {
  readonly bUseRelativeLocation: boolean
  readonly TargetPrimitiveTransform?: Readonly<AlsPrimitiveTransform>
  readonly TargetRelativeLocation: Readonly<AlsVector3>
  readonly TargetRelativeRotation: Readonly<AlsRotator>
}

export type AlsRootMotionSourceStatus =
  | 'Active'
  | 'Finished'
  | 'MarkedForRemoval'

/**
 * Framework-free counterpart of `FAlsRootMotionSource_Mantling`.
 *
 * Coordinates stay in ALS/Unreal actor space: +X forward, +Y right, +Z up,
 * with distances in metres. `AuthoredRootMotion` is the lossless GLB sidecar;
 * its reflected three.js translation is converted back at the sampling seam.
 */
export interface AlsRootMotionSource_Mantling {
  readonly Priority: 1000
  Time: number
  readonly Duration: number
  readonly MantlingSettings: AlsMantlingSettings
  readonly AuthoredRootMotion: CompiledAuthoredRootMotion
  readonly TargetPrimitive: unknown
  readonly TargetRelativeLocation: AlsVector3
  readonly TargetRelativeRotation: AlsRotator
  readonly ActorFeetLocationOffset: AlsVector3
  readonly ActorRotationOffset: AlsRotator
  readonly TargetAnimationLocation: AlsVector3
  readonly MontageStartTime: number
  Status: AlsRootMotionSourceStatus
}

export interface CreateAlsRootMotionSourceMantlingInput {
  readonly MantlingSettings: AlsMantlingSettings
  readonly AuthoredRootMotion: CompiledAuthoredRootMotion
  readonly MantlingHeight: number
  readonly TargetPrimitive: unknown
  readonly bUseRelativeLocation: boolean
  readonly TargetPrimitiveTransform?: Readonly<AlsPrimitiveTransform>
  readonly TargetRelativeLocation: Readonly<AlsVector3>
  readonly TargetRelativeRotation: Readonly<AlsRotator>
  readonly ActorFeetLocation: Readonly<AlsVector3>
  readonly ActorRotation: Readonly<AlsQuaternion>
}

export interface PrepareAlsMantlingRootMotionInput {
  readonly SimulationDeltaTime: number
  readonly DeltaTime: number
  readonly TargetPrimitiveValid: boolean
  readonly bUseRelativeLocation: boolean
  /**
   * Current primitive world transform. Required only when
   * MovementBaseUtility::UseRelativeLocation() is true.
   */
  readonly TargetPrimitiveTransform?: Readonly<AlsPrimitiveTransform>
  readonly ActorFeetLocation: Readonly<AlsVector3>
  readonly ActorRotation: Readonly<AlsQuaternion>
  readonly MeshScaleZ?: number
  /** AAlsCharacter::GetGravityDirection(), normalized and pointing down. */
  readonly GravityDirection?: Readonly<AlsVector3>
}

export interface AlsMantlingRootMotionClock {
  RootMotionTime: number
  MontageTime: number
  MontagePosition: number
}

export interface AlsMantlingRootMotionResult {
  valid: boolean
  finished: boolean
  readonly Clock: AlsMantlingRootMotionClock
  BlendInAmount: number
  InterpolationAmount: number
  HorizontalCorrectionAmount: number
  VerticalCorrectionAmount: number
  readonly TargetTransform: AlsTransform
  readonly TranslationVelocity: AlsVector3
  /** Normalized target-to-actor rotation before UE's scalar velocity packing. */
  readonly RotationDelta: AlsQuaternion
  /** Exact quaternion components written to RootMotionParams after `/ DeltaTime`. */
  readonly RotationVelocity: AlsQuaternion
}

const UE_SMALL_NUMBER = 1e-8
export const ALS_ZERO_ANIMWEIGHT_THRESH = 1e-5
export const ALS_FULL_ANIMATION_WEIGHT =
  1 - ALS_ZERO_ANIMWEIGHT_THRESH
const MAX_LOCATION_SEARCH_TOLERANCE = 0.01
const DEGREES_TO_RADIANS = Math.PI / 180

export function isFullAlsAnimationWeight(weight: number) {
  return weight >= ALS_FULL_ANIMATION_WEIGHT
}

function vector(
  x = 0,
  y = 0,
  z = 0,
): AlsVector3 {
  return { x, y, z }
}

function quaternion(
  x = 0,
  y = 0,
  z = 0,
  w = 1,
): AlsQuaternion {
  return { x, y, z, w }
}

function rotator(
  Pitch = 0,
  Yaw = 0,
  Roll = 0,
): AlsRotator {
  return { Pitch, Yaw, Roll }
}

function normalizeAxisDegrees(value: number) {
  let normalized = value % 360
  if (normalized < 0) normalized += 360
  if (normalized > 180) normalized -= 360
  return normalized === 0 ? 0 : normalized
}

function normalizedRotator(
  value: Readonly<AlsRotator>,
): AlsRotator {
  return rotator(
    normalizeAxisDegrees(value.Pitch),
    normalizeAxisDegrees(value.Yaw),
    normalizeAxisDegrees(value.Roll),
  )
}

function copyVector(
  source: Readonly<AlsVector3>,
  target: AlsVector3,
) {
  target.x = source.x
  target.y = source.y
  target.z = source.z
}

function copyQuaternion(
  source: Readonly<AlsQuaternion>,
  target: AlsQuaternion,
) {
  target.x = source.x
  target.y = source.y
  target.z = source.z
  target.w = source.w
}

function normalizeQuaternion(
  value: Readonly<AlsQuaternion>,
  output: AlsQuaternion,
) {
  const squaredLength = (
    value.x * value.x
    + value.y * value.y
    + value.z * value.z
    + value.w * value.w
  )
  if (!Number.isFinite(squaredLength)) {
    throw new Error('ALS mantling rotation must be a finite quaternion')
  }
  if (squaredLength < UE_SMALL_NUMBER) {
    output.x = 0
    output.y = 0
    output.z = 0
    output.w = 1
    return output
  }
  const length = Math.sqrt(squaredLength)
  output.x = value.x / length
  output.y = value.y / length
  output.z = value.z / length
  output.w = value.w / length
  return output
}

function multiplyQuaternion(
  left: Readonly<AlsQuaternion>,
  right: Readonly<AlsQuaternion>,
  output: AlsQuaternion,
) {
  const x = (
    left.w * right.x
    + left.x * right.w
    + left.y * right.z
    - left.z * right.y
  )
  const y = (
    left.w * right.y
    - left.x * right.z
    + left.y * right.w
    + left.z * right.x
  )
  const z = (
    left.w * right.z
    + left.x * right.y
    - left.y * right.x
    + left.z * right.w
  )
  const w = (
    left.w * right.w
    - left.x * right.x
    - left.y * right.y
    - left.z * right.z
  )
  output.x = x
  output.y = y
  output.z = z
  output.w = w
  return normalizeQuaternion(output, output)
}

function inverseQuaternion(
  value: Readonly<AlsQuaternion>,
  output: AlsQuaternion,
) {
  const squaredLength = (
    value.x * value.x
    + value.y * value.y
    + value.z * value.z
    + value.w * value.w
  )
  if (!(squaredLength > 0) || !Number.isFinite(squaredLength)) {
    throw new Error('ALS mantling rotation must be a finite non-zero quaternion')
  }
  output.x = -value.x / squaredLength
  output.y = -value.y / squaredLength
  output.z = -value.z / squaredLength
  output.w = value.w / squaredLength
  return output
}

function rotateVector(
  rotation: Readonly<AlsQuaternion>,
  value: Readonly<AlsVector3>,
  output: AlsVector3,
) {
  const ix = (
    rotation.w * value.x
    + rotation.y * value.z
    - rotation.z * value.y
  )
  const iy = (
    rotation.w * value.y
    + rotation.z * value.x
    - rotation.x * value.z
  )
  const iz = (
    rotation.w * value.z
    + rotation.x * value.y
    - rotation.y * value.x
  )
  const iw = (
    -rotation.x * value.x
    - rotation.y * value.y
    - rotation.z * value.z
  )
  output.x = (
    ix * rotation.w
    + iw * -rotation.x
    + iy * -rotation.z
    - iz * -rotation.y
  )
  output.y = (
    iy * rotation.w
    + iw * -rotation.y
    + iz * -rotation.x
    - ix * -rotation.z
  )
  output.z = (
    iz * rotation.w
    + iw * -rotation.z
    + ix * -rotation.y
    - iy * -rotation.x
  )
  return output
}

function rotatorToQuaternion(
  value: Readonly<AlsRotator>,
  output: AlsQuaternion,
) {
  // FRotator::Quaternion(): Unreal positive pitch/roll use the opposite
  // right-handed quaternion sign; positive yaw remains about +Z.
  const pitch = value.Pitch * DEGREES_TO_RADIANS * 0.5
  const yaw = value.Yaw * DEGREES_TO_RADIANS * 0.5
  const roll = value.Roll * DEGREES_TO_RADIANS * 0.5
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  output.x = cr * sp * sy - sr * cp * cy
  output.y = -cr * sp * cy - sr * cp * sy
  output.z = cr * cp * sy - sr * sp * cy
  output.w = cr * cp * cy + sr * sp * sy
  return normalizeQuaternion(output, output)
}

function quaternionToRotator(
  value: Readonly<AlsQuaternion>,
  output: AlsRotator,
) {
  const singularityTest = value.z * value.x - value.w * value.y
  const yawY = 2 * (value.w * value.z + value.x * value.y)
  const yawX = 1 - 2 * (value.y * value.y + value.z * value.z)
  const radiansToDegrees = 180 / Math.PI
  if (singularityTest < -0.4999995) {
    output.Pitch = -90
    output.Yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    output.Roll = normalizeAxisDegrees(
      -output.Yaw
      - 2 * Math.atan2(value.x, value.w) * radiansToDegrees,
    )
  } else if (singularityTest > 0.4999995) {
    output.Pitch = 90
    output.Yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    output.Roll = normalizeAxisDegrees(
      output.Yaw
      - 2 * Math.atan2(value.x, value.w) * radiansToDegrees,
    )
  } else {
    output.Pitch = (
      Math.asin(Math.max(-1, Math.min(1, 2 * singularityTest)))
      * radiansToDegrees
    )
    output.Yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    output.Roll = Math.atan2(
      -2 * (value.w * value.x + value.y * value.z),
      1 - 2 * (value.x * value.x + value.y * value.y),
    ) * radiansToDegrees
  }
  return output
}

function normalizeVector(
  value: Readonly<AlsVector3>,
  output: AlsVector3,
) {
  const length = Math.hypot(value.x, value.y, value.z)
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new Error('ALS gravity direction must be a finite non-zero vector')
  }
  output.x = value.x / length
  output.y = value.y / length
  output.z = value.z / length
  return output
}

function getTwist(
  value: Readonly<AlsQuaternion>,
  axis: Readonly<AlsVector3>,
  output: AlsQuaternion,
) {
  const projection = (
    axis.x * value.x
    + axis.y * value.y
    + axis.z * value.z
  )
  output.x = axis.x * projection
  output.y = axis.y * projection
  output.z = axis.z * projection
  output.w = value.w
  return normalizeQuaternion(output, output)
}

const resolvedRelativeRotation = quaternion()
const resolvedRelativeRotationInverse = quaternion()
const resolvedRelativeTranslation = vector()

/**
 * Mirrors ALS's unusual inverse-relative storage exactly:
 *
 * `Primitive.GetRelativeTransform(Target)` is stored, then reconstructed by
 * `Relative.GetRelativeTransformReverse(Primitive)` every frame. This is not
 * the usual `Primitive * Relative` order.
 */
export function resolveAlsMantlingTargetTransform(
  input: ResolveAlsMantlingTargetTransformInput,
  output: AlsTransform = {
    Location: vector(),
    Rotation: quaternion(),
  },
): AlsTransform {
  rotatorToQuaternion(
    normalizedRotator(input.TargetRelativeRotation),
    resolvedRelativeRotation,
  )
  if (!input.bUseRelativeLocation) {
    copyVector(input.TargetRelativeLocation, output.Location)
    copyQuaternion(resolvedRelativeRotation, output.Rotation)
    return output
  }

  const primitive = input.TargetPrimitiveTransform
  if (!primitive) {
    throw new Error(
      'A relative ALS mantling target requires its current primitive transform',
    )
  }
  const scale = primitive.Scale3D
  if (
    !Number.isFinite(scale.x)
    || !Number.isFinite(scale.y)
    || !Number.isFinite(scale.z)
  ) {
    throw new Error('ALS mantling primitive scale must be finite')
  }
  inverseQuaternion(
    resolvedRelativeRotation,
    resolvedRelativeRotationInverse,
  )
  multiplyQuaternion(
    primitive.Rotation,
    resolvedRelativeRotationInverse,
    output.Rotation,
  )
  rotateVector(
    output.Rotation,
    input.TargetRelativeLocation,
    resolvedRelativeTranslation,
  )
  // Relative is reconstructed with the primitive's current scale, so
  // Other.Scale / Relative.Scale is one (or zero for a degenerate axis).
  const scaleRatioX = Math.abs(scale.x) <= UE_SMALL_NUMBER ? 0 : 1
  const scaleRatioY = Math.abs(scale.y) <= UE_SMALL_NUMBER ? 0 : 1
  const scaleRatioZ = Math.abs(scale.z) <= UE_SMALL_NUMBER ? 0 : 1
  output.Location.x = (
    primitive.Location.x - resolvedRelativeTranslation.x * scaleRatioX
  )
  output.Location.y = (
    primitive.Location.y - resolvedRelativeTranslation.y * scaleRatioY
  )
  output.Location.z = (
    primitive.Location.z - resolvedRelativeTranslation.z * scaleRatioZ
  )
  return output
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount
}

function mappedRangeValueClamped(
  inputRange: readonly [number, number],
  outputRange: readonly [number, number],
  value: number,
) {
  const denominator = inputRange[1] - inputRange[0]
  const amount = denominator === 0
    ? 0
    : Math.min(1, Math.max(0, (value - inputRange[0]) / denominator))
  return lerp(outputRange[0], outputRange[1], amount)
}

const startTimeSample = createAuthoredRootMotionSample()
const endTimeSample = createAuthoredRootMotionSample()
const searchSample = createAuthoredRootMotionSample()

export function getAlsMantlingSegmentValidPlayRate(
  montage: AlsMantlingMontage,
) {
  const playRate = montage.SequenceRateScale * montage.AnimPlayRate
  return Math.abs(playRate) <= UE_SMALL_NUMBER ? 1 : playRate
}

export function getAlsMantlingSegmentEndPosition(
  montage: AlsMantlingMontage,
) {
  return (
    montage.StartPos
    + (
      montage.LoopingCount
      * (montage.AnimEndTime - montage.AnimStartTime)
      / Math.abs(getAlsMantlingSegmentValidPlayRate(montage))
    )
  )
}

/**
 * Literal UE 5.5 FAnimSegment::ConvertTrackPosToAnimPos port.
 * The caller must first perform FAnimSegment::IsInRange().
 */
export function convertAlsMantlingTrackPositionToSequencePosition(
  montage: AlsMantlingMontage,
  trackPosition: number,
) {
  const playRate = getAlsMantlingSegmentValidPlayRate(montage)
  const animationLength = montage.AnimEndTime - montage.AnimStartTime
  if (!(animationLength > 0)) {
    throw new Error(`${montage.Name} has an invalid animation segment range`)
  }
  const unwrappedPosition = (
    (trackPosition - montage.StartPos) * playRate
  )
  const loopCount = Math.min(
    Math.floor(Math.abs(unwrappedPosition) / animationLength),
    Math.max(montage.LoopingCount - 1, 0),
  )
  const animationPoint = playRate >= 0
    ? montage.AnimStartTime
    : montage.AnimEndTime
  return (
    animationPoint
    + unwrappedPosition
    - loopCount * animationLength
  )
}

function sampleAlsRootLocation(
  settings: AlsMantlingSettings,
  rootMotion: CompiledAuthoredRootMotion,
  montageTime: number,
  sample: AuthoredRootMotionSample,
  output: AlsVector3,
) {
  const montage = settings.Montage
  output.x = 0
  output.y = 0
  output.z = 0
  if (
    montageTime < montage.StartPos
    || montageTime > getAlsMantlingSegmentEndPosition(montage)
  ) {
    // UAlsMontageUtility returns FTransform::Identity when no segment owns time.
    return false
  }
  const sequenceTime = convertAlsMantlingTrackPositionToSequencePosition(
    montage,
    montageTime,
  )
  sampleAuthoredRootMotion(rootMotion, sequenceTime, false, sample)
  // GLB C basis: UE (X,Y,Z) -> three.js (X,Z,Y).
  output.x = sample.translation[0]
  output.y = sample.translation[2]
  output.z = sample.translation[1]
  return true
}

function sampleLastAlsRootLocation(
  settings: AlsMantlingSettings,
  rootMotion: CompiledAuthoredRootMotion,
  sample: AuthoredRootMotionSample,
  output: AlsVector3,
) {
  // Preserve ALS Refactored's literal endpoint utility. It deliberately passes
  // Segment.GetEndPos() straight to UAnimSequence instead of converting it.
  sampleAuthoredRootMotion(
    rootMotion,
    getAlsMantlingSegmentEndPosition(settings.Montage),
    false,
    sample,
  )
  output.x = sample.translation[0]
  output.y = sample.translation[2]
  output.z = sample.translation[1]
  return output
}

/**
 * Exact port of `AAlsCharacter::CalculateMantlingStartTime()`.
 */
export function calculateMantlingStartTime(
  MantlingSettings: AlsMantlingSettings,
  MantlingHeight: number,
  AuthoredRootMotion: CompiledAuthoredRootMotion,
): number {
  if (!Number.isFinite(MantlingHeight)) {
    throw new Error('MantlingHeight must be finite')
  }
  if (!MantlingSettings.bAutoCalculateStartTime) {
    return mappedRangeValueClamped(
      MantlingSettings.StartTimeReferenceHeight,
      MantlingSettings.StartTime,
      MantlingHeight,
    )
  }

  const montage = MantlingSettings.Montage
  if (AuthoredRootMotion.clipName !== montage.Sequence) {
    throw new Error(
      `${montage.Name} references ${montage.Sequence}, not `
      + AuthoredRootMotion.clipName,
    )
  }
  let searchStartTime = 0
  let searchEndTime = montage.PlayLength
  const searchStartLocation = vector()
  const searchEndLocation = vector()
  sampleAlsRootLocation(
    MantlingSettings,
    AuthoredRootMotion,
    searchStartTime,
    startTimeSample,
    searchStartLocation,
  )
  sampleAlsRootLocation(
    MantlingSettings,
    AuthoredRootMotion,
    searchEndTime,
    endTimeSample,
    searchEndLocation,
  )
  const targetLocationZ = Math.max(
    0,
    searchEndLocation.z - MantlingHeight,
  )
  if (
    Math.abs(searchStartLocation.z - targetLocationZ)
    <= MAX_LOCATION_SEARCH_TOLERANCE
  ) {
    return searchStartTime
  }

  const montageFrameTime = 1 / montage.SamplingFrameRate
  const location = vector()
  while (true) {
    const time = (searchStartTime + searchEndTime) * 0.5
    sampleAlsRootLocation(
      MantlingSettings,
      AuthoredRootMotion,
      time,
      searchSample,
      location,
    )
    if (
      Math.abs(location.z - targetLocationZ)
      <= MAX_LOCATION_SEARCH_TOLERANCE
      || searchEndTime - searchStartTime <= montageFrameTime
    ) {
      return time
    }
    if (location.z < targetLocationZ) searchStartTime = time
    else searchEndTime = time
  }
}

const createEndSample = createAuthoredRootMotionSample()
const createTargetTransform: AlsTransform = {
  Location: vector(),
  Rotation: quaternion(),
}
const createTargetRotationInverse = quaternion()
const createActorRotationOffsetQuaternion = quaternion()

export function createAlsRootMotionSource_Mantling(
  input: CreateAlsRootMotionSourceMantlingInput,
): AlsRootMotionSource_Mantling {
  const settings = input.MantlingSettings
  const montage = settings.Montage
  const rootMotion = input.AuthoredRootMotion
  if (rootMotion.clipName !== montage.Sequence) {
    throw new Error(
      `${montage.Name} references ${montage.Sequence}, not `
      + rootMotion.clipName,
    )
  }
  if (
    Math.abs(rootMotion.duration - montage.SequenceLength) > 1e-5
  ) {
    throw new Error(
      `${montage.Name} length does not match ${rootMotion.clipName}`,
    )
  }
  if (
    !Number.isFinite(montage.RateScale)
    || Math.abs(montage.RateScale) <= UE_SMALL_NUMBER
  ) {
    throw new Error(`${montage.Name} RateScale must be finite and non-zero`)
  }
  const MontageStartTime = calculateMantlingStartTime(
    settings,
    input.MantlingHeight,
    rootMotion,
  )
  const Duration = (
    (montage.PlayLength - MontageStartTime)
    / montage.RateScale
  )
  const TargetAnimationLocation = sampleLastAlsRootLocation(
    settings,
    rootMotion,
    createEndSample,
    vector(),
  )
  if (Math.abs(TargetAnimationLocation.z) <= UE_SMALL_NUMBER) {
    throw new Error(
      `${montage.Name} final vertical root location must be non-zero`,
    )
  }
  const TargetRelativeRotation = normalizedRotator(
    input.TargetRelativeRotation,
  )
  resolveAlsMantlingTargetTransform(
    {
      bUseRelativeLocation: input.bUseRelativeLocation,
      TargetPrimitiveTransform: input.TargetPrimitiveTransform,
      TargetRelativeLocation: input.TargetRelativeLocation,
      TargetRelativeRotation,
    },
    createTargetTransform,
  )
  const ActorFeetLocationOffset = vector(
    input.ActorFeetLocation.x - createTargetTransform.Location.x,
    input.ActorFeetLocation.y - createTargetTransform.Location.y,
    input.ActorFeetLocation.z - createTargetTransform.Location.z,
  )
  inverseQuaternion(
    createTargetTransform.Rotation,
    createTargetRotationInverse,
  )
  multiplyQuaternion(
    createTargetRotationInverse,
    input.ActorRotation,
    createActorRotationOffsetQuaternion,
  )
  const ActorRotationOffset = quaternionToRotator(
    createActorRotationOffsetQuaternion,
    rotator(),
  )

  return {
    Priority: 1000,
    Time: 0,
    Duration,
    MantlingSettings: settings,
    AuthoredRootMotion: rootMotion,
    TargetPrimitive: input.TargetPrimitive,
    TargetRelativeLocation: vector(
      input.TargetRelativeLocation.x,
      input.TargetRelativeLocation.y,
      input.TargetRelativeLocation.z,
    ),
    TargetRelativeRotation,
    ActorFeetLocationOffset,
    ActorRotationOffset,
    TargetAnimationLocation,
    MontageStartTime,
    Status: 'Active',
  }
}

export function createAlsMantlingRootMotionResult():
  AlsMantlingRootMotionResult {
  return {
    valid: false,
    finished: false,
    Clock: {
      RootMotionTime: 0,
      MontageTime: 0,
      MontagePosition: 0,
    },
    BlendInAmount: 0,
    InterpolationAmount: 0,
    HorizontalCorrectionAmount: 1,
    VerticalCorrectionAmount: 1,
    TargetTransform: {
      Location: vector(),
      Rotation: quaternion(),
    },
    TranslationVelocity: vector(),
    RotationDelta: quaternion(),
    RotationVelocity: quaternion(),
  }
}

export function matchesAlsRootMotionSource_Mantling(
  left: AlsRootMotionSource_Mantling,
  right: AlsRootMotionSource_Mantling,
): boolean {
  return (
    left.MantlingSettings === right.MantlingSettings
    && left.TargetPrimitive === right.TargetPrimitive
  )
}

const gravityAxis = vector()
const targetRotation = quaternion()
const targetXAxis = vector()
const targetAnimationLocationOffset = vector()
const locationOffset = vector()
const rotationOffset = quaternion()
const actorRotationInverse = quaternion()
const currentAnimationLocation = vector()
const prepareSample = createAuthoredRootMotionSample()
const resolvedTargetTransform: AlsTransform = {
  Location: vector(),
  Rotation: quaternion(),
}
const unitForward = vector(1, 0, 0)
const defaultGravityDirection = vector(0, 0, -1)
const negativeGravityDirection = vector()
const scaledActorRotationOffset = rotator()

function clearResult(
  source: AlsRootMotionSource_Mantling,
  output: AlsMantlingRootMotionResult,
) {
  output.valid = false
  output.finished = source.Status === 'Finished'
  output.TranslationVelocity.x = 0
  output.TranslationVelocity.y = 0
  output.TranslationVelocity.z = 0
  output.RotationDelta.x = 0
  output.RotationDelta.y = 0
  output.RotationDelta.z = 0
  output.RotationDelta.w = 1
  output.RotationVelocity.x = 0
  output.RotationVelocity.y = 0
  output.RotationVelocity.z = 0
  output.RotationVelocity.w = 0
  return output
}

/**
 * Exact math/order of `FAlsRootMotionSource_Mantling::PrepareRootMotion()`.
 *
 * `Clock.MontagePosition` is the value ALS writes to Montage_SetPosition().
 * Root sampling and both correction curves use `Clock.MontageTime`, so there is
 * one authoritative source clock and no independently advancing animation time.
 */
export function prepareAlsRootMotionSource_Mantling(
  source: AlsRootMotionSource_Mantling,
  input: PrepareAlsMantlingRootMotionInput,
  output = createAlsMantlingRootMotionResult(),
): AlsMantlingRootMotionResult {
  if (
    !Number.isFinite(input.SimulationDeltaTime)
    || !Number.isFinite(input.DeltaTime)
  ) {
    throw new Error('ALS mantling delta times must be finite')
  }
  source.Time += input.SimulationDeltaTime
  const montage = source.MantlingSettings.Montage
  const MontageTime = (
    source.MontageStartTime
    + source.Time * montage.RateScale
  )
  output.Clock.RootMotionTime = source.Time
  output.Clock.MontageTime = MontageTime
  output.Clock.MontagePosition = Math.max(
    0,
    MontageTime - input.DeltaTime,
  )

  if (
    !(source.Duration > UE_SMALL_NUMBER)
    || input.DeltaTime <= UE_SMALL_NUMBER
    || !input.TargetPrimitiveValid
  ) {
    return clearResult(source, output)
  }

  const gravity = input.GravityDirection ?? defaultGravityDirection
  negativeGravityDirection.x = -gravity.x
  negativeGravityDirection.y = -gravity.y
  negativeGravityDirection.z = -gravity.z
  normalizeVector(
    negativeGravityDirection,
    gravityAxis,
  )
  resolveAlsMantlingTargetTransform(
    {
      bUseRelativeLocation: input.bUseRelativeLocation,
      TargetPrimitiveTransform: input.TargetPrimitiveTransform,
      TargetRelativeLocation: source.TargetRelativeLocation,
      TargetRelativeRotation: source.TargetRelativeRotation,
    },
    resolvedTargetTransform,
  )
  getTwist(resolvedTargetTransform.Rotation, gravityAxis, targetRotation)
  copyVector(
    resolvedTargetTransform.Location,
    output.TargetTransform.Location,
  )
  copyQuaternion(targetRotation, output.TargetTransform.Rotation)

  const blendTime = montage.BlendIn.BlendTime
  const BlendInAmount = blendTime > 0
    ? alphaToBlendOption(
        source.Time / blendTime,
        montage.BlendIn.BlendOption,
      )
    : 1
  output.BlendInAmount = BlendInAmount

  sampleAlsRootLocation(
    source.MantlingSettings,
    source.AuthoredRootMotion,
    MontageTime,
    prepareSample,
    currentAnimationLocation,
  )
  const InterpolationAmount = (
    currentAnimationLocation.z
    / source.TargetAnimationLocation.z
  )
  output.InterpolationAmount = InterpolationAmount
  const combinedWeight = BlendInAmount * InterpolationAmount

  let HorizontalCorrectionAmount = 1
  let VerticalCorrectionAmount = 1
  if (!isFullAlsAnimationWeight(combinedWeight)) {
    HorizontalCorrectionAmount = sampleRichCurve(
      source.MantlingSettings.HorizontalCorrectionCurve.Keys,
      MontageTime,
    )
    VerticalCorrectionAmount = sampleRichCurve(
      source.MantlingSettings.VerticalCorrectionCurve.Keys,
      MontageTime,
    )
    rotateVector(targetRotation, unitForward, targetXAxis)
    targetAnimationLocationOffset.x = (
      targetXAxis.x * -source.TargetAnimationLocation.y
    )
    targetAnimationLocationOffset.y = (
      targetXAxis.y * -source.TargetAnimationLocation.y
    )
    targetAnimationLocationOffset.z =
      -source.TargetAnimationLocation.z

    const meshScaleZ = input.MeshScaleZ ?? 1
    if (!Number.isFinite(meshScaleZ)) {
      throw new Error('ALS mantling mesh scale must be finite')
    }
    targetAnimationLocationOffset.x *= meshScaleZ
    targetAnimationLocationOffset.y *= meshScaleZ
    targetAnimationLocationOffset.z *= meshScaleZ

    locationOffset.x = lerp(
      source.ActorFeetLocationOffset.x,
      targetAnimationLocationOffset.x,
      HorizontalCorrectionAmount,
    )
    locationOffset.y = lerp(
      source.ActorFeetLocationOffset.y,
      targetAnimationLocationOffset.y,
      HorizontalCorrectionAmount,
    )
    locationOffset.z = lerp(
      source.ActorFeetLocationOffset.z,
      targetAnimationLocationOffset.z,
      VerticalCorrectionAmount,
    )
    locationOffset.x = lerp(
      source.ActorFeetLocationOffset.x,
      locationOffset.x * (1 - InterpolationAmount),
      BlendInAmount,
    )
    locationOffset.y = lerp(
      source.ActorFeetLocationOffset.y,
      locationOffset.y * (1 - InterpolationAmount),
      BlendInAmount,
    )
    locationOffset.z = lerp(
      source.ActorFeetLocationOffset.z,
      locationOffset.z * (1 - InterpolationAmount),
      BlendInAmount,
    )
    output.TargetTransform.Location.x += locationOffset.x
    output.TargetTransform.Location.y += locationOffset.y
    output.TargetTransform.Location.z += locationOffset.z

    const rotationAmount = lerp(
      1,
      (1 - HorizontalCorrectionAmount) * (1 - InterpolationAmount),
      BlendInAmount,
    )
    scaledActorRotationOffset.Pitch =
      source.ActorRotationOffset.Pitch * rotationAmount
    scaledActorRotationOffset.Yaw =
      source.ActorRotationOffset.Yaw * rotationAmount
    scaledActorRotationOffset.Roll =
      source.ActorRotationOffset.Roll * rotationAmount
    rotatorToQuaternion(scaledActorRotationOffset, rotationOffset)
    multiplyQuaternion(
      output.TargetTransform.Rotation,
      rotationOffset,
      output.TargetTransform.Rotation,
    )
  } else {
    source.Status = 'Finished'
  }

  output.HorizontalCorrectionAmount = HorizontalCorrectionAmount
  output.VerticalCorrectionAmount = VerticalCorrectionAmount
  output.TranslationVelocity.x = (
    output.TargetTransform.Location.x - input.ActorFeetLocation.x
  ) / input.DeltaTime
  output.TranslationVelocity.y = (
    output.TargetTransform.Location.y - input.ActorFeetLocation.y
  ) / input.DeltaTime
  output.TranslationVelocity.z = (
    output.TargetTransform.Location.z - input.ActorFeetLocation.z
  ) / input.DeltaTime
  inverseQuaternion(input.ActorRotation, actorRotationInverse)
  multiplyQuaternion(
    output.TargetTransform.Rotation,
    actorRotationInverse,
    output.RotationDelta,
  )
  output.RotationVelocity.x =
    output.RotationDelta.x / input.DeltaTime
  output.RotationVelocity.y =
    output.RotationDelta.y / input.DeltaTime
  output.RotationVelocity.z =
    output.RotationDelta.z / input.DeltaTime
  output.RotationVelocity.w =
    output.RotationDelta.w / input.DeltaTime
  output.valid = true
  output.finished = source.Status === 'Finished'
  return output
}
