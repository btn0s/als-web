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
  setRotationInstant,
} from './AlsCharacter'
import {
  setMovementVelocity,
} from './AlsCharacterMovementComponent'
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
  exponentialDecay,
} from './State/AlsGroundedState'
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
 * The two UAnimInstance calls used by ALS's rolling lifecycle.
 *
 * Montage evaluation and notify dispatch stay engine-owned. In particular,
 * this bridge does not synthesize a Roll duration or clear LocomotionAction.
 */
export interface AlsRollingMontageBridge {
  Montage_IsPlaying(Montage: string): boolean
  Montage_Play(Montage: string, PlayRate: number): number
}

/** `AAlsCharacter::IsRollingAllowedToStart()`, lines 32-37. */
export function isRollingAllowedToStart(
  Character: Readonly<AlsCharacter>,
  Montage: string,
  Animation: AlsRollingMontageBridge,
): boolean {
  return Character.locomotionAction === null
    || (
      Character.locomotionAction === 'Rolling'
      && !Animation.Montage_IsPlaying(Montage)
    )
}

/**
 * `AAlsCharacter::StartRollingImplementation()`, lines 89-100.
 *
 * The action is installed only after Montage_Play succeeds. Its authored
 * `AlsAnimNotifyState_SetLocomotionAction` window owns the eventual exit.
 */
export function startRollingImplementation(
  Character: AlsCharacter,
  Montage: string,
  PlayRate: number,
  InitialYawAngle: number,
  TargetYawAngle: number,
  Animation: AlsRollingMontageBridge,
): boolean {
  if (
    !isRollingAllowedToStart(Character, Montage, Animation)
    || Animation.Montage_Play(Montage, PlayRate) <= 0
  ) {
    return false
  }

  Character.rollingState.TargetYawAngle = TargetYawAngle
  setRotationInstant(Character, InitialYawAngle)
  setLocomotionAction(Character, 'Rolling')
  return true
}

export function startRolling(
  Character: AlsCharacter,
  PlayRate: number,
  Animation: AlsRollingMontageBridge,
): boolean
export function startRolling(
  Character: AlsCharacter,
  PlayRate: number,
  TargetYawAngle: number,
  Animation: AlsRollingMontageBridge,
): boolean

/**
 * Both `AAlsCharacter::StartRolling()` overloads, lines 22-66.
 *
 * The three-argument overload is the player-request path and therefore
 * requires Grounded before selecting the authored input/actor target. The
 * explicit-target overload is also used by landing, after Grounded has already
 * been established by NotifyLocomotionModeChanged().
 *
 * Role/RPC routing happens outside this framework-free character seam. The
 * synchronous call below is the same character-side implementation reached by
 * ALS's multicast.
 */
export function startRolling(
  Character: AlsCharacter,
  PlayRate: number,
  TargetYawAngleOrAnimation:
    number | AlsRollingMontageBridge,
  ExplicitAnimation?: AlsRollingMontageBridge,
): boolean {
  const bHasExplicitTarget =
    typeof TargetYawAngleOrAnimation === 'number'

  if (!bHasExplicitTarget && Character.locomotionMode !== 'Grounded') {
    return false
  }

  const Animation = bHasExplicitTarget
    ? ExplicitAnimation
    : TargetYawAngleOrAnimation
  if (!Animation) return false

  const TargetYawAngle = bHasExplicitTarget
    ? TargetYawAngleOrAnimation
    : (
        Character.settings.Rolling.bRotateToInputOnStart
        && Character.locomotionState.hasInput
          ? Character.locomotionState.inputYawAngle
          : unwindDegrees(Character.actorYawAngle)
      )
  const Montage = Character.settings.Rolling.Montage
  if (
    Montage.length === 0
    || !isRollingAllowedToStart(Character, Montage, Animation)
  ) {
    return false
  }

  const InitialYawAngle = unwindDegrees(Character.actorYawAngle)
  return startRollingImplementation(
    Character,
    Montage,
    PlayRate,
    InitialYawAngle,
    TargetYawAngle,
    Animation,
  )
}

export interface AlsRollingPhysicsAdapter {
  GetUpdatedComponentRotation(): Readonly<AlsRotator>
  MoveUpdatedComponent(
    Delta: Readonly<AlsVector3>,
    NewRotation: Readonly<AlsRotator>,
    bSweep: false,
    Teleport: 'None' | 'TeleportPhysics',
  ): void
}

