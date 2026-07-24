import {
  ALS_MOVEMENT_SETTINGS,
  sampleGroundedMovementParameters,
} from './Settings/AlsMovementSettings'
import type {
  AlsGait,
  AlsMovementGaitSettings,
  AlsRotationMode,
  AlsStance,
} from './Settings/AlsMovementSettings'
import type { AlsVector3 } from './State/AlsLocomotionState'

/**
 * MS_Als_Normal keeps direction-dependent movement disabled, but this authored range remains part
 * of UAlsMovementSettings and the component policy supports it for compatible ALS data assets.
 * AlsMovementSettings.h:72-75.
 */
export const ALS_VELOCITY_ANGLE_TO_SPEED_INTERPOLATION_RANGE =
  [100, 125] as const

/**
 * `bAllowDirectionDependentMovementSpeed` is false in every MS_Als_Normal gait record. Keeping it
 * as an optional ALS-named extension lets a future authored settings asset enable the exact
 * component branch without changing the current settings API.
 */
export type AlsCharacterMovementGaitSettings = AlsMovementGaitSettings & {
  readonly allowDirectionDependentMovementSpeed?: boolean
}

export interface AlsDirectionDependentGaitSpeeds {
  readonly walkSpeed: number
  readonly runSpeed: number
}

export interface AlsCharacterMovementComponent {
  rotationMode: AlsRotationMode
  stance: AlsStance
  maxAllowedGait: AlsGait
  gaitSettings: AlsCharacterMovementGaitSettings
  gaitAmount: number
  maxWalkSpeed: number
  maxAccelerationWalking: number
  brakingDecelerationWalking: number
  groundFriction: number
  rotationInterpolationSpeed: number
  inputBlocked: boolean
  readonly velocity: AlsVector3
}

export interface CreateAlsCharacterMovementComponentOptions {
  readonly rotationMode?: AlsRotationMode
  readonly stance?: AlsStance
  readonly maxAllowedGait?: AlsGait
  readonly velocity?: Readonly<AlsVector3>
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function mapRangeClamped(
  value: number,
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
): number {
  if (inputMaximum <= inputMinimum) {
    return value <= inputMinimum ? outputMinimum : outputMaximum
  }
  const amount = clamp(
    (value - inputMinimum) / (inputMaximum - inputMinimum),
    0,
    1,
  )
  return outputMinimum + (outputMaximum - outputMinimum) * amount
}

function unrotatePlanar(
  vector: Readonly<AlsVector3>,
  yawAngle: number,
): { x: number; y: number } {
  const radians = yawAngle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    x: vector.x * cosine + vector.y * sine,
    y: -vector.x * sine + vector.y * cosine,
  }
}

/**
 * Mirrors UAlsCharacterMovementComponent::RefreshGroundedMovementSettings() lines 949-979.
 * The current MS_Als_Normal asset takes the disabled branch and therefore returns forward speeds.
 */
export function calculateDirectionDependentGaitSpeeds(
  gaitSettings: AlsCharacterMovementGaitSettings,
  velocity: Readonly<AlsVector3>,
  viewYawAngle: number,
  interpolationRange:
    readonly [number, number] =
      ALS_VELOCITY_ANGLE_TO_SPEED_INTERPOLATION_RANGE,
): AlsDirectionDependentGaitSpeeds {
  if (
    gaitSettings.allowDirectionDependentMovementSpeed !== true
    || velocity.x * velocity.x + velocity.y * velocity.y <= 1e-4
  ) {
    return {
      walkSpeed: gaitSettings.walkForwardSpeed,
      runSpeed: gaitSettings.runForwardSpeed,
    }
  }

  const relativeVelocity = unrotatePlanar(velocity, viewYawAngle)
  const velocityAngle = Math.atan2(
    relativeVelocity.y,
    relativeVelocity.x,
  ) * 180 / Math.PI
  const forwardSpeedAmount = mapRangeClamped(
    Math.abs(velocityAngle),
    interpolationRange[0],
    interpolationRange[1],
    1,
    0,
  )

  return {
    walkSpeed: gaitSettings.walkBackwardSpeed
      + (gaitSettings.walkForwardSpeed - gaitSettings.walkBackwardSpeed)
      * forwardSpeedAmount,
    runSpeed: gaitSettings.runBackwardSpeed
      + (gaitSettings.runForwardSpeed - gaitSettings.runBackwardSpeed)
      * forwardSpeedAmount,
  }
}

