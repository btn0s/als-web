import { describe, expect, it } from 'vitest'
import {
  ProcessFootLockBaseChange as ReferenceProcessFootLockBaseChange,
  ProcessFootLockTeleport as ReferenceProcessFootLockTeleport,
  RefreshFootLock as ReferenceRefreshFootLock,
} from '../reference/AlsAnimationInstance.reference'
import type {
  FAlsFootState,
  FAlsMovementBaseState,
  FQuat4f,
  FTransform3f,
  FVector3f,
} from '../reference/AlsAnimationInstance.reference'
import {
  ALS_FOOT_LOCK_TELEPORT_GRACE_PERIOD,
  ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD,
  createAlsFeetState,
  createAlsFootState,
  processFootLockBaseChange,
  processFootLockTeleport,
  refreshFootLock,
} from './AlsFeetState'
import type {
  AlsFootLockMovementBase,
  AlsFootState,
  AlsQuaternion,
  AlsRefreshFootLockInput,
  AlsTransform,
} from './AlsFeetState'

const IDENTITY_TRANSFORM: AlsTransform = {
  location: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
}

const NO_MOVEMENT_BASE: AlsFootLockMovementBase = {
  hasRelativeLocation: false,
  location: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
}

function yawQuaternion(degrees: number): AlsQuaternion {
  const halfAngle = degrees * Math.PI / 360
  return {
    x: 0,
    y: 0,
    z: Math.sin(halfAngle),
    w: Math.cos(halfAngle),
  }
}

function cloneFootState(state: AlsFootState): AlsFootState {
  return structuredClone(state)
}

function toReferenceVector(value: {
  readonly x: number
  readonly y: number
  readonly z: number
}): FVector3f {
  return { X: value.x, Y: value.y, Z: value.z }
}

function toReferenceQuaternion(
  value: Readonly<AlsQuaternion>,
): FQuat4f {
  return { X: value.x, Y: value.y, Z: value.z, W: value.w }
}

function toReferenceTransform(transform: AlsTransform): FTransform3f {
  return {
    Location: toReferenceVector(transform.location),
    Rotation: toReferenceQuaternion(transform.rotation),
  }
}

function toReferenceMovementBase(
  movementBase: AlsFootLockMovementBase,
): FAlsMovementBaseState {
  return {
    bHasRelativeLocation: movementBase.hasRelativeLocation,
    bHasRelativeRotation: false,
    Location: toReferenceVector(movementBase.location),
    Rotation: toReferenceQuaternion(movementBase.rotation),
    DeltaRotationYaw: 0,
  }
}

function toReferenceFootState(state: AlsFootState): FAlsFootState {
  return {
    LockAmount: state.lockAmount,
    ThighAxis: toReferenceVector(state.thighAxis),
    TargetLocation: toReferenceVector(state.targetLocation),
    TargetRotation: toReferenceQuaternion(state.targetRotation),
    LockLocation: toReferenceVector(state.lockLocation),
    LockRotation: toReferenceQuaternion(state.lockRotation),
    LockComponentRelativeLocation:
      toReferenceVector(state.lockComponentRelativeLocation),
    LockComponentRelativeRotation:
      toReferenceQuaternion(state.lockComponentRelativeRotation),
    LockMovementBaseRelativeLocation:
      toReferenceVector(state.lockMovementBaseRelativeLocation),
    LockMovementBaseRelativeRotation:
      toReferenceQuaternion(state.lockMovementBaseRelativeRotation),
    FinalLocation: toReferenceVector(state.finalLocation),
    FinalRotation: toReferenceQuaternion(state.finalRotation),
  }
}

