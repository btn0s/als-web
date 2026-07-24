import type { AlsVector3 } from './AlsLocomotionState'

/**
 * Framework-free counterpart of ALS Refactored's `FAlsInAirState`.
 *
 * The web runtime stores linear values in metres / metres-per-second. Ground-prediction math is
 * evaluated in ALS's native centimetre domain and converted back at the injected physics seam.
 */
export interface AlsInAirState {
  verticalVelocity: number
  jumpRequested: boolean
  jumped: boolean
  jumpPlayRate: number
  groundPredictionAmount: number
}

export function createAlsInAirState(): AlsInAirState {
  // FAlsInAirState defaults, State/AlsInAirState.h:10-26.
  return {
    verticalVelocity: 0,
    jumpRequested: false,
    jumped: false,
    jumpPlayRate: 1,
    groundPredictionAmount: 1,
  }
}

// AlsAnimationInstance.cpp:1012-1017. Runtime linear speeds are metres per second.
export const ALS_JUMP_REFERENCE_SPEED = 6
export const ALS_JUMP_MIN_PLAY_RATE = 1.2
export const ALS_JUMP_MAX_PLAY_RATE = 1.5

/** UAlsAnimationInstance::Jump(), AlsAnimationInstance.h:393-396. */
export function jump(state: AlsInAirState): AlsInAirState {
  state.jumpRequested = true
  return state
}

/**
 * Exact port of `RefreshInAirOnGameThread()` (`AlsAnimationInstance.cpp:985-991`).
 *
 * A pending animation update discards both an old latch and a new request. The request is consumed
 * every frame even when it cannot become `jumped`.
 */
export function refreshInAirOnGameThread(
  state: AlsInAirState,
  pendingUpdate: boolean,
): AlsInAirState {
  state.jumped = !pendingUpdate && (state.jumped || state.jumpRequested)
  state.jumpRequested = false
  return state
}

export interface AlsRefreshInAirInput {
  /** LocomotionState.Speed, in metres per second. */
  readonly speed: number
  /** LocomotionState.Velocity.Z, in metres per second. */
  readonly verticalVelocity: number
}

/**
 * State-only portion of `UAlsAnimationInstance::RefreshInAir()` (`cpp:993-1026`).
 *
 * Ground prediction and in-air lean remain their own Refresh* functions, matching the source call
 * boundaries. `jumped` is a one-shot: only the first refresh after the game-thread latch changes
 * `JumpPlayRate`.
 */
export function refreshInAir(
  state: AlsInAirState,
  input: AlsRefreshInAirInput,
): AlsInAirState {
  if (state.jumped) {
    state.jumped = false
    const speedAmount = clamp(
      input.speed / ALS_JUMP_REFERENCE_SPEED,
      0,
      1,
    )
    state.jumpPlayRate =
      ALS_JUMP_MIN_PLAY_RATE
      + (ALS_JUMP_MAX_PLAY_RATE - ALS_JUMP_MIN_PLAY_RATE) * speedAmount
  }

  state.verticalVelocity = input.verticalVelocity
  return state
}

/**
 * Backend-neutral capsule-sweep query corresponding to the `SweepSingleByChannel()` call in
 * `RefreshGroundPrediction()`. All positions and dimensions are metres in ALS coordinates
 * (+X forward, +Y right, +Z up); the capsule has UE's identity rotation, so its axis is +Z.
 */
export interface AlsGroundPredictionSweepQuery {
  readonly start: Readonly<AlsVector3>
  readonly end: Readonly<AlsVector3>
  readonly capsuleRadius: number
  readonly capsuleHalfHeight: number
}

/**
 * Minimal backend hit adapter for the `FHitResult` fields ALS reads.
 *
 * `time` is UE's normalized sweep fraction (0 at the start, 1 at the full sweep distance).
 * It is intentionally not clamped: ALS passes `Hit.Time` directly to its authored curve.
 */
export interface AlsGroundPredictionSweepHitInput {
  /** Result of the backend's exact equivalent of `FHitResult::IsValidBlockingHit()`. */
  readonly validBlockingHit: boolean
  readonly time: number
  readonly impactNormal: Readonly<AlsVector3>
}

export type AlsGroundPredictionCapsuleSweep = (
  query: Readonly<AlsGroundPredictionSweepQuery>,
) => AlsGroundPredictionSweepHitInput | null

export interface AlsGroundPredictionHit {
  readonly groundValid: boolean
  readonly hitTime: number
}

/**
 * Adapts the injected cast result to ALS's exact walkable-hit predicate:
 * `Hit.IsValidBlockingHit() && Hit.ImpactNormal.Z >= WalkableFloorAngleCos`.
 * See `AlsAnimationInstance.cpp:1073`.
 */
export function adaptGroundPredictionSweepHit(
  hit: AlsGroundPredictionSweepHitInput | null,
  walkableFloorAngleCos: number,
): AlsGroundPredictionHit {
  return {
    groundValid: hit !== null
      && hit.validBlockingHit
      && hit.impactNormal.z >= walkableFloorAngleCos,
    hitTime: hit?.time ?? 1,
  }
}