function exponentialDecayRollingYawAngle(
  Current: number,
  Target: number,
  DeltaTime: number,
  Lambda: number,
): number {
  if (Lambda <= 0) return Target
  let Delta = unwindDegrees(Target - Current)
  // UAlsRotation remaps (175, 180] to (-185, -180] so an exact
  // back-facing turn consistently rotates counterclockwise.
  if (Delta > 175) Delta -= 360
  return unwindDegrees(
    Current + Delta * exponentialDecay(DeltaTime, Lambda),
  )
}

/**
 * `AAlsCharacter::RefreshRollingPhysics()`, lines 115-141.
 *
 * The snap branch retains its `TeleportPhysics` move while interpolated
 * movement uses the normal non-swept overload. The updated-component rotator,
 * rather than cached actor yaw, is the interpolation source.
 */
export function refreshRollingPhysics(
  Character: AlsCharacter,
  DeltaTime: number,
  Physics: AlsRollingPhysicsAdapter,
): boolean {
  if (Character.locomotionAction !== 'Rolling') return false

  const UpdatedComponentRotation =
    Physics.GetUpdatedComponentRotation()
  const TargetRotation: AlsRotator = {
    Pitch: UpdatedComponentRotation.Pitch,
    Yaw: UpdatedComponentRotation.Yaw,
    Roll: UpdatedComponentRotation.Roll,
  }
  const RotationInterpolationSpeed =
    Character.settings.Rolling.RotationInterpolationSpeed
  let Teleport: 'None' | 'TeleportPhysics'
  if (RotationInterpolationSpeed <= 0) {
    TargetRotation.Yaw =
      Character.rollingState.TargetYawAngle
    Teleport = 'TeleportPhysics'
  } else {
    TargetRotation.Yaw = exponentialDecayRollingYawAngle(
      unwindDegrees(TargetRotation.Yaw),
      Character.rollingState.TargetYawAngle,
      DeltaTime,
      RotationInterpolationSpeed,
    )
    Teleport = 'None'
  }

  Physics.MoveUpdatedComponent(
    { x: 0, y: 0, z: 0 },
    TargetRotation,
    false,
    Teleport,
  )
  Character.actorYawAngle = unwindDegrees(TargetRotation.Yaw)
  return true
}

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

export const ALS_RAGDOLLING_PELVIS_BONE_NAME = 'pelvis'
export const ALS_RAGDOLLING_SPINE_03_BONE_NAME = 'spine_03'
export const ALS_RAGDOLLING_MONTAGE_BLEND_OUT_DURATION = 0.2
export const ALS_RAGDOLLING_MIN_SPEED_LIMIT = 2
export const ALS_RAGDOLLING_SPEED_LIMIT_FRAME_COUNT = 8
export const ALS_RAGDOLLING_PULL_FORCE = 750
export const ALS_RAGDOLLING_PULL_FORCE_INTERPOLATION_SPEED = 0.6
export const ALS_RAGDOLLING_PULL_FORCE_SPINE_SPEED = 3
export const ALS_RAGDOLLING_MIN_PULL_FORCE_DISTANCE = 0.05
export const ALS_RAGDOLLING_MAX_PULL_FORCE_DISTANCE = 0.5
export const ALS_RAGDOLLING_REFERENCE_SPEED = 10
export const ALS_RAGDOLLING_STIFFNESS = 25_000

export type AlsRagdollingCollisionEnabled =
  | 'NoCollision'
  | 'QueryOnly'
  | 'QueryAndPhysics'

export type AlsRagdollingCollisionObjectType =
  | 'Pawn'
  | 'PhysicsBody'

export type AlsRagdollingMovementMode =
  | 'None'
  | 'Walking'
  | 'Falling'

export interface AlsRagdollingBodyState {
  readonly Location: Readonly<AlsVector3>
  readonly LinearVelocity: Readonly<AlsVector3>
}

export interface AlsRagdollingGroundQueryParameters {
  readonly TraceTag: 'RagdollTraceGround'
  readonly bTraceComplex: false
  readonly bIgnoreOwningActor: true
}

export interface AlsRagdollingGroundSweep {
  readonly Start: Readonly<AlsVector3>
  readonly End: Readonly<AlsVector3>
  readonly Rotation: Readonly<AlsQuaternion>
  readonly Radius: number
  readonly CollisionChannel: unknown
  readonly QueryParameters:
    Readonly<AlsRagdollingGroundQueryParameters>
  readonly CollisionResponses: unknown
}

