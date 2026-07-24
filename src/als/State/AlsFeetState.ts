import type { AlsVector3 } from './AlsLocomotionState'

/**
 * Framework-free counterpart of ALS Refactored's FAlsFootState / FAlsFeetState.
 *
 * Locations are expressed in metres at the web runtime boundary. The source functions operate
 * on centimetres, but every operation below is affine or angular and therefore remains identical
 * after the one global centimetres-to-metres conversion. Coordinates retain ALS's +X forward,
 * +Y right, +Z up convention; the renderer-space conversion belongs outside this state module.
 */

export interface AlsQuaternion {
  x: number
  y: number
  z: number
  w: number
}

export interface AlsTransform {
  readonly location: Readonly<AlsVector3>
  readonly rotation: Readonly<AlsQuaternion>
}

/** The subset of FAlsMovementBaseState consumed by the foot-lock functions. */
export interface AlsFootLockMovementBase {
  readonly hasRelativeLocation: boolean
  readonly location: Readonly<AlsVector3>
  readonly rotation: Readonly<AlsQuaternion>
}

export interface AlsFootState {
  lockAmount: number
  thighAxis: AlsVector3
  targetLocation: AlsVector3
  targetRotation: AlsQuaternion
  lockLocation: AlsVector3
  lockRotation: AlsQuaternion
  lockComponentRelativeLocation: AlsVector3
  lockComponentRelativeRotation: AlsQuaternion
  lockMovementBaseRelativeLocation: AlsVector3
  lockMovementBaseRelativeRotation: AlsQuaternion
  finalLocation: AlsVector3
  finalRotation: AlsQuaternion
}

export interface AlsFeetState {
  pelvisRotation: AlsQuaternion
  footPlantedAmount: number
  feetCrossingAmount: number
  left: AlsFootState
  right: AlsFootState
}

export interface AlsProcessFootLockTeleportInput {
  readonly ikAmount: number
  readonly pendingUpdate: boolean
  readonly timeSinceTeleported: number
  readonly componentTransform: AlsTransform
  readonly movementBase: AlsFootLockMovementBase
}

export interface AlsProcessFootLockBaseChangeInput {
  readonly ikAmount: number
  readonly pendingUpdate: boolean
  readonly baseChanged: boolean
  readonly componentTransform: AlsTransform
  readonly movementBase: AlsFootLockMovementBase
}

export interface AlsRefreshFootLockInput {
  readonly ikAmount: number
  readonly lockCurveAmount: number
  readonly componentTransform: AlsTransform
  readonly deltaTime: number
  readonly movingSmooth: boolean
  readonly grounded: boolean
  readonly pendingUpdate: boolean
  readonly disableFootLock: boolean
  readonly movementBase: AlsFootLockMovementBase
  readonly pelvisRotation: Readonly<AlsQuaternion>
  /** Degrees, matching FAlsFeetSettings::FootLockAngleLimit. */
  readonly footLockAngleLimit: number
}

export interface AlsRefreshFeetOnGameThreadInput {
  /** Pelvis socket rotation in mesh-component space. */
  readonly pelvisRotation: Readonly<AlsQuaternion>
  /** Resolved `ik_foot_l` or `VB foot_l` socket transform in world space. */
  readonly leftTarget: AlsTransform
  /** Resolved `ik_foot_r` or `VB foot_r` socket transform in world space. */
  readonly rightTarget: AlsTransform
}

export interface AlsRefreshFeetInput {
  readonly deltaTime: number
  readonly pendingUpdate: boolean
  readonly timeSinceTeleported: number
  readonly baseChanged: boolean
  readonly componentTransform: AlsTransform
  readonly movementBase: AlsFootLockMovementBase
  readonly movingSmooth: boolean
  readonly grounded: boolean
  readonly disableFootLock: boolean
  readonly footLockAngleLimit: number
  readonly footPlantedCurveAmount: number
  readonly feetCrossingCurveAmount: number
  readonly footLeftIkCurveAmount: number
  readonly footRightIkCurveAmount: number
  readonly footLeftLockCurveAmount: number
  readonly footRightLockCurveAmount: number
}

// AlsAnimationInstance.cpp:1186 and 1248-1250.
export const ALS_FOOT_LOCK_TELEPORT_GRACE_PERIOD = 0.2
export const ALS_FOOT_LOCK_MOVING_DECREASE_SPEED = 5
export const ALS_FOOT_LOCK_NOT_GROUNDED_DECREASE_SPEED = 0.6

