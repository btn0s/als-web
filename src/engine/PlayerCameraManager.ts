import {
  createCameraShakePatternUpdateResult,
  WaveOscillatorCameraShakePattern,
} from './WaveOscillatorCameraShakePattern'
import type {
  CameraShakeRandomSource,
  FCameraShakePatternUpdateResult,
  FRotator3f,
  FVector3f,
  WaveOscillatorCameraShakePatternSettings,
} from './WaveOscillatorCameraShakePattern'

const DEGREES_TO_RADIANS_HALF = Math.PI / 360
const RADIANS_TO_DEGREES = 180 / Math.PI
const ROTATOR_SINGULARITY_THRESHOLD = 0.4999995

/**
 * VERIFIED against UE 5.5 `PlayerCameraManager.cpp`, `CameraModifier_CameraShake.cpp`,
 * `CameraShakeBase.cpp`, and `CameraAnimationHelper.cpp`.
 */

export type CameraShakePlaySpace = 'CameraLocal'

export const CAMERA_SHAKE_BASE_DEFAULTS:
Readonly<{
  bSingleInstance: boolean
  ShakeScale: number
  PlaySpace: CameraShakePlaySpace
}> = Object.freeze({
  bSingleInstance: false,
  ShakeScale: 1,
  PlaySpace: 'CameraLocal' as const,
})

export interface CameraShakeClass {
  readonly CameraShakeClass: string
  readonly bSingleInstance: boolean
  readonly RootShakePattern:
    Readonly<WaveOscillatorCameraShakePatternSettings>
}

/**
 * Minimal `FMinimalViewInfo` subset consumed by ALS's shipped wave shake.
 *
 * Location is in Unreal units (centimetres), Rotation is in degrees, and FOV is horizontal degrees.
 */
export interface FMinimalViewInfo {
  readonly Location: FVector3f
  readonly Rotation: FRotator3f
  FOV: number
}

interface FQuat {
  x: number
  y: number
  z: number
  w: number
}

function clampAxis(angle: number) {
  let result = angle % 360
  if (result < 0) result += 360
  return result
}

function normalizeAxis(angle: number) {
  let result = clampAxis(angle)
  if (result > 180) result -= 360
  return result
}

/** Exact `FMath::ClampAngle()` for degree values. */
function clampAngle(
  angle: number,
  minAngle: number,
  maxAngle: number,
) {
  const maxDelta = clampAxis(maxAngle - minAngle) * 0.5
  const rangeCenter = clampAxis(minAngle + maxDelta)
  const deltaFromCenter = normalizeAxis(angle - rangeCenter)

  if (deltaFromCenter > maxDelta) {
    return normalizeAxis(rangeCenter + maxDelta)
  }
  if (deltaFromCenter < -maxDelta) {
    return normalizeAxis(rangeCenter - maxDelta)
  }
  return normalizeAxis(angle)
}

function rotatorToQuaternion(rotation: Readonly<FRotator3f>): FQuat {
  const pitch = rotation.pitch * DEGREES_TO_RADIANS_HALF
  const yaw = rotation.yaw * DEGREES_TO_RADIANS_HALF
  const roll = rotation.roll * DEGREES_TO_RADIANS_HALF
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)

  return {
    x: cr * sp * sy - sr * cp * cy,
    y: -cr * sp * cy - sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
  }
}

function normalizeQuaternion(value: Readonly<FQuat>): FQuat {
  const magnitude = Math.hypot(value.x, value.y, value.z, value.w)
  if (magnitude <= Number.EPSILON) {
    return { x: 0, y: 0, z: 0, w: 1 }
  }
  return {
    x: value.x / magnitude,
    y: value.y / magnitude,
    z: value.z / magnitude,
    w: value.w / magnitude,
  }
}

function multiplyQuaternions(
  first: Readonly<FQuat>,
  second: Readonly<FQuat>,
): FQuat {
  return normalizeQuaternion({
    x: first.w * second.x
      + first.x * second.w
      + first.y * second.z
      - first.z * second.y,
    y: first.w * second.y
      - first.x * second.z
      + first.y * second.w
      + first.z * second.x,
    z: first.w * second.z
      + first.x * second.y
      - first.y * second.x
      + first.z * second.w,
    w: first.w * second.w
      - first.x * second.x
      - first.y * second.y
      - first.z * second.z,
  })
}