export interface AlsRagdollingGroundSweepHit {
  readonly Location: Readonly<AlsVector3>
}

/**
 * Engine operations owned by `AAlsCharacter`'s ragdoll lifecycle.
 *
 * Body locations and velocities cross this seam in repository metres. Native
 * physical-animation stiffness and pull-force values remain unchanged; the
 * physics implementation owns their solver-specific interpretation.
 *
 * `RefreshUpdateRateOptimizationsAfterRagdolling()` is one atomic engine
 * handoff: when URO is active it must disable URO now and restore it on the
 * next engine tick, matching ALS. This module never approximates that engine
 * behavior with a wall-clock timer.
 */
export interface AlsRagdollingLifecycleAdapter {
  GetBodyInstance(BoneName: string): unknown | null
  ReadBodyState(Body: unknown): AlsRagdollingBodyState
  IsRigidBody(Body: unknown): boolean
  GetBodyLocation(Body: unknown): Readonly<AlsVector3>
  AddForce(
    Body: unknown,
    Force: Readonly<AlsVector3>,
    bAccelChange: true,
    bAutoWake: true,
  ): void
  SetBodyLinearVelocity(
    Body: unknown,
    Velocity: Readonly<AlsVector3>,
  ): void
  ForEachBodyBelow(
    BoneName: null,
    bIncludeSelf: true,
    bSkipCustomPhysicsType: false,
    Visitor: (Body: unknown) => void,
  ): void

  SetUpdateJointsFromAnimation(bEnabled: boolean): void
  IsRunningParallelEvaluation(): boolean
  GetBoneSpaceTransformCount(): number
  UpdateRBJointMotors(): void
  Montage_Stop(BlendOutDuration: number): void
  Montage_Play(Montage: string): number
  SetNetworkSmoothingMode(mode: AlsNetworkSmoothingMode): void
  SetIgnoreClientMovementErrorChecksAndCorrection(
    bIgnored: boolean,
  ): void
  DetachMeshKeepWorld(): void
  AttachMeshToCapsuleKeepWorld(): void
  SetCapsuleCollisionEnabled(
    CollisionEnabled: AlsRagdollingCollisionEnabled,
  ): void
  SetMeshCollisionObjectType(
    CollisionObjectType: AlsRagdollingCollisionObjectType,
  ): void
  SetMeshCollisionEnabled(
    CollisionEnabled: AlsRagdollingCollisionEnabled,
  ): void
  SetMeshSimulatePhysics(bSimulatePhysics: boolean): void
  SetAllMotorsAngularDriveParams(
    AngularSpring: number,
    AngularDamping: 0,
    ForceLimit: 0,
  ): void

  GetRagdollTargetLocation(): Readonly<AlsVector3>
  SetRagdollTargetLocation(
    NewTargetLocation: Readonly<AlsVector3>,
  ): void
  ServerSetRagdollTargetLocation(
    NewTargetLocation: Readonly<AlsVector3>,
  ): void

  GetActorLocation(): Readonly<AlsVector3>
  GetActorRotation(): Readonly<AlsRotator>
  SetActorLocationTeleport(
    NewActorLocation: Readonly<AlsVector3>,
  ): void
  SetActorLocationAndRotationTeleport(
    NewActorLocation: Readonly<AlsVector3>,
    NewActorRotation: Readonly<AlsRotator>,
  ): void
  GetScaledCapsuleRadius(): number
  GetScaledCapsuleHalfHeight(): number
  GetMovementCollisionObjectType(): unknown
  InitCollisionParams(
    QueryParameters:
      Readonly<AlsRagdollingGroundQueryParameters>,
  ): unknown
  SweepSingleByChannel(
    Sweep: Readonly<AlsRagdollingGroundSweep>,
  ): AlsRagdollingGroundSweepHit | null
  SetMovementMode(MovementMode: AlsRagdollingMovementMode): void
  SetMovementModeLocked(bLocked: boolean): void

  SnapshotFinalRagdollPose(): unknown
  GetPelvisSocketTransform(): unknown
  GetTransformRotation(Transform: unknown): Readonly<AlsRotator>
  RestoreMeshWorldTransformFromActorBaseOffsets(): void
  RefreshUpdateRateOptimizationsAfterRagdolling(): void
  RestoreFinalRagdollPosePelvisTransform(
    FinalRagdollPose: unknown,
    PelvisTransform: unknown,
  ): void

