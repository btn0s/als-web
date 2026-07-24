import {
  createAlsCharacterMovementComponent,
  getMaxRunSpeed,
  getMaxWalkSpeed,
  setMaxAllowedGait,
  setMovementRotationMode,
  setMovementStance,
  setMovementVelocity,
  startAlsLandingBrakingFriction,
} from './AlsCharacterMovementComponent'
import type {
  AlsCharacterMovementComponent,
  AlsCharacterMovementGaitSettings,
} from './AlsCharacterMovementComponent'
import type {
  AlsGait,
  AlsRotationMode,
  AlsStance,
} from './Settings/AlsMovementSettings'
import {
  ALS_CHARACTER_SETTINGS,
} from './Settings/AlsCharacterSettings'
import type {
  AlsCharacterSettings,
  AlsInAirRotationMode,
} from './Settings/AlsCharacterSettings'
import {
  createAlsLocomotionState,
  directionToAngleXY,
  refreshLocomotionState,
  unwindDegrees,
} from './State/AlsLocomotionState'
import type {
  AlsLocomotionState,
  AlsVector3,
} from './State/AlsLocomotionState'
import {
  createAlsMantlingState,
} from './State/AlsMantlingState'
import type { AlsMantlingState } from './State/AlsMantlingState'

export type AlsLocomotionMode = 'Grounded' | 'InAir' | null
export type AlsLocomotionAction =
  | 'Mantling'
  | 'Ragdolling'
  | 'GettingUp'
  | 'Rolling'
  | null
export type AlsViewMode = 'FirstPerson' | 'ThirdPerson'

export { ALS_CHARACTER_SETTINGS }
export type { AlsCharacterSettings, AlsInAirRotationMode }

export interface AlsCharacter {
  desiredAiming: boolean
  desiredRotationMode: AlsRotationMode
  desiredStance: AlsStance
  desiredGait: AlsGait
  viewMode: AlsViewMode
  locomotionMode: AlsLocomotionMode
  locomotionAction: AlsLocomotionAction
  rotationMode: AlsRotationMode
  stance: AlsStance
  gait: AlsGait
  actorYawAngle: number
  viewYawAngle: number
  viewYawSpeed: number
  desiredVelocityYawAngle: number
  hasDesiredVelocity: boolean
  readonly inputDirection: AlsVector3
  readonly locomotionState: AlsLocomotionState
  readonly movement: AlsCharacterMovementComponent
  readonly mantlingState: AlsMantlingState
  readonly settings: AlsCharacterSettings
}

export interface CreateAlsCharacterOptions {
  readonly actorYawAngle?: number
  readonly viewYawAngle?: number
  readonly desiredAiming?: boolean
  readonly desiredRotationMode?: AlsRotationMode
  readonly desiredStance?: AlsStance
  readonly desiredGait?: AlsGait
  readonly viewMode?: AlsViewMode
  readonly locomotionMode?: Exclude<AlsLocomotionMode, null>
  readonly velocity?: Readonly<AlsVector3>
  readonly settings?: Partial<AlsCharacterSettings>
}

// AAlsCharacter::CalculateActualGait(), cpp:997-1004, uses a 10 cm/s buffer.
export const ALS_ACTUAL_GAIT_SPEED_BUFFER = 0.1

// AAlsCharacter::CanSprint(), cpp:1028-1032. The comparison is intentionally strict.
export const ALS_SPRINT_VIEW_RELATIVE_ANGLE_THRESHOLD = 50

const UE_SMALL_NUMBER = 1e-8
const UE_KINDA_SMALL_NUMBER = 1e-4