// AlsAnimationInstance.cpp:1294 and AlsFeetSettings.h:18.
export const ALS_FOOT_LOCK_CAPTURE_AMOUNT_THRESHOLD = 0.9
export const ALS_DEFAULT_FOOT_LOCK_ANGLE_LIMIT = 90

// FAnimWeight::IsRelevant() / IsFullWeight(), pinned by the test-only C++ oracle.
export const ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

const UE_SMALL_NUMBER = 1e-8
const UE_KINDA_SMALL_NUMBER = 1e-4

function vector(x = 0, y = 0, z = 0): AlsVector3 {
  return { x, y, z }
}

function quaternion(
  x = 0,
  y = 0,
  z = 0,
  w = 1,
): AlsQuaternion {
  return { x, y, z, w }
}

function copyVector(value: Readonly<AlsVector3>): AlsVector3 {
  return vector(value.x, value.y, value.z)
}

function copyQuaternion(value: Readonly<AlsQuaternion>): AlsQuaternion {
  return quaternion(value.x, value.y, value.z, value.w)
}

function add(
  a: Readonly<AlsVector3>,
  b: Readonly<AlsVector3>,
): AlsVector3 {
  return vector(a.x + b.x, a.y + b.y, a.z + b.z)
}

function subtract(
  a: Readonly<AlsVector3>,
  b: Readonly<AlsVector3>,
): AlsVector3 {
  return vector(a.x - b.x, a.y - b.y, a.z - b.z)
}

function normalizeQuaternion(
  value: Readonly<AlsQuaternion>,
): AlsQuaternion {
  const sizeSquared = value.x * value.x
    + value.y * value.y
    + value.z * value.z
    + value.w * value.w

  if (sizeSquared <= UE_SMALL_NUMBER) {
    return quaternion()
  }

  const scale = 1 / Math.sqrt(sizeSquared)
  return quaternion(
    value.x * scale,
    value.y * scale,
    value.z * scale,
    value.w * scale,
  )
}

function inverseQuaternion(
  value: Readonly<AlsQuaternion>,
): AlsQuaternion {
  // FQuat::Inverse() is the conjugate for the normalized rotations used by FTransform.
  return quaternion(-value.x, -value.y, -value.z, value.w)
}

function multiplyQuaternion(
  a: Readonly<AlsQuaternion>,
  b: Readonly<AlsQuaternion>,
): AlsQuaternion {
  return quaternion(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  )
}

function fastLerpQuaternion(
  from: Readonly<AlsQuaternion>,
  to: Readonly<AlsQuaternion>,
  amount: number,
): AlsQuaternion {
  const dot = from.x * to.x
    + from.y * to.y
    + from.z * to.z
    + from.w * to.w
  const bias = dot >= 0 ? 1 : -1
  return quaternion(
    to.x * amount + from.x * bias * (1 - amount),
    to.y * amount + from.y * bias * (1 - amount),
    to.z * amount + from.z * bias * (1 - amount),
    to.w * amount + from.w * bias * (1 - amount),
  )
}

function rotateVector(
  rotation: Readonly<AlsQuaternion>,
  value: Readonly<AlsVector3>,
): AlsVector3 {
  const result = multiplyQuaternion(
    multiplyQuaternion(
      rotation,
      quaternion(value.x, value.y, value.z, 0),
    ),
    inverseQuaternion(rotation),
  )
  return vector(result.x, result.y, result.z)
}

function unrotateVector(
  rotation: Readonly<AlsQuaternion>,
  value: Readonly<AlsVector3>,
): AlsVector3 {
  return rotateVector(inverseQuaternion(rotation), value)
}

function transformPosition(
  transform: AlsTransform,
  value: Readonly<AlsVector3>,
): AlsVector3 {
  return add(transform.location, rotateVector(transform.rotation, value))
}

function inverseTransformPosition(
  transform: AlsTransform,
  value: Readonly<AlsVector3>,
): AlsVector3 {
  return unrotateVector(
    transform.rotation,
    subtract(value, transform.location),
  )
}

function transformRotation(
  transform: AlsTransform,
  value: Readonly<AlsQuaternion>,
): AlsQuaternion {
  return normalizeQuaternion(multiplyQuaternion(transform.rotation, value))
}

function inverseTransformRotation(
  transform: AlsTransform,
  value: Readonly<AlsQuaternion>,
): AlsQuaternion {
  return normalizeQuaternion(
    multiplyQuaternion(inverseQuaternion(transform.rotation), value),
  )
}

function isRelevant(weight: number): boolean {
  return weight > ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD
}

function isFullWeight(weight: number): boolean {
  return weight >= 1 - ALS_ZERO_ANIMATION_WEIGHT_THRESHOLD
}