  FlushServerMoves(): void
  ServerStartRagdolling(): void
  MulticastStartRagdolling(): void
  ServerStopRagdolling(): void
  MulticastStopRagdolling(): void
  ForceNetUpdate(): void
  OnRagdollingStarted(): void
  OnRagdollingEnded(): void
}

export interface AlsRagdollingRoleState {
  readonly LocalRole: AlsCharacterLocalRole
  readonly bIsLocallyControlled: boolean
  readonly bHasValidController: boolean
}

export interface AlsRagdollingInput
  extends AlsRagdollingRoleState {
  readonly Character: AlsCharacter
  readonly Lifecycle: AlsRagdollingLifecycleAdapter
}

function isRoleAboveSimulatedProxy(
  LocalRole: AlsCharacterLocalRole,
): boolean {
  return LocalRole === 'AutonomousProxy'
    || LocalRole === 'Authority'
}

function vectorEquals(
  a: Readonly<AlsVector3>,
  b: Readonly<AlsVector3>,
): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

function vectorIsZero(value: Readonly<AlsVector3>): boolean {
  return value.x === 0 && value.y === 0 && value.z === 0
}

function copyVector(
  value: Readonly<AlsVector3>,
): AlsVector3 {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  }
}

function vectorSizeSquared(
  value: Readonly<AlsVector3>,
): number {
  return value.x * value.x
    + value.y * value.y
    + value.z * value.z
}

function setRagdollingVelocity(
  Character: AlsCharacter,
  Velocity: Readonly<AlsVector3>,
): void {
  Character.ragdollingState.Velocity.x = Velocity.x
  Character.ragdollingState.Velocity.y = Velocity.y
  Character.ragdollingState.Velocity.z = Velocity.z
}

function requiredRagdollBody(
  Lifecycle: AlsRagdollingLifecycleAdapter,
  BoneName: string,
): unknown {
  const Body = Lifecycle.GetBodyInstance(BoneName)
  if (Body === null) {
    throw new Error(
      `ALS ragdoll invariant failed: missing ${BoneName} body`,
    )
  }
  return Body
}

/**
 * `AAlsCharacter::IsRagdollingAllowedToStart()`, lines 680-687.
 *
 * The body queries deliberately short-circuit in source order.
 */
export function isRagdollingAllowedToStart(
  Character: Readonly<AlsCharacter>,
  Lifecycle: AlsRagdollingLifecycleAdapter,
): boolean {
  return Character.locomotionAction !== 'Ragdolling'
    && Lifecycle.GetBodyInstance(
      ALS_RAGDOLLING_PELVIS_BONE_NAME,
    ) !== null
    && Lifecycle.GetBodyInstance(
      ALS_RAGDOLLING_SPINE_03_BONE_NAME,
    ) !== null
}

/** `AAlsCharacter::StartRagdolling()`, lines 689-709. */
export function startRagdolling(
  input: Readonly<AlsRagdollingInput>,
): boolean {
  if (
    !isRoleAboveSimulatedProxy(input.LocalRole)
    || !isRagdollingAllowedToStart(
      input.Character,
      input.Lifecycle,
    )
  ) {
    return false
  }

  if (input.LocalRole === 'Authority') {
    input.Lifecycle.MulticastStartRagdolling()
  } else {
    input.Lifecycle.FlushServerMoves()
    input.Lifecycle.ServerStartRagdolling()
  }
  return true
}

/** `AAlsCharacter::ServerStartRagdolling_Implementation()`. */
export function serverStartRagdolling(
  input: Readonly<AlsRagdollingInput>,
): boolean {
  if (!isRagdollingAllowedToStart(
    input.Character,
    input.Lifecycle,
  )) {
    return false
  }

  input.Lifecycle.MulticastStartRagdolling()
  input.Lifecycle.ForceNetUpdate()
  return true
}

/**
 * `AAlsCharacter::SetRagdollTargetLocation()`, lines 798-814.
 *
 * The adapter's setter owns replicated-property dirtiness. Only an autonomous
 * proxy forwards its changed value through ALS's unreliable server RPC.
 */
