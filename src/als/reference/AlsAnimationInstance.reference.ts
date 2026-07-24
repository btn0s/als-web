/**
 * Test-only C++ oracle.
 *
 * Reviewable against ALS/Private/AlsAnimationInstance.cpp:25-81, 313-351, 386-487,
 * 494-581, 708-803, 1028-1126, 1239-1414, and 1631-1830; never imported by runtime code.
 *
 * This file is deliberately a direct, unidiomatic transliteration. Names, statement order, and
 * inline constants stay close to the upstream C++ so review can proceed line by line.
 */

export interface FVector2f {
  X: number
  Y: number
}

export interface FVector3f extends FVector2f {
  Z: number
}

export interface FQuat4f {
  X: number
  Y: number
  Z: number
  W: number
}

export interface FTransform3f {
  Location: FVector3f
  Rotation: FQuat4f
}

export interface FAlsVelocityBlendState {
  bInitializationRequired: boolean
  ForwardAmount: number
  BackwardAmount: number
  LeftAmount: number
  RightAmount: number
}

export interface FAlsPoseState {
  GroundedAmount: number
  InAirAmount: number
  StandingAmount: number
  CrouchingAmount: number
  MovingAmount: number
  GaitAmount: number
  GaitWalkingAmount: number
  GaitRunningAmount: number
  GaitSprintingAmount: number
  UnweightedGaitAmount: number
  UnweightedGaitWalkingAmount: number
  UnweightedGaitRunningAmount: number
  UnweightedGaitSprintingAmount: number
}

export interface FAlsLeanState {
  RightAmount: number
  ForwardAmount: number
}

export interface FAlsLookState {
  bInitializationRequired: boolean
  WorldYawAngle: number
  YawAngle: number
  PitchAngle: number
  YawForwardAmount: number
  YawLeftAmount: number
  YawRightAmount: number
}

export interface FAlsSpineState {
  bSpineRotationAllowed: boolean
  SpineAmount: number
  SpineAmountScale: number
  SpineAmountBias: number
  LastYawAngle: number
  LastActorYawAngle: number
  CurrentYawAngle: number
  YawAngle: number
}

export interface FAlsRotateInPlaceState {
  bUpdatedThisFrame: boolean
  bRotatingLeft: boolean
  bRotatingRight: boolean
  PlayRate: number
}

export type FAlsStance = 'Standing' | 'Crouching'
export type FAlsTurnDirection = 'Left' | 'Right'
export type FAlsTurnAngle = 90 | 180

export interface FAlsTurnInPlaceClipSettings {
  clip: string
  PlayRate: number
  bScalePlayRateByAnimatedTurnAngle: boolean
  AnimatedTurnAngle: number
}

export interface FAlsGeneralTurnInPlaceSettings {
  ViewYawAngleThreshold: number
  ViewYawSpeedThreshold: number
  ViewYawAngleToActivationDelay: readonly [number, number]
  Turn180AngleThreshold: number
  clips: Readonly<
    Record<
      FAlsStance,
      Readonly<
        Record<
          FAlsTurnAngle,
          Readonly<Record<FAlsTurnDirection, FAlsTurnInPlaceClipSettings>>
        >
      >
    >
  >
}

export interface FAlsTurnInPlaceState {
  bUpdatedThisFrame: boolean
  ActivationDelay: number
}

export interface FAlsTurnInPlaceRequest {
  Stance: FAlsStance
  Angle: FAlsTurnAngle
  Direction: FAlsTurnDirection
  Settings: FAlsTurnInPlaceClipSettings
  QueuedTurnYawAngle: number
  PlayRate: number
}

export interface FAlsFootState {
  ThighAxis: FVector3f
  LockAmount: number
  TargetLocation: FVector3f
  TargetRotation: FQuat4f
  LockLocation: FVector3f
  LockRotation: FQuat4f
  LockComponentRelativeLocation: FVector3f
  LockComponentRelativeRotation: FQuat4f
  LockMovementBaseRelativeLocation: FVector3f
  LockMovementBaseRelativeRotation: FQuat4f
  FinalLocation: FVector3f
  FinalRotation: FQuat4f
}

export interface FAlsMovementBaseState {
  bHasRelativeLocation: boolean
  bHasRelativeRotation: boolean
  Location: FVector3f
  Rotation: FQuat4f
  DeltaRotationYaw: number
}

export interface FAlsGroundPredictionResult {
  GroundPredictionAmount: number
  SweepVector: FVector3f
}

const UE_SMALL_NUMBER = 1e-8
const UE_KINDA_SMALL_NUMBER = 1e-4
const ZERO_ANIMWEIGHT_THRESH = 1e-5

export function Clamp(Value: number, Min: number, Max: number): number {
  return Math.min(Max, Math.max(Min, Value))
}

export function Clamp01(Value: number): number {
  return Clamp(Value, 0.0, 1.0)
}

export function UnwindDegrees(Angle: number): number {
  while (Angle > 180.0) Angle -= 360.0
  while (Angle < -180.0) Angle += 360.0
  return Angle
}

export function RemapAngleForCounterClockwiseRotation(Angle: number): number {
  if (Angle > 180.0 - 5.0) {
    return Angle - 360.0
  }
  return Angle
}

export function Lerp(From: number, To: number, Ratio: number): number {
  return From + (To - From) * Ratio
}

export function LerpAngle(From: number, To: number, Ratio: number): number {
  let Delta = UnwindDegrees(To - From)
  Delta = RemapAngleForCounterClockwiseRotation(Delta)
  return UnwindDegrees(From + Delta * Ratio)
}