export function createAlsCharacter(
  options: CreateAlsCharacterOptions = {},
): AlsCharacter {
  const actorYawAngle = unwindDegrees(options.actorYawAngle ?? 0)
  const viewYawAngle = unwindDegrees(options.viewYawAngle ?? actorYawAngle)
  const desiredRotationMode =
    options.desiredRotationMode ?? 'ViewDirection'
  const desiredStance = options.desiredStance ?? 'Standing'
  const settings: AlsCharacterSettings = {
    ...ALS_CHARACTER_SETTINGS,
    ...options.settings,
  }
  const locomotionState = createAlsLocomotionState(actorYawAngle)
  locomotionState.viewRelativeTargetYawAngle = unwindDegrees(
    viewYawAngle - locomotionState.targetYawAngle,
  )
  const movement = createAlsCharacterMovementComponent({
    rotationMode: options.desiredAiming
      ? 'Aiming'
      : desiredRotationMode,
    stance: desiredStance,
    maxAllowedGait: 'Running',
    velocity: options.velocity,
  })
  const character: AlsCharacter = {
    desiredAiming: options.desiredAiming ?? false,
    desiredRotationMode,
    desiredStance,
    desiredGait: options.desiredGait ?? 'Running',
    viewMode: options.viewMode ?? 'ThirdPerson',
    locomotionMode: options.locomotionMode ?? 'Grounded',
    locomotionAction: null,
    rotationMode: movement.rotationMode,
    stance: desiredStance,
    gait: 'Walking',
    actorYawAngle,
    viewYawAngle,
    viewYawSpeed: 0,
    desiredVelocityYawAngle: actorYawAngle,
    hasDesiredVelocity: false,
    inputDirection: { x: 0, y: 0, z: 0 },
    locomotionState,
    movement,
    mantlingState: createAlsMantlingState(),
    settings,
  }
  refreshLocomotion(character, movement.velocity)
  refreshGait(character)
  refreshRotationMode(character)
  return character
}

/**
 * AAlsCharacter::RefreshView(), cpp:1226-1269. The supplied yaw is the web controller's
 * absolute ControlRotation analog. Actor rotation consumes this state but never writes back to
 * it; camera and animation derive their actor-relative values from the same absolute yaw.
 */
export function refreshView(
  character: AlsCharacter,
  viewYawAngle: number,
  deltaTime: number,
): AlsCharacter {
  const previousYawAngle = character.viewYawAngle
  character.viewYawAngle = unwindDegrees(viewYawAngle)
  character.viewYawSpeed = deltaTime > UE_SMALL_NUMBER
    ? Math.abs(character.viewYawAngle - previousYawAngle) / deltaTime
    : 0
  return character
}

/** AAlsCharacter::SetViewMode(). Network replication is outside the standalone web runtime. */
export function setViewMode(
  character: AlsCharacter,
  viewMode: AlsViewMode,
): AlsCharacter {
  character.viewMode = viewMode
  return character
}

function getSafeNormal(
  vector: Readonly<AlsVector3>,
  out: AlsVector3,
): AlsVector3 {
  const squaredLength =
    vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
  if (squaredLength <= UE_SMALL_NUMBER) {
    out.x = 0
    out.y = 0
    out.z = 0
    return out
  }

  const inverseLength = 1 / Math.sqrt(squaredLength)
  out.x = vector.x * inverseLength
  out.y = vector.y * inverseLength
  out.z = vector.z * inverseLength
  return out
}

/** AAlsCharacter::SetInputDirection(), cpp:1118-1123. */
export function setInputDirection(
  character: AlsCharacter,
  inputDirection: Readonly<AlsVector3>,
): AlsVector3 {
  return getSafeNormal(inputDirection, character.inputDirection)
}

/**
 * AAlsCharacter::RefreshInput(), cpp:1125-1138. A zero input keeps InputYawAngle at the last
 * non-zero value, which is required by velocity-direction stopping and quick-stop transitions.
 */