export function setRagdollTargetLocation(
  input: Readonly<AlsRagdollingInput>,
  NewTargetLocation: Readonly<AlsVector3>,
): boolean {
  if (vectorEquals(
    input.Lifecycle.GetRagdollTargetLocation(),
    NewTargetLocation,
  )) {
    return false
  }

  const TargetLocation = copyVector(NewTargetLocation)
  input.Lifecycle.SetRagdollTargetLocation(TargetLocation)
  if (input.LocalRole === 'AutonomousProxy') {
    input.Lifecycle.ServerSetRagdollTargetLocation(
      TargetLocation,
    )
  }
  return true
}

/** `AAlsCharacter::ServerSetRagdollTargetLocation_Implementation()`. */
export function serverSetRagdollTargetLocation(
  input: Readonly<AlsRagdollingInput>,
  NewTargetLocation: Readonly<AlsVector3>,
): boolean {
  return setRagdollTargetLocation(input, NewTargetLocation)
}

/**
 * `AAlsCharacter::StartRagdollingImplementation()`, lines 726-792.
 *
 * Every movement, mesh, physics, replication, and event side effect stays in
 * native source order. Multicast delivery calls this on every network role;
 * role filtering belongs only to `startRagdolling()`.
 */
export function startRagdollingImplementation(
  input: Readonly<AlsRagdollingInput>,
): boolean {
  const Character = input.Character
  const Lifecycle = input.Lifecycle
  if (!isRagdollingAllowedToStart(Character, Lifecycle)) {
    return false
  }

  Lifecycle.SetUpdateJointsFromAnimation(true)
  if (
    !Lifecycle.IsRunningParallelEvaluation()
    && Lifecycle.GetBoneSpaceTransformCount() > 0
  ) {
    Lifecycle.UpdateRBJointMotors()
  }

  Lifecycle.Montage_Stop(
    ALS_RAGDOLLING_MONTAGE_BLEND_OUT_DURATION,
  )
  Lifecycle.SetNetworkSmoothingMode('Disabled')
  Lifecycle.SetIgnoreClientMovementErrorChecksAndCorrection(true)
  Lifecycle.DetachMeshKeepWorld()
  Lifecycle.SetCapsuleCollisionEnabled('NoCollision')
  Lifecycle.SetMeshCollisionObjectType('PhysicsBody')
  Lifecycle.SetMeshCollisionEnabled('QueryAndPhysics')
  Lifecycle.SetMeshSimulatePhysics(true)

  const PelvisBody = requiredRagdollBody(
    Lifecycle,
    ALS_RAGDOLLING_PELVIS_BONE_NAME,
  )
  const PelvisState = Lifecycle.ReadBodyState(PelvisBody)
  const PelvisLocation = copyVector(PelvisState.Location)
  setRagdollingVelocity(Character, PelvisState.LinearVelocity)
  Character.ragdollingState.PullForce = 0

  if (Character.settings.Ragdolling.bLimitInitialRagdollSpeed) {
    Character.ragdollingState.SpeedLimitFrameTimeRemaining =
      ALS_RAGDOLLING_SPEED_LIMIT_FRAME_COUNT
    Character.ragdollingState.SpeedLimit = Math.max(
      ALS_RAGDOLLING_MIN_SPEED_LIMIT,
      Math.hypot(
        Character.locomotionState.velocity.x,
        Character.locomotionState.velocity.y,
        Character.locomotionState.velocity.z,
      ),
    )
    constraintRagdollSpeed(Character, Lifecycle)
  }

  if (input.LocalRole === 'Authority') {
    setRagdollTargetLocation(input, { x: 0, y: 0, z: 0 })
  }
  if (
    input.bIsLocallyControlled
    || (
      input.LocalRole === 'Authority'
      && !input.bHasValidController
    )
  ) {
    setRagdollTargetLocation(input, PelvisLocation)
  }

  Lifecycle.SetMovementMode('None')
  setLocomotionMode(Character, null)
  Lifecycle.SetMovementModeLocked(true)
  setLocomotionAction(Character, 'Ragdolling')
  Lifecycle.OnRagdollingStarted()
  return true
}

/** `AAlsCharacter::MulticastStartRagdolling_Implementation()`. */
export function multicastStartRagdolling(
  input: Readonly<AlsRagdollingInput>,
): boolean {
  return startRagdollingImplementation(input)
}

function interpTo(
  Current: number,
  Target: number,
  DeltaTime: number,
  InterpolationSpeed: number,
): number {
  if (InterpolationSpeed <= 0) return Target
  const Distance = Target - Current
  if (Distance * Distance < UE_SMALL_NUMBER) return Target
  return Current + Distance * Math.min(
    Math.max(DeltaTime * InterpolationSpeed, 0),
    1,
  )
}