export function ExponentialDecay(DeltaTime: number, Lambda: number): number {
  // UAlsMath::ExponentialDecay, AlsMath.h:103-115, delegates to UE's InvExpApprox.
  const X = Lambda * DeltaTime
  return 1.0 - 1.0 / (1.0 + X + 0.48 * X * X + 0.235 * X * X * X)
}

export function FInterpTo(
  Current: number,
  Target: number,
  DeltaTime: number,
  InterpSpeed: number,
): number {
  if (InterpSpeed <= 0.0) {
    return Target
  }
  const Dist = Target - Current
  if (Dist * Dist < UE_SMALL_NUMBER) {
    return Target
  }
  const DeltaMove = Dist * Clamp(DeltaTime * InterpSpeed, 0.0, 1.0)
  return Current + DeltaMove
}

function Vector(X = 0.0, Y = 0.0, Z = 0.0): FVector3f {
  return { X, Y, Z }
}

function Quaternion(X = 0.0, Y = 0.0, Z = 0.0, W = 1.0): FQuat4f {
  return { X, Y, Z, W }
}

function Add(A: FVector3f, B: FVector3f): FVector3f {
  return Vector(A.X + B.X, A.Y + B.Y, A.Z + B.Z)
}

function Subtract(A: FVector3f, B: FVector3f): FVector3f {
  return Vector(A.X - B.X, A.Y - B.Y, A.Z - B.Z)
}

function MultiplyVector(A: FVector3f, Scale: number): FVector3f {
  return Vector(A.X * Scale, A.Y * Scale, A.Z * Scale)
}

function Dot(A: FVector3f, B: FVector3f): number {
  return A.X * B.X + A.Y * B.Y + A.Z * B.Z
}

function NormalizeVector(Value: FVector3f): FVector3f {
  const Size = Math.hypot(Value.X, Value.Y, Value.Z)
  return Size > UE_SMALL_NUMBER
    ? Vector(Value.X / Size, Value.Y / Size, Value.Z / Size)
    : Vector()
}

function NormalizeQuaternion(Value: FQuat4f): FQuat4f {
  const Size = Math.hypot(Value.X, Value.Y, Value.Z, Value.W)
  return Size > UE_SMALL_NUMBER
    ? Quaternion(Value.X / Size, Value.Y / Size, Value.Z / Size, Value.W / Size)
    : Quaternion()
}

function InverseQuaternion(Value: FQuat4f): FQuat4f {
  return Quaternion(-Value.X, -Value.Y, -Value.Z, Value.W)
}

function MultiplyQuaternion(A: FQuat4f, B: FQuat4f): FQuat4f {
  return Quaternion(
    A.W * B.X + A.X * B.W + A.Y * B.Z - A.Z * B.Y,
    A.W * B.Y - A.X * B.Z + A.Y * B.W + A.Z * B.X,
    A.W * B.Z + A.X * B.Y - A.Y * B.X + A.Z * B.W,
    A.W * B.W - A.X * B.X - A.Y * B.Y - A.Z * B.Z,
  )
}

function RotateVector(Rotation: FQuat4f, Value: FVector3f): FVector3f {
  const Result = MultiplyQuaternion(
    MultiplyQuaternion(Rotation, Quaternion(Value.X, Value.Y, Value.Z, 0.0)),
    InverseQuaternion(Rotation),
  )
  return Vector(Result.X, Result.Y, Result.Z)
}

function UnrotateVector(Rotation: FQuat4f, Value: FVector3f): FVector3f {
  return RotateVector(InverseQuaternion(Rotation), Value)
}

function TransformPosition(Transform: FTransform3f, Value: FVector3f): FVector3f {
  return Add(Transform.Location, RotateVector(Transform.Rotation, Value))
}

function InverseTransformPosition(Transform: FTransform3f, Value: FVector3f): FVector3f {
  return UnrotateVector(Transform.Rotation, Subtract(Value, Transform.Location))
}

function TransformRotation(Transform: FTransform3f, Value: FQuat4f): FQuat4f {
  return NormalizeQuaternion(MultiplyQuaternion(Transform.Rotation, Value))
}

function InverseTransformRotation(Transform: FTransform3f, Value: FQuat4f): FQuat4f {
  return NormalizeQuaternion(MultiplyQuaternion(InverseQuaternion(Transform.Rotation), Value))
}

function IsRelevant(Weight: number): boolean {
  return Weight > ZERO_ANIMWEIGHT_THRESH
}

function IsFullWeight(Weight: number): boolean {
  return Weight >= 1.0 - ZERO_ANIMWEIGHT_THRESH
}

function ClampMagnitude01(Value: FVector3f): FVector3f {
  const MagnitudeSquared = Dot(Value, Value)
  if (MagnitudeSquared <= 1.0) {
    return Value
  }
  const Scale = 1.0 / Math.sqrt(MagnitudeSquared)
  return Vector(Value.X * Scale, Value.Y * Scale, Value.Z * Scale)
}

function AngleBetweenSignedXY(From: FVector3f, To: FVector3f): number {
  const CrossZ = From.X * To.Y - From.Y * To.X
  const DotXY = From.X * To.X + From.Y * To.Y
  return Math.atan2(CrossZ, DotXY) * 180.0 / Math.PI
}

function YawQuaternion(YawDegrees: number): FQuat4f {
  const HalfAngle = YawDegrees * Math.PI / 360.0
  return Quaternion(0.0, 0.0, Math.sin(HalfAngle), Math.cos(HalfAngle))
}

