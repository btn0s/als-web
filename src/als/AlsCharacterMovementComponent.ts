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

/** UAlsCharacterMovementComponent constructor, cpp:143 and 148. */
export const ALS_AIR_CONTROL = 0.15
export const ALS_MAX_ACCELERATION = 20
export const ALS_MIN_ANALOG_WALK_SPEED = 0.25

/** UAlsCharacterMovementComponent constructor, cpp:159-162. */
export const ALS_PERCH_RADIUS_THRESHOLD = 0.15
export const ALS_PERCH_ADDITIONAL_HEIGHT = 0

/** AAlsCharacter::NotifyLocomotionModeChanged(), cpp:540-552. */
export const ALS_HAS_INPUT_BRAKING_FRICTION_FACTOR = 0.5
export const ALS_NO_INPUT_BRAKING_FRICTION_FACTOR = 3
export const ALS_BRAKING_FRICTION_FACTOR_RESET_DELAY = 0.5

/** UCharacterMovementComponent defaults inherited by UAlsCharacterMovementComponent. */
export const UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_MULTIPLIER = 2
export const UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_VELOCITY_THRESHOLD = 0.25
export const UE_CHARACTER_MOVEMENT_BRAKING_SUB_STEP_TIME = 1 / 33
export const UE_CHARACTER_MOVEMENT_BRAKE_TO_STOP_VELOCITY = 0.1
export const UE_CHARACTER_MOVEMENT_MIN_TICK_TIME = 1e-6
// UCharacterMovementComponent::MaxStepHeight; B_Als_Character serializes no override.
export const UE_CHARACTER_MOVEMENT_MAX_STEP_HEIGHT = 0.45

/**
 * `bAllowDirectionDependentMovementSpeed` is false in every MS_Als_Normal gait record. Keeping it
 * as an optional ALS-named extension lets a future authored settings asset enable the exact
 * component branch without changing the current settings API.
 */
export type AlsCharacterMovementGaitSettings = AlsMovementGaitSettings & {
  readonly allowDirectionDependentMovementSpeed?: boolean
}

export type AlsGaitSpeedOverrides = Partial<Record<AlsStance, Partial<Pick<AlsMovementGaitSettings,
  'walkForwardSpeed' | 'walkBackwardSpeed' | 'runForwardSpeed' | 'runBackwardSpeed' | 'sprintSpeed'
>>>>

export interface AlsDirectionDependentGaitSpeeds {
  readonly walkSpeed: number
  readonly runSpeed: number
}

export interface AlsCharacterMovementComponent {
  rotationMode: AlsRotationMode
  stance: AlsStance
  maxAllowedGait: AlsGait
  gaitSettings: AlsCharacterMovementGaitSettings
  gaitSpeedOverrides?: AlsGaitSpeedOverrides
  gaitAmount: number
  maxWalkSpeed: number
  maxAccelerationWalking: number
  brakingDecelerationWalking: number
  groundFriction: number
  rotationInterpolationSpeed: number
  airControl: number
  maxAcceleration: number
  minAnalogWalkSpeed: number
  airControlBoostMultiplier: number
  airControlBoostVelocityThreshold: number
  brakingFrictionFactor: number
  brakingFrictionFactorResetTime: number
  brakingSubStepTime: number
  maxStepHeight: number
  perchRadiusThreshold: number
  perchAdditionalHeight: number
  inputBlocked: boolean
  readonly velocity: AlsVector3
}