/** `FQuat::Rotator()`, including Unreal's singularity branches. */
function quaternionToRotator(value: Readonly<FQuat>): FRotator3f {
  const normalized = normalizeQuaternion(value)
  const singularityTest =
    normalized.z * normalized.x - normalized.w * normalized.y
  const yawY = 2 * (
    normalized.w * normalized.z + normalized.x * normalized.y
  )
  const yawX = 1 - 2 * (
    normalized.y * normalized.y + normalized.z * normalized.z
  )

  if (singularityTest < -ROTATOR_SINGULARITY_THRESHOLD) {
    const yaw = Math.atan2(yawY, yawX) * RADIANS_TO_DEGREES
    return {
      pitch: -90,
      yaw: normalizeAxis(yaw),
      roll: normalizeAxis(
        -yaw
        - 2 * Math.atan2(normalized.x, normalized.w)
        * RADIANS_TO_DEGREES,
      ),
    }
  }
  if (singularityTest > ROTATOR_SINGULARITY_THRESHOLD) {
    const yaw = Math.atan2(yawY, yawX) * RADIANS_TO_DEGREES
    return {
      pitch: 90,
      yaw: normalizeAxis(yaw),
      roll: normalizeAxis(
        yaw
        - 2 * Math.atan2(normalized.x, normalized.w)
        * RADIANS_TO_DEGREES,
      ),
    }
  }

  return {
    pitch: Math.asin(2 * singularityTest) * RADIANS_TO_DEGREES,
    yaw: normalizeAxis(Math.atan2(yawY, yawX) * RADIANS_TO_DEGREES),
    roll: normalizeAxis(
      Math.atan2(
        -2 * (
          normalized.w * normalized.x
          + normalized.y * normalized.z
        ),
        1 - 2 * (
          normalized.x * normalized.x
          + normalized.y * normalized.y
        ),
      ) * RADIANS_TO_DEGREES,
    ),
  }
}

function rotateVectorByQuaternion(
  vector: Readonly<FVector3f>,
  rotation: Readonly<FQuat>,
): FVector3f {
  const normalized = normalizeQuaternion(rotation)
  const crossX = normalized.y * vector.z - normalized.z * vector.y
  const crossY = normalized.z * vector.x - normalized.x * vector.z
  const crossZ = normalized.x * vector.y - normalized.y * vector.x
  const secondCrossX =
    normalized.y * crossZ - normalized.z * crossY
  const secondCrossY =
    normalized.z * crossX - normalized.x * crossZ
  const secondCrossZ =
    normalized.x * crossY - normalized.y * crossX

  return {
    x: vector.x + 2 * (
      normalized.w * crossX + secondCrossX
    ),
    y: vector.y + 2 * (
      normalized.w * crossY + secondCrossY
    ),
    z: vector.z + 2 * (
      normalized.w * crossZ + secondCrossZ
    ),
  }
}

function scaleCameraShakeResult(
  result: FCameraShakePatternUpdateResult,
  scale: number,
) {
  result.Location.x *= scale
  result.Location.y *= scale
  result.Location.z *= scale
  result.Rotation.pitch *= scale
  result.Rotation.yaw *= scale
  result.Rotation.roll *= scale
  result.FOV *= scale
}

function applyPitchLimit(
  view: Readonly<FMinimalViewInfo>,
  result: FCameraShakePatternUpdateResult,
) {
  const inputPitch = normalizeAxis(view.Rotation.pitch)
  const outputPitchOffset = normalizeAxis(result.Rotation.pitch)
  result.Rotation.pitch = clampAngle(
    inputPitch + outputPitchOffset,
    -89.9,
    89.9,
  ) - inputPitch
}

/**
 * UE `FCameraAnimationHelper::ApplyOffset()` CameraLocal branch.
 *
 * Translation is rotated by the current camera orientation. Rotation is post-applied in the
 * camera's local frame: the row-matrix expression `OffsetRot * CameraRot` is equivalent to
 * `CameraQuat * OffsetQuat` under the quaternion/vector convention used here.
 */
export function applyCameraLocalShake(
  view: FMinimalViewInfo,
  result: FCameraShakePatternUpdateResult,
  headTrackingAllowed = false,
): FMinimalViewInfo {
  if (!headTrackingAllowed) {
    applyPitchLimit(view, result)
  }

  const cameraRotation = rotatorToQuaternion(view.Rotation)
  const rotatedLocation = rotateVectorByQuaternion(
    result.Location,
    cameraRotation,
  )
  const shakenRotation = quaternionToRotator(
    multiplyQuaternions(
      cameraRotation,
      rotatorToQuaternion(result.Rotation),
    ),
  )

  view.Location.x += rotatedLocation.x
  view.Location.y += rotatedLocation.y
  view.Location.z += rotatedLocation.z
  view.Rotation.pitch = shakenRotation.pitch
  view.Rotation.yaw = shakenRotation.yaw
  view.Rotation.roll = shakenRotation.roll
  view.FOV += result.FOV
  return view
}

export class CameraShakeInstance {
  readonly CameraShakeClass: Readonly<CameraShakeClass>
  readonly RootShakePattern: WaveOscillatorCameraShakePattern
  ShakeScale: number = CAMERA_SHAKE_BASE_DEFAULTS.ShakeScale

  private readonly updateResult = createCameraShakePatternUpdateResult()
  private active = false

  constructor(
    cameraShakeClass: Readonly<CameraShakeClass>,
    randomSource: CameraShakeRandomSource,
  ) {
    this.CameraShakeClass = cameraShakeClass
    this.RootShakePattern = new WaveOscillatorCameraShakePattern(
      cameraShakeClass.RootShakePattern,
      randomSource,
    )
  }