function runtimeValues(state: AlsFootState): number[] {
  return [
    state.lockAmount,
    state.thighAxis.x,
    state.thighAxis.y,
    state.thighAxis.z,
    state.targetLocation.x,
    state.targetLocation.y,
    state.targetLocation.z,
    state.targetRotation.x,
    state.targetRotation.y,
    state.targetRotation.z,
    state.targetRotation.w,
    state.lockLocation.x,
    state.lockLocation.y,
    state.lockLocation.z,
    state.lockRotation.x,
    state.lockRotation.y,
    state.lockRotation.z,
    state.lockRotation.w,
    state.lockComponentRelativeLocation.x,
    state.lockComponentRelativeLocation.y,
    state.lockComponentRelativeLocation.z,
    state.lockComponentRelativeRotation.x,
    state.lockComponentRelativeRotation.y,
    state.lockComponentRelativeRotation.z,
    state.lockComponentRelativeRotation.w,
    state.lockMovementBaseRelativeLocation.x,
    state.lockMovementBaseRelativeLocation.y,
    state.lockMovementBaseRelativeLocation.z,
    state.lockMovementBaseRelativeRotation.x,
    state.lockMovementBaseRelativeRotation.y,
    state.lockMovementBaseRelativeRotation.z,
    state.lockMovementBaseRelativeRotation.w,
    state.finalLocation.x,
    state.finalLocation.y,
    state.finalLocation.z,
    state.finalRotation.x,
    state.finalRotation.y,
    state.finalRotation.z,
    state.finalRotation.w,
  ]
}

function referenceValues(state: FAlsFootState): number[] {
  return [
    state.LockAmount,
    state.ThighAxis.X,
    state.ThighAxis.Y,
    state.ThighAxis.Z,
    state.TargetLocation.X,
    state.TargetLocation.Y,
    state.TargetLocation.Z,
    state.TargetRotation.X,
    state.TargetRotation.Y,
    state.TargetRotation.Z,
    state.TargetRotation.W,
    state.LockLocation.X,
    state.LockLocation.Y,
    state.LockLocation.Z,
    state.LockRotation.X,
    state.LockRotation.Y,
    state.LockRotation.Z,
    state.LockRotation.W,
    state.LockComponentRelativeLocation.X,
    state.LockComponentRelativeLocation.Y,
    state.LockComponentRelativeLocation.Z,
    state.LockComponentRelativeRotation.X,
    state.LockComponentRelativeRotation.Y,
    state.LockComponentRelativeRotation.Z,
    state.LockComponentRelativeRotation.W,
    state.LockMovementBaseRelativeLocation.X,
    state.LockMovementBaseRelativeLocation.Y,
    state.LockMovementBaseRelativeLocation.Z,
    state.LockMovementBaseRelativeRotation.X,
    state.LockMovementBaseRelativeRotation.Y,
    state.LockMovementBaseRelativeRotation.Z,
    state.LockMovementBaseRelativeRotation.W,
    state.FinalLocation.X,
    state.FinalLocation.Y,
    state.FinalLocation.Z,
    state.FinalRotation.X,
    state.FinalRotation.Y,
    state.FinalRotation.Z,
    state.FinalRotation.W,
  ]
}

function expectStateToMatchReference(
  actual: AlsFootState,
  expected: FAlsFootState,
): void {
  const actualValues = runtimeValues(actual)
  const expectedValues = referenceValues(expected)
  expect(actualValues).toHaveLength(expectedValues.length)
  for (let index = 0; index < actualValues.length; index++) {
    expect(actualValues[index]).toBeCloseTo(expectedValues[index], 11)
  }
}

function baseRefreshInput(
  overrides: Partial<AlsRefreshFootLockInput> = {},
): AlsRefreshFootLockInput {
  return {
    ikAmount: 1,
    lockCurveAmount: 1,
    componentTransform: IDENTITY_TRANSFORM,
    deltaTime: 1 / 60,
    movingSmooth: false,
    grounded: true,
    pendingUpdate: false,
    disableFootLock: false,
    movementBase: NO_MOVEMENT_BASE,
    pelvisRotation: yawQuaternion(0),
    footLockAngleLimit: 90,
    ...overrides,
  }
}