export interface AlsGroundPredictionInput {
  /** LocomotionState.Location, in metres and ALS coordinates. */
  readonly location: Readonly<AlsVector3>
  /** LocomotionState.Velocity, in metres per second and ALS coordinates. */
  readonly velocity: Readonly<AlsVector3>
  /** LocomotionState.Scale. ALS multiplies only the sweep distance by this value. */
  readonly scale: number
  /** Scaled capsule dimensions, in metres. */
  readonly capsuleRadius: number
  readonly capsuleHalfHeight: number
  readonly walkableFloorAngleCos: number
  /** Raw value of the authored `GroundPredictionBlock` animation curve. */
  readonly groundPredictionBlockCurveValue: number
  /** Evaluates `FAlsInAirSettings::GroundPredictionAmountCurve` at normalized `Hit.Time`. */
  readonly groundPredictionAmountCurve: (hitTime: number) => number
  /** Physics remains an injected runtime concern; this module owns only ALS query semantics. */
  readonly sweepCapsule: AlsGroundPredictionCapsuleSweep
}

export interface AlsGroundPredictionResult {
  readonly groundPredictionAmount: number
  readonly sweepVector: AlsVector3
}

const CENTIMETRES_PER_METRE = 100
const UE_SMALL_NUMBER = 1e-8
const UE_KINDA_SMALL_NUMBER = 1e-4

// AlsAnimationInstance.cpp:1034-1065. Values remain in native cm/s and cm here.
const VERTICAL_VELOCITY_THRESHOLD = -200
const MIN_VERTICAL_VELOCITY = -4000
const MAX_VERTICAL_VELOCITY = -200
const MIN_SWEEP_DISTANCE = 150
const MAX_SWEEP_DISTANCE = 2000

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function zeroVector(): AlsVector3 {
  return { x: 0, y: 0, z: 0 }
}

/**
 * Exact runtime port of `UAlsAnimationInstance::RefreshGroundPrediction()`
 * (`AlsAnimationInstance.cpp:1028-1100`).
 *
 * Early-outs do not invoke either injected callback, matching ALS's trace/curve evaluation order.
 */
export function refreshGroundPrediction(
  state: AlsInAirState,
  input: AlsGroundPredictionInput,
): AlsGroundPredictionResult {
  const verticalVelocity = state.verticalVelocity * CENTIMETRES_PER_METRE

  if (verticalVelocity > VERTICAL_VELOCITY_THRESHOLD) {
    state.groundPredictionAmount = 0
    return {
      groundPredictionAmount: state.groundPredictionAmount,
      sweepVector: zeroVector(),
    }
  }

  const allowanceAmount = 1 - clamp(
    input.groundPredictionBlockCurveValue,
    0,
    1,
  )
  if (allowanceAmount <= UE_KINDA_SMALL_NUMBER) {
    state.groundPredictionAmount = 0
    return {
      groundPredictionAmount: state.groundPredictionAmount,
      sweepVector: zeroVector(),
    }
  }

  // Convert the complete velocity before normalizing so UE's native-unit tolerance and formula
  // remain the source of truth. The clamped Z component also guarantees a downward sweep.
  const velocityDirection = {
    x: input.velocity.x * CENTIMETRES_PER_METRE,
    y: input.velocity.y * CENTIMETRES_PER_METRE,
    z: clamp(
      input.velocity.z * CENTIMETRES_PER_METRE,
      MIN_VERTICAL_VELOCITY,
      MAX_VERTICAL_VELOCITY,
    ),
  }
  const directionSizeSquared = velocityDirection.x * velocityDirection.x
    + velocityDirection.y * velocityDirection.y
    + velocityDirection.z * velocityDirection.z

  if (directionSizeSquared > UE_SMALL_NUMBER) {
    const inverseDirectionSize = 1 / Math.sqrt(directionSizeSquared)
    velocityDirection.x *= inverseDirectionSize
    velocityDirection.y *= inverseDirectionSize
    velocityDirection.z *= inverseDirectionSize
  } else {
    velocityDirection.x = 0
    velocityDirection.y = 0
    velocityDirection.z = 0
  }

  const sweepDistanceAlpha = clamp(
    (verticalVelocity - MAX_VERTICAL_VELOCITY)
      / (MIN_VERTICAL_VELOCITY - MAX_VERTICAL_VELOCITY),
    0,
    1,
  )
  const sweepDistanceCentimetres = (
    MIN_SWEEP_DISTANCE
    + (MAX_SWEEP_DISTANCE - MIN_SWEEP_DISTANCE) * sweepDistanceAlpha
  ) * input.scale
  const sweepVector = {
    x: velocityDirection.x * sweepDistanceCentimetres
      / CENTIMETRES_PER_METRE,
    y: velocityDirection.y * sweepDistanceCentimetres
      / CENTIMETRES_PER_METRE,
    z: velocityDirection.z * sweepDistanceCentimetres
      / CENTIMETRES_PER_METRE,
  }

  const hit = input.sweepCapsule({
    start: input.location,
    end: {
      x: input.location.x + sweepVector.x,
      y: input.location.y + sweepVector.y,
      z: input.location.z + sweepVector.z,
    },
    capsuleRadius: input.capsuleRadius,
    capsuleHalfHeight: input.capsuleHalfHeight,
  })
  const { groundValid, hitTime } = adaptGroundPredictionSweepHit(
    hit,
    input.walkableFloorAngleCos,
  )

  state.groundPredictionAmount = groundValid
    ? input.groundPredictionAmountCurve(hitTime) * allowanceAmount
    : 0

  return {
    groundPredictionAmount: state.groundPredictionAmount,
    sweepVector,
  }
}