export function refreshInput(
  character: AlsCharacter,
  inputDirection?: Readonly<AlsVector3>,
): AlsCharacter {
  if (inputDirection) setInputDirection(character, inputDirection)

  const squaredLength =
    character.inputDirection.x * character.inputDirection.x
    + character.inputDirection.y * character.inputDirection.y
    + character.inputDirection.z * character.inputDirection.z
  character.locomotionState.hasInput =
    squaredLength > UE_KINDA_SMALL_NUMBER
  if (character.locomotionState.hasInput) {
    character.locomotionState.inputYawAngle =
      directionToAngleXY(character.inputDirection)
  }
  return character
}

/**
 * AAlsCharacter::RefreshLocomotion(), cpp:1375-1440. `desiredVelocity` is the bridge's intended
 * pre-collision velocity; if omitted, actual velocity is the faithful available fallback.
 */
export function refreshLocomotion(
  character: AlsCharacter,
  velocity: Readonly<AlsVector3>,
  desiredVelocity: Readonly<AlsVector3> = velocity,
): AlsCharacter {
  setMovementVelocity(character.movement, velocity)
  refreshLocomotionState(
    character.locomotionState,
    velocity,
    character.locomotionState.hasInput,
    character.settings.movingSpeedThreshold,
  )

  if (Math.hypot(desiredVelocity.x, desiredVelocity.y) >= 0.01) {
    character.desiredVelocityYawAngle = directionToAngleXY(desiredVelocity)
    character.hasDesiredVelocity = true
  } else if (character.locomotionState.hasVelocity) {
    character.desiredVelocityYawAngle =
      character.locomotionState.velocityYawAngle
    character.hasDesiredVelocity = true
  } else {
    character.hasDesiredVelocity = false
  }
  return character
}

/**
 * AAlsCharacter::CanSprint(), cpp:1010-1037.
 *
 * Third-person VelocityDirection (or the rotate-to-velocity sprint option) may sprint in any
 * input direction. First person and ordinary ViewDirection/Aiming require strict <50° alignment.
 */
export function canSprint(character: AlsCharacter): boolean {
  const state = character.locomotionState
  if (
    !state.hasInput
    || character.stance !== 'Standing'
    || (
      (
        character.desiredAiming
        || character.desiredRotationMode === 'Aiming'
      )
      && !character.settings.sprintHasPriorityOverAiming
    )
  ) {
    return false
  }

  if (
    character.viewMode !== 'FirstPerson'
    && (
      character.desiredRotationMode === 'VelocityDirection'
      || character.settings.rotateToVelocityWhenSprinting
    )
  ) {
    return true
  }

  return Math.abs(unwindDegrees(
    state.inputYawAngle - character.viewYawAngle,
  )) < ALS_SPRINT_VIEW_RELATIVE_ANGLE_THRESHOLD
}

/** AAlsCharacter::CalculateMaxAllowedGait(), cpp:970-987. */
export function calculateMaxAllowedGait(
  character: AlsCharacter,
): AlsGait {
  if (character.desiredGait !== 'Sprinting') {
    return character.desiredGait
  }
  return canSprint(character) ? 'Sprinting' : 'Running'
}

/**
 * AAlsCharacter::CalculateActualGait(), cpp:989-1008. The speed buffer prevents gait chatter at
 * authored boundaries, while MaxAllowedGait prevents Sprinting during an over-speed deceleration.
 */
export function calculateActualGait(
  speed: number,
  gaitSettings: AlsCharacterMovementGaitSettings,
  maxAllowedGait: AlsGait,
): AlsGait {
  if (
    speed
    < getMaxWalkSpeed(gaitSettings) + ALS_ACTUAL_GAIT_SPEED_BUFFER
  ) {
    return 'Walking'
  }
  if (
    speed
      < getMaxRunSpeed(gaitSettings) + ALS_ACTUAL_GAIT_SPEED_BUFFER
    || maxAllowedGait !== 'Sprinting'
  ) {
    return 'Running'
  }
  return 'Sprinting'
}