/**
 * `AAlsCharacter::RagdollTraceGround()`, lines 915-957.
 */
export function ragdollTraceGround(
  input: Readonly<AlsRagdollingInput>,
): {
  readonly bGrounded: boolean
  readonly Location: AlsVector3
} {
  const Lifecycle = input.Lifecycle
  const TargetLocation = Lifecycle.GetRagdollTargetLocation()
  const RagdollLocation = copyVector(
    !vectorIsZero(TargetLocation)
      ? TargetLocation
      : Lifecycle.GetActorLocation(),
  )
  const CapsuleRadius = Lifecycle.GetScaledCapsuleRadius()
  const CapsuleHalfHeight =
    Lifecycle.GetScaledCapsuleHalfHeight()
  const Start = {
    x: RagdollLocation.x,
    y: RagdollLocation.y,
    z: RagdollLocation.z + 2 * CapsuleRadius,
  }
  const End = {
    x: RagdollLocation.x,
    y: RagdollLocation.y,
    z: (
      RagdollLocation.z
      - CapsuleHalfHeight
      + CapsuleRadius
    ),
  }
  const CollisionChannel =
    Lifecycle.GetMovementCollisionObjectType()
  const QueryParameters = {
    TraceTag: 'RagdollTraceGround',
    bTraceComplex: false,
    bIgnoreOwningActor: true,
  } as const
  const CollisionResponses =
    Lifecycle.InitCollisionParams(QueryParameters)
  const Hit = Lifecycle.SweepSingleByChannel({
    Start,
    End,
    Rotation: { x: 0, y: 0, z: 0, w: 1 },
    Radius: CapsuleRadius,
    CollisionChannel,
    QueryParameters,
    CollisionResponses,
  })
  const bGrounded = Hit !== null

  return {
    bGrounded,
    Location: {
      x: RagdollLocation.x,
      y: RagdollLocation.y,
      z: bGrounded
        ? (
            Hit.Location.z
            + CapsuleHalfHeight
            - CapsuleRadius
            + UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
          )
        : RagdollLocation.z,
    },
  }
}

/**
 * `AAlsCharacter::ConstraintRagdollSpeed()`, lines 959-983.
 */
export function constraintRagdollSpeed(
  Character: Readonly<AlsCharacter>,
  Lifecycle: AlsRagdollingLifecycleAdapter,
): void {
  const SpeedLimit = Character.ragdollingState.SpeedLimit
  Lifecycle.ForEachBodyBelow(
    null,
    true,
    false,
    (Body) => {
      if (!Lifecycle.IsRigidBody(Body)) return

      const Velocity = Lifecycle.ReadBodyState(Body).LinearVelocity
      const SpeedSquared = vectorSizeSquared(Velocity)
      if (SpeedSquared <= SpeedLimit * SpeedLimit) return

      const Speed = Math.sqrt(SpeedSquared)
      Lifecycle.SetBodyLinearVelocity(Body, {
        x: Velocity.x / Speed * SpeedLimit,
        y: Velocity.y / Speed * SpeedLimit,
        z: Velocity.z / Speed * SpeedLimit,
      })
    },
  )
}

/**
 * `AAlsCharacter::RefreshRagdolling()`, lines 821-913.
 */