function angleBetweenSignedXY(
  from: Readonly<AlsVector3>,
  to: Readonly<AlsVector3>,
): number {
  const fromSizeSquared = from.x * from.x + from.y * from.y
  const toSizeSquared = to.x * to.x + to.y * to.y
  const fromScale = fromSizeSquared > UE_SMALL_NUMBER
    ? 1 / Math.sqrt(fromSizeSquared)
    : 0
  const toScale = toSizeSquared > UE_SMALL_NUMBER
    ? 1 / Math.sqrt(toSizeSquared)
    : 0
  const fromX = from.x * fromScale
  const fromY = from.y * fromScale
  const toX = to.x * toScale
  const toY = to.y * toScale
  const cross = fromX * toY - fromY * toX
  const dot = Math.max(-1, Math.min(1, fromX * toX + fromY * toY))
  return Math.acos(dot) * 180 / Math.PI * Math.sign(cross)
}

function yawQuaternion(yawDegrees: number): AlsQuaternion {
  const halfAngle = yawDegrees * Math.PI / 360
  return quaternion(0, 0, Math.sin(halfAngle), Math.cos(halfAngle))
}

function cacheMovementBaseRelativeTransform(
  state: AlsFootState,
  movementBase: AlsFootLockMovementBase,
  worldLocation: Readonly<AlsVector3>,
  worldRotation: Readonly<AlsQuaternion>,
): void {
  state.lockMovementBaseRelativeLocation = unrotateVector(
    movementBase.rotation,
    subtract(worldLocation, movementBase.location),
  )
  state.lockMovementBaseRelativeRotation = normalizeQuaternion(
    multiplyQuaternion(
      inverseQuaternion(movementBase.rotation),
      worldRotation,
    ),
  )
}

export function createAlsFootState(
  thighAxis: Readonly<AlsVector3> = vector(),
): AlsFootState {
  return {
    lockAmount: 0,
    thighAxis: copyVector(thighAxis),
    targetLocation: vector(),
    targetRotation: quaternion(),
    lockLocation: vector(),
    lockRotation: quaternion(),
    lockComponentRelativeLocation: vector(),
    lockComponentRelativeRotation: quaternion(),
    lockMovementBaseRelativeLocation: vector(),
    lockMovementBaseRelativeRotation: quaternion(),
    finalLocation: vector(),
    finalRotation: quaternion(),
  }
}

/** FAlsFeetState defaults from AlsFeetState.h:50-78. */
export function createAlsFeetState(): AlsFeetState {
  return {
    pelvisRotation: quaternion(),
    footPlantedAmount: 0,
    feetCrossingAmount: 0,
    left: createAlsFootState(vector(0, 0, -1)),
    right: createAlsFootState(vector(0, 0, 1)),
  }
}

/**
 * Exact data boundary of `RefreshFeetOnGameThread()` (`AlsAnimationInstance.cpp:1128-1153`).
 *
 * The bridge resolves which authored IK/virtual-bone socket to read; this state seam owns the
 * copies so later worker-thread Refresh* calls observe one coherent pose snapshot.
 */
export function refreshFeetOnGameThread(
  state: AlsFeetState,
  input: AlsRefreshFeetOnGameThreadInput,
): AlsFeetState {
  state.pelvisRotation = copyQuaternion(input.pelvisRotation)
  state.left.targetLocation = copyVector(input.leftTarget.location)
  state.left.targetRotation = copyQuaternion(input.leftTarget.rotation)
  state.right.targetLocation = copyVector(input.rightTarget.location)
  state.right.targetRotation = copyQuaternion(input.rightTarget.rotation)
  return state
}

/** UAlsAnimationInstance::ProcessFootLockTeleport(), lines 1179-1204. */
export function processFootLockTeleport(
  state: AlsFootState,
  input: AlsProcessFootLockTeleportInput,
): AlsFootState {
  if (
    input.pendingUpdate
    || input.timeSinceTeleported > ALS_FOOT_LOCK_TELEPORT_GRACE_PERIOD
    || !isRelevant(input.ikAmount * state.lockAmount)
  ) {
    return state
  }

  state.lockLocation = transformPosition(
    input.componentTransform,
    state.lockComponentRelativeLocation,
  )
  state.lockRotation = transformRotation(
    input.componentTransform,
    state.lockComponentRelativeRotation,
  )

  if (input.movementBase.hasRelativeLocation) {
    cacheMovementBaseRelativeTransform(
      state,
      input.movementBase,
      state.lockLocation,
      state.lockRotation,
    )
  }
  return state
}