function makeLockedFoot(): AlsFootState {
  const state = createAlsFootState({ x: 1, y: 0, z: 0 })
  state.lockAmount = 1
  state.targetLocation = { x: 0.4, y: -0.2, z: 0.1 }
  state.targetRotation = yawQuaternion(25)
  state.lockLocation = { x: -0.7, y: 0.3, z: 0.05 }
  state.lockRotation = yawQuaternion(-40)
  state.lockComponentRelativeLocation = { x: -0.7, y: 0.3, z: 0.05 }
  state.lockComponentRelativeRotation = yawQuaternion(-40)
  state.lockMovementBaseRelativeLocation = { x: 0.2, y: -0.4, z: 0.1 }
  state.lockMovementBaseRelativeRotation = yawQuaternion(15)
  return state
}

describe('FAlsFeetState defaults', () => {
  it('matches AlsFeetState.h including the asymmetric default thigh axes', () => {
    const state = createAlsFeetState()
    expect(state.pelvisRotation).toEqual({ x: 0, y: 0, z: 0, w: 1 })
    expect(state.footPlantedAmount).toBe(0)
    expect(state.feetCrossingAmount).toBe(0)
    expect(state.left.thighAxis).toEqual({ x: 0, y: 0, z: -1 })
    expect(state.right.thighAxis).toEqual({ x: 0, y: 0, z: 1 })
    expect(state.left.lockAmount).toBe(0)
    expect(state.left.lockRotation).toEqual({ x: 0, y: 0, z: 0, w: 1 })
  })
})

describe('ProcessFootLockTeleport', () => {
  it('rebuilds the world lock through exactly 0.2 seconds and recaches its base transform', () => {
    const state = makeLockedFoot()
    state.lockComponentRelativeLocation = { x: 0.3, y: -0.2, z: 0.1 }
    state.lockComponentRelativeRotation = yawQuaternion(20)
    const componentTransform: AlsTransform = {
      location: { x: 3, y: 4, z: 1 },
      rotation: yawQuaternion(90),
    }
    const movementBase: AlsFootLockMovementBase = {
      hasRelativeLocation: true,
      location: { x: 2, y: 3, z: 0.5 },
      rotation: yawQuaternion(15),
    }
    const reference = toReferenceFootState(state)

    processFootLockTeleport(state, {
      ikAmount: 1,
      pendingUpdate: false,
      timeSinceTeleported: ALS_FOOT_LOCK_TELEPORT_GRACE_PERIOD,
      componentTransform,
      movementBase,
    })
    ReferenceProcessFootLockTeleport({
      IkAmount: 1,
      FootState: reference,
      bPendingUpdate: false,
      TimeSinceTeleported: ALS_FOOT_LOCK_TELEPORT_GRACE_PERIOD,
      ComponentTransform: toReferenceTransform(componentTransform),
      MovementBase: toReferenceMovementBase(movementBase),
    })

    expect(state.lockLocation.x).toBeCloseTo(3.2, 12)
    expect(state.lockLocation.y).toBeCloseTo(4.3, 12)
    expect(state.lockLocation.z).toBeCloseTo(1.1, 12)
    expectStateToMatchReference(state, reference)
  })

  it('uses strict teleport-time and animation-weight relevance boundaries', () => {
    const afterGrace = makeLockedFoot()
    const originalAfterGrace = cloneFootState(afterGrace)
    processFootLockTeleport(afterGrace, {
      ikAmount: 1,
      pendingUpdate: false,
      timeSinceTeleported: ALS_FOOT_LOCK_TELEPORT_GRACE_PERIOD
        + Number.EPSILON,
      componentTransform: {
        location: { x: 100, y: 0, z: 0 },
        rotation: yawQuaternion(0),
      },
      movementBase: NO_MOVEMENT_BASE,
    })
    expect(afterGrace).toEqual(originalAfterGrace)

    const exactThreshold = makeLockedFoot()
    exactThreshold.lockAmount = ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD
    const originalThreshold = cloneFootState(exactThreshold)
    processFootLockTeleport(exactThreshold, {
      ikAmount: 1,
      pendingUpdate: false,
      timeSinceTeleported: 0,
      componentTransform: {
        location: { x: 100, y: 0, z: 0 },
        rotation: yawQuaternion(0),
      },
      movementBase: NO_MOVEMENT_BASE,
    })
    expect(exactThreshold).toEqual(originalThreshold)

    const aboveThreshold = makeLockedFoot()
    aboveThreshold.lockAmount = ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD
      + Number.EPSILON
    processFootLockTeleport(aboveThreshold, {
      ikAmount: 1,
      pendingUpdate: false,
      timeSinceTeleported: 0,
      componentTransform: {
        location: { x: 100, y: 0, z: 0 },
        rotation: yawQuaternion(0),
      },
      movementBase: NO_MOVEMENT_BASE,
    })
    expect(aboveThreshold.lockLocation.x).toBeGreaterThan(99)
  })
})