export function refreshRagdolling(
  input: Readonly<AlsRagdollingInput> & {
    readonly DeltaTime: number
  },
): boolean {
  const Character = input.Character
  const Lifecycle = input.Lifecycle
  if (Character.locomotionAction !== 'Ragdolling') return false

  const PelvisBody = requiredRagdollBody(
    Lifecycle,
    ALS_RAGDOLLING_PELVIS_BONE_NAME,
  )
  const PelvisState = Lifecycle.ReadBodyState(PelvisBody)
  const PelvisLocation = copyVector(PelvisState.Location)
  setRagdollingVelocity(Character, PelvisState.LinearVelocity)

  const bLocallyControlled = input.bIsLocallyControlled
    || (
      input.LocalRole === 'Authority'
      && !input.bHasValidController
    )
  if (bLocallyControlled) {
    setRagdollTargetLocation(input, PelvisLocation)
  }

  const GroundTrace = ragdollTraceGround(input)
  Lifecycle.SetActorLocationTeleport(GroundTrace.Location)

  const TargetLocation = Lifecycle.GetRagdollTargetLocation()
  if (!bLocallyControlled && !vectorIsZero(TargetLocation)) {
    Character.ragdollingState.PullForce = interpTo(
      Character.ragdollingState.PullForce,
      ALS_RAGDOLLING_PULL_FORCE,
      input.DeltaTime,
      ALS_RAGDOLLING_PULL_FORCE_INTERPOLATION_SPEED,
    )

    const HorizontalSpeedSquared = (
      Character.ragdollingState.Velocity.x
        * Character.ragdollingState.Velocity.x
      + Character.ragdollingState.Velocity.y
        * Character.ragdollingState.Velocity.y
    )
    const PullForceBoneName = (
      HorizontalSpeedSquared
        > ALS_RAGDOLLING_PULL_FORCE_SPINE_SPEED
          * ALS_RAGDOLLING_PULL_FORCE_SPINE_SPEED
        ? ALS_RAGDOLLING_SPINE_03_BONE_NAME
        : ALS_RAGDOLLING_PELVIS_BONE_NAME
    )
    const PullForceBody = requiredRagdollBody(
      Lifecycle,
      PullForceBoneName,
    )
    if (Lifecycle.IsRigidBody(PullForceBody)) {
      const BodyLocation =
        Lifecycle.GetBodyLocation(PullForceBody)
      const PullForceVector = {
        x: TargetLocation.x - BodyLocation.x,
        y: TargetLocation.y - BodyLocation.y,
        z: TargetLocation.z - BodyLocation.z,
      }
      const DistanceSquared =
        vectorSizeSquared(PullForceVector)
      if (
        DistanceSquared
          > ALS_RAGDOLLING_MIN_PULL_FORCE_DISTANCE
            * ALS_RAGDOLLING_MIN_PULL_FORCE_DISTANCE
      ) {
        const Distance = Math.sqrt(DistanceSquared)
        const DistanceScale = (
          Distance > ALS_RAGDOLLING_MAX_PULL_FORCE_DISTANCE
            ? ALS_RAGDOLLING_MAX_PULL_FORCE_DISTANCE / Distance
            : 1
        )
        Lifecycle.AddForce(
          PullForceBody,
          {
            x: PullForceVector.x
              * DistanceScale
              * Character.ragdollingState.PullForce,
            y: PullForceVector.y
              * DistanceScale
              * Character.ragdollingState.PullForce,
            z: PullForceVector.z
              * DistanceScale
              * Character.ragdollingState.PullForce,
          },
          true,
          true,
        )
      }
    }
  }

  const SpeedAmount = Math.min(Math.max(
    Math.hypot(
      Character.ragdollingState.Velocity.x,
      Character.ragdollingState.Velocity.y,
      Character.ragdollingState.Velocity.z,
    ) / ALS_RAGDOLLING_REFERENCE_SPEED,
    0,
  ), 1)
  Lifecycle.SetAllMotorsAngularDriveParams(
    SpeedAmount * ALS_RAGDOLLING_STIFFNESS,
    0,
    0,
  )

  if (
    Character.ragdollingState
      .SpeedLimitFrameTimeRemaining > 0
  ) {
    Character.ragdollingState
      .SpeedLimitFrameTimeRemaining -= 1
    constraintRagdollSpeed(Character, Lifecycle)
  }
  return true
}

/** `AAlsCharacter::IsRagdollingAllowedToStop()`. */
export function isRagdollingAllowedToStop(
  Character: Readonly<AlsCharacter>,
): boolean {
  return Character.locomotionAction === 'Ragdolling'
}

/** `AAlsCharacter::StopRagdolling()`, lines 990-1010. */
export function stopRagdolling(
  input: Readonly<AlsRagdollingInput>,
): boolean {
  if (
    !isRoleAboveSimulatedProxy(input.LocalRole)
    || !isRagdollingAllowedToStop(input.Character)
  ) {
    return false
  }

  if (input.LocalRole === 'Authority') {
    input.Lifecycle.MulticastStopRagdolling()
  } else {
    input.Lifecycle.ServerStopRagdolling()
  }
  return true
}

/** `AAlsCharacter::ServerStopRagdolling_Implementation()`. */
export function serverStopRagdolling(
  input: Readonly<AlsRagdollingInput>,
): boolean {
  if (!isRagdollingAllowedToStop(input.Character)) {
    return false
  }

  input.Lifecycle.MulticastStopRagdolling()
  input.Lifecycle.ForceNetUpdate()
  return true
}