/** AlsAnimationInstance.cpp:708-711. */
export function GetRelativeVelocity(
  RotationQuaternion: FQuat4f,
  Velocity: FVector3f,
): FVector3f {
  return UnrotateVector(RotationQuaternion, Velocity)
}

/** AlsAnimationInstance.cpp:713-733; ClampMagnitude01 is AlsVector.h:101-113. */
export function GetRelativeAccelerationAmount(Input: {
  RotationQuaternion: FQuat4f
  Acceleration: FVector3f
  Velocity: FVector3f
  MaxAcceleration: number
  MaxBrakingDeceleration: number
}): FVector2f {
  const MaxAcceleration =
    Dot(Input.Acceleration, Input.Velocity) >= 0.0
      ? Input.MaxAcceleration
      : Input.MaxBrakingDeceleration

  if (MaxAcceleration <= UE_KINDA_SMALL_NUMBER) {
    return { X: 0.0, Y: 0.0 }
  }

  const RelativeAcceleration = UnrotateVector(
    Input.RotationQuaternion,
    Input.Acceleration,
  )

  const ClampedAcceleration = ClampMagnitude01(
    MultiplyVector(RelativeAcceleration, 1.0 / MaxAcceleration),
  )
  return { X: ClampedAcceleration.X, Y: ClampedAcceleration.Y }
}

/** AlsAnimationInstance.cpp:735-785. */
export function RefreshVelocityBlend(Input: {
  VelocityBlend: FAlsVelocityBlendState
  RotationQuaternion: FQuat4f
  Velocity: FVector3f
  DeltaTime: number
  VelocityBlendInterpolationSpeed: number
}): FAlsVelocityBlendState {
  const VelocityBlend = Input.VelocityBlend

  let RelativeVelocityDirection = GetRelativeVelocity(
    Input.RotationQuaternion,
    Input.Velocity,
  )
  let TargetVelocityBlend = Vector()

  const RelativeVelocitySize = Math.hypot(
    RelativeVelocityDirection.X,
    RelativeVelocityDirection.Y,
    RelativeVelocityDirection.Z,
  )
  if (RelativeVelocitySize > UE_SMALL_NUMBER) {
    RelativeVelocityDirection = MultiplyVector(
      RelativeVelocityDirection,
      1.0 / RelativeVelocitySize,
    )
    TargetVelocityBlend = MultiplyVector(
      RelativeVelocityDirection,
      1.0 / (
        Math.abs(RelativeVelocityDirection.X)
        + Math.abs(RelativeVelocityDirection.Y)
        + Math.abs(RelativeVelocityDirection.Z)
      ),
    )
  }

  if (
    VelocityBlend.bInitializationRequired
    || Input.VelocityBlendInterpolationSpeed <= 0.0
  ) {
    VelocityBlend.bInitializationRequired = false

    VelocityBlend.ForwardAmount = Clamp01(TargetVelocityBlend.X)
    VelocityBlend.BackwardAmount = Math.abs(Clamp(TargetVelocityBlend.X, -1.0, 0.0))
    VelocityBlend.LeftAmount = Math.abs(Clamp(TargetVelocityBlend.Y, -1.0, 0.0))
    VelocityBlend.RightAmount = Clamp01(TargetVelocityBlend.Y)
  } else {
    const InterpolationAmount = ExponentialDecay(
      Input.DeltaTime,
      Input.VelocityBlendInterpolationSpeed,
    )

    VelocityBlend.ForwardAmount = Lerp(
      VelocityBlend.ForwardAmount,
      Clamp01(TargetVelocityBlend.X),
      InterpolationAmount,
    )
    VelocityBlend.BackwardAmount = Lerp(
      VelocityBlend.BackwardAmount,
      Math.abs(Clamp(TargetVelocityBlend.X, -1.0, 0.0)),
      InterpolationAmount,
    )
    VelocityBlend.LeftAmount = Lerp(
      VelocityBlend.LeftAmount,
      Math.abs(Clamp(TargetVelocityBlend.Y, -1.0, 0.0)),
      InterpolationAmount,
    )
    VelocityBlend.RightAmount = Lerp(
      VelocityBlend.RightAmount,
      Clamp01(TargetVelocityBlend.Y),
      InterpolationAmount,
    )
  }

  return VelocityBlend
}

/** AlsAnimationInstance.cpp:313-351. */
export function RefreshPose(
  Curves: Readonly<Record<string, number>>,
): FAlsPoseState {
  const GetCurveValue = (CurveName: string) => Curves[CurveName] ?? 0.0

  const PoseState = {} as FAlsPoseState
  PoseState.GroundedAmount = GetCurveValue('PoseGrounded')
  PoseState.InAirAmount = GetCurveValue('PoseInAir')

  PoseState.StandingAmount = GetCurveValue('PoseStanding')
  PoseState.CrouchingAmount = GetCurveValue('PoseCrouching')

  PoseState.MovingAmount = GetCurveValue('PoseMoving')

  PoseState.GaitAmount = Clamp(GetCurveValue('PoseGait'), 0.0, 3.0)
  PoseState.GaitWalkingAmount = Clamp01(PoseState.GaitAmount)
  PoseState.GaitRunningAmount = Clamp01(PoseState.GaitAmount - 1.0)
  PoseState.GaitSprintingAmount = Clamp01(PoseState.GaitAmount - 2.0)

  PoseState.UnweightedGaitAmount =
    PoseState.GroundedAmount > UE_SMALL_NUMBER
      ? PoseState.GaitAmount / PoseState.GroundedAmount
      : PoseState.GaitAmount

  PoseState.UnweightedGaitWalkingAmount = Clamp01(PoseState.UnweightedGaitAmount)
  PoseState.UnweightedGaitRunningAmount = Clamp01(PoseState.UnweightedGaitAmount - 1.0)
  PoseState.UnweightedGaitSprintingAmount = Clamp01(PoseState.UnweightedGaitAmount - 2.0)
  return PoseState
}

