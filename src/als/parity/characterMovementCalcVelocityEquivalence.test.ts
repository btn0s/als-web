import { describe, expect, it } from 'vitest'
import {
  calcPlanarVelocity,
  createAlsCharacterMovementComponent,
} from '../AlsCharacterMovementComponent'

interface OracleInput {
  velocityX: number
  velocityY: number
  inputX: number
  inputY: number
  inputBlocked: boolean
  deltaTime: number
  friction: number
  brakingDeceleration: number
  maxAcceleration: number
  maxSpeed: number
  minAnalogSpeed: number
  analogInputModifier: number
  brakingFrictionFactor: number
  brakingSubStepTime: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/*
 * Test-only line-mirroring transliteration of UE 5.5
 * UCharacterMovementComponent::CalcVelocity()/ApplyVelocityBraking().
 * It intentionally does not import implementation helpers.
 */
function ueCalcVelocityOracle(input: Readonly<OracleInput>): {
  x: number
  y: number
} {
  let velocityX = input.velocityX
  let velocityY = input.velocityY
  if (input.deltaTime < 1e-6) return { x: velocityX, y: velocityY }

  let controlX = input.inputBlocked ? 0 : input.inputX
  let controlY = input.inputBlocked ? 0 : input.inputY
  const controlAmount = Math.hypot(controlX, controlY)
  if (controlAmount > 1) {
    controlX /= controlAmount
    controlY /= controlAmount
  }
  const accelerationX = controlX * input.maxAcceleration
  const accelerationY = controlY * input.maxAcceleration
  const zeroAcceleration = accelerationX === 0 && accelerationY === 0
  const maxInputSpeed = Math.max(
    input.maxSpeed * clamp(input.analogInputModifier, 0, 1),
    input.minAnalogSpeed,
  )
  const exceeds = (maximumSpeed: number): boolean => (
    velocityX * velocityX + velocityY * velocityY
      > Math.max(0, maximumSpeed) ** 2 * 1.01
  )
  const velocityOverMax = exceeds(maxInputSpeed)

  if (zeroAcceleration || velocityOverMax) {
    const oldVelocityX = velocityX
    const oldVelocityY = velocityY
    const oldSpeedSquared =
      oldVelocityX * oldVelocityX + oldVelocityY * oldVelocityY
    if (oldSpeedSquared !== 0) {
      const actualFriction = Math.max(
        0,
        Math.max(0, input.friction)
          * Math.max(0, input.brakingFrictionFactor),
      )
      const actualBrakingDeceleration = Math.max(
        0,
        input.brakingDeceleration,
      )
      const zeroFriction = actualFriction === 0
      const zeroBraking = actualBrakingDeceleration === 0
      if (!zeroFriction || !zeroBraking) {
        const oldSpeed = Math.sqrt(oldSpeedSquared)
        const reverseAccelerationX = zeroBraking
          ? 0
          : -actualBrakingDeceleration * oldVelocityX / oldSpeed
        const reverseAccelerationY = zeroBraking
          ? 0
          : -actualBrakingDeceleration * oldVelocityY / oldSpeed
        let remainingTime = input.deltaTime
        const maximumTimeStep = clamp(
          input.brakingSubStepTime,
          1 / 75,
          1 / 20,
        )
        while (remainingTime >= 1e-6) {
          const timeStep = remainingTime > maximumTimeStep && !zeroFriction
            ? Math.min(maximumTimeStep, remainingTime * 0.5)
            : remainingTime
          remainingTime -= timeStep
          velocityX += (
            -actualFriction * velocityX + reverseAccelerationX
          ) * timeStep
          velocityY += (
            -actualFriction * velocityY + reverseAccelerationY
          ) * timeStep
          if (velocityX * oldVelocityX + velocityY * oldVelocityY <= 0) {
            velocityX = 0
            velocityY = 0
            break
          }
        }
        const speedSquared = velocityX * velocityX + velocityY * velocityY
        if (
          speedSquared <= 1e-8
          || (!zeroBraking && speedSquared <= 0.1 ** 2)
        ) {
          velocityX = 0
          velocityY = 0
        }
      }
    }

    if (
      velocityOverMax
      && velocityX * velocityX + velocityY * velocityY
        < maxInputSpeed * maxInputSpeed
      && accelerationX * oldVelocityX + accelerationY * oldVelocityY > 0
    ) {
      const oldSpeed = Math.hypot(oldVelocityX, oldVelocityY)
      if (oldSpeed > Number.EPSILON) {
        velocityX = oldVelocityX / oldSpeed * maxInputSpeed
        velocityY = oldVelocityY / oldSpeed * maxInputSpeed
      }
    }
  } else {
    const accelerationAmount = Math.hypot(accelerationX, accelerationY)
    if (accelerationAmount > Number.EPSILON) {
      const velocityAmount = Math.hypot(velocityX, velocityY)
      const steeringAmount = Math.min(
        input.deltaTime * Math.max(0, input.friction),
        1,
      )
      velocityX -= (
        velocityX - accelerationX / accelerationAmount * velocityAmount
      ) * steeringAmount
      velocityY -= (
        velocityY - accelerationY / accelerationAmount * velocityAmount
      ) * steeringAmount
    }
  }

  if (!zeroAcceleration) {
    const currentSpeed = Math.hypot(velocityX, velocityY)
    const newMaxInputSpeed = exceeds(maxInputSpeed)
      ? currentSpeed
      : maxInputSpeed
    velocityX += accelerationX * input.deltaTime
    velocityY += accelerationY * input.deltaTime
    const newSpeed = Math.hypot(velocityX, velocityY)
    if (newSpeed > newMaxInputSpeed && newSpeed > Number.EPSILON) {
      velocityX *= newMaxInputSpeed / newSpeed
      velocityY *= newMaxInputSpeed / newSpeed
    }
  }
  return { x: velocityX, y: velocityY }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 0x100000000
  }
}