describe('ProcessFootLockBaseChange', () => {
  it('recaptures the target on a pending update and clears absent-base caches', () => {
    const state = makeLockedFoot()
    const componentTransform: AlsTransform = {
      location: { x: 0.5, y: -0.3, z: 0.2 },
      rotation: yawQuaternion(30),
    }
    const reference = toReferenceFootState(state)

    processFootLockBaseChange(state, {
      ikAmount: 1,
      pendingUpdate: true,
      baseChanged: false,
      componentTransform,
      movementBase: NO_MOVEMENT_BASE,
    })
    ReferenceProcessFootLockBaseChange({
      IkAmount: 1,
      FootState: reference,
      bPendingUpdate: true,
      bBaseChanged: false,
      ComponentTransform: toReferenceTransform(componentTransform),
      MovementBase: toReferenceMovementBase(NO_MOVEMENT_BASE),
    })

    expect(state.lockLocation).toEqual(state.targetLocation)
    expect(state.lockRotation).toEqual(state.targetRotation)
    expect(state.lockMovementBaseRelativeLocation).toEqual({ x: 0, y: 0, z: 0 })
    expect(state.lockMovementBaseRelativeRotation)
      .toEqual({ x: 0, y: 0, z: 0, w: 1 })
    expectStateToMatchReference(state, reference)
  })

  it('recaches a changed relative base without replacing the existing world lock', () => {
    const state = makeLockedFoot()
    const oldLock = structuredClone(state.lockLocation)
    const movementBase: AlsFootLockMovementBase = {
      hasRelativeLocation: true,
      location: { x: -1, y: 0.5, z: 0.2 },
      rotation: yawQuaternion(-35),
    }
    const reference = toReferenceFootState(state)

    processFootLockBaseChange(state, {
      ikAmount: 0.8,
      pendingUpdate: false,
      baseChanged: true,
      componentTransform: IDENTITY_TRANSFORM,
      movementBase,
    })
    ReferenceProcessFootLockBaseChange({
      IkAmount: 0.8,
      FootState: reference,
      bPendingUpdate: false,
      bBaseChanged: true,
      ComponentTransform: toReferenceTransform(IDENTITY_TRANSFORM),
      MovementBase: toReferenceMovementBase(movementBase),
    })

    expect(state.lockLocation).toEqual(oldLock)
    expectStateToMatchReference(state, reference)
  })
})