/** AlsAnimationInstance.cpp:787-803. */
export function RefreshGroundedLean(Input: {
  LeanState: FAlsLeanState
  RelativeAccelerationAmount: FVector2f
  bPendingUpdate: boolean
  DeltaTime: number
  LeanInterpolationSpeed: number
}): FAlsLeanState {
  const TargetLeanAmount = Input.RelativeAccelerationAmount

  if (Input.bPendingUpdate || Input.LeanInterpolationSpeed <= 0.0) {
    Input.LeanState.RightAmount = TargetLeanAmount.Y
    Input.LeanState.ForwardAmount = TargetLeanAmount.X
  } else {
    const InterpolationAmount = ExponentialDecay(
      Input.DeltaTime,
      Input.LeanInterpolationSpeed,
    )

    Input.LeanState.RightAmount = Lerp(
      Input.LeanState.RightAmount,
      TargetLeanAmount.Y,
      InterpolationAmount,
    )
    Input.LeanState.ForwardAmount = Lerp(
      Input.LeanState.ForwardAmount,
      TargetLeanAmount.X,
      InterpolationAmount,
    )
  }
  return Input.LeanState
}

/** AlsAnimationInstance.cpp:1102-1126. */
export function RefreshInAirLean(Input: {
  LeanState: FAlsLeanState
  RelativeVelocity: FVector3f
  VerticalVelocity: number
  LeanAmountCurveValue: number
  bPendingUpdate: boolean
  DeltaTime: number
  LeanInterpolationSpeed: number
}): FAlsLeanState {
  const ReferenceSpeed = 350.0

  const TargetLeanAmount = MultiplyVector(
    Input.RelativeVelocity,
    Input.LeanAmountCurveValue / ReferenceSpeed,
  )

  if (Input.bPendingUpdate || Input.LeanInterpolationSpeed <= 0.0) {
    Input.LeanState.RightAmount = TargetLeanAmount.Y
    Input.LeanState.ForwardAmount = TargetLeanAmount.X
  } else {
    const InterpolationAmount = ExponentialDecay(
      Input.DeltaTime,
      Input.LeanInterpolationSpeed,
    )

    Input.LeanState.RightAmount = Lerp(
      Input.LeanState.RightAmount,
      TargetLeanAmount.Y,
      InterpolationAmount,
    )
    Input.LeanState.ForwardAmount = Lerp(
      Input.LeanState.ForwardAmount,
      TargetLeanAmount.X,
      InterpolationAmount,
    )
  }
  return Input.LeanState
}

/** AlsAnimationInstance.cpp:494-581. */
export function RefreshLook(Input: {
  LookState: FAlsLookState
  RotationMode: 'VelocityDirection' | 'ViewDirection' | 'Aiming'
  ActorYawAngle: number
  bMovementBaseHasRelativeRotation: boolean
  MovementBaseDeltaRotationYaw: number
  bHasInput: boolean
  InputYawAngle: number
  TargetYawAngle: number
  ViewYawAngle: number
  ViewPitchAngle: number
  LocomotionYawSpeed: number
  DeltaTime: number
  LookTowardsInputYawAngleInterpolationSpeed: number
  LookTowardsCameraRotationInterpolationSpeed: number
}): FAlsLookState {
  const LookState = Input.LookState
  const ActorYawAngle = Input.ActorYawAngle

  if (Input.bMovementBaseHasRelativeRotation) {
    LookState.WorldYawAngle = UnwindDegrees(
      LookState.WorldYawAngle + Input.MovementBaseDeltaRotationYaw,
    )
  }

  let TargetYawAngle: number
  let TargetPitchAngle: number
  let InterpolationSpeed: number

  if (Input.RotationMode === 'VelocityDirection') {
    TargetYawAngle = UnwindDegrees(
      (Input.bHasInput ? Input.InputYawAngle : Input.TargetYawAngle) - ActorYawAngle,
    )
    TargetPitchAngle = 0.0
    InterpolationSpeed = Input.LookTowardsInputYawAngleInterpolationSpeed
  } else {
    TargetYawAngle = Input.ViewYawAngle
    TargetPitchAngle = Input.ViewPitchAngle
    InterpolationSpeed = Input.LookTowardsCameraRotationInterpolationSpeed
  }

  if (LookState.bInitializationRequired || InterpolationSpeed <= 0.0) {
    LookState.YawAngle = TargetYawAngle
    LookState.PitchAngle = TargetPitchAngle
    LookState.bInitializationRequired = false
  } else {
    const YawAngle = UnwindDegrees(LookState.WorldYawAngle - ActorYawAngle)
    let DeltaYawAngle = UnwindDegrees(TargetYawAngle - YawAngle)

    if (DeltaYawAngle > 180.0 - 5.0) {
      DeltaYawAngle -= 360.0
    } else if (
      Math.abs(Input.LocomotionYawSpeed) > UE_SMALL_NUMBER
      && Math.abs(TargetYawAngle) > 90.0
    ) {
      DeltaYawAngle =
        Input.LocomotionYawSpeed > 0.0
          ? Math.abs(DeltaYawAngle)
          : -Math.abs(DeltaYawAngle)
    }

    const InterpolationAmount = ExponentialDecay(Input.DeltaTime, InterpolationSpeed)

    LookState.YawAngle = UnwindDegrees(YawAngle + DeltaYawAngle * InterpolationAmount)
    LookState.PitchAngle = LerpAngle(
      LookState.PitchAngle,
      TargetPitchAngle,
      InterpolationAmount,
    )
  }

  LookState.WorldYawAngle = UnwindDegrees(ActorYawAngle + LookState.YawAngle)
  LookState.YawForwardAmount = LookState.YawAngle / 360.0 + 0.5
  LookState.YawLeftAmount =
    0.5 - Math.abs(LookState.YawForwardAmount - 0.5)
  LookState.YawRightAmount =
    0.5 + Math.abs(LookState.YawForwardAmount - 0.5)
  return LookState
}