export interface CreateAlsCharacterMovementComponentOptions {
  readonly rotationMode?: AlsRotationMode
  readonly stance?: AlsStance
  readonly maxAllowedGait?: AlsGait
  readonly velocity?: Readonly<AlsVector3>
  readonly gaitSpeedOverrides?: AlsGaitSpeedOverrides
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
    gaitSettings: { ...ALS_MOVEMENT_SETTINGS[rotationMode][stance], ...options.gaitSpeedOverrides?.[stance] },
    gaitSpeedOverrides: options.gaitSpeedOverrides,
    gaitAmount: 0,
    maxWalkSpeed: 0,
    maxAccelerationWalking: 0,
    brakingDecelerationWalking: 0,
    groundFriction: 0,
    rotationInterpolationSpeed: 0,
    airControl: ALS_AIR_CONTROL,
    maxAcceleration: ALS_MAX_ACCELERATION,
    minAnalogWalkSpeed: ALS_MIN_ANALOG_WALK_SPEED,
    airControlBoostMultiplier:
      UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_MULTIPLIER,
    airControlBoostVelocityThreshold:
      UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_VELOCITY_THRESHOLD,
    brakingFrictionFactor: 0,
    brakingFrictionFactorResetTime: 0,
    brakingSubStepTime: UE_CHARACTER_MOVEMENT_BRAKING_SUB_STEP_TIME,
    maxStepHeight: UE_CHARACTER_MOVEMENT_MAX_STEP_HEIGHT,
    perchRadiusThreshold: ALS_PERCH_RADIUS_THRESHOLD,
    perchAdditionalHeight: ALS_PERCH_ADDITIONAL_HEIGHT,
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
  component.gaitSettings = {
    ...ALS_MOVEMENT_SETTINGS[component.rotationMode][component.stance],
    ...component.gaitSpeedOverrides?.[component.stance],
  }
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

function isExceedingMaxPlanarSpeed(
  component: AlsCharacterMovementComponent,
  maxSpeed: number,
): boolean {
  const clampedMaxSpeed = Math.max(0, maxSpeed)
  return (
    component.velocity.x * component.velocity.x
      + component.velocity.y * component.velocity.y
    > clampedMaxSpeed * clampedMaxSpeed * 1.01
  )
}

/**
 * Planar form of UCharacterMovementComponent::ApplyVelocityBraking().
 *
 * PhysWalking and PhysFalling both remove gravity-axis velocity before CalcVelocity(). The
 * Rapier bridge owns that axis, so this port applies the identical friction/deceleration loop to
 * X/Y while preserving Z.
 */
export function applyPlanarVelocityBraking(
  component: AlsCharacterMovementComponent,
  deltaTime: number,
  friction: number,
  brakingDeceleration: number,
): AlsVector3 {
  const speedSquared =
    component.velocity.x * component.velocity.x
    + component.velocity.y * component.velocity.y
  if (
    speedSquared === 0
    || deltaTime < UE_CHARACTER_MOVEMENT_MIN_TICK_TIME
  ) {
    return component.velocity
  }

  const frictionFactor = Math.max(0, component.brakingFrictionFactor)
  const actualFriction = Math.max(0, friction * frictionFactor)
  const actualBrakingDeceleration = Math.max(
    0,
    brakingDeceleration,
  )
  const zeroFriction = actualFriction === 0
  const zeroBraking = actualBrakingDeceleration === 0
  if (zeroFriction && zeroBraking) return component.velocity

  const oldVelocityX = component.velocity.x
  const oldVelocityY = component.velocity.y
  const oldSpeed = Math.sqrt(speedSquared)
  const reverseAccelerationX = zeroBraking
    ? 0
    : -actualBrakingDeceleration * oldVelocityX / oldSpeed
  const reverseAccelerationY = zeroBraking
    ? 0
    : -actualBrakingDeceleration * oldVelocityY / oldSpeed
  let remainingTime = deltaTime
  const maximumTimeStep = clamp(
    component.brakingSubStepTime,
    1 / 75,
    1 / 20,
  )

  while (remainingTime >= UE_CHARACTER_MOVEMENT_MIN_TICK_TIME) {
    const timeStep = remainingTime > maximumTimeStep && !zeroFriction
      ? Math.min(maximumTimeStep, remainingTime * 0.5)
      : remainingTime
    remainingTime -= timeStep
    component.velocity.x += (
      -actualFriction * component.velocity.x + reverseAccelerationX
    ) * timeStep
    component.velocity.y += (
      -actualFriction * component.velocity.y + reverseAccelerationY
    ) * timeStep

    if (
      component.velocity.x * oldVelocityX
        + component.velocity.y * oldVelocityY
      <= 0
    ) {
      component.velocity.x = 0
      component.velocity.y = 0
      return component.velocity
    }
  }

  const newSpeedSquared =
    component.velocity.x * component.velocity.x
    + component.velocity.y * component.velocity.y
  // UE_KINDA_SMALL_NUMBER is tested against cm². 1e-4 cm² equals 1e-8 m².
  if (
    newSpeedSquared <= 1e-8
    || (
      !zeroBraking
      && newSpeedSquared
        <= UE_CHARACTER_MOVEMENT_BRAKE_TO_STOP_VELOCITY ** 2
    )
  ) {
    component.velocity.x = 0
    component.velocity.y = 0
  }
  return component.velocity
}

function clampPlanarVelocity(
  component: AlsCharacterMovementComponent,
  maximumSpeed: number,
): void {
  const speed = Math.hypot(component.velocity.x, component.velocity.y)
  if (speed <= maximumSpeed || speed <= Number.EPSILON) return
  const amount = maximumSpeed / speed
  component.velocity.x *= amount
  component.velocity.y *= amount
}

/**
 * The player-controlled, no-path-following branch of
 * UCharacterMovementComponent::CalcVelocity().
 */
export function calcPlanarVelocity(
  component: AlsCharacterMovementComponent,
  inputVector: Readonly<AlsVector3>,
  deltaTime: number,
  friction: number,
  brakingDeceleration: number,
  maxAcceleration: number,
  analogInputModifier?: number,
): AlsVector3 {
  if (deltaTime < UE_CHARACTER_MOVEMENT_MIN_TICK_TIME) {
    return component.velocity
  }

  let inputX = component.inputBlocked ? 0 : inputVector.x
  let inputY = component.inputBlocked ? 0 : inputVector.y
  const unclampedInputAmount = Math.hypot(inputX, inputY)
  if (unclampedInputAmount > 1) {
    inputX /= unclampedInputAmount
    inputY /= unclampedInputAmount
  }
  const inputAmount = Math.min(unclampedInputAmount, 1)
  const accelerationX = inputX * maxAcceleration
  const accelerationY = inputY * maxAcceleration
  const zeroAcceleration = accelerationX === 0 && accelerationY === 0
  const maxInputSpeed = Math.max(
    component.maxWalkSpeed
      * clamp(analogInputModifier ?? inputAmount, 0, 1),
    component.minAnalogWalkSpeed,
  )
  const velocityOverMax = isExceedingMaxPlanarSpeed(
    component,
    maxInputSpeed,
  )

  if (zeroAcceleration || velocityOverMax) {
    const oldVelocityX = component.velocity.x
    const oldVelocityY = component.velocity.y
    applyPlanarVelocityBraking(
      component,
      deltaTime,
      Math.max(0, friction),
      brakingDeceleration,
    )

    const newSpeedSquared =
      component.velocity.x * component.velocity.x
      + component.velocity.y * component.velocity.y
    if (
      velocityOverMax
      && newSpeedSquared < maxInputSpeed * maxInputSpeed
      && accelerationX * oldVelocityX + accelerationY * oldVelocityY > 0
    ) {
      const oldSpeed = Math.hypot(oldVelocityX, oldVelocityY)
      if (oldSpeed > Number.EPSILON) {
        component.velocity.x = oldVelocityX / oldSpeed * maxInputSpeed
        component.velocity.y = oldVelocityY / oldSpeed * maxInputSpeed
      }
    }
  } else {
    const accelerationAmount = Math.hypot(accelerationX, accelerationY)
    const velocityAmount = Math.hypot(
      component.velocity.x,
      component.velocity.y,
    )
    if (accelerationAmount > Number.EPSILON) {
      const accelerationDirectionX = accelerationX / accelerationAmount
      const accelerationDirectionY = accelerationY / accelerationAmount
      const steeringAmount = Math.min(
        deltaTime * Math.max(0, friction),
        1,
      )
      component.velocity.x -= (
        component.velocity.x
        - accelerationDirectionX * velocityAmount
      ) * steeringAmount
      component.velocity.y -= (
        component.velocity.y
        - accelerationDirectionY * velocityAmount
      ) * steeringAmount
    }
  }

  if (!zeroAcceleration) {
    const currentSpeed = Math.hypot(
      component.velocity.x,
      component.velocity.y,
    )
    const newMaxInputSpeed = isExceedingMaxPlanarSpeed(
      component,
      maxInputSpeed,
    )
      ? currentSpeed
      : maxInputSpeed
    component.velocity.x += accelerationX * deltaTime
    component.velocity.y += accelerationY * deltaTime
    clampPlanarVelocity(component, newMaxInputSpeed)
  }
  return component.velocity
}

export function startAlsLandingBrakingFriction(
  component: AlsCharacterMovementComponent,
  hasInput: boolean,
): void {
  component.brakingFrictionFactor = hasInput
    ? ALS_HAS_INPUT_BRAKING_FRICTION_FACTOR
    : ALS_NO_INPUT_BRAKING_FRICTION_FACTOR
  component.brakingFrictionFactorResetTime =
    ALS_BRAKING_FRICTION_FACTOR_RESET_DELAY
}

function advanceAlsLandingBrakingFriction(
  component: AlsCharacterMovementComponent,
  deltaTime: number,
): void {
  if (component.brakingFrictionFactorResetTime <= 0) return
  component.brakingFrictionFactorResetTime = Math.max(
    0,
    component.brakingFrictionFactorResetTime - Math.max(0, deltaTime),
  )
  if (
    component.brakingFrictionFactorResetTime
      < UE_CHARACTER_MOVEMENT_MIN_TICK_TIME
  ) {
    component.brakingFrictionFactorResetTime = 0
    component.brakingFrictionFactor = 0
  }
}

/**
 * Advances horizontal grounded velocity and leaves Z for the Rapier bridge.
 *
 * UAlsCharacterMovementComponent::CalcVelocity() delegates to UE's CalcVelocity after rotating
 * moving-base velocity. This port executes that player-input branch exactly; moving bases,
 * path-following requests, root motion, fluids, and RVO remain outside this standalone bridge.
 */
export function stepGroundedVelocity(
  component: AlsCharacterMovementComponent,
  inputVector: Readonly<AlsVector3>,
  deltaTime: number,
  viewYawAngle: number,
): AlsVector3 {
  refreshGroundedMovementSettings(component, viewYawAngle)

  calcPlanarVelocity(
    component,
    inputVector,
    Math.max(0, deltaTime),
    component.groundFriction,
    component.brakingDecelerationWalking,
    component.maxAccelerationWalking,
  )
  advanceAlsLandingBrakingFriction(component, deltaTime)
  return component.velocity
}

/**
 * Advances horizontal falling velocity and leaves vertical integration to Rapier.
 *
 * ALS pins AirControl to 0.15 and the non-grounded MaxAcceleration to 2000 cm/s², then delegates
 * falling integration to UCharacterMovementComponent::PhysFalling(). This ports its lateral
 * CalcVelocity branch, including inherited analog speed limiting and low-speed AirControlBoost.
 * Rapier remains responsible for gravity and collision.
 */
export function stepInAirVelocity(
  component: AlsCharacterMovementComponent,
  inputVector: Readonly<AlsVector3>,
  deltaTime: number,
): AlsVector3 {
  const lateralSpeed = Math.hypot(
    component.velocity.x,
    component.velocity.y,
  )
  let inputX = inputVector.x
  let inputY = inputVector.y
  const rawInputAmount = Math.hypot(inputX, inputY)
  const analogInputModifier = Math.min(rawInputAmount, 1)
  if (rawInputAmount > 1) {
    inputX /= rawInputAmount
    inputY /= rawInputAmount
  }
  const airControl = (
    component.airControlBoostMultiplier > 0
    && lateralSpeed
      < component.airControlBoostVelocityThreshold
  )
    ? Math.min(
        1,
        component.airControl
          * component.airControlBoostMultiplier,
      )
    : component.airControl
  calcPlanarVelocity(
    component,
    {
      x: inputX * airControl,
      y: inputY * airControl,
      z: 0,
    },
    Math.max(0, deltaTime),
    0,
    0,
    component.maxAcceleration,
    analogInputModifier,
  )
  return component.velocity
}
