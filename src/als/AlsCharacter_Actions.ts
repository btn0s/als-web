import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
} from '../engine/characterMovementFloor'
import type {
  CompiledAuthoredRootMotion,
} from '../engine/rootMotion'
import type {
  AlsMantlingMontageBridge,
  AlsMantlingMontageNotifyEvent,
} from './AlsAnimationInstance'
import {
  setLocomotionAction,
  setLocomotionMode,
} from './AlsCharacter'
import type {
  AlsCharacter,
  AlsLocomotionAction,
  AlsLocomotionMode,
} from './AlsCharacter'
import {
  tickAlsAnimNotifyStateEarlyBlendOut,
} from './Notifies/AlsAnimNotifyState_EarlyBlendOut'
import type {
  AlsAnimNotifyStateEarlyBlendOutPayload,
} from './Notifies/AlsAnimNotifyState_EarlyBlendOut'
import {
  notifyAlsAnimNotifyStateSetLocomotionActionBegin,
  notifyAlsAnimNotifyStateSetLocomotionActionEnd,
} from './Notifies/AlsAnimNotifyState_SetLocomotionAction'
import {
  createAlsRootMotionSource_Mantling,
  prepareAlsRootMotionSource_Mantling,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import type {
  AlsMantlingRootMotionResult,
  AlsPrimitiveTransform,
  AlsRootMotionSource_Mantling,
  AlsRotator,
  PrepareAlsMantlingRootMotionInput,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
  selectAlsMantlingSettings,
} from './Settings/AlsMantlingSettings'
import type {
  AlsGeneralMantlingSettings,
  AlsMantlingMontageNotify,
  AlsMantlingTraceSettings,
  AlsMantlingType,
} from './Settings/AlsMantlingSettings'
import type {
  AlsRotationMode,
  AlsStance,
} from './Settings/AlsMovementSettings'
import type {
  AlsQuaternion,
} from './State/AlsFeetState'
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

export type AlsNetworkSmoothingMode = 'Disabled' | 'Exponential'

/**
 * UE-owned operations called by AAlsCharacter's mantling lifecycle.
 *
 * This adapter is deliberately explicit: the browser runtime must account for
 * every movement-component, mesh, montage, and event side effect in the same
 * order as ALS. Root-motion-source ID allocation is an engine responsibility,
 * just as it is in UCharacterMovementComponent; this module never invents an
 * independent action clock or ID allocator.
 */
export interface AlsMantlingLifecycleAdapter {
  SetNetworkSmoothingMode(mode: AlsNetworkSmoothingMode): void
  ResetMeshRelativeTransform(): void
  SetMovementModeLocked(bLocked: boolean): void
  SetBase(TargetPrimitive: unknown): void
  ApplyRootMotionSource(
    RootMotionSource: AlsRootMotionSource_Mantling,
  ): number
  GetRootMotionSourceByID(
    RootMotionSourceId: number,
  ): AlsRootMotionSource_Mantling | null
  /**
   * UAnimInstance owns every retained FAnimMontageInstance and its identity.
   * FAnimMontageInstance::InstanceID is intentionally unrelated to
   * FRootMotionSource::LocalID.
   */
  readonly MantlingMontage: AlsMantlingMontageBridge
  IsTargetPrimitiveValid(TargetPrimitive: unknown): boolean
  OnMantlingStarted(Parameters: Readonly<AlsMantlingParameters>): void
  OnMantlingEnded(): void
  ForceNetUpdate(): void
  StartRagdolling(): void
}

export interface StartAlsMantlingImplementationInput {
  readonly Character: AlsCharacter
  readonly Parameters: Readonly<AlsMantlingParameters>
  /** Exact gameplay tag consumed by B_Als_Character's overlay switch. */
  readonly OverlayMode?: string
  readonly AuthoredRootMotion: CompiledAuthoredRootMotion
  readonly bUseRelativeLocation: boolean
  readonly TargetPrimitiveTransform?: Readonly<AlsPrimitiveTransform>
  readonly ActorFeetLocation: Readonly<AlsVector3>
  readonly ActorRotation: Readonly<AlsQuaternion>
  readonly Lifecycle: AlsMantlingLifecycleAdapter
}

export interface StartAlsMantlingImplementationResult {
  readonly RootMotionSource: AlsRootMotionSource_Mantling
}

/**
 * `AAlsCharacter::StartMantlingImplementation()`, lines 454-538.
 *
 * `createAlsRootMotionSource_Mantling()` owns the exact start-time, target
 * transform, duration, and actor-offset math. This function owns the character
 * side effects and their source order.
 */
export function startMantlingImplementation(
  input: Readonly<StartAlsMantlingImplementationInput>,
): StartAlsMantlingImplementationResult | null {
  const character = input.Character
  if (character.locomotionAction !== null) return null

  const settings = selectAlsMantlingSettings(
    input.Parameters.MantlingType,
    input.OverlayMode ?? 'Als.OverlayMode.Default',
  )
  const RootMotionSource = createAlsRootMotionSource_Mantling({
    MantlingSettings: settings,
    AuthoredRootMotion: input.AuthoredRootMotion,
    MantlingHeight: input.Parameters.MantlingHeight,
    TargetPrimitive: input.Parameters.TargetPrimitive,
    bUseRelativeLocation: input.bUseRelativeLocation,
    TargetPrimitiveTransform: input.TargetPrimitiveTransform,
    TargetRelativeLocation: input.Parameters.TargetRelativeLocation,
    TargetRelativeRotation: input.Parameters.TargetRelativeRotation,
    ActorFeetLocation: input.ActorFeetLocation,
    ActorRotation: input.ActorRotation,
  })

  input.Lifecycle.SetNetworkSmoothingMode('Disabled')
  input.Lifecycle.ResetMeshRelativeTransform()

  // MOVE_Custom is represented by an invalid/null ALS locomotion-mode tag.
  setLocomotionMode(character, null)
  input.Lifecycle.SetMovementModeLocked(true)
  input.Lifecycle.SetBase(input.Parameters.TargetPrimitive)

  character.mantlingState.RootMotionSourceId =
    input.Lifecycle.ApplyRootMotionSource(RootMotionSource)

  // Montage_Play(Montage) starts at its default position zero. The root
  // source synchronizes the active montage to M - DeltaTime before animation
  // evaluation; starting Montage_Play at MontageStartTime would skip that
  // exact first-frame ownership handoff.
  const MontagePlayResult = input.Lifecycle.MantlingMontage.play(
    settings,
    0,
  )
  if (MontagePlayResult !== null) {
    setLocomotionAction(character, 'Mantling')
  }

  input.Lifecycle.OnMantlingStarted(input.Parameters)
  return {
    RootMotionSource,
  }
}

export interface StopAlsMantlingInput {
  readonly Character: AlsCharacter
  readonly Lifecycle: AlsMantlingLifecycleAdapter
  readonly MantlingSettings?: Readonly<AlsGeneralMantlingSettings>
  readonly bStopMontage?: boolean
}

/**
 * `AAlsCharacter::StopMantling()`, lines 644-676.
 *
 * The function intentionally does not clear LocomotionAction. If the montage
 * is stopped while its movement-action notify is active, that notify owns the
 * eventual action exit exactly as it does in ALS. The animation instance
 * retains stopped montage evaluation and dispatches NotifyEnd on termination.
 */
export function stopMantling(
  input: Readonly<StopAlsMantlingInput>,
): boolean {
  const character = input.Character
  const RootMotionSourceId =
    character.mantlingState.RootMotionSourceId
  if (RootMotionSourceId <= 0) return false

  const RootMotionSource =
    input.Lifecycle.GetRootMotionSourceByID(RootMotionSourceId)
  if (RootMotionSource !== null) {
    RootMotionSource.Status = 'MarkedForRemoval'
  }

  character.mantlingState.RootMotionSourceId = 0

  if (
    input.bStopMontage === true
    && RootMotionSource !== null
  ) {
    // UAnimInstance::Montage_Stop() resolves the currently active instance
    // by montage asset. A same-asset replacement is stopped; a different
    // montage that replaced it in the Slot Group is not.
    input.Lifecycle.MantlingMontage.montageStop(
      RootMotionSource.MantlingSettings,
      (
        input.MantlingSettings
        ?? ALS_GENERAL_MANTLING_SETTINGS
      ).BlendOutDuration,
    )
  }

  input.Lifecycle.SetNetworkSmoothingMode('Exponential')
  input.Lifecycle.SetMovementModeLocked(false)
  setLocomotionMode(character, 'Grounded')
  input.Lifecycle.OnMantlingEnded()
  input.Lifecycle.ForceNetUpdate()
  return true
}

export interface RefreshAlsMantlingInput {
  readonly Character: AlsCharacter
  readonly Lifecycle: AlsMantlingLifecycleAdapter
  readonly MantlingSettings?: Readonly<AlsGeneralMantlingSettings>
}

/**
 * `AAlsCharacter::RefreshMantling()`, lines 609-642.
 */
export function refreshMantling(
  input: Readonly<RefreshAlsMantlingInput>,
): boolean {
  const character = input.Character
  const RootMotionSourceId =
    character.mantlingState.RootMotionSourceId
  if (RootMotionSourceId <= 0) return false

  if (character.locomotionAction !== 'Mantling') {
    return stopMantling({
      ...input,
      bStopMontage: false,
    })
  }

  if (character.locomotionMode !== null) {
    return stopMantling({
      ...input,
      bStopMontage: true,
    })
  }

  const RootMotionSource =
    input.Lifecycle.GetRootMotionSourceByID(RootMotionSourceId)
  if (
    RootMotionSource !== null
    && !input.Lifecycle.IsTargetPrimitiveValid(
      RootMotionSource.TargetPrimitive,
    )
  ) {
    const stopped = stopMantling({
      ...input,
      bStopMontage: true,
    })
    if (
      (
        input.MantlingSettings
        ?? ALS_GENERAL_MANTLING_SETTINGS
      ).bStartRagdollingOnTargetPrimitiveDestruction
    ) {
      input.Lifecycle.StartRagdolling()
    }
    return stopped
  }

  return false
}

export interface PrepareAlsCharacterMantlingInput
  extends Omit<PrepareAlsMantlingRootMotionInput, 'TargetPrimitiveValid'> {
  readonly Character: AlsCharacter
  readonly Lifecycle: AlsMantlingLifecycleAdapter
  readonly RootMotionSource: AlsRootMotionSource_Mantling
  readonly RootMotionResult?: AlsMantlingRootMotionResult
}

/**
 * CharacterMovement's exact mantling root-source preparation followed by
 * FAnimMontageInstance::SetPosition().
 *
 * ALS Refactored 4.15
 * `FAlsRootMotionSource_Mantling::PrepareRootMotion()` writes
 * `Max(0, MontageTime - DeltaTime)` before UAnimInstance advances the retained
 * montage. The animation runtime remains the sole montage clock; the montage
 * asset resolves whichever same-asset instance is currently active, exactly
 * like UAnimInstance::Montage_SetPosition().
 */
export function prepareCharacterMantling(
  input: Readonly<PrepareAlsCharacterMantlingInput>,
): AlsMantlingRootMotionResult {
  const RootMotionResult = prepareAlsRootMotionSource_Mantling(
    input.RootMotionSource,
    {
      SimulationDeltaTime: input.SimulationDeltaTime,
      DeltaTime: input.DeltaTime,
      TargetPrimitiveValid:
        input.Lifecycle.IsTargetPrimitiveValid(
          input.RootMotionSource.TargetPrimitive,
        ),
      bUseRelativeLocation: input.bUseRelativeLocation,
      TargetPrimitiveTransform: input.TargetPrimitiveTransform,
      ActorFeetLocation: input.ActorFeetLocation,
      ActorRotation: input.ActorRotation,
      MeshScaleZ: input.MeshScaleZ,
      GravityDirection: input.GravityDirection,
    },
    input.RootMotionResult,
  )

  if (RootMotionResult.valid) {
    input.Lifecycle.MantlingMontage.montageSetPosition(
      input.RootMotionSource.MantlingSettings,
      RootMotionResult.Clock.MontagePosition,
    )
  }

  return RootMotionResult
}

export interface AlsActiveMantlingEarlyBlendOutState {
  readonly MontageInstanceId: number
  readonly NotifyIndex: number
  readonly Notify: Readonly<AlsAnimNotifyStateEarlyBlendOutPayload>
}

/**
 * Character-side branching-point state retained across animation frames.
 *
 * UAnimInstance owns marker traversal and montage lifetime. This runtime only
 * mirrors native notify-state ownership so BranchingPointNotifyTick() runs on
 * every frame between its authored Begin and End events.
 */
export interface AlsMantlingNotifyRuntime {
  readonly ActiveEarlyBlendOutStates: Map<
    number,
    Map<number, AlsActiveMantlingEarlyBlendOutState>
  >
}

export function createAlsMantlingNotifyRuntime(
): AlsMantlingNotifyRuntime {
  return {
    ActiveEarlyBlendOutStates: new Map(),
  }
}

function locomotionActionFromAuthoredTag(
  tag: string | undefined,
): Exclude<AlsLocomotionAction, null> {
  switch (tag) {
    case 'Als.LocomotionAction.Mantling':
      return 'Mantling'
    case 'Als.LocomotionAction.Ragdolling':
      return 'Ragdolling'
    case 'Als.LocomotionAction.GettingUp':
      return 'GettingUp'
    case 'Als.LocomotionAction.Rolling':
      return 'Rolling'
    default:
      throw new Error(
        `Unsupported ALS mantling LocomotionAction tag "${String(tag)}"`,
      )
  }
}

function locomotionModeFromAuthoredTag(
  tag: string | undefined,
): Exclude<AlsLocomotionMode, null> {
  switch (tag) {
    case 'Als.LocomotionMode.Grounded':
      return 'Grounded'
    case 'Als.LocomotionMode.InAir':
      return 'InAir'
    default:
      throw new Error(
        `Unsupported ALS mantling LocomotionMode tag "${String(tag)}"`,
      )
  }
}

function rotationModeFromAuthoredTag(
  tag: string | undefined,
): AlsRotationMode {
  switch (tag) {
    case 'Als.RotationMode.VelocityDirection':
      return 'VelocityDirection'
    case 'Als.RotationMode.ViewDirection':
      return 'ViewDirection'
    case 'Als.RotationMode.Aiming':
      return 'Aiming'
    default:
      throw new Error(
        `Unsupported ALS mantling RotationMode tag "${String(tag)}"`,
      )
  }
}

function stanceFromAuthoredTag(
  tag: string | undefined,
): AlsStance {
  switch (tag) {
    case 'Als.Stance.Standing':
      return 'Standing'
    case 'Als.Stance.Crouching':
      return 'Crouching'
    default:
      throw new Error(
        `Unsupported ALS mantling Stance tag "${String(tag)}"`,
      )
  }
}

export function compileAlsMantlingEarlyBlendOutNotify(
  Notify: Readonly<AlsMantlingMontageNotify>,
): AlsAnimNotifyStateEarlyBlendOutPayload {
  return {
    BlendOutDuration: Notify.BlendOutDuration ?? 0.25,
    bCheckInput: Notify.bCheckInput ?? true,
    bCheckLocomotionMode:
      Notify.bCheckLocomotionMode ?? true,
    bCheckRotationMode:
      Notify.bCheckRotationMode ?? true,
    bCheckStance: Notify.bCheckStance ?? true,
    LocomotionModeEquals: locomotionModeFromAuthoredTag(
      Notify.LocomotionModeEquals
        ?? 'Als.LocomotionMode.InAir',
    ),
    RotationModeEquals: rotationModeFromAuthoredTag(
      Notify.RotationModeEquals
        ?? 'Als.RotationMode.Aiming',
    ),
    StanceEquals: stanceFromAuthoredTag(
      Notify.StanceEquals
        ?? 'Als.Stance.Crouching',
    ),
  }
}

export function compileAlsMantlingLocomotionActionNotify(
  Notify: Readonly<AlsMantlingMontageNotify>,
): { readonly LocomotionAction: Exclude<AlsLocomotionAction, null> } {
  return {
    LocomotionAction: locomotionActionFromAuthoredTag(
      Notify.LocomotionAction,
    ),
  }
}

function activeEarlyBlendOutStatesForInstance(
  Runtime: AlsMantlingNotifyRuntime,
  MontageInstanceId: number,
) {
  let active = Runtime.ActiveEarlyBlendOutStates.get(
    MontageInstanceId,
  )
  if (!active) {
    active = new Map()
    Runtime.ActiveEarlyBlendOutStates.set(
      MontageInstanceId,
      active,
    )
  }
  return active
}

/**
 * Dispatches the native branching-point Begin/End callbacks in animation
 * traversal order. Unknown state classes or gameplay tags are content errors,
 * never suffix-matched web aliases.
 */
export function consumeAlsMantlingNotifyEvents(
  Runtime: AlsMantlingNotifyRuntime,
  Character: AlsCharacter,
  Events: readonly AlsMantlingMontageNotifyEvent[],
): void {
  for (const event of Events) {
    const notify = event.notify
    const notifyIndex =
      event.mantlingSettings.Montage.Notifies.indexOf(notify)
    if (notifyIndex < 0) {
      throw new Error(
        `${event.mantlingSettings.Montage.Name} received a foreign `
        + 'mantling notify',
      )
    }
    switch (notify.StateClassType) {
      case 'AlsAnimNotifyState_SetLocomotionAction': {
        const payload =
          compileAlsMantlingLocomotionActionNotify(notify)
        if (event.notifyEventType === 'Begin') {
          notifyAlsAnimNotifyStateSetLocomotionActionBegin(
            Character,
            payload,
          )
        } else {
          notifyAlsAnimNotifyStateSetLocomotionActionEnd(
            Character,
            payload,
          )
        }
        break
      }
      case 'AlsAnimNotifyState_EarlyBlendOut': {
        const payload =
          compileAlsMantlingEarlyBlendOutNotify(notify)
        const activeStates =
          Runtime.ActiveEarlyBlendOutStates.get(event.instanceId)
        if (event.notifyEventType === 'End') {
          activeStates?.delete(notifyIndex)
          if (activeStates?.size === 0) {
            Runtime.ActiveEarlyBlendOutStates.delete(
              event.instanceId,
            )
          }
        } else {
          activeEarlyBlendOutStatesForInstance(
            Runtime,
            event.instanceId,
          ).set(notifyIndex, {
            MontageInstanceId: event.instanceId,
            NotifyIndex: notifyIndex,
            Notify: payload,
          })
        }
        break
      }
      default:
        throw new Error(
          `Unsupported ALS mantling notify state `
          + `"${notify.StateClassType}"`,
        )
    }
  }
}

/**
 * Exact UAlsAnimNotifyState_EarlyBlendOut::BranchingPointNotifyTick() for
 * every currently active authored state.
 */
export function tickAlsMantlingEarlyBlendOutStates(
  Runtime: AlsMantlingNotifyRuntime,
  Character: AlsCharacter,
  MantlingMontage: AlsMantlingMontageBridge,
): boolean {
  let stopped = false
  const montage = {
    StopMontageInstance(
      MontageInstanceID: number,
      BlendOutDuration: number,
    ) {
      return MantlingMontage.stopMontageInstance(
        MontageInstanceID,
        BlendOutDuration,
      )
    },
  }
  const character = {
    bHasInput: Character.locomotionState.hasInput,
    LocomotionMode: Character.locomotionMode,
    RotationMode: Character.rotationMode,
    Stance: Character.stance,
  }
  for (
    const activeStates
    of Runtime.ActiveEarlyBlendOutStates.values()
  ) {
    for (const state of activeStates.values()) {
      stopped = tickAlsAnimNotifyStateEarlyBlendOut(
        montage,
        state.MontageInstanceId,
        character,
        state.Notify,
      ) || stopped
    }
  }
  return stopped
}

export interface RefreshAlsMantlingNotifyRuntimeInput {
  readonly Character: AlsCharacter
  readonly MantlingMontage: AlsMantlingMontageBridge
  readonly NotifyEvents:
    readonly AlsMantlingMontageNotifyEvent[]
}

/**
 * Called after UAnimInstance advancement: first apply its ordered
 * branching-point transitions, then tick the states that remain active.
 */
export function refreshAlsMantlingNotifyRuntime(
  Runtime: AlsMantlingNotifyRuntime,
  input: Readonly<RefreshAlsMantlingNotifyRuntimeInput>,
): boolean {
  consumeAlsMantlingNotifyEvents(
    Runtime,
    input.Character,
    input.NotifyEvents,
  )
  return tickAlsMantlingEarlyBlendOutStates(
    Runtime,
    input.Character,
    input.MantlingMontage,
  )
}