/** AlsAnimationInstance.cpp:386-487. */
export function RefreshSpine(Input: {
  SpineState: FAlsSpineState
  bSpineRotationAllowed: boolean
  SpineBlendAmount: number
  DeltaTime: number
  bPendingUpdate: boolean
  ViewYawAngle: number
  ViewYawSpeed: number
  ActorYawAngle: number
  bMovementBaseHasRelativeRotation: boolean
  MovementBaseDeltaRotationYaw: number
}): FAlsSpineState {
  const SpineState = Input.SpineState
  if (SpineState.bSpineRotationAllowed !== Input.bSpineRotationAllowed) {
    SpineState.bSpineRotationAllowed = !SpineState.bSpineRotationAllowed

    if (SpineState.bSpineRotationAllowed) {
      if (IsFullWeight(SpineState.SpineAmount)) {
        SpineState.SpineAmountScale = 1.0
        SpineState.SpineAmountBias = 0.0
      } else {
        SpineState.SpineAmountScale = 1.0 / (1.0 - SpineState.SpineAmount)
        SpineState.SpineAmountBias =
          -SpineState.SpineAmount * SpineState.SpineAmountScale
      }
    } else {
      SpineState.SpineAmountScale =
        !IsRelevant(SpineState.SpineAmount)
          ? 1.0
          : 1.0 / SpineState.SpineAmount
      SpineState.SpineAmountBias = 0.0
    }

    SpineState.LastYawAngle = SpineState.CurrentYawAngle
    SpineState.LastActorYawAngle = Input.ActorYawAngle
  }

  if (SpineState.bSpineRotationAllowed) {
    if (Input.bPendingUpdate || IsFullWeight(SpineState.SpineAmount)) {
      SpineState.SpineAmount = 1.0
      SpineState.CurrentYawAngle = Input.ViewYawAngle
    } else {
      const InterpolationSpeed = 20.0
      SpineState.SpineAmount = Lerp(
        SpineState.SpineAmount,
        1.0,
        ExponentialDecay(Input.DeltaTime, InterpolationSpeed),
      )
      SpineState.CurrentYawAngle = LerpAngle(
        SpineState.LastYawAngle,
        Input.ViewYawAngle,
        SpineState.SpineAmount * SpineState.SpineAmountScale
          + SpineState.SpineAmountBias,
      )
    }
  } else if (Input.bPendingUpdate || !IsRelevant(SpineState.SpineAmount)) {
    SpineState.SpineAmount = 0.0
    SpineState.CurrentYawAngle = 0.0
  } else {
    const InterpolationSpeed = 1.0
    const ReferenceViewYawSpeed = 40.0
    const InterpolationSpeedMultiplier = Math.max(
      1.0,
      Math.abs(Input.ViewYawSpeed) / ReferenceViewYawSpeed,
    )
    SpineState.SpineAmount = Lerp(
      SpineState.SpineAmount,
      0.0,
      ExponentialDecay(
        Input.DeltaTime,
        InterpolationSpeed * InterpolationSpeedMultiplier,
      ),
    )

    if (Input.bMovementBaseHasRelativeRotation) {
      SpineState.LastActorYawAngle = UnwindDegrees(
        SpineState.LastActorYawAngle + Input.MovementBaseDeltaRotationYaw,
      )
    }

    let YawAngleOffset = UnwindDegrees(
      SpineState.LastActorYawAngle - Input.ActorYawAngle,
    )
    const MaxYawAngleOffset = 30.0
    YawAngleOffset = Clamp(
      YawAngleOffset,
      -MaxYawAngleOffset,
      MaxYawAngleOffset,
    )
    SpineState.LastActorYawAngle = UnwindDegrees(
      YawAngleOffset + Input.ActorYawAngle,
    )
    SpineState.CurrentYawAngle = LerpAngle(
      0.0,
      SpineState.LastYawAngle + YawAngleOffset,
      SpineState.SpineAmount * SpineState.SpineAmountScale
        + SpineState.SpineAmountBias,
    )
  }

  SpineState.YawAngle = LerpAngle(
    0.0,
    SpineState.CurrentYawAngle,
    Input.SpineBlendAmount,
  )
  return SpineState
}