/** FAlsMovementGaitSettings::GetMaxWalkSpeed(), AlsMovementSettings.h:91-96. */
export function getMaxWalkSpeed(
  gaitSettings: AlsCharacterMovementGaitSettings,
): number {
  return gaitSettings.allowDirectionDependentMovementSpeed === true
    ? Math.max(
        gaitSettings.walkForwardSpeed,
        gaitSettings.walkBackwardSpeed,
      )
    : gaitSettings.walkForwardSpeed
}

/** FAlsMovementGaitSettings::GetMaxRunSpeed(), AlsMovementSettings.h:98-103. */
export function getMaxRunSpeed(
  gaitSettings: AlsCharacterMovementGaitSettings,
): number {
  return gaitSettings.allowDirectionDependentMovementSpeed === true
    ? Math.max(gaitSettings.runForwardSpeed, gaitSettings.runBackwardSpeed)
    : gaitSettings.runForwardSpeed
}

/**
 * Maps speed to ALS's 0=stopped, 1=walking, 2=running, 3=sprinting gait domain.
 * AlsCharacterMovementComponent.cpp:981-997.
 */
export function calculateGaitAmount(
  speed: number,
  walkSpeed: number,
  runSpeed: number,
  sprintSpeed: number,
): number {
  if (speed > runSpeed) {
    return mapRangeClamped(speed, runSpeed, sprintSpeed, 2, 3)
  }
  if (speed > walkSpeed) {
    return mapRangeClamped(speed, walkSpeed, runSpeed, 1, 2)
  }
  return mapRangeClamped(speed, 0, walkSpeed, 0, 1)
}

export function createAlsCharacterMovementComponent(
  options: CreateAlsCharacterMovementComponentOptions = {},
): AlsCharacterMovementComponent {
  const rotationMode = options.rotationMode ?? 'ViewDirection'
  const stance = options.stance ?? 'Standing'
  const sourceVelocity = options.velocity ?? { x: 0, y: 0, z: 0 }
  const component: AlsCharacterMovementComponent = {
    rotationMode,
    stance,
    maxAllowedGait: options.maxAllowedGait ?? 'Running',
    gaitSettings: ALS_MOVEMENT_SETTINGS[rotationMode][stance],
    gaitAmount: 0,
    maxWalkSpeed: 0,
    maxAccelerationWalking: 0,
    brakingDecelerationWalking: 0,
    groundFriction: 0,
    rotationInterpolationSpeed: 0,
    inputBlocked: false,
    velocity: {
      x: sourceVelocity.x,
      y: sourceVelocity.y,
      z: sourceVelocity.z,
    },
  }
  return refreshGroundedMovementSettings(component, 0)
}

/** UAlsCharacterMovementComponent::RefreshGaitSettings(), cpp:914-925. */
export function refreshGaitSettings(
  component: AlsCharacterMovementComponent,
): AlsCharacterMovementComponent {
  component.gaitSettings =
    ALS_MOVEMENT_SETTINGS[component.rotationMode][component.stance]
  return component
}

export function setMovementRotationMode(
  component: AlsCharacterMovementComponent,
  rotationMode: AlsRotationMode,
): AlsCharacterMovementComponent {
  if (component.rotationMode !== rotationMode) {
    component.rotationMode = rotationMode
    refreshGaitSettings(component)
  }
  return component
}

export function setMovementStance(
  component: AlsCharacterMovementComponent,
  stance: AlsStance,
): AlsCharacterMovementComponent {
  if (component.stance !== stance) {
    component.stance = stance
    refreshGaitSettings(component)
  }
  return component
}

export function setMaxAllowedGait(
  component: AlsCharacterMovementComponent,
  maxAllowedGait: AlsGait,
): AlsCharacterMovementComponent {
  component.maxAllowedGait = maxAllowedGait
  return component
}

export function setMovementVelocity(
  component: AlsCharacterMovementComponent,
  velocity: Readonly<AlsVector3>,
): AlsCharacterMovementComponent {
  component.velocity.x = velocity.x
  component.velocity.y = velocity.y
  component.velocity.z = velocity.z
  return component
}

/**
 * Direct policy port of UAlsCharacterMovementComponent::RefreshGroundedMovementSettings(),
 * cpp:947-1031. It resolves direction-aware thresholds, GaitAmount, maximum speed, and the
 * authored movement/rotation curve samples before ground velocity is integrated.
 */
