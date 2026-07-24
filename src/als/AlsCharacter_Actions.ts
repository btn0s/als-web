import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
} from '../engine/characterMovementFloor'
import type {
  AlsRotator,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import type {
  AlsGeneralMantlingSettings,
  AlsMantlingTraceSettings,
  AlsMantlingType,
} from './Settings/AlsMantlingSettings'
import {
  unwindDegrees,
} from './State/AlsLocomotionState'
import type {
  AlsVector3,
} from './State/AlsLocomotionState'

export type AlsCharacterLocalRole =
  | 'None'
  | 'SimulatedProxy'
  | 'AutonomousProxy'
  | 'Authority'

/**
 * Read-only values consumed by `AAlsCharacter::StartMantling()`.
 *
 * Keeping this seam independent of the mutable web character lets the live
 * bridge capture one coherent frame before issuing any physics query.
 */
export interface AlsStartMantlingCharacterState {
  readonly ActorLocation: Readonly<AlsVector3>
  readonly ActorYawAngle: number
  readonly CapsuleScale: number
  readonly CapsuleRadius: number
  readonly CapsuleHalfHeight: number
  readonly LocalRole: AlsCharacterLocalRole
  readonly bIsLocallyControlled: boolean
  readonly bIsMantlingAllowedToStart: boolean
  readonly LocomotionMode: 'Grounded' | 'InAir' | null
  readonly LocomotionState: {
    readonly bHasVelocity: boolean
    readonly VelocityYawAngle: number
    readonly bHasInput: boolean
    readonly InputYawAngle: number
  }
}

export type AlsMantlingTraceTag =
  | 'StartMantling (Forward Trace)'
  | 'StartMantling (Downward Trace)'
  | 'StartMantling (Target Location Overlap)'
  | 'StartMantling (Start Location Overlap)'

interface AlsMantlingCollisionQueryBase {
  readonly TraceTag: AlsMantlingTraceTag
  readonly TraceChannel: string
  readonly TraceResponseChannels: readonly string[]
  readonly bIgnoreOwningActor: true
}

export interface AlsMantlingCapsuleSweep
  extends AlsMantlingCollisionQueryBase {
  readonly Start: Readonly<AlsVector3>
  readonly End: Readonly<AlsVector3>
  readonly Radius: number
  readonly HalfHeight: number
  readonly TraceTag: 'StartMantling (Forward Trace)'
}

export interface AlsMantlingSphereSweep
  extends AlsMantlingCollisionQueryBase {
  readonly Start: Readonly<AlsVector3>
  readonly End: Readonly<AlsVector3>
  readonly Radius: number
  readonly TraceTag: 'StartMantling (Downward Trace)'
}

export interface AlsMantlingCapsuleOverlap
  extends AlsMantlingCollisionQueryBase {
  readonly Location: Readonly<AlsVector3>
  readonly Radius: number
  readonly HalfHeight: number
  readonly TraceTag:
    | 'StartMantling (Target Location Overlap)'
    | 'StartMantling (Start Location Overlap)'
}

export interface AlsMantlingSweepHit {
  readonly bBlockingHit: boolean
  readonly bStartPenetrating: boolean
  /** Swept shape center at the time of impact. */
  readonly Location: Readonly<AlsVector3>
  /** Contact point on the hit primitive. */
  readonly ImpactPoint: Readonly<AlsVector3>
  readonly ImpactNormal: Readonly<AlsVector3>
  readonly TargetPrimitive: unknown
  readonly TargetPrimitiveVelocity: Readonly<AlsVector3>
  readonly bCanCharacterStepUp: boolean
  readonly bWalkable: boolean
}

export interface AlsMantlingCollisionQuery {
  SweepCapsule(
    query: Readonly<AlsMantlingCapsuleSweep>,
  ): AlsMantlingSweepHit | null
  SweepSphere(
    query: Readonly<AlsMantlingSphereSweep>,
  ): AlsMantlingSweepHit | null
  OverlapCapsule(
    query: Readonly<AlsMantlingCapsuleOverlap>,
  ): boolean
}

export interface AlsCapturedMantlingTarget {
  readonly TargetPrimitive: unknown
  readonly TargetRelativeLocation: AlsVector3
  readonly TargetRelativeRotation: AlsRotator
}

export interface AlsMantlingTargetSpace {
  CaptureTarget(
    TargetPrimitive: unknown,
    TargetLocation: Readonly<AlsVector3>,
    TargetYawAngle: number,
  ): AlsCapturedMantlingTarget
}

/** Framework-free counterpart of `FAlsMantlingParameters`. */
export interface AlsMantlingParameters
  extends AlsCapturedMantlingTarget {
  readonly MantlingHeight: number
  readonly MantlingType: AlsMantlingType
}

export interface StartAlsMantlingInput {
  readonly Character: AlsStartMantlingCharacterState
  readonly TraceSettings: AlsMantlingTraceSettings
  readonly MantlingSettings: AlsGeneralMantlingSettings
  readonly Collision: AlsMantlingCollisionQuery
  readonly TargetSpace: AlsMantlingTargetSpace
}

export type StartAlsMantlingForModeInput = Omit<
  StartAlsMantlingInput,
  'TraceSettings'
>

const UE_SMALL_NUMBER = 1e-8
// AAlsCharacter_Actions.cpp uses literal one-centimetre capsule/reach margins.
const ALS_MANTLING_TRACE_MARGIN = 0.01

function isSimulatedProxyOrLower(role: AlsCharacterLocalRole): boolean {
  return role === 'None' || role === 'SimulatedProxy'
}

function isValidBlockingHit(
  hit: Readonly<AlsMantlingSweepHit> | null,
): hit is AlsMantlingSweepHit {
  // FHitResult::IsValidBlockingHit().
  return hit !== null && hit.bBlockingHit && !hit.bStartPenetrating
}

function clampSymmetricAngle(
  angle: number,
  maximumAbsoluteAngle: number,
): number {
  // This is the exact symmetric range used by both FMath::ClampAngle() calls
  // in StartMantling. Unwinding first preserves wrap-around at ±180 degrees.
  return Math.max(
    -maximumAbsoluteAngle,
    Math.min(maximumAbsoluteAngle, unwindDegrees(angle)),
  )
}

function safeNormalXY(
  value: Readonly<AlsVector3>,
): AlsVector3 {
  const squaredLength = value.x * value.x + value.y * value.y
  if (squaredLength <= UE_SMALL_NUMBER) return { x: 0, y: 0, z: 0 }
  const inverseLength = 1 / Math.sqrt(squaredLength)
  return {
    x: value.x * inverseLength,
    y: value.y * inverseLength,
    z: 0,
  }
}

function normalizedLikeFVectorNormalize(
  value: Readonly<AlsVector3>,
): AlsVector3 {
  const squaredLength = (
    value.x * value.x
    + value.y * value.y
    + value.z * value.z
  )
  // FVector::Normalize() returns false and leaves the vector unchanged below
  // its tolerance; it differs from GetSafeNormal() in this branch.
  if (squaredLength <= UE_SMALL_NUMBER) {
    return { x: value.x, y: value.y, z: value.z }
  }
  const inverseLength = 1 / Math.sqrt(squaredLength)
  return {
    x: value.x * inverseLength,
    y: value.y * inverseLength,
    z: value.z * inverseLength,
  }
}

function collisionQueryBase<Tag extends AlsMantlingTraceTag>(
  settings: Readonly<AlsGeneralMantlingSettings>,
  TraceTag: Tag,
): AlsMantlingCollisionQueryBase & { readonly TraceTag: Tag } {
  return {
    TraceTag,
    TraceChannel: settings.MantlingTraceChannel,
    TraceResponseChannels: settings.MantlingTraceResponseChannels,
    bIgnoreOwningActor: true,
  }
}

/**
 * `AAlsCharacter::StartMantling()` from ALS Refactored 4.15.
 *
 * Query order, early-outs, distances, strict comparisons, slope checks, and
 * target classification are line-for-line equivalents expressed in metres.
 */
export function startMantling(
  input: Readonly<StartAlsMantlingInput>,
): AlsMantlingParameters | null {
  const character = input.Character
  const settings = input.MantlingSettings
  const trace = input.TraceSettings

  if (
    !settings.bAllowMantling
    || isSimulatedProxyOrLower(character.LocalRole)
    || !character.bIsMantlingAllowedToStart
  ) {
    return null
  }

  const state = character.LocomotionState
  let forwardTraceAngle: number
  if (state.bHasVelocity) {
    forwardTraceAngle = state.bHasInput
      ? (
          state.VelocityYawAngle
          + clampSymmetricAngle(
            state.InputYawAngle - state.VelocityYawAngle,
            settings.MaxReachAngle,
          )
        )
      : state.VelocityYawAngle
  } else {
    forwardTraceAngle = state.bHasInput
      ? state.InputYawAngle
      : character.ActorYawAngle
  }

  const actorYawAngle = unwindDegrees(character.ActorYawAngle)
  const forwardTraceDeltaAngle = unwindDegrees(
    forwardTraceAngle - actorYawAngle,
  )
  if (
    Math.abs(forwardTraceDeltaAngle)
      > settings.TraceAngleThreshold
  ) {
    return null
  }

  const forwardTraceDirectionAngle = (
    actorYawAngle
    + clampSymmetricAngle(
      forwardTraceDeltaAngle,
      settings.MaxReachAngle,
    )
  ) * Math.PI / 180
  const forwardTraceDirection = {
    x: Math.cos(forwardTraceDirectionAngle),
    y: Math.sin(forwardTraceDirectionAngle),
    z: 0,
  }

  const capsuleScale = character.CapsuleScale
  const capsuleRadius = character.CapsuleRadius
  const capsuleHalfHeight = character.CapsuleHalfHeight
  const capsuleBottomLocation = {
    x: character.ActorLocation.x,
    y: character.ActorLocation.y,
    z: character.ActorLocation.z - capsuleHalfHeight,
  }
  const traceCapsuleRadius = (
    capsuleRadius - ALS_MANTLING_TRACE_MARGIN
  )
  const ledgeHeightDelta = (
    (trace.LedgeHeight[1] - trace.LedgeHeight[0]) * capsuleScale
  )

  const forwardTraceStart = {
    x: (
      capsuleBottomLocation.x
      - forwardTraceDirection.x * capsuleRadius
    ),
    y: (
      capsuleBottomLocation.y
      - forwardTraceDirection.y * capsuleRadius
    ),
    z: (
      capsuleBottomLocation.z
      + (trace.LedgeHeight[0] + trace.LedgeHeight[1])
        * 0.5 * capsuleScale
      - UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE
    ),
  }
  const forwardTraceDistance = (
    capsuleRadius
    + (trace.ReachDistance + ALS_MANTLING_TRACE_MARGIN)
      * capsuleScale
  )
  const forwardTraceEnd = {
    x: (
      forwardTraceStart.x
      + forwardTraceDirection.x * forwardTraceDistance
    ),
    y: (
      forwardTraceStart.y
      + forwardTraceDirection.y * forwardTraceDistance
    ),
    z: forwardTraceStart.z,
  }

  const forwardTraceHit = input.Collision.SweepCapsule({
    ...collisionQueryBase(
      settings,
      'StartMantling (Forward Trace)',
    ),
    Start: forwardTraceStart,
    End: forwardTraceEnd,
    Radius: traceCapsuleRadius,
    HalfHeight: ledgeHeightDelta * 0.5,
  })
  if (
    !isValidBlockingHit(forwardTraceHit)
    || forwardTraceHit.TargetPrimitive == null
    || (
      forwardTraceHit.TargetPrimitiveVelocity.x
        * forwardTraceHit.TargetPrimitiveVelocity.x
      + forwardTraceHit.TargetPrimitiveVelocity.y
        * forwardTraceHit.TargetPrimitiveVelocity.y
      + forwardTraceHit.TargetPrimitiveVelocity.z
        * forwardTraceHit.TargetPrimitiveVelocity.z
      > settings.TargetPrimitiveSpeedThreshold
        * settings.TargetPrimitiveSpeedThreshold
    )
    || !forwardTraceHit.bCanCharacterStepUp
    || forwardTraceHit.bWalkable
  ) {
    return null
  }

  const targetDirectionNormal = safeNormalXY(
    forwardTraceHit.ImpactNormal,
  )
  const targetDirection = {
    x: -targetDirectionNormal.x,
    y: -targetDirectionNormal.y,
    z: 0,
  }
  const targetLocationOffset = {
    x: (
      targetDirection.x * trace.TargetLocationOffset * capsuleScale
    ),
    y: (
      targetDirection.y * trace.TargetLocationOffset * capsuleScale
    ),
  }
  const downwardTraceStart = {
    x: forwardTraceHit.ImpactPoint.x + targetLocationOffset.x,
    y: forwardTraceHit.ImpactPoint.y + targetLocationOffset.y,
    z: (
      capsuleBottomLocation.z
      + ledgeHeightDelta
      + 2.5 * traceCapsuleRadius
      + UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
    ),
  }
  const downwardTraceEnd = {
    x: downwardTraceStart.x,
    y: downwardTraceStart.y,
    z: (
      capsuleBottomLocation.z
      + trace.LedgeHeight[0] * capsuleScale
      + traceCapsuleRadius
      - UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE
    ),
  }

  const downwardTraceHit = input.Collision.SweepSphere({
    ...collisionQueryBase(
      settings,
      'StartMantling (Downward Trace)',
    ),
    Start: downwardTraceStart,
    End: downwardTraceEnd,
    Radius: traceCapsuleRadius,
  })
  if (downwardTraceHit === null) return null

  const approximateSlopeNormal = normalizedLikeFVectorNormalize({
    x: downwardTraceHit.Location.x - downwardTraceHit.ImpactPoint.x,
    y: downwardTraceHit.Location.y - downwardTraceHit.ImpactPoint.y,
    z: downwardTraceHit.Location.z - downwardTraceHit.ImpactPoint.z,
  })
  if (
    downwardTraceHit.ImpactNormal.z
      < settings.SlopeAngleThresholdCos
    || approximateSlopeNormal.z
      < settings.SlopeAngleThresholdCos
    || !downwardTraceHit.bWalkable
  ) {
    return null
  }

  const targetLocation = {
    x: downwardTraceHit.Location.x,
    y: downwardTraceHit.Location.y,
    z: (
      downwardTraceHit.ImpactPoint.z
      + UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
    ),
  }
  if (input.Collision.OverlapCapsule({
    ...collisionQueryBase(
      settings,
      'StartMantling (Target Location Overlap)',
    ),
    Location: {
      x: targetLocation.x,
      y: targetLocation.y,
      z: targetLocation.z + capsuleHalfHeight,
    },
    Radius: capsuleRadius,
    HalfHeight: capsuleHalfHeight,
  })) {
    return null
  }

  const startLocationOffset = {
    x: (
      targetDirection.x * trace.StartLocationOffset * capsuleScale
    ),
    y: (
      targetDirection.y * trace.StartLocationOffset * capsuleScale
    ),
  }
  const startLocation = {
    x: forwardTraceHit.ImpactPoint.x - startLocationOffset.x,
    y: forwardTraceHit.ImpactPoint.y - startLocationOffset.y,
    z: (
      downwardTraceHit.Location.z + downwardTraceEnd.z
    ) * 0.5,
  }
  const startLocationTraceCapsuleHalfHeight = (
    (downwardTraceHit.Location.z - downwardTraceEnd.z) * 0.5
    + traceCapsuleRadius
  )
  if (input.Collision.OverlapCapsule({
    ...collisionQueryBase(
      settings,
      'StartMantling (Start Location Overlap)',
    ),
    Location: startLocation,
    Radius: traceCapsuleRadius,
    HalfHeight: startLocationTraceCapsuleHalfHeight,
  })) {
    return null
  }

  const targetYawAngle = (
    Math.atan2(targetDirection.y, targetDirection.x) * 180 / Math.PI
  ) || 0
  const capturedTarget = input.TargetSpace.CaptureTarget(
    forwardTraceHit.TargetPrimitive,
    targetLocation,
    targetYawAngle,
  )
  const MantlingHeight = (
    (targetLocation.z - capsuleBottomLocation.z) / capsuleScale
  )
  const MantlingType: AlsMantlingType = (
    character.LocomotionMode !== 'Grounded'
      ? 'InAir'
      : MantlingHeight > settings.MantlingHighHeightThreshold
        ? 'High'
        : 'Low'
  )

  return {
    TargetPrimitive: capturedTarget.TargetPrimitive,
    TargetRelativeLocation: {
      x: capturedTarget.TargetRelativeLocation.x,
      y: capturedTarget.TargetRelativeLocation.y,
      z: capturedTarget.TargetRelativeLocation.z,
    },
    TargetRelativeRotation: {
      Pitch: capturedTarget.TargetRelativeRotation.Pitch,
      Yaw: capturedTarget.TargetRelativeRotation.Yaw,
      Roll: capturedTarget.TargetRelativeRotation.Roll,
    },
    MantlingHeight,
    MantlingType,
  }
}

/** `AAlsCharacter::StartMantlingGrounded()`. */
export function startMantlingGrounded(
  input: Readonly<StartAlsMantlingForModeInput>,
): AlsMantlingParameters | null {
  return input.Character.LocomotionMode === 'Grounded'
    ? startMantling({
        ...input,
        TraceSettings: input.MantlingSettings.GroundedTrace,
      })
    : null
}

/** `AAlsCharacter::StartMantlingInAir()`. */
export function startMantlingInAir(
  input: Readonly<StartAlsMantlingForModeInput>,
): AlsMantlingParameters | null {
  return (
    input.Character.LocomotionMode === 'InAir'
    && input.Character.bIsLocallyControlled
  )
    ? startMantling({
        ...input,
        TraceSettings: input.MantlingSettings.InAirTrace,
      })
    : null
}