/** AlsAnimationInstance.cpp:1631-1687. */
export function RefreshRotateInPlace(Input: {
  RotateInPlaceState: FAlsRotateInPlaceState
  bMoving: boolean
  bRotateInPlaceAllowed: boolean
  bPendingUpdate: boolean
  ViewYawAngle: number
  ViewYawSpeed: number
  DeltaTime: number
  ViewYawAngleThreshold: number
  ReferenceViewYawSpeed: readonly [number, number]
  PlayRate: readonly [number, number]
}): FAlsRotateInPlaceState {
  const RotateInPlaceState = Input.RotateInPlaceState
  if (RotateInPlaceState.bUpdatedThisFrame) {
    return RotateInPlaceState
  }
  RotateInPlaceState.bUpdatedThisFrame = true

  if (Input.bMoving || !Input.bRotateInPlaceAllowed) {
    RotateInPlaceState.bRotatingLeft = false
    RotateInPlaceState.bRotatingRight = false
  } else {
    RotateInPlaceState.bRotatingLeft =
      Input.ViewYawAngle < -Input.ViewYawAngleThreshold
    RotateInPlaceState.bRotatingRight =
      Input.ViewYawAngle > Input.ViewYawAngleThreshold
  }

  const PlayRateInterpolationSpeed = 5.0

  if (
    !RotateInPlaceState.bRotatingLeft
    && !RotateInPlaceState.bRotatingRight
  ) {
    RotateInPlaceState.PlayRate = Input.bPendingUpdate
      ? Input.PlayRate[0]
      : FInterpTo(
          RotateInPlaceState.PlayRate,
          Input.PlayRate[0],
          Input.DeltaTime,
          PlayRateInterpolationSpeed,
        )
    return RotateInPlaceState
  }

  const RangeAlpha = Clamp(
    (Input.ViewYawSpeed - Input.ReferenceViewYawSpeed[0])
      / (Input.ReferenceViewYawSpeed[1] - Input.ReferenceViewYawSpeed[0]),
    0.0,
    1.0,
  )
  const PlayRate = Lerp(Input.PlayRate[0], Input.PlayRate[1], RangeAlpha)
  RotateInPlaceState.PlayRate = Input.bPendingUpdate
    ? PlayRate
    : FInterpTo(
        RotateInPlaceState.PlayRate,
        PlayRate,
        Input.DeltaTime,
        PlayRateInterpolationSpeed,
      )
  return RotateInPlaceState
}

/** AlsAnimationInstance.cpp:1699-1806 and PlayQueuedTurnInPlaceAnimation:1819-1830. */
export function RefreshTurnInPlace(Input: {
  TurnInPlaceState: FAlsTurnInPlaceState
  bTransitionsAllowed: boolean
  bTurnInPlaceAllowed: boolean
  ViewYawAngle: number
  ViewYawSpeed: number
  DeltaTime: number
  Stance: FAlsStance
  Settings: FAlsGeneralTurnInPlaceSettings
}): FAlsTurnInPlaceRequest | null {
  const TurnInPlaceState = Input.TurnInPlaceState
  if (TurnInPlaceState.bUpdatedThisFrame) {
    return null
  }
  TurnInPlaceState.bUpdatedThisFrame = true

  if (!Input.bTransitionsAllowed || !Input.bTurnInPlaceAllowed) {
    TurnInPlaceState.ActivationDelay = 0.0
    return null
  }

  if (
    Input.ViewYawSpeed >= Input.Settings.ViewYawSpeedThreshold
    || Math.abs(Input.ViewYawAngle) <= Input.Settings.ViewYawAngleThreshold
  ) {
    TurnInPlaceState.ActivationDelay = 0.0
    return null
  }

  TurnInPlaceState.ActivationDelay =
    TurnInPlaceState.ActivationDelay + Input.DeltaTime

  const ActivationAlpha = Clamp(
    (Math.abs(Input.ViewYawAngle) - Input.Settings.ViewYawAngleThreshold)
      / (180.0 - Input.Settings.ViewYawAngleThreshold),
    0.0,
    1.0,
  )
  const ActivationDelay = Lerp(
    Input.Settings.ViewYawAngleToActivationDelay[0],
    Input.Settings.ViewYawAngleToActivationDelay[1],
    ActivationAlpha,
  )

  if (TurnInPlaceState.ActivationDelay <= ActivationDelay) {
    return null
  }

  const bTurnLeft =
    RemapAngleForCounterClockwiseRotation(Input.ViewYawAngle) <= 0.0
  const Angle: FAlsTurnAngle =
    Math.abs(Input.ViewYawAngle) < Input.Settings.Turn180AngleThreshold
      ? 90
      : 180
  const Direction: FAlsTurnDirection = bTurnLeft ? 'Left' : 'Right'
  const Settings = Input.Settings.clips[Input.Stance][Angle][Direction]

  let PlayRate = Settings.PlayRate
  if (Settings.bScalePlayRateByAnimatedTurnAngle) {
    PlayRate *= Math.abs(Input.ViewYawAngle / Settings.AnimatedTurnAngle)
  }

  return {
    Stance: Input.Stance,
    Angle,
    Direction,
    Settings,
    QueuedTurnYawAngle: Input.ViewYawAngle,
    PlayRate,
  }
}

/**
 * NativeInitializeAnimation's init-time thigh-axis capture,
 * AlsAnimationInstance.cpp:41-82.
 */
export function GetThighAxis(Input: {
  boneNames: readonly string[]
  parentIndices: ArrayLike<number>
  referencePositions: ArrayLike<number>
  PelvisBoneName: string
  FootBoneName: string
}): FVector3f {
  const PelvisBoneIndex = Input.boneNames.indexOf(Input.PelvisBoneName)
  let ParentBoneIndex = Input.boneNames.indexOf(Input.FootBoneName)
  if (ParentBoneIndex < 0) {
    return Vector()
  }

  while (true) {
    const NextParentBoneIndex = Input.parentIndices[ParentBoneIndex]
    if (NextParentBoneIndex <= 0) {
      return Vector()
    }
    if (NextParentBoneIndex === PelvisBoneIndex) {
      break
    }
    ParentBoneIndex = NextParentBoneIndex
  }

  const PositionOffset = ParentBoneIndex * 3
  return NormalizeVector(Vector(
    Input.referencePositions[PositionOffset],
    Input.referencePositions[PositionOffset + 1],
    Input.referencePositions[PositionOffset + 2],
  ))
}