/**
 * Exact `RefreshFeet()` / `RefreshFoot()` orchestration (`cpp:1155-1177`).
 *
 * Curve values remain raw at this boundary: ALS clamps planted to [-1, 1], crossing and IK to
 * [0, 1], while `RefreshFootLock()` independently clamps each authored lock curve.
 */
export function refreshFeet(
  state: AlsFeetState,
  input: AlsRefreshFeetInput,
): AlsFeetState {
  state.footPlantedAmount = Math.max(
    -1,
    Math.min(1, input.footPlantedCurveAmount),
  )
  state.feetCrossingAmount = Math.max(
    0,
    Math.min(1, input.feetCrossingCurveAmount),
  )

  const refreshFoot = (
    foot: AlsFootState,
    ikCurveAmount: number,
    lockCurveAmount: number,
  ) => {
    const ikAmount = Math.max(0, Math.min(1, ikCurveAmount))
    processFootLockTeleport(foot, {
      ikAmount,
      pendingUpdate: input.pendingUpdate,
      timeSinceTeleported: input.timeSinceTeleported,
      componentTransform: input.componentTransform,
      movementBase: input.movementBase,
    })
    processFootLockBaseChange(foot, {
      ikAmount,
      pendingUpdate: input.pendingUpdate,
      baseChanged: input.baseChanged,
      componentTransform: input.componentTransform,
      movementBase: input.movementBase,
    })
    refreshFootLock(foot, {
      ikAmount,
      lockCurveAmount,
      componentTransform: input.componentTransform,
      deltaTime: input.deltaTime,
      movingSmooth: input.movingSmooth,
      grounded: input.grounded,
      pendingUpdate: input.pendingUpdate,
      disableFootLock: input.disableFootLock,
      movementBase: input.movementBase,
      pelvisRotation: state.pelvisRotation,
      footLockAngleLimit: input.footLockAngleLimit,
    })
  }

  refreshFoot(
    state.left,
    input.footLeftIkCurveAmount,
    input.footLeftLockCurveAmount,
  )
  refreshFoot(
    state.right,
    input.footRightIkCurveAmount,
    input.footRightLockCurveAmount,
  )
  return state
}

/** UAlsAnimationInstance::ProcessFootLockBaseChange(), lines 1206-1237. */
export function processFootLockBaseChange(
  state: AlsFootState,
  input: AlsProcessFootLockBaseChangeInput,
): AlsFootState {
  if (
    (!input.pendingUpdate && !input.baseChanged)
    || !isRelevant(input.ikAmount * state.lockAmount)
  ) {
    return state
  }

  if (input.pendingUpdate) {
    state.lockLocation = copyVector(state.targetLocation)
    state.lockRotation = copyQuaternion(state.targetRotation)
  }

  state.lockComponentRelativeLocation = inverseTransformPosition(
    input.componentTransform,
    state.lockLocation,
  )
  state.lockComponentRelativeRotation = inverseTransformRotation(
    input.componentTransform,
    state.lockRotation,
  )

  if (input.movementBase.hasRelativeLocation) {
    cacheMovementBaseRelativeTransform(
      state,
      input.movementBase,
      state.lockLocation,
      state.lockRotation,
    )
  } else {
    state.lockMovementBaseRelativeLocation = vector()
    state.lockMovementBaseRelativeRotation = quaternion()
  }
  return state
}