/** AAlsCharacter::RefreshGait(), cpp:952-968. */
export function refreshGait(character: AlsCharacter): AlsCharacter {
  if (character.locomotionMode !== 'Grounded') return character

  const maxAllowedGait = calculateMaxAllowedGait(character)
  setMaxAllowedGait(character.movement, maxAllowedGait)
  character.gait = calculateActualGait(
    character.locomotionState.speed,
    character.movement.gaitSettings,
    maxAllowedGait,
  )
  return character
}

function setRotationMode(
  character: AlsCharacter,
  rotationMode: AlsRotationMode,
): void {
  setMovementRotationMode(character.movement, rotationMode)
  if (character.rotationMode !== rotationMode) {
    character.rotationMode = rotationMode
    // NotifyRotationModeChanged(), AlsCharacter.cpp:674-681.
    character.locomotionState.rotationTowardsLastInputDirectionBlocked = true
  }
}

/** AAlsCharacter::RefreshRotationMode(), cpp:684-767. */
export function refreshRotationMode(
  character: AlsCharacter,
): AlsCharacter {
  const aiming =
    character.desiredAiming || character.desiredRotationMode === 'Aiming'
  const sprinting =
    character.movement.maxAllowedGait === 'Sprinting'

  if (character.viewMode === 'FirstPerson') {
    if (character.locomotionMode === 'InAir') {
      setRotationMode(
        character,
        aiming && character.settings.allowAimingWhenInAir
          ? 'Aiming'
          : 'ViewDirection',
      )
    } else {
      setRotationMode(
        character,
        aiming
          && (
            !sprinting
            || !character.settings.sprintHasPriorityOverAiming
          )
          ? 'Aiming'
          : 'ViewDirection',
      )
    }
    return character
  }

  if (character.locomotionMode === 'InAir') {
    setRotationMode(
      character,
      aiming
        ? (
            character.settings.allowAimingWhenInAir
              ? 'Aiming'
              : 'ViewDirection'
          )
        : character.desiredRotationMode,
    )
    return character
  }

  if (sprinting) {
    if (aiming && !character.settings.sprintHasPriorityOverAiming) {
      setRotationMode(character, 'Aiming')
    } else if (character.settings.rotateToVelocityWhenSprinting) {
      setRotationMode(character, 'VelocityDirection')
    } else {
      setRotationMode(character, character.desiredRotationMode)
    }
  } else {
    setRotationMode(
      character,
      aiming ? 'Aiming' : character.desiredRotationMode,
    )
  }
  return character
}

export function setStance(
  character: AlsCharacter,
  stance: AlsStance,
): AlsCharacter {
  character.stance = stance
  setMovementStance(character.movement, stance)
  return character
}

/** AAlsCharacter::ApplyDesiredStance(), AlsCharacter.cpp:810-833. */
export function applyDesiredStance(
  character: AlsCharacter,
): AlsCharacter {
  if (character.locomotionAction === null) {
    if (character.locomotionMode === 'Grounded') {
      return setStance(character, character.desiredStance)
    }
    if (character.locomotionMode === 'InAir') {
      return setStance(character, 'Standing')
    }
    return character
  }

  if (
    character.locomotionAction === 'Rolling'
    && character.settings.rollingCrouchOnStart
  ) {
    return setStance(character, 'Crouching')
  }
  return character
}

/**
 * AAlsCharacter::SetLocomotionAction() / NotifyLocomotionActionChanged(),
 * AlsCharacter.cpp:1089-1110.
 */
export function setLocomotionAction(
  character: AlsCharacter,
  locomotionAction: AlsLocomotionAction,
): AlsCharacter {
  if (character.locomotionAction === locomotionAction) return character
  character.locomotionAction = locomotionAction
  if (locomotionAction === null) {
    character.movement.inputBlocked = false
  }
  return applyDesiredStance(character)
}

/**
 * AAlsCharacter::SetLocomotionMode() / NotifyLocomotionModeChanged() /
 * ApplyDesiredStance(), cpp:503-529 and 810-833.
 *
 * An invalid locomotion mode represents MOVE_Custom (mantling). It deliberately leaves stance
 * untouched while an action owns movement.
 */