/** AlsAnimationInstance.cpp:1239-1376. */
export function RefreshFootLock(Input: {
  IkAmount: number
  NewLockCurveAmount: number
  FootState: FAlsFootState
  ComponentTransform: FTransform3f
  DeltaTime: number
  bMovingSmooth: boolean
  bGrounded: boolean
  bPendingUpdate: boolean
  bDisableFootLock: boolean
  MovementBase: FAlsMovementBaseState
  PelvisRotation: FQuat4f
  FootLockAngleLimit: number
}): FAlsFootState {
  const FootState = Input.FootState
  let NewLockAmount = Clamp01(Input.NewLockCurveAmount)

  if (Input.bMovingSmooth || !Input.bGrounded) {
    const MovingDecreaseSpeed = 5.0
    const NotGroundedDecreaseSpeed = 0.6
    NewLockAmount = Input.bPendingUpdate
      ? 0.0
      : Math.max(
          0.0,
          Math.min(
            NewLockAmount,
            FootState.LockAmount - Input.DeltaTime
              * (Input.bMovingSmooth
                ? MovingDecreaseSpeed
                : NotGroundedDecreaseSpeed),
          ),
        )
  }

  if (Input.bDisableFootLock || !IsRelevant(Input.IkAmount * NewLockAmount)) {
    if (FootState.LockAmount > 0.0) {
      FootState.LockAmount = 0.0
      FootState.LockLocation = Vector()
      FootState.LockRotation = Quaternion()
      FootState.LockComponentRelativeLocation = Vector()
      FootState.LockComponentRelativeRotation = Quaternion()
      FootState.LockMovementBaseRelativeLocation = Vector()
      FootState.LockMovementBaseRelativeRotation = Quaternion()
    }

    FootState.FinalLocation = InverseTransformPosition(
      Input.ComponentTransform,
      FootState.TargetLocation,
    )
    FootState.FinalRotation = InverseTransformRotation(
      Input.ComponentTransform,
      FootState.TargetRotation,
    )
    return FootState
  }

  const bNewAmountEqualOne = IsFullWeight(NewLockAmount)
  const bNewAmountGreaterThanPrevious = NewLockAmount > FootState.LockAmount

  if (bNewAmountEqualOne) {
    if (bNewAmountGreaterThanPrevious) {
      if (FootState.LockAmount <= 0.9) {
        FootState.LockLocation = { ...FootState.TargetLocation }
        FootState.LockRotation = { ...FootState.TargetRotation }
        FootState.LockComponentRelativeLocation = InverseTransformPosition(
          Input.ComponentTransform,
          FootState.LockLocation,
        )
        FootState.LockComponentRelativeRotation = InverseTransformRotation(
          Input.ComponentTransform,
          FootState.LockRotation,
        )
      }

      if (Input.MovementBase.bHasRelativeLocation) {
        FootState.LockMovementBaseRelativeLocation = UnrotateVector(
          Input.MovementBase.Rotation,
          Subtract(FootState.TargetLocation, Input.MovementBase.Location),
        )
        FootState.LockMovementBaseRelativeRotation = NormalizeQuaternion(
          MultiplyQuaternion(
            InverseQuaternion(Input.MovementBase.Rotation),
            FootState.TargetRotation,
          ),
        )
      } else {
        FootState.LockMovementBaseRelativeLocation = Vector()
        FootState.LockMovementBaseRelativeRotation = Quaternion()
      }
    }
    FootState.LockAmount = 1.0
  } else if (!bNewAmountGreaterThanPrevious) {
    FootState.LockAmount = NewLockAmount
  }

  if (Input.MovementBase.bHasRelativeLocation) {
    FootState.LockLocation = Add(
      Input.MovementBase.Location,
      RotateVector(
        Input.MovementBase.Rotation,
        FootState.LockMovementBaseRelativeLocation,
      ),
    )
    FootState.LockRotation = NormalizeQuaternion(
      MultiplyQuaternion(
        Input.MovementBase.Rotation,
        FootState.LockMovementBaseRelativeRotation,
      ),
    )
  }

  FootState.LockComponentRelativeLocation = InverseTransformPosition(
    Input.ComponentTransform,
    FootState.LockLocation,
  )
  FootState.LockComponentRelativeRotation = InverseTransformRotation(
    Input.ComponentTransform,
    FootState.LockRotation,
  )

  const ComponentRelativeThighAxis = RotateVector(
    Input.PelvisRotation,
    FootState.ThighAxis,
  )
  const LockAngle = AngleBetweenSignedXY(
    ComponentRelativeThighAxis,
    FootState.LockComponentRelativeLocation,
  )

  if (
    Math.abs(LockAngle)
    > Input.FootLockAngleLimit + UE_KINDA_SMALL_NUMBER
  ) {
    const ConstrainedLockAngle = Clamp(
      LockAngle,
      -Input.FootLockAngleLimit,
      Input.FootLockAngleLimit,
    )
    const OffsetRotation = YawQuaternion(ConstrainedLockAngle - LockAngle)
    FootState.LockComponentRelativeLocation = RotateVector(
      OffsetRotation,
      FootState.LockComponentRelativeLocation,
    )
    FootState.LockComponentRelativeRotation = NormalizeQuaternion(
      MultiplyQuaternion(
        OffsetRotation,
        FootState.LockComponentRelativeRotation,
      ),
    )
    FootState.LockLocation = TransformPosition(
      Input.ComponentTransform,
      FootState.LockComponentRelativeLocation,
    )
    FootState.LockRotation = TransformRotation(
      Input.ComponentTransform,
      FootState.LockComponentRelativeRotation,
    )

    if (Input.MovementBase.bHasRelativeLocation) {
      FootState.LockMovementBaseRelativeLocation = UnrotateVector(
        Input.MovementBase.Rotation,
        Subtract(FootState.LockLocation, Input.MovementBase.Location),
      )
      FootState.LockMovementBaseRelativeRotation = NormalizeQuaternion(
        MultiplyQuaternion(
          InverseQuaternion(Input.MovementBase.Rotation),
          FootState.LockRotation,
        ),
      )
    }
  }

  const FinalLocation = Vector(
    Lerp(FootState.TargetLocation.X, FootState.LockLocation.X, FootState.LockAmount),
    Lerp(FootState.TargetLocation.Y, FootState.LockLocation.Y, FootState.LockAmount),
    Lerp(FootState.TargetLocation.Z, FootState.LockLocation.Z, FootState.LockAmount),
  )
  let FinalRotation = Quaternion(
    Lerp(FootState.TargetRotation.X, FootState.LockRotation.X, FootState.LockAmount),
    Lerp(FootState.TargetRotation.Y, FootState.LockRotation.Y, FootState.LockAmount),
    Lerp(FootState.TargetRotation.Z, FootState.LockRotation.Z, FootState.LockAmount),
    Lerp(FootState.TargetRotation.W, FootState.LockRotation.W, FootState.LockAmount),
  )
  FinalRotation = NormalizeQuaternion(FinalRotation)

  FootState.FinalLocation = InverseTransformPosition(
    Input.ComponentTransform,
    FinalLocation,
  )
  FootState.FinalRotation = InverseTransformRotation(
    Input.ComponentTransform,
    FinalRotation,
  )
  return FootState
}