describe('CharacterMovement CalcVelocity differential', () => {
  it('matches the UE 5.5 player-input branch over deterministic state space', () => {
    const random = createRandom(0x41534c)
    const range = (minimum: number, maximum: number) =>
      minimum + (maximum - minimum) * random()
    const deltas = [0, 1e-7, 1 / 120, 1 / 60, 1 / 30, 0.1]
    const frictionFactors = [0, 0.5, 3]

    for (let index = 0; index < 512; index += 1) {
      const oracleInput: OracleInput = {
        velocityX: range(-8, 8),
        velocityY: range(-8, 8),
        inputX: range(-1.5, 1.5),
        inputY: range(-1.5, 1.5),
        inputBlocked: random() < 0.1,
        deltaTime: deltas[Math.floor(random() * deltas.length)],
        friction: range(-1, 8),
        brakingDeceleration: range(-1, 20),
        maxAcceleration: range(0, 20),
        maxSpeed: range(0.25, 6.5),
        minAnalogSpeed: 0.25,
        analogInputModifier: range(0, 1),
        brakingFrictionFactor:
          frictionFactors[Math.floor(random() * frictionFactors.length)],
        brakingSubStepTime: 1 / 33,
      }
      const expected = ueCalcVelocityOracle(oracleInput)
      const component = createAlsCharacterMovementComponent({
        velocity: {
          x: oracleInput.velocityX,
          y: oracleInput.velocityY,
          z: range(-10, 10),
        },
      })
      const originalZ = component.velocity.z
      component.maxWalkSpeed = oracleInput.maxSpeed
      component.minAnalogWalkSpeed = oracleInput.minAnalogSpeed
      component.brakingFrictionFactor =
        oracleInput.brakingFrictionFactor
      component.brakingSubStepTime = oracleInput.brakingSubStepTime
      component.inputBlocked = oracleInput.inputBlocked

      calcPlanarVelocity(
        component,
        {
          x: oracleInput.inputX,
          y: oracleInput.inputY,
          z: 0,
        },
        oracleInput.deltaTime,
        oracleInput.friction,
        oracleInput.brakingDeceleration,
        oracleInput.maxAcceleration,
        oracleInput.analogInputModifier,
      )

      expect(component.velocity.x).toBeCloseTo(expected.x, 11)
      expect(component.velocity.y).toBeCloseTo(expected.y, 11)
      expect(component.velocity.z).toBe(originalZ)
    }
  })
})