describe('RefreshFootLock', () => {
  it('decreases moving and in-air locks at the exact 5/s and 0.6/s rates', () => {
    const moving = makeLockedFoot()
    const movingReference = toReferenceFootState(moving)
    const movingInput = baseRefreshInput({
      movingSmooth: true,
      grounded: false,
      deltaTime: 0.1,
    })
    refreshFootLock(moving, movingInput)
    ReferenceRefreshFootLock({
      IkAmount: movingInput.ikAmount,
      NewLockCurveAmount: movingInput.lockCurveAmount,
      FootState: movingReference,
      ComponentTransform:
        toReferenceTransform(movingInput.componentTransform),
      DeltaTime: movingInput.deltaTime,
      bMovingSmooth: movingInput.movingSmooth,
      bGrounded: movingInput.grounded,
      bPendingUpdate: movingInput.pendingUpdate,
      bDisableFootLock: movingInput.disableFootLock,
      MovementBase: toReferenceMovementBase(movingInput.movementBase),
      PelvisRotation: toReferenceQuaternion(movingInput.pelvisRotation),
      FootLockAngleLimit: movingInput.footLockAngleLimit,
    })
    expect(moving.lockAmount).toBeCloseTo(0.5, 12)
    expectStateToMatchReference(moving, movingReference)

    const inAir = makeLockedFoot()
    refreshFootLock(inAir, baseRefreshInput({
      grounded: false,
      deltaTime: 0.1,
    }))
    expect(inAir.lockAmount).toBeCloseTo(0.94, 12)
  })

  it('fully releases on a pending moving update or irrelevant IK-lock product', () => {
    const state = makeLockedFoot()
    const componentTransform: AlsTransform = {
      location: { x: 0.25, y: -0.5, z: 0.1 },
      rotation: yawQuaternion(90),
    }
    const reference = toReferenceFootState(state)
    const input = baseRefreshInput({
      componentTransform,
      movingSmooth: true,
      pendingUpdate: true,
    })

    refreshFootLock(state, input)
    ReferenceRefreshFootLock({
      IkAmount: input.ikAmount,
      NewLockCurveAmount: input.lockCurveAmount,
      FootState: reference,
      ComponentTransform: toReferenceTransform(input.componentTransform),
      DeltaTime: input.deltaTime,
      bMovingSmooth: input.movingSmooth,
      bGrounded: input.grounded,
      bPendingUpdate: input.pendingUpdate,
      bDisableFootLock: input.disableFootLock,
      MovementBase: toReferenceMovementBase(input.movementBase),
      PelvisRotation: toReferenceQuaternion(input.pelvisRotation),
      FootLockAngleLimit: input.footLockAngleLimit,
    })

    expect(state.lockAmount).toBe(0)
    expect(state.lockLocation).toEqual({ x: 0, y: 0, z: 0 })
    expect(state.lockRotation).toEqual({ x: 0, y: 0, z: 0, w: 1 })
    expectStateToMatchReference(state, reference)

    const exactThreshold = makeLockedFoot()
    refreshFootLock(exactThreshold, baseRefreshInput({
      ikAmount: ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD,
      lockCurveAmount: 1,
    }))
    expect(exactThreshold.lockAmount).toBe(0)
  })

  it('never blends a partial curve in, but decreases an existing lock', () => {
    const unlocked = createAlsFootState({ x: 1, y: 0, z: 0 })
    unlocked.targetLocation = { x: 1, y: 2, z: 3 }
    refreshFootLock(unlocked, baseRefreshInput({ lockCurveAmount: 0.75 }))
    expect(unlocked.lockAmount).toBe(0)

    const locked = makeLockedFoot()
    refreshFootLock(locked, baseRefreshInput({ lockCurveAmount: 0.75 }))
    expect(locked.lockAmount).toBe(0.75)
  })

  it('uses the full-weight and 0.9 recapture boundaries verbatim', () => {
    const justBelowFull = createAlsFootState({ x: 1, y: 0, z: 0 })
    justBelowFull.targetLocation = { x: 4, y: 5, z: 6 }
    refreshFootLock(justBelowFull, baseRefreshInput({
      lockCurveAmount: 1 - ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD
        - Number.EPSILON,
    }))
    expect(justBelowFull.lockAmount).toBe(0)

    const full = createAlsFootState({ x: 1, y: 0, z: 0 })
    full.targetLocation = { x: 4, y: 5, z: 6 }
    refreshFootLock(full, baseRefreshInput({
      lockCurveAmount: 1 - ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD,
    }))
    expect(full.lockAmount).toBe(1)
    expect(full.lockLocation).toEqual(full.targetLocation)

    const atCaptureBoundary = makeLockedFoot()
    atCaptureBoundary.lockAmount = 0.9
    atCaptureBoundary.targetLocation = { x: 7, y: 8, z: 9 }
    refreshFootLock(atCaptureBoundary, baseRefreshInput({
      footLockAngleLimit: 180,
    }))
    expect(atCaptureBoundary.lockLocation)
      .toEqual(atCaptureBoundary.targetLocation)

    const aboveCaptureBoundary = makeLockedFoot()
    aboveCaptureBoundary.lockAmount = 0.9 + Number.EPSILON
    const retainedLocation = structuredClone(aboveCaptureBoundary.lockLocation)
    aboveCaptureBoundary.targetLocation = { x: 7, y: 8, z: 9 }
    refreshFootLock(aboveCaptureBoundary, baseRefreshInput({
      footLockAngleLimit: 180,
    }))
    expect(aboveCaptureBoundary.lockLocation).toEqual(retainedLocation)
  })

  it('rides a relative movement base and writes the final transform in component space', () => {
    const state = createAlsFootState({ x: 1, y: 0, z: 0 })
    state.targetLocation = { x: 2.5, y: 0, z: 0.2 }
    state.targetRotation = yawQuaternion(10)
    const initialBase: AlsFootLockMovementBase = {
      hasRelativeLocation: true,
      location: { x: 2, y: 0, z: 0 },
      rotation: yawQuaternion(0),
    }
    refreshFootLock(state, baseRefreshInput({ movementBase: initialBase }))

    const movedBase: AlsFootLockMovementBase = {
      ...initialBase,
      location: { x: 3, y: 1, z: 0 },
      rotation: yawQuaternion(90),
    }
    const reference = toReferenceFootState(state)
    const componentTransform: AlsTransform = {
      location: { x: 1, y: 1, z: 0 },
      rotation: yawQuaternion(30),
    }
    const input = baseRefreshInput({
      movementBase: movedBase,
      componentTransform,
    })
    refreshFootLock(state, input)
    ReferenceRefreshFootLock({
      IkAmount: input.ikAmount,
      NewLockCurveAmount: input.lockCurveAmount,
      FootState: reference,
      ComponentTransform: toReferenceTransform(input.componentTransform),
      DeltaTime: input.deltaTime,
      bMovingSmooth: input.movingSmooth,
      bGrounded: input.grounded,
      bPendingUpdate: input.pendingUpdate,
      bDisableFootLock: input.disableFootLock,
      MovementBase: toReferenceMovementBase(input.movementBase),
      PelvisRotation: toReferenceQuaternion(input.pelvisRotation),
      FootLockAngleLimit: input.footLockAngleLimit,
    })

    expect(state.lockLocation.x).toBeCloseTo(3, 12)
    expect(state.lockLocation.y).toBeCloseTo(1.5, 12)
    expect(state.lockLocation.z).toBeCloseTo(0.2, 12)
    expectStateToMatchReference(state, reference)
  })

  it('clamps the lock around +Z only beyond angle limit plus KINDA_SMALL_NUMBER', () => {
    const withinTolerance = makeLockedFoot()
    const withinAngle = (90 + 0.00009) * Math.PI / 180
    withinTolerance.lockLocation = {
      x: Math.cos(withinAngle),
      y: Math.sin(withinAngle),
      z: 0.2,
    }
    refreshFootLock(withinTolerance, baseRefreshInput())
    expect(withinTolerance.lockComponentRelativeLocation.x)
      .toBeCloseTo(Math.cos(withinAngle), 11)

    const constrained = makeLockedFoot()
    const outsideAngle = 125 * Math.PI / 180
    constrained.lockLocation = {
      x: Math.cos(outsideAngle),
      y: Math.sin(outsideAngle),
      z: 0.2,
    }
    constrained.lockRotation = yawQuaternion(20)
    const reference = toReferenceFootState(constrained)
    const input = baseRefreshInput()
    refreshFootLock(constrained, input)
    ReferenceRefreshFootLock({
      IkAmount: input.ikAmount,
      NewLockCurveAmount: input.lockCurveAmount,
      FootState: reference,
      ComponentTransform: toReferenceTransform(input.componentTransform),
      DeltaTime: input.deltaTime,
      bMovingSmooth: input.movingSmooth,
      bGrounded: input.grounded,
      bPendingUpdate: input.pendingUpdate,
      bDisableFootLock: input.disableFootLock,
      MovementBase: toReferenceMovementBase(input.movementBase),
      PelvisRotation: toReferenceQuaternion(input.pelvisRotation),
      FootLockAngleLimit: input.footLockAngleLimit,
    })

    expect(constrained.lockComponentRelativeLocation.x).toBeCloseTo(0, 11)
    expect(constrained.lockComponentRelativeLocation.y).toBeCloseTo(1, 11)
    expect(constrained.lockComponentRelativeLocation.z).toBeCloseTo(0.2, 11)
    expectStateToMatchReference(constrained, reference)
  })

  it('uses quaternion FastLerp hemisphere bias for the final rotation', () => {
    const state = makeLockedFoot()
    state.lockAmount = 0.25
    state.targetLocation = { x: 2, y: -1, z: 0.5 }
    state.lockLocation = { x: -2, y: 3, z: 0.1 }
    state.targetRotation = yawQuaternion(170)
    const equivalentNegativeLock = yawQuaternion(-170)
    state.lockRotation = {
      x: -equivalentNegativeLock.x,
      y: -equivalentNegativeLock.y,
      z: -equivalentNegativeLock.z,
      w: -equivalentNegativeLock.w,
    }
    const componentTransform: AlsTransform = {
      location: { x: 0.4, y: -0.3, z: 0.2 },
      rotation: yawQuaternion(35),
    }
    const reference = toReferenceFootState(state)
    const input = baseRefreshInput({
      componentTransform,
      lockCurveAmount: 0.25,
      footLockAngleLimit: 180,
    })

    refreshFootLock(state, input)
    ReferenceRefreshFootLock({
      IkAmount: input.ikAmount,
      NewLockCurveAmount: input.lockCurveAmount,
      FootState: reference,
      ComponentTransform: toReferenceTransform(input.componentTransform),
      DeltaTime: input.deltaTime,
      bMovingSmooth: input.movingSmooth,
      bGrounded: input.grounded,
      bPendingUpdate: input.pendingUpdate,
      bDisableFootLock: input.disableFootLock,
      MovementBase: toReferenceMovementBase(input.movementBase),
      PelvisRotation: toReferenceQuaternion(input.pelvisRotation),
      FootLockAngleLimit: input.footLockAngleLimit,
    })

    expectStateToMatchReference(state, reference)
  })
})