/** PlayQuickStopAnimation, AlsAnimationInstance.cpp:1378-1414. */
export function PlayQuickStopAnimation(Input: {
  RotationMode: 'VelocityDirection' | 'ViewDirection' | 'Aiming'
  bHasInput: boolean
  InputYawAngle: number
  TargetYawAngle: number
  ActorYawAngle: number
  QuickStopPlayRate: readonly [number, number]
}): { Direction: 'Left' | 'Right'; PlayRate: number } {
  if (Input.RotationMode !== 'VelocityDirection') {
    return { Direction: 'Left', PlayRate: Input.QuickStopPlayRate[0] }
  }

  let RemainingYawAngle = UnwindDegrees(
    (Input.bHasInput ? Input.InputYawAngle : Input.TargetYawAngle)
      - Input.ActorYawAngle,
  )
  RemainingYawAngle = RemapAngleForCounterClockwiseRotation(RemainingYawAngle)

  if (RemainingYawAngle <= 0.0) {
    return {
      Direction: 'Left',
      PlayRate: Lerp(
        Input.QuickStopPlayRate[0],
        Input.QuickStopPlayRate[1],
        Math.abs(RemainingYawAngle) / 180.0,
      ),
    }
  }
  return {
    Direction: 'Right',
    PlayRate: Lerp(
      Input.QuickStopPlayRate[0],
      Input.QuickStopPlayRate[1],
      Math.abs(RemainingYawAngle) / 180.0,
    ),
  }
}

/**
 * RefreshGroundPrediction's mapping seam only (no sweep),
 * AlsAnimationInstance.cpp:1028-1065 and 1097-1099.
 */
export function RefreshGroundPrediction(Input: {
  VerticalVelocity: number
  Velocity: FVector3f
  Scale: number
  GroundPredictionBlockCurveValue: number
  bGroundValid: boolean
  HitTime: number
  GroundPredictionAmountCurveValue: (HitTime: number) => number
}): FAlsGroundPredictionResult {
  const VerticalVelocityThreshold = -200.0
  if (Input.VerticalVelocity > VerticalVelocityThreshold) {
    return { GroundPredictionAmount: 0.0, SweepVector: Vector() }
  }

  const AllowanceAmount = 1.0 - Clamp01(Input.GroundPredictionBlockCurveValue)
  if (AllowanceAmount <= UE_KINDA_SMALL_NUMBER) {
    return { GroundPredictionAmount: 0.0, SweepVector: Vector() }
  }

  const MinVerticalVelocity = -4000.0
  const MaxVerticalVelocity = -200.0
  const VelocityDirection = NormalizeVector(Vector(
    Input.Velocity.X,
    Input.Velocity.Y,
    Clamp(Input.Velocity.Z, MinVerticalVelocity, MaxVerticalVelocity),
  ))

  const MinSweepDistance = 150.0
  const MaxSweepDistance = 2000.0
  const SweepDistanceAlpha = Clamp(
    (Input.VerticalVelocity - MaxVerticalVelocity)
      / (MinVerticalVelocity - MaxVerticalVelocity),
    0.0,
    1.0,
  )
  const SweepVector = MultiplyVector(
    VelocityDirection,
    Lerp(MinSweepDistance, MaxSweepDistance, SweepDistanceAlpha) * Input.Scale,
  )

  return {
    GroundPredictionAmount: Input.bGroundValid
      ? Input.GroundPredictionAmountCurveValue(Input.HitTime) * AllowanceAmount
      : 0.0,
    SweepVector,
  }
}