export function setLocomotionMode(
  character: AlsCharacter,
  locomotionMode: AlsLocomotionMode,
): AlsCharacter {
  if (character.locomotionMode === locomotionMode) return character

  const previousLocomotionMode = character.locomotionMode
  character.locomotionMode = locomotionMode
  applyDesiredStance(character)

  if (
    locomotionMode === 'Grounded'
    && previousLocomotionMode === 'InAir'
  ) {
    startAlsLandingBrakingFriction(
      character.movement,
      character.locomotionState.hasInput,
    )
    // NotifyLocomotionModeChanged() blocks the previous input-facing target after an ordinary
    // landing so the landing animation cannot twist the legs into a spiral.
    character.locomotionState.rotationTowardsLastInputDirectionBlocked = true
  }
  return character
}

/**
 * One bridge-facing character state refresh in ALS Tick order: input → locomotion → gait →
 * rotation mode (AlsCharacter.cpp:291-300). Physics integration remains separately owned by the
 * movement component and Rapier bridge.
 */
export function refreshAlsCharacter(
  character: AlsCharacter,
  inputDirection: Readonly<AlsVector3>,
  velocity: Readonly<AlsVector3>,
  desiredVelocity: Readonly<AlsVector3> = velocity,
): AlsCharacter {
  refreshInput(character, inputDirection)
  refreshLocomotion(character, velocity, desiredVelocity)
  refreshGait(character)
  refreshRotationMode(character)
  return character
}

export type AlsGroundedFacingTargetSource =
  | 'ActorRotation'
  | 'TargetYawAngle'
  | 'DesiredVelocity'
  | 'Velocity'
  | 'ViewRotation'
  | 'ViewRotationWithRotationYawOffset'

export interface AlsGroundedFacingTarget {
  readonly yawAngle: number
  readonly source: AlsGroundedFacingTargetSource
  readonly rotationInterpolationSpeed: number
  readonly targetYawAngleRotationSpeed: number
}

/**
 * AAlsCharacter::CalculateGroundedMovingRotationInterpolationSpeed(), cpp:1775-1796.
 */
export function calculateGroundedMovingRotationInterpolationSpeed(
  baseInterpolationSpeed: number,
  viewYawSpeed: number,
): number {
  const multiplier = 1 + 2 * Math.max(
    0,
    Math.min(1, viewYawSpeed / 300),
  )
  return baseInterpolationSpeed * multiplier
}

function facingTarget(
  yawAngle: number,
  source: AlsGroundedFacingTargetSource,
  rotationInterpolationSpeed: number,
  targetYawAngleRotationSpeed: number,
): AlsGroundedFacingTarget {
  return {
    yawAngle: unwindDegrees(yawAngle),
    source,
    rotationInterpolationSpeed,
    targetYawAngleRotationSpeed,
  }
}

/**
 * Resolves the actor-facing target selected by AAlsCharacter::RefreshGroundedRotation(),
 * cpp:1517-1663. The pose runtime supplies RotationYawOffset; this core supplies the policy and
 * interpolation rates, while the scene bridge applies the resulting yaw to its rigid body.
 */