export function refreshGroundedMovementSettings(
  component: AlsCharacterMovementComponent,
  viewYawAngle: number,
): AlsCharacterMovementComponent {
  const { walkSpeed, runSpeed } = calculateDirectionDependentGaitSpeeds(
    component.gaitSettings,
    component.velocity,
    viewYawAngle,
  )
  const speed = Math.hypot(component.velocity.x, component.velocity.y)
  component.gaitAmount = calculateGaitAmount(
    speed,
    walkSpeed,
    runSpeed,
    component.gaitSettings.sprintSpeed,
  )

  if (component.maxAllowedGait === 'Walking') {
    component.maxWalkSpeed = walkSpeed
  } else if (component.maxAllowedGait === 'Running') {
    component.maxWalkSpeed = runSpeed
  } else {
    component.maxWalkSpeed = component.gaitSettings.sprintSpeed
  }

  const parameters = sampleGroundedMovementParameters(
    component.gaitSettings,
    component.gaitAmount,
  )
  component.maxAccelerationWalking = parameters.maxAcceleration
  component.brakingDecelerationWalking = parameters.brakingDeceleration
  component.groundFriction = parameters.groundFriction
  component.rotationInterpolationSpeed =
    parameters.rotationInterpolationSpeed
  return component
}

function brakePlanarVelocity(
  component: AlsCharacterMovementComponent,
  deltaTime: number,
): number {
  const speed = Math.hypot(component.velocity.x, component.velocity.y)
  if (speed <= Number.EPSILON) {
    component.velocity.x = 0
    component.velocity.y = 0
    return 0
  }

  const newSpeed = Math.max(
    0,
    speed - component.brakingDecelerationWalking * deltaTime,
  )
  const amount = newSpeed / speed
  component.velocity.x *= amount
  component.velocity.y *= amount
  return newSpeed
}

/**
 * Advances horizontal grounded velocity and leaves Z for the Rapier bridge.
 *
 * ORIGINAL WEB RUNTIME: ALS calls UCharacterMovementComponent::CalcVelocity() for integration
 * (AlsCharacterMovementComponent.cpp:278-289), whose implementation is engine-owned and absent
 * from ALS Refactored. This deterministic web integrator is therefore not claimed as UE numeric
 * parity. It does preserve every policy ALS exposes here: curve-selected acceleration/braking/
 * ground-friction, analog input, frictional steering, maximum-gait speed, no default frictional
 * braking (constructor lines 145-153), and gradual braking when max gait is lowered.
 */
export function stepGroundedVelocity(
  component: AlsCharacterMovementComponent,
  inputVector: Readonly<AlsVector3>,
  deltaTime: number,
  viewYawAngle: number,
): AlsVector3 {
  refreshGroundedMovementSettings(component, viewYawAngle)

  const delta = Math.max(0, deltaTime)
  if (delta <= 0) return component.velocity

  let inputX = component.inputBlocked ? 0 : inputVector.x
  let inputY = component.inputBlocked ? 0 : inputVector.y
  let inputAmount = Math.hypot(inputX, inputY)
  if (inputAmount > 1) {
    inputX /= inputAmount
    inputY /= inputAmount
    inputAmount = 1
  }

  const hasInput = inputAmount > Number.EPSILON
  const inputDirectionX = hasInput ? inputX / inputAmount : 0
  const inputDirectionY = hasInput ? inputY / inputAmount : 0
  const previousSpeed = Math.hypot(
    component.velocity.x,
    component.velocity.y,
  )
  const exceedingMaxSpeed =
    previousSpeed > component.maxWalkSpeed + Number.EPSILON

  let accelerationSpeedCap = component.maxWalkSpeed
  if (!hasInput || exceedingMaxSpeed) {
    const speedAfterBraking = brakePlanarVelocity(component, delta)
    if (exceedingMaxSpeed) {
      // Preserve ALS's "actual gait lags until deceleration" behavior instead of snapping a
      // running velocity to a newly selected walk cap (AlsCharacter.cpp:991-1004).
      accelerationSpeedCap = Math.max(
        component.maxWalkSpeed,
        speedAfterBraking,
      )
    }
  } else if (previousSpeed > Number.EPSILON) {
    const steeringAmount = clamp(component.groundFriction * delta, 0, 1)
    component.velocity.x += (
      inputDirectionX * previousSpeed - component.velocity.x
    ) * steeringAmount
    component.velocity.y += (
      inputDirectionY * previousSpeed - component.velocity.y
    ) * steeringAmount
  }

  if (hasInput) {
    const acceleration =
      component.maxAccelerationWalking * inputAmount * delta
    component.velocity.x += inputDirectionX * acceleration
    component.velocity.y += inputDirectionY * acceleration

    const acceleratedSpeed = Math.hypot(
      component.velocity.x,
      component.velocity.y,
    )
    if (
      acceleratedSpeed > accelerationSpeedCap
      && acceleratedSpeed > Number.EPSILON
    ) {
      const amount = accelerationSpeedCap / acceleratedSpeed
      component.velocity.x *= amount
      component.velocity.y *= amount
    }
  }

  return component.velocity
}