/** `AAlsCharacter::SelectGetUpMontage_Implementation()`. */
export function selectGetUpMontage(
  Character: Readonly<AlsCharacter>,
  bRagdollFacingUpward: boolean,
): string {
  return bRagdollFacingUpward
    ? Character.settings.Ragdolling.GetUpBackMontage
    : Character.settings.Ragdolling.GetUpFrontMontage
}

export interface StopAlsRagdollingImplementationResult {
  readonly bGrounded: boolean
  readonly bRagdollFacingUpward: boolean
  readonly bStartedGettingUp: boolean
}

/**
 * `AAlsCharacter::StopRagdollingImplementation()`, lines 1027-1119.
 *
 * The two opaque pose calls preserve the engine ownership boundary exactly:
 * snapshot before changing physics/transforms, then replace the snapshot's
 * pelvis local transform after mesh reattachment. No animation pose is
 * sampled or guessed in character policy.
 */
export function stopRagdollingImplementation(
  input: Readonly<AlsRagdollingInput>,
): StopAlsRagdollingImplementationResult | null {
  const Character = input.Character
  const Lifecycle = input.Lifecycle
  if (!isRagdollingAllowedToStop(Character)) return null

  const FinalRagdollPose =
    Lifecycle.SnapshotFinalRagdollPose()
  const PelvisTransform =
    Lifecycle.GetPelvisSocketTransform()
  const PelvisRotation =
    Lifecycle.GetTransformRotation(PelvisTransform)

  Lifecycle.SetUpdateJointsFromAnimation(false)
  Lifecycle.SetMeshSimulatePhysics(false)
  Lifecycle.SetMeshCollisionEnabled('QueryOnly')
  Lifecycle.SetMeshCollisionObjectType('Pawn')
  Lifecycle.SetCapsuleCollisionEnabled('QueryAndPhysics')
  Lifecycle.SetNetworkSmoothingMode('Exponential')
  Lifecycle.SetIgnoreClientMovementErrorChecksAndCorrection(false)

  const GroundTrace = ragdollTraceGround(input)
  const bRagdollFacingUpward =
    unwindDegrees(PelvisRotation.Roll) <= 0
  const ActorRotation = Lifecycle.GetActorRotation()
  const NewActorRotation = {
    Pitch: ActorRotation.Pitch,
    Yaw: bRagdollFacingUpward
      ? PelvisRotation.Yaw - 180
      : PelvisRotation.Yaw,
    Roll: ActorRotation.Roll,
  }
  Lifecycle.SetActorLocationAndRotationTeleport(
    GroundTrace.Location,
    NewActorRotation,
  )
  Lifecycle.RestoreMeshWorldTransformFromActorBaseOffsets()
  Lifecycle.AttachMeshToCapsuleKeepWorld()
  Lifecycle.RefreshUpdateRateOptimizationsAfterRagdolling()
  Lifecycle.RestoreFinalRagdollPosePelvisTransform(
    FinalRagdollPose,
    PelvisTransform,
  )

  Lifecycle.SetMovementModeLocked(false)
  if (GroundTrace.bGrounded) {
    Lifecycle.SetMovementMode('Walking')
    setLocomotionMode(Character, 'Grounded')
  } else {
    Lifecycle.SetMovementMode('Falling')
    setLocomotionMode(Character, 'InAir')
    setMovementVelocity(
      Character.movement,
      Character.ragdollingState.Velocity,
    )
  }

  setLocomotionAction(Character, null)
  Lifecycle.OnRagdollingEnded()

  let bStartedGettingUp = false
  if (
    GroundTrace.bGrounded
    && Lifecycle.Montage_Play(selectGetUpMontage(
      Character,
      bRagdollFacingUpward,
    )) > 0
  ) {
    Character.movement.inputBlocked = true
    setLocomotionAction(Character, 'GettingUp')
    bStartedGettingUp = true
  }

  return {
    bGrounded: GroundTrace.bGrounded,
    bRagdollFacingUpward,
    bStartedGettingUp,
  }
}

/** `AAlsCharacter::MulticastStopRagdolling_Implementation()`. */
export function multicastStopRagdolling(
  input: Readonly<AlsRagdollingInput>,
): StopAlsRagdollingImplementationResult | null {
  return stopRagdollingImplementation(input)
}