describe('C++ differential sweep', () => {
  function randomGenerator(seed: number): () => number {
    let value = seed >>> 0
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0
      return value / 0x1_0000_0000
    }
  }

  const random = randomGenerator(0xa15fee7)
  const scalar = (extent = 1) => (random() * 2 - 1) * extent
  const randomVector = (extent = 2) => ({
    x: scalar(extent),
    y: scalar(extent),
    z: scalar(extent),
  })
  const randomRotation = () => yawQuaternion(scalar(180))
  const randomTransform = (): AlsTransform => ({
    location: randomVector(5),
    rotation: randomRotation(),
  })
  const randomMovementBase = (): AlsFootLockMovementBase => ({
    hasRelativeLocation: random() > 0.5,
    location: randomVector(5),
    rotation: randomRotation(),
  })
  const randomState = (): AlsFootState => {
    const state = createAlsFootState(randomVector(1))
    state.lockAmount = random()
    state.targetLocation = randomVector()
    state.targetRotation = randomRotation()
    state.lockLocation = randomVector()
    state.lockRotation = randomRotation()
    state.lockComponentRelativeLocation = randomVector()
    state.lockComponentRelativeRotation = randomRotation()
    state.lockMovementBaseRelativeLocation = randomVector()
    state.lockMovementBaseRelativeRotation = randomRotation()
    state.finalLocation = randomVector()
    state.finalRotation = randomRotation()
    return state
  }

  it('matches the line-mirroring oracle across teleport, base-change, and refresh branches', () => {
    for (let iteration = 0; iteration < 128; iteration++) {
      const componentTransform = randomTransform()
      const movementBase = randomMovementBase()

      const teleportState = randomState()
      const teleportReference = toReferenceFootState(teleportState)
      const teleportInput = {
        ikAmount: random(),
        pendingUpdate: random() > 0.8,
        timeSinceTeleported: random() * 0.4,
        componentTransform,
        movementBase,
      }
      processFootLockTeleport(teleportState, teleportInput)
      ReferenceProcessFootLockTeleport({
        IkAmount: teleportInput.ikAmount,
        FootState: teleportReference,
        bPendingUpdate: teleportInput.pendingUpdate,
        TimeSinceTeleported: teleportInput.timeSinceTeleported,
        ComponentTransform: toReferenceTransform(componentTransform),
        MovementBase: toReferenceMovementBase(movementBase),
      })
      expectStateToMatchReference(teleportState, teleportReference)

      const baseChangeState = randomState()
      const baseChangeReference = toReferenceFootState(baseChangeState)
      const baseChangeInput = {
        ikAmount: random(),
        pendingUpdate: random() > 0.8,
        baseChanged: random() > 0.5,
        componentTransform,
        movementBase,
      }
      processFootLockBaseChange(baseChangeState, baseChangeInput)
      ReferenceProcessFootLockBaseChange({
        IkAmount: baseChangeInput.ikAmount,
        FootState: baseChangeReference,
        bPendingUpdate: baseChangeInput.pendingUpdate,
        bBaseChanged: baseChangeInput.baseChanged,
        ComponentTransform: toReferenceTransform(componentTransform),
        MovementBase: toReferenceMovementBase(movementBase),
      })
      expectStateToMatchReference(baseChangeState, baseChangeReference)

      const refreshState = randomState()
      const refreshReference = toReferenceFootState(refreshState)
      const refreshInput = baseRefreshInput({
        ikAmount: random(),
        lockCurveAmount: scalar(1.5) + 0.5,
        componentTransform,
        deltaTime: random() * 0.1,
        movingSmooth: random() > 0.5,
        grounded: random() > 0.35,
        pendingUpdate: random() > 0.85,
        disableFootLock: random() > 0.9,
        movementBase,
        pelvisRotation: randomRotation(),
        footLockAngleLimit: random() * 180,
      })
      refreshFootLock(refreshState, refreshInput)
      ReferenceRefreshFootLock({
        IkAmount: refreshInput.ikAmount,
        NewLockCurveAmount: refreshInput.lockCurveAmount,
        FootState: refreshReference,
        ComponentTransform: toReferenceTransform(componentTransform),
        DeltaTime: refreshInput.deltaTime,
        bMovingSmooth: refreshInput.movingSmooth,
        bGrounded: refreshInput.grounded,
        bPendingUpdate: refreshInput.pendingUpdate,
        bDisableFootLock: refreshInput.disableFootLock,
        MovementBase: toReferenceMovementBase(movementBase),
        PelvisRotation: toReferenceQuaternion(refreshInput.pelvisRotation),
        FootLockAngleLimit: refreshInput.footLockAngleLimit,
      })
      expectStateToMatchReference(refreshState, refreshReference)
    }
  })
})