export function refreshGroundedFacingTarget(
  character: AlsCharacter,
  rotationYawOffset = 0,
): AlsGroundedFacingTarget {
  const state = character.locomotionState
  const movingInterpolationSpeed =
    calculateGroundedMovingRotationInterpolationSpeed(
      character.movement.rotationInterpolationSpeed,
      character.viewYawSpeed,
    )

  if (!state.moving) {
    if (character.rotationMode === 'VelocityDirection') {
      const useTargetYaw =
        state.rotationTowardsLastInputDirectionBlocked
      return facingTarget(
        useTargetYaw
          ? state.targetYawAngle
          : (
              character.settings
                .rotateTowardsDesiredVelocityInVelocityDirectionRotationMode
                ? character.desiredVelocityYawAngle
                : state.velocityYawAngle
            ),
        useTargetYaw
          ? 'TargetYawAngle'
          : (
              character.settings
                .rotateTowardsDesiredVelocityInVelocityDirectionRotationMode
                ? 'DesiredVelocity'
                : 'Velocity'
            ),
        12,
        800,
      )
    }

    if (character.rotationMode === 'ViewDirection') {
      if (
        (
          !state.hasInput
          && state.rotationTowardsLastInputDirectionBlocked
        )
        || !character.settings
          .autoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode
      ) {
        return facingTarget(
          character.actorYawAngle,
          'ActorRotation',
          0,
          0,
        )
      }
      return facingTarget(
        state.hasInput
          ? character.viewYawAngle
          : state.targetYawAngle,
        state.hasInput ? 'ViewRotation' : 'TargetYawAngle',
        movingInterpolationSpeed,
        500,
      )
    }

    if (character.rotationMode === 'Aiming') {
      return facingTarget(
        character.viewYawAngle,
        'ViewRotation',
        0,
        0,
      )
    }

    return facingTarget(character.actorYawAngle, 'ActorRotation', 0, 0)
  }

  if (
    character.rotationMode === 'VelocityDirection'
    && (
      state.hasInput
      || !state.rotationTowardsLastInputDirectionBlocked
    )
  ) {
    state.rotationTowardsLastInputDirectionBlocked = false
    const useDesiredVelocity =
      character.settings
        .rotateTowardsDesiredVelocityInVelocityDirectionRotationMode
    return facingTarget(
      useDesiredVelocity
        ? character.desiredVelocityYawAngle
        : state.velocityYawAngle,
      useDesiredVelocity ? 'DesiredVelocity' : 'Velocity',
      movingInterpolationSpeed,
      800,
    )
  }

  if (
    character.rotationMode === 'ViewDirection'
    && (
      state.hasInput
      || !state.rotationTowardsLastInputDirectionBlocked
    )
  ) {
    state.rotationTowardsLastInputDirectionBlocked = false
    if (character.gait === 'Sprinting') {
      return facingTarget(
        state.velocityYawAngle,
        'Velocity',
        movingInterpolationSpeed,
        500,
      )
    }
    return facingTarget(
      character.viewYawAngle + rotationYawOffset,
      'ViewRotationWithRotationYawOffset',
      movingInterpolationSpeed,
      500,
    )
  }

  if (character.rotationMode === 'Aiming') {
    return facingTarget(
      character.viewYawAngle,
      'ViewRotation',
      20,
      1000,
    )
  }

  return facingTarget(character.actorYawAngle, 'ActorRotation', 0, 0)
}

/**
 * AAlsCharacter::ApplyRotationYawSpeedAnimationCurve(), cpp:1798-1810.
 * RotationYawSpeed is degrees/second and only the caller's grounded-not-moving branch applies it.
 */
export function applyRotationYawSpeedAnimationCurve(
  actorYawAngle: number,
  rotationYawSpeed: number,
  deltaTime: number,
): number {
  const deltaYawAngle = rotationYawSpeed * Math.max(0, deltaTime)
  return Math.abs(deltaYawAngle) > UE_SMALL_NUMBER
    ? unwindDegrees(actorYawAngle + deltaYawAngle)
    : unwindDegrees(actorYawAngle)
}

/**
 * AAlsCharacter::SetTargetYawAngle(), cpp:1921-1927.
 */
export function setTargetYawAngle(
  character: AlsCharacter,
  targetYawAngle: number,
): AlsCharacter {
  const target = unwindDegrees(targetYawAngle)
  character.locomotionState.targetYawAngle = target
  character.locomotionState.smoothTargetYawAngle = target
  character.locomotionState.viewRelativeTargetYawAngle = unwindDegrees(
    character.viewYawAngle - target,
  )
  return character
}