/** UAlsAnimationInstance::RefreshFootLock(), lines 1239-1376. */
export function refreshFootLock(
  state: AlsFootState,
  input: AlsRefreshFootLockInput,
): AlsFootState {
  let newLockAmount = Math.max(0, Math.min(1, input.lockCurveAmount))

  if (input.movingSmooth || !input.grounded) {
    newLockAmount = input.pendingUpdate
      ? 0
      : Math.max(
          0,
          Math.min(
            newLockAmount,
            state.lockAmount - input.deltaTime
              * (input.movingSmooth
                ? ALS_FOOT_LOCK_MOVING_DECREASE_SPEED
                : ALS_FOOT_LOCK_NOT_GROUNDED_DECREASE_SPEED),
          ),
        )
  }

  if (
    input.disableFootLock
    || !isRelevant(input.ikAmount * newLockAmount)
  ) {
    if (state.lockAmount > 0) {
      state.lockAmount = 0
      state.lockLocation = vector()
      state.lockRotation = quaternion()
      state.lockComponentRelativeLocation = vector()
      state.lockComponentRelativeRotation = quaternion()
      state.lockMovementBaseRelativeLocation = vector()
      state.lockMovementBaseRelativeRotation = quaternion()
    }

    state.finalLocation = inverseTransformPosition(
      input.componentTransform,
      state.targetLocation,
    )
    state.finalRotation = inverseTransformRotation(
      input.componentTransform,
      state.targetRotation,
    )
    return state
  }

  const newAmountEqualOne = isFullWeight(newLockAmount)
  const newAmountGreaterThanPrevious = newLockAmount > state.lockAmount

  // ALS permits an existing lock to blend out, or a full-weight curve to latch a new lock, but
  // deliberately never blends a partial curve value into an unlocked foot.
  if (newAmountEqualOne) {
    if (newAmountGreaterThanPrevious) {
      if (state.lockAmount <= ALS_FOOT_LOCK_CAPTURE_AMOUNT_THRESHOLD) {
        state.lockLocation = copyVector(state.targetLocation)
        state.lockRotation = copyQuaternion(state.targetRotation)
        state.lockComponentRelativeLocation = inverseTransformPosition(
          input.componentTransform,
          state.lockLocation,
        )
        state.lockComponentRelativeRotation = inverseTransformRotation(
          input.componentTransform,
          state.lockRotation,
        )
      }

      if (input.movementBase.hasRelativeLocation) {
        cacheMovementBaseRelativeTransform(
          state,
          input.movementBase,
          state.targetLocation,
          state.targetRotation,
        )
      } else {
        state.lockMovementBaseRelativeLocation = vector()
        state.lockMovementBaseRelativeRotation = quaternion()
      }
    }
    state.lockAmount = 1
  } else if (!newAmountGreaterThanPrevious) {
    state.lockAmount = newLockAmount
  }

  if (input.movementBase.hasRelativeLocation) {
    state.lockLocation = add(
      input.movementBase.location,
      rotateVector(
        input.movementBase.rotation,
        state.lockMovementBaseRelativeLocation,
      ),
    )
    state.lockRotation = normalizeQuaternion(
      multiplyQuaternion(
        input.movementBase.rotation,
        state.lockMovementBaseRelativeRotation,
      ),
    )
  }

  state.lockComponentRelativeLocation = inverseTransformPosition(
    input.componentTransform,
    state.lockLocation,
  )
  state.lockComponentRelativeRotation = inverseTransformRotation(
    input.componentTransform,
    state.lockRotation,
  )

  // UAlsVector::AngleBetweenSignedXY() measures the component-space lock against the pelvis-
  // rotated reference-pose thigh axis. The corrective rotation is about ALS's +Z up axis.
  const componentRelativeThighAxis = rotateVector(
    input.pelvisRotation,
    state.thighAxis,
  )
  const lockAngle = angleBetweenSignedXY(
    componentRelativeThighAxis,
    state.lockComponentRelativeLocation,
  )

  if (
    Math.abs(lockAngle)
    > input.footLockAngleLimit + UE_KINDA_SMALL_NUMBER
  ) {
    const constrainedLockAngle = Math.max(
      -input.footLockAngleLimit,
      Math.min(input.footLockAngleLimit, lockAngle),
    )
    const offsetRotation = yawQuaternion(constrainedLockAngle - lockAngle)
    state.lockComponentRelativeLocation = rotateVector(
      offsetRotation,
      state.lockComponentRelativeLocation,
    )
    state.lockComponentRelativeRotation = normalizeQuaternion(
      multiplyQuaternion(
        offsetRotation,
        state.lockComponentRelativeRotation,
      ),
    )
    state.lockLocation = transformPosition(
      input.componentTransform,
      state.lockComponentRelativeLocation,
    )
    state.lockRotation = transformRotation(
      input.componentTransform,
      state.lockComponentRelativeRotation,
    )

    if (input.movementBase.hasRelativeLocation) {
      cacheMovementBaseRelativeTransform(
        state,
        input.movementBase,
        state.lockLocation,
        state.lockRotation,
      )
    }
  }

  const finalLocation = vector(
    state.targetLocation.x
      + (state.lockLocation.x - state.targetLocation.x) * state.lockAmount,
    state.targetLocation.y
      + (state.lockLocation.y - state.targetLocation.y) * state.lockAmount,
    state.targetLocation.z
      + (state.lockLocation.z - state.targetLocation.z) * state.lockAmount,
  )
  const finalRotation = normalizeQuaternion(
    fastLerpQuaternion(
      state.targetRotation,
      state.lockRotation,
      state.lockAmount,
    ),
  )

  state.finalLocation = inverseTransformPosition(
    input.componentTransform,
    finalLocation,
  )
  state.finalRotation = inverseTransformRotation(
    input.componentTransform,
    finalRotation,
  )
  return state
}