  StartShake(scale: number) {
    const bIsRestarting = this.active
    this.ShakeScale = scale
    this.active = true
    this.RootShakePattern.StartShakePattern({ bIsRestarting })
  }

  UpdateAndApplyCameraShake(
    deltaTime: number,
    dynamicScale: number,
    view: FMinimalViewInfo,
    headTrackingAllowed = false,
  ) {
    this.RootShakePattern.UpdateShakePattern(
      deltaTime,
      this.updateResult,
    )

    if (!this.RootShakePattern.IsFinished()) {
      scaleCameraShakeResult(
        this.updateResult,
        Math.max(this.ShakeScale * dynamicScale, 0),
      )
      applyCameraLocalShake(
        view,
        this.updateResult,
        headTrackingAllowed,
      )
    }
  }

  IsFinished() {
    return this.RootShakePattern.IsFinished()
  }

  StopShake(bImmediately = true) {
    this.RootShakePattern.StopShakePattern(bImmediately)
  }

  TeardownShake() {
    this.RootShakePattern.TeardownShakePattern()
    this.active = false
  }
}

export interface PlayerCameraManagerOptions {
  readonly CameraShakeClasses?: readonly Readonly<CameraShakeClass>[]
  readonly RandomSource?: CameraShakeRandomSource
  readonly HeadTrackingAllowed?: boolean
}

/**
 * ALS-required subset of `APlayerCameraManager` plus `UCameraModifier_CameraShake`.
 *
 * The shipped ALS notify uses StartCameraShake's Scale and default CameraLocal play space. Source
 * attenuation, split-screen scaling, and non-wave shake patterns are intentionally not exposed
 * because ALS does not use those paths.
 */
export class PlayerCameraManager {
  private readonly classes = new Map<string, Readonly<CameraShakeClass>>()
  private readonly activeShakes: CameraShakeInstance[] = []
  private readonly randomSource: CameraShakeRandomSource
  private readonly headTrackingAllowed: boolean

  constructor(options: Readonly<PlayerCameraManagerOptions> = {}) {
    this.randomSource = options.RandomSource ?? Math.random
    this.headTrackingAllowed = options.HeadTrackingAllowed ?? false
    for (const cameraShakeClass of options.CameraShakeClasses ?? []) {
      this.classes.set(
        cameraShakeClass.CameraShakeClass,
        cameraShakeClass,
      )
    }
  }

  get ActiveCameraShakes():
  readonly CameraShakeInstance[] {
    return this.activeShakes
  }

  RegisterCameraShakeClass(
    cameraShakeClass: Readonly<CameraShakeClass>,
  ) {
    this.classes.set(
      cameraShakeClass.CameraShakeClass,
      cameraShakeClass,
    )
  }

  StartCameraShake(
    cameraShakeClassName: string | null,
    scale: number = CAMERA_SHAKE_BASE_DEFAULTS.ShakeScale,
    playSpace: CameraShakePlaySpace =
      CAMERA_SHAKE_BASE_DEFAULTS.PlaySpace,
  ): CameraShakeInstance | null {
    if (!cameraShakeClassName || playSpace !== 'CameraLocal') {
      return null
    }

    const cameraShakeClass = this.classes.get(cameraShakeClassName)
    if (!cameraShakeClass) return null

    if (cameraShakeClass.bSingleInstance) {
      const existing = this.activeShakes.find(
        (shake) =>
          shake.CameraShakeClass.CameraShakeClass
          === cameraShakeClassName,
      )
      if (existing) {
        existing.StartShake(scale)
        return existing
      }
    }

    const instance = new CameraShakeInstance(
      cameraShakeClass,
      this.randomSource,
    )
    instance.StartShake(scale)
    this.activeShakes.push(instance)
    return instance
  }

  StopCameraShake(
    instance: CameraShakeInstance | null | undefined,
    bImmediately = true,
  ) {
    if (!instance) return
    const index = this.activeShakes.indexOf(instance)
    if (index < 0) return

    instance.StopShake(bImmediately)
    if (bImmediately) {
      instance.TeardownShake()
      this.activeShakes.splice(index, 1)
    }
  }

  /**
   * Updates active instances in insertion order, then tears down finished instances backwards.
   * Modifier alpha <= 0 pauses the entire list, matching UCameraModifier_CameraShake.
   */
  UpdateAndApplyCameraShakes(
    deltaTime: number,
    view: FMinimalViewInfo,
    modifierAlpha = 1,
  ): FMinimalViewInfo {
    if (modifierAlpha <= 0) return view

    for (const instance of this.activeShakes) {
      instance.UpdateAndApplyCameraShake(
        deltaTime,
        modifierAlpha,
        view,
        this.headTrackingAllowed,
      )
    }

    for (
      let index = this.activeShakes.length - 1;
      index >= 0;
      index--
    ) {
      const instance = this.activeShakes[index]
      if (instance.IsFinished()) {
        instance.TeardownShake()
        this.activeShakes.splice(index, 1)
      }
    }
    return view
  }
}
