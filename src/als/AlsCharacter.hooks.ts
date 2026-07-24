import {
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier'
import { folder, useControls } from 'leva'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { LEVA_ROOTS } from '../app/levaRoots'
import {
  probeRapierAlsGround,
  rapierAlsCameraMovementBase,
  rapierAlsMovementBase,
} from '../engine/rapierAlsCapsuleSweep'
import type {
  RapierAlsCapsuleSweep,
  RapierAlsCapsuleSweepHit,
} from '../engine/rapierAlsCapsuleSweep'
import {
  getCharacterMovementFloorOffset,
} from '../engine/characterMovementFloor'
import { ALS_NO_BASED_MOVEMENT } from './State/AlsMovementBaseState'
import type { AlsBasedMovement } from './State/AlsMovementBaseState'
import {
  setRapierAlsStanceCapsules,
} from '../engine/rapierAlsStanceCapsules'
import {
  threeToUnrealVector,
  unrealToThreeVector,
  unrealYawDegreesToThreeRadians,
} from '../engine/unrealCoordinateSpace'
import {
  applyRotationYawSpeedAnimationCurve,
  createAlsCharacter,
  refreshAlsCharacter,
  refreshGroundedFacingTarget,
  setLocomotionMode,
  setStance,
  setTargetYawAngle,
} from './AlsCharacter'
import type {
  AlsCharacter,
  AlsLocomotionMode,
} from './AlsCharacter'
import {
  stepGroundedVelocity,
  stepInAirVelocity,
} from './AlsCharacterMovementComponent'
import { getRelativeAccelerationAmount } from './AlsAnimationInstance'
import type { AlsAnimationInstanceControls } from './AlsAnimationInstance'
import type { CharacterPoseSample } from '../app/CharacterPoseSample'
import {
  ALS_OVERLAY_MODES,
} from './AnimGraph/overlayMode'
import type { AlsOverlayMode } from './AnimGraph/overlayMode'
import {
  ALS_GAITS,
  ALS_ROTATION_MODES,
  ALS_STANCES,
  resolveDesiredGaitSpeed,
} from './Settings/AlsMovementSettings'
import { calculateMovingSmooth } from './Settings/AlsGeneralAnimationSettings'
import type {
  AlsGait,
  AlsRotationMode,
  AlsStance,
} from './Settings/AlsMovementSettings'
import { exponentialDecay } from './State/AlsGroundedState'
import { unwindDegrees } from './State/AlsLocomotionState'
import type { AlsVector3 } from './State/AlsLocomotionState'

// AAlsCharacter::AAlsCharacter(), cpp:36; UAlsCharacterMovementComponent(), cpp:132.
export const ALS_CAPSULE_RADIUS = 0.3
export const ALS_STANDING_CAPSULE_HALF_HEIGHT = 0.9
export const ALS_CROUCHING_CAPSULE_HALF_HEIGHT = 0.56
// AAlsCharacter::AAlsCharacter(), cpp:43. The mesh component stays 2 cm below the standing
// capsule base; aligning its rendered bounds to the floor would erase authored ALS placement.
export const ALS_MESH_RELATIVE_LOCATION_Z = -0.92
export const ALS_PHYSICS_TIMESTEP = 1 / 60

/*
 * B_Als_Character serializes no JumpZVelocity or WalkableFloorZ override. These are the UE
 * CharacterMovement defaults inherited by the sample, expressed in repository metres.
 */
export const ALS_RAPIER_JUMP_SPEED = 4.2
export const ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS = 0.71
export const ALS_RAPIER_GRAVITY = 9.8

export function getAlsCapsuleHalfHeight(stance: AlsStance): number {
  return stance === 'Crouching'
    ? ALS_CROUCHING_CAPSULE_HALF_HEIGHT
    : ALS_STANDING_CAPSULE_HALF_HEIGHT
}

/**
 * Reconstructs AActor::GetActorLocation(), which is the active capsule-root centre in ALS.
 *
 * Rapier keeps this sample's rigid-body anchor at standing height and offsets only the crouching
 * collider, so the backend anchor is not the ALS actor transform while crouched.
 */
export function resolveAlsActorLocation(
  rapierBodyAnchor: Readonly<AlsVector3>,
  stance: AlsStance,
  locomotionMode: AlsLocomotionMode,
  out: AlsVector3 = { x: 0, y: 0, z: 0 },
): AlsVector3 {
  out.x = rapierBodyAnchor.x
  out.y = rapierBodyAnchor.y
  out.z = rapierBodyAnchor.z
    + getAlsCapsuleHalfHeight(stance)
    - ALS_STANDING_CAPSULE_HALF_HEIGHT
    + getCharacterMovementFloorOffset(locomotionMode === 'Grounded')
  return out
}

/**
 * Resolves the mesh component's Y relative to the fixed Rapier body anchor.
 *
 * `UCharacterMovementComponent::Crouch()` lowers ALS's capsule root because
 * `bCrouchMaintainsBaseLocation` is true, then `ACharacter::OnStartCrouch()` adds the same
 * half-height adjustment to the mesh's relative location. Those two changes cancel in world
 * space. Rapier deliberately keeps its body anchor fixed, so its equivalent is to keep the mesh
 * offset fixed too.
 */
export function resolveAlsMeshRootRelativeY(
  _stance: AlsStance,
  locomotionMode: AlsLocomotionMode,
): number {
  return ALS_MESH_RELATIVE_LOCATION_Z
    + getCharacterMovementFloorOffset(locomotionMode === 'Grounded')
}

// Unreal Enhanced Input's default radial dead-zone lower threshold. The authored IMC mapping
// dump owns buttons/axes; this engine-level normalization only suppresses browser gamepad drift.
const GAMEPAD_DEAD_ZONE = 0.2
const COUNTER_CLOCKWISE_ROTATION_ANGLE_THRESHOLD = 5
const SPRINT_HOLD_TIME_THRESHOLD = 0.1
const IN_AIR_ROTATION_INTERPOLATION_SPEED = 5
const IN_AIR_AIMING_ROTATION_INTERPOLATION_SPEED = 15
const MIN_AIMING_YAW_ANGLE_LIMIT = 70
const UE_KINDA_SMALL_NUMBER = 1e-4

/** Enhanced Input `UInputTriggerHold` threshold check for IMC_Als_Default's Sprint mapping. */
export function hasTriggeredSprintHold(heldTime: number): boolean {
  return heldTime + Number.EPSILON >= SPRINT_HOLD_TIME_THRESHOLD
}

interface InputAxes {
  right: number
  forward: number
}

interface GamepadInput extends InputAxes {
  jump: boolean
  sprint: boolean
  walk: boolean
  crouch: boolean
  aim: boolean
  rotationMode: boolean
}

interface CharacterControlValues {
  desiredGait: AlsGait
  desiredStance: AlsStance
  desiredRotationMode: AlsRotationMode
  desiredAiming: boolean
  overlayMode: AlsOverlayMode
  movementOverride: boolean
  speed: number
  direction: number
  rotateInPlace: boolean
  viewYawOverride: boolean
  viewYaw: number
}

export interface AlsCharacterBridge {
  readonly character: MutableRefObject<AlsCharacter>
  readonly animationControls:
    MutableRefObject<AlsCharacterAnimationControls>
  /** Curves published by the preceding animation evaluation for AAlsCharacter::Tick(). */
  readonly animationCurves:
    MutableRefObject<AlsCharacterAnimationCurves>
  /**
   * The evaluator installs UAlsAnimationInstance::Jump() here. The character invokes it only
   * after the movement backend accepts the jump, matching OnJumpedNetworked().
   */
  readonly onJumped: MutableRefObject<(() => void) | null>
  readonly overlayMode: AlsOverlayMode
}

export interface AlsCharacterAnimationCurves {
  rotationYawOffset: number
  rotationYawSpeed: number
}

/**
 * Character-owned fields passed across the animation update boundary. They remain an
 * intersection until AlsAnimationInstance lands the matching live InAir evaluator.
 */
export interface AlsCharacterAnimationControls
  extends AlsAnimationInstanceControls {
  locomotionMode: AlsLocomotionMode
  scale: number
  location: Readonly<AlsVector3>
  actorYawAngle: number
  velocity: Readonly<AlsVector3>
  capsuleRadius: number
  capsuleHalfHeight: number
  walkableFloorAngleCos: number
}

export interface AlsCharacterAnimationSnapshotInput {
  readonly character: AlsCharacter
  readonly location: Readonly<AlsVector3>
  readonly basedMovement: Readonly<AlsBasedMovement>
  readonly acceleration: Readonly<AlsVector3>
  readonly overlayMode: AlsOverlayMode
  readonly movementOverride: boolean
  readonly speedOverride: number
  readonly directionOverride: number
  readonly rotateInPlaceOverride: boolean
}

/**
 * Publishes one coherent `NativeUpdateAnimation()` character snapshot.
 *
 * ALS first copies character modes (`AlsAnimationInstance.cpp:118-124`), then MovementBase,
 * View, and the complete LocomotionState (`cpp:583-666`). Keeping that order in one pure seam
 * prevents a post-physics mode change from mixing new capsule data with prior-frame stance,
 * speed, gait, or direction.
 */
export function publishAlsCharacterAnimationSnapshot(
  output: AlsCharacterAnimationControls,
  input: AlsCharacterAnimationSnapshotInput,
): AlsCharacterAnimationControls {
  const { character } = input
  const state = character.locomotionState

  output.locomotionMode = character.locomotionMode
  output.rotationMode = character.rotationMode
  output.stance = character.stance
  output.gait = input.movementOverride
    ? character.desiredGait
    : character.gait
  output.overlayMode = input.overlayMode

  output.basedMovement = input.basedMovement

  output.viewYawAngle = unwindDegrees(
    character.viewYawAngle - character.actorYawAngle,
  )
  output.viewYawSpeed = character.viewYawSpeed

  output.hasInput = state.hasInput
  output.speed = input.movementOverride
    ? Math.max(0, input.speedOverride)
    : state.speed
  output.velocity = state.velocity
  output.direction = input.movementOverride
    ? input.directionOverride
    : unwindDegrees(
        state.velocityYawAngle - character.actorYawAngle,
      )
  output.moving = input.movementOverride
    ? input.speedOverride > 0
    : state.moving
  output.movingSmooth = input.movementOverride
    ? input.speedOverride > 0
    : calculateMovingSmooth(state)
  output.location = input.location
  output.actorYawAngle = character.actorYawAngle
  output.scale = 1
  output.capsuleRadius = ALS_CAPSULE_RADIUS
  output.capsuleHalfHeight = getAlsCapsuleHalfHeight(character.stance)
  output.walkableFloorAngleCos = ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS

  const relativeAccelerationAmount = getRelativeAccelerationAmount({
    actorYaw: character.actorYawAngle * Math.PI / 180,
    acceleration: input.acceleration,
    velocity: state.velocity,
    maxAcceleration: character.movement.maxAccelerationWalking,
    maxBrakingDeceleration:
      character.movement.brakingDecelerationWalking,
  })
  output.relativeAccelerationAmount.x = input.movementOverride
    ? 0
    : relativeAccelerationAmount.x
  output.relativeAccelerationAmount.y = input.movementOverride
    ? 0
    : relativeAccelerationAmount.y
  output.rotateInPlace = input.rotateInPlaceOverride
  return output
}

/**
 * Exact live selection seam for the `FBasedMovementInfo` consumed by
 * `UAlsCameraComponent::TickCamera()` (`AlsCameraComponent.cpp:180-207`).
 *
 * Rapier can retain a nearby floor sweep while airborne, but CharacterMovement exposes no
 * movement base off Grounded. Static supports deliberately retain identity even though their
 * relative-rotation flag is false.
 */
export function resolveAlsCameraMovementBaseSnapshot(
  locomotionMode: AlsLocomotionMode,
  groundSupport: Readonly<RapierAlsCapsuleSweepHit> | null,
  relativeRotation = false,
) {
  return locomotionMode === 'Grounded'
    ? rapierAlsCameraMovementBase(groundSupport, relativeRotation)
    : null
}

interface AlsJumpRequestRef {
  current: boolean
}

/** Queues one jump input for the next fixed character update. */
export function requestAlsJumpInput(request: AlsJumpRequestRef): void {
  request.current = true
}

/** Consumes a queued jump exactly once at the fixed character-update boundary. */
export function consumeAlsJumpInput(request: AlsJumpRequestRef): boolean {
  const requested = request.current
  request.current = false
  return requested
}

function clampMagnitude(axes: InputAxes): InputAxes {
  const magnitude = Math.hypot(axes.right, axes.forward)
  if (magnitude > 1) {
    axes.right /= magnitude
    axes.forward /= magnitude
  }
  return axes
}

function applyRadialDeadZone(axes: InputAxes): InputAxes {
  const magnitude = Math.hypot(axes.right, axes.forward)
  if (magnitude <= GAMEPAD_DEAD_ZONE) {
    axes.right = 0
    axes.forward = 0
    return axes
  }
  const scaledMagnitude = Math.min(
    1,
    (magnitude - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE),
  )
  axes.right *= scaledMagnitude / magnitude
  axes.forward *= scaledMagnitude / magnitude
  return axes
}

function sampleGamepad(out: GamepadInput): GamepadInput {
  out.right = 0
  out.forward = 0
  out.jump = false
  out.sprint = false
  out.walk = false
  out.crouch = false
  out.aim = false
  out.rotationMode = false
  const gamepads = navigator.getGamepads?.()
  if (!gamepads) return out
  const gamepad = Array.from(gamepads).find(
    (candidate) => candidate?.connected && candidate.axes.length >= 2,
  )
  if (!gamepad) return out

  out.right = gamepad.axes[0] ?? 0
  out.forward = -(gamepad.axes[1] ?? 0)
  applyRadialDeadZone(out)
  // IMC_Als_Default: FaceButtonBottom/Right, RightShoulder, LeftThumbstick, LeftShoulder, DPadLeft.
  out.jump = gamepad.buttons[0]?.pressed ?? false
  out.sprint = gamepad.buttons[1]?.pressed ?? false
  out.walk = gamepad.buttons[5]?.pressed ?? false
  out.crouch = gamepad.buttons[10]?.pressed ?? false
  out.aim = gamepad.buttons[4]?.pressed ?? false
  out.rotationMode = gamepad.buttons[14]?.pressed ?? false
  return out
}

/** AAlsCharacterExample::Input_OnMove(): view-forward plus its counter-clockwise perpendicular. */
export function resolveCameraRelativeInput(
  axes: Readonly<InputAxes>,
  viewYawAngle: number,
  out: AlsVector3 = { x: 0, y: 0, z: 0 },
): AlsVector3 {
  const clamped = clampMagnitude({
    right: axes.right,
    forward: axes.forward,
  })
  const radians = viewYawAngle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  out.x = cosine * clamped.forward - sine * clamped.right
  out.y = sine * clamped.forward + cosine * clamped.right
  out.z = 0
  return out
}

function remapCounterClockwise(angle: number): number {
  return angle > 180 - COUNTER_CLOCKWISE_ROTATION_ANGLE_THRESHOLD
    ? angle - 360
    : angle
}

function interpolateAngleConstant(
  current: number,
  target: number,
  deltaTime: number,
  speed: number,
): number {
  if (speed <= 0 || Math.abs(current - target) <= 1e-8) {
    return unwindDegrees(target)
  }
  const delta = remapCounterClockwise(unwindDegrees(target - current))
  const maximumDelta = speed * Math.max(0, deltaTime)
  return unwindDegrees(
    current + THREE.MathUtils.clamp(delta, -maximumDelta, maximumDelta),
  )
}

function lerpAngle(from: number, to: number, ratio: number): number {
  const delta = remapCounterClockwise(unwindDegrees(to - from))
  return unwindDegrees(from + delta * ratio)
}

/** Exact SetRotationExtraSmooth/SetRotationSmooth actor-yaw step used by grounded ALS modes. */
export function stepGroundedCharacterYaw(
  character: AlsCharacter,
  deltaTime: number,
  rotationYawOffset = 0,
  rotationYawSpeed = 0,
): number {
  if (
    character.locomotionMode !== 'Grounded'
    || character.locomotionAction !== null
  ) {
    return character.actorYawAngle
  }

  if (!character.locomotionState.moving) {
    const previousActorYawAngle = character.actorYawAngle
    character.actorYawAngle = applyRotationYawSpeedAnimationCurve(
      character.actorYawAngle,
      rotationYawSpeed,
      deltaTime,
    )
    if (character.actorYawAngle !== previousActorYawAngle) {
      setTargetYawAngle(character, character.actorYawAngle)
    }
  }

  const target = refreshGroundedFacingTarget(character, rotationYawOffset)
  if (target.rotationInterpolationSpeed <= 0) {
    return character.actorYawAngle
  }

  const state = character.locomotionState
  state.targetYawAngle = target.yawAngle
  state.smoothTargetYawAngle = target.targetYawAngleRotationSpeed > 0
    ? interpolateAngleConstant(
        state.smoothTargetYawAngle,
        state.targetYawAngle,
        deltaTime,
        target.targetYawAngleRotationSpeed,
      )
    : state.targetYawAngle
  state.viewRelativeTargetYawAngle = unwindDegrees(
    character.viewYawAngle - state.targetYawAngle,
  )
  character.actorYawAngle = lerpAngle(
    character.actorYawAngle,
    state.smoothTargetYawAngle,
    exponentialDecay(deltaTime, target.rotationInterpolationSpeed),
  )
  return character.actorYawAngle
}

function refreshTargetYawAngleUsingActorRotation(
  character: AlsCharacter,
): void {
  setTargetYawAngle(character, character.actorYawAngle)
}

function setRotationSmooth(
  character: AlsCharacter,
  targetYawAngle: number,
  deltaTime: number,
  interpolationSpeed: number,
): void {
  setTargetYawAngle(character, targetYawAngle)
  character.actorYawAngle = lerpAngle(
    character.actorYawAngle,
    character.locomotionState.smoothTargetYawAngle,
    exponentialDecay(deltaTime, interpolationSpeed),
  )
}

/**
 * AAlsCharacter::RefreshInAirRotation(), cpp:1812-1879.
 *
 * This includes all three authored EAlsInAirRotationMode branches. The C++ class default is
 * RotateToVelocityOnJump; CS_Als_Default overrides it to KeepRelativeRotation.
 */
export function stepInAirCharacterYaw(
  character: AlsCharacter,
  deltaTime: number,
): number {
  if (character.locomotionMode !== 'InAir') {
    return character.actorYawAngle
  }

  const state = character.locomotionState
  if (character.rotationMode === 'Aiming') {
    setRotationSmooth(
      character,
      character.viewYawAngle,
      deltaTime,
      IN_AIR_AIMING_ROTATION_INTERPOLATION_SPEED,
    )

    // ConstrainAimingRotation() with its default false secondary-constraint argument.
    state.aimingLimitAppliedThisFrame = true
    if (state.resetAimingLimit) state.aimingYawAngleLimit = 180

    let viewRelativeAngle = unwindDegrees(
      character.viewYawAngle - character.actorYawAngle,
    )
    if (
      Math.abs(viewRelativeAngle)
      <= MIN_AIMING_YAW_ANGLE_LIMIT + UE_KINDA_SMALL_NUMBER
    ) {
      state.aimingYawAngleLimit = MIN_AIMING_YAW_ANGLE_LIMIT
    } else {
      viewRelativeAngle = remapCounterClockwise(viewRelativeAngle)
      if (
        Math.abs(viewRelativeAngle)
        > state.aimingYawAngleLimit + UE_KINDA_SMALL_NUMBER
      ) {
        viewRelativeAngle = THREE.MathUtils.clamp(
          viewRelativeAngle,
          -state.aimingYawAngleLimit,
          state.aimingYawAngleLimit,
        )
      } else {
        state.aimingYawAngleLimit = Math.max(
          Math.abs(viewRelativeAngle),
          MIN_AIMING_YAW_ANGLE_LIMIT,
        )
      }
      character.actorYawAngle = unwindDegrees(
        character.viewYawAngle - viewRelativeAngle,
      )
    }
    state.resetAimingLimit = false
    return character.actorYawAngle
  }

  state.aimingLimitAppliedThisFrame = false
  state.resetAimingLimit = true

  if (
    character.rotationMode !== 'VelocityDirection'
    && character.rotationMode !== 'ViewDirection'
  ) {
    refreshTargetYawAngleUsingActorRotation(character)
    return character.actorYawAngle
  }

  if (
    character.settings.inAirRotationMode === 'RotateToVelocityOnJump'
    && state.moving
  ) {
    setRotationSmooth(
      character,
      state.velocityYawAngle,
      deltaTime,
      IN_AIR_ROTATION_INTERPOLATION_SPEED,
    )
  } else if (
    character.settings.inAirRotationMode === 'KeepRelativeRotation'
  ) {
    setRotationSmooth(
      character,
      character.viewYawAngle - state.viewRelativeTargetYawAngle,
      deltaTime,
      IN_AIR_ROTATION_INTERPOLATION_SPEED,
    )
  } else {
    refreshTargetYawAngleUsingActorRotation(character)
  }

  return character.actorYawAngle
}

export type AlsJumpInputResult = 'Rejected' | 'Uncrouched' | 'Jumped'

/**
 * AAlsCharacterExample::Input_OnJump() plus AAlsCharacter::Jump().
 * Action systems own the preceding ragdoll/mantle branches. The movement backend applies the
 * inherited UE vertical speed only after this policy returns Jumped.
 */
export function handleAlsJumpInput(
  character: AlsCharacter,
): AlsJumpInputResult {
  if (character.stance === 'Crouching') {
    character.desiredStance = 'Standing'
    setStance(character, 'Standing')
    return 'Uncrouched'
  }
  if (
    character.stance !== 'Standing'
    || character.locomotionMode !== 'Grounded'
  ) {
    return 'Rejected'
  }

  setLocomotionMode(character, 'InAir')
  return 'Jumped'
}

/**
 * Adapts Rapier ground state to AAlsCharacter::OnMovementModeChanged() Walking/Falling tags.
 */
export function refreshRapierAlsLocomotionMode(
  character: AlsCharacter,
  groundValid: boolean,
  verticalVelocity: number,
): AlsLocomotionMode {
  if (
    character.locomotionMode === 'InAir'
    && verticalVelocity <= 0
    && groundValid
  ) {
    setLocomotionMode(character, 'Grounded')
  } else if (
    character.locomotionMode === 'Grounded'
    // Resting Rapier contacts can oscillate by floating-point ulps; match UE's
    // KINDA_SMALL_NUMBER tolerance before exposing Falling to ALS.
    && verticalVelocity < -UE_KINDA_SMALL_NUMBER
    && !groundValid
  ) {
    setLocomotionMode(character, 'InAir')
  }
  return character.locomotionMode
}

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

/**
 * React/Rapier boundary for the framework-free AAlsCharacter and movement-component analogs.
 * Physics vectors are converted once here; all policy and state remain in ALS coordinates.
 */
export function useAlsCharacter(
  rigidBody: MutableRefObject<RapierRigidBody | null>,
  standingCapsule: MutableRefObject<RapierCollider | null>,
  crouchingCapsule: MutableRefObject<RapierCollider | null>,
  characterRoot: MutableRefObject<THREE.Group | null>,
  poseSample: MutableRefObject<CharacterPoseSample>,
  sweepCapsule?: RapierAlsCapsuleSweep,
): AlsCharacterBridge {
  const [{
    desiredGait,
    desiredStance,
    desiredRotationMode,
    desiredAiming,
    overlayMode,
    movementOverride,
    speed,
    direction,
    rotateInPlace,
    viewYawOverride,
    viewYaw,
  }, setControls] = useControls(
    LEVA_ROOTS.movement,
    () => ({
      desiredGait: {
        value: 'Running' as AlsGait,
        options: ALS_GAITS,
        label: 'DesiredGait',
      },
      desiredStance: {
        value: 'Standing' as AlsStance,
        options: ALS_STANCES,
        label: 'DesiredStance',
      },
      desiredRotationMode: {
        value: 'ViewDirection' as AlsRotationMode,
        options: ALS_ROTATION_MODES,
        label: 'DesiredRotationMode',
      },
      desiredAiming: {
        value: false,
        label: 'DesiredAiming',
      },
      overlayMode: {
        value: 'Default' as AlsOverlayMode,
        options: ALS_OVERLAY_MODES,
        label: 'OverlayMode',
      },
      'Debug Overrides': folder({
        movementOverride: {
          value: false,
          label: 'override locomotion',
        },
        speed: {
          value: resolveDesiredGaitSpeed('Running', 'Standing'),
          min: 0,
          max: 6.5,
          step: 0.05,
          label: 'speed (m/s)',
        },
        direction: {
          value: 0,
          min: -180,
          max: 180,
          step: 1,
          label: 'direction (deg)',
        },
        rotateInPlace: {
          value: false,
          label: 'RotateInPlace',
        },
        viewYawOverride: {
          value: false,
          label: 'override view yaw',
        },
        viewYaw: {
          value: 0,
          min: -180,
          max: 180,
          step: 1,
          label: 'view yaw (deg)',
        },
      }, { collapsed: true }),
    }),
    { order: 1 },
  )

  const character = useRef(createAlsCharacter())
  poseSample.current.character = character.current
  useEffect(() => () => {
    if (poseSample.current.character === character.current) {
      poseSample.current.character = null
      poseSample.current.ownerRigidBody = null
      poseSample.current.movementBase = null
    }
  }, [poseSample])
  const animationControls = useRef<AlsCharacterAnimationControls>({
    gait: 'Walking',
    moving: false,
    movingSmooth: false,
    locomotionMode: 'Grounded',
    scale: 1,
    location: { x: 0, y: 0, z: 0 },
    actorYawAngle: 0,
    basedMovement: ALS_NO_BASED_MOVEMENT,
    velocity: { x: 0, y: 0, z: 0 },
    capsuleRadius: ALS_CAPSULE_RADIUS,
    capsuleHalfHeight: ALS_STANDING_CAPSULE_HALF_HEIGHT,
    walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
    stance: 'Standing',
    rotationMode: 'ViewDirection',
    overlayMode: 'Default',
    speed: 0,
    direction: 0,
    relativeAccelerationAmount: { x: 0, y: 0 },
    rotateInPlace: false,
    viewYawAngle: 0,
    viewYawSpeed: 0,
  })
  const animationCurves = useRef<AlsCharacterAnimationCurves>({
    rotationYawOffset: 0,
    rotationYawSpeed: 0,
  })
  const values = useRef<CharacterControlValues>({
    desiredGait: 'Running',
    desiredStance: 'Standing',
    desiredRotationMode: 'ViewDirection',
    desiredAiming: false,
    overlayMode: 'Default',
    movementOverride: false,
    speed: resolveDesiredGaitSpeed('Running', 'Standing'),
    direction: 0,
    rotateInPlace: false,
    viewYawOverride: false,
    viewYaw: 0,
  })
  values.current = {
    desiredGait: desiredGait as AlsGait,
    desiredStance: desiredStance as AlsStance,
    desiredRotationMode: desiredRotationMode as AlsRotationMode,
    desiredAiming,
    overlayMode: overlayMode as AlsOverlayMode,
    movementOverride,
    speed,
    direction,
    rotateInPlace,
    viewYawOverride,
    viewYaw,
  }

  const pressedKeys = useRef(new Set<string>())
  const aimingWithPointer = useRef(false)
  const gamepadInput = useRef<GamepadInput>({
    right: 0,
    forward: 0,
    jump: false,
    sprint: false,
    walk: false,
    crouch: false,
    aim: false,
    rotationMode: false,
  })
  const previousGamepadInput = useRef({
    jump: false,
    walk: false,
    crouch: false,
    rotationMode: false,
  })
  const sprintHoldTime = useRef(0)
  const sprintActionActive = useRef(false)
  const jumpRequested = useRef(false)
  const onJumped = useRef<(() => void) | null>(null)
  const inputAxes = useRef<InputAxes>({ right: 0, forward: 0 })
  const inputDirection = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const actualVelocity = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const rapierBodyAnchor = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const actorLocation = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const groundProbeLocation = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const groundSupport = useRef<RapierAlsCapsuleSweepHit | null>(null)
  const acceleration = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const desiredVelocity = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const renderedVelocity = useRef({ x: 0, y: 0, z: 0 })
  const debugViewYawWorld = useRef(0)
  const previousStance = useRef<AlsStance>('Standing')
  const capsulesInitialized = useRef(false)

  useEffect(() => {
    if (viewYawOverride) {
      debugViewYawWorld.current = unwindDegrees(
        character.current.actorYawAngle + viewYaw,
      )
    }
  }, [viewYaw, viewYawOverride])

  useEffect(() => {
    setControls({
      speed: resolveDesiredGaitSpeed(
        desiredGait as AlsGait,
        desiredStance as AlsStance,
        desiredRotationMode as AlsRotationMode,
      ),
    })
  }, [
    desiredGait,
    desiredRotationMode,
    desiredStance,
    setControls,
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return
      pressedKeys.current.add(event.code)
      if (event.repeat) return

      if (event.code === 'ControlLeft') {
        const stance = values.current.desiredStance === 'Standing'
          ? 'Crouching'
          : 'Standing'
        setControls({ desiredStance: stance })
      } else if (event.code === 'AltLeft') {
        const gait = values.current.desiredGait === 'Walking'
          ? 'Running'
          : 'Walking'
        setControls({ desiredGait: gait })
      } else if (event.code === 'Digit1') {
        const rotationMode =
          values.current.desiredRotationMode === 'VelocityDirection'
            ? 'ViewDirection'
            : 'VelocityDirection'
        setControls({ desiredRotationMode: rotationMode })
      } else if (event.code === 'Space') {
        requestAlsJumpInput(jumpRequested)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.current.delete(event.code)
    }
    const clearInputs = () => {
      pressedKeys.current.clear()
      aimingWithPointer.current = false
      jumpRequested.current = false
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) aimingWithPointer.current = true
    }
    const onPointerUp = (event: PointerEvent) => {
      if (event.button === 2) aimingWithPointer.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInputs)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInputs)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [setControls])

  useEffect(() => {
    window.__setSpeed = (value: number) => setControls({
      speed: Math.max(0, value),
      movementOverride: true,
    })
    window.__setGait = (value: AlsGait) => {
      if (ALS_GAITS.includes(value)) setControls({ desiredGait: value })
    }
    window.__setStance = (value: AlsStance) => {
      if (ALS_STANCES.includes(value)) setControls({ desiredStance: value })
    }
    window.__setRotationMode = (value: AlsRotationMode) => {
      if (ALS_ROTATION_MODES.includes(value)) {
        setControls({ desiredRotationMode: value })
      }
    }
    window.__setOverlayMode = (value: AlsOverlayMode) => {
      if (ALS_OVERLAY_MODES.includes(value)) setControls({ overlayMode: value })
    }
    window.__setViewYaw = (value: number) => {
      debugViewYawWorld.current = unwindDegrees(
        character.current.actorYawAngle + value,
      )
      setControls({ viewYaw: value, viewYawOverride: true })
    }
    window.__setMovementOverride = (enabled: boolean) => {
      setControls({ movementOverride: enabled })
    }
    window.__triggerJump = () => {
      requestAlsJumpInput(jumpRequested)
    }
    return () => {
      delete window.__setSpeed
      delete window.__setGait
      delete window.__setStance
      delete window.__setRotationMode
      delete window.__setOverlayMode
      delete window.__setViewYaw
      delete window.__setMovementOverride
      delete window.__triggerJump
    }
  }, [setControls])

  useBeforePhysicsStep(() => {
    const body = rigidBody.current
    if (!body) return
    if (!capsulesInitialized.current) {
      setRapierAlsStanceCapsules(
        standingCapsule.current,
        crouchingCapsule.current,
        'Standing',
      )
      capsulesInitialized.current = true
    }

    const controls = values.current
    const current = character.current
    poseSample.current.character = current
    poseSample.current.ownerRigidBody = body
    const keys = pressedKeys.current
    const gamepad = sampleGamepad(gamepadInput.current)
    const previousGamepad = previousGamepadInput.current
    if (gamepad.jump && !previousGamepad.jump) {
      requestAlsJumpInput(jumpRequested)
    }
    if (gamepad.walk && !previousGamepad.walk) {
      setControls({
        desiredGait:
          controls.desiredGait === 'Walking' ? 'Running' : 'Walking',
      })
    }
    if (gamepad.crouch && !previousGamepad.crouch) {
      setControls({
        desiredStance:
          controls.desiredStance === 'Standing' ? 'Crouching' : 'Standing',
      })
    }
    if (gamepad.rotationMode && !previousGamepad.rotationMode) {
      setControls({
        desiredRotationMode:
          controls.desiredRotationMode === 'VelocityDirection'
            ? 'ViewDirection'
            : 'VelocityDirection',
      })
    }
    previousGamepad.jump = gamepad.jump
    previousGamepad.walk = gamepad.walk
    previousGamepad.crouch = gamepad.crouch
    previousGamepad.rotationMode = gamepad.rotationMode

    const axes = inputAxes.current
    axes.right =
      (keys.has('KeyD') ? 1 : 0)
      - (keys.has('KeyA') ? 1 : 0)
      + gamepad.right
    axes.forward =
      (keys.has('KeyW') ? 1 : 0)
      - (keys.has('KeyS') ? 1 : 0)
      + gamepad.forward
    clampMagnitude(axes)

    const sprintHeld =
      keys.has('ShiftLeft') || gamepad.sprint
    if (sprintHeld) {
      sprintHoldTime.current += ALS_PHYSICS_TIMESTEP
      sprintActionActive.current =
        hasTriggeredSprintHold(sprintHoldTime.current)
    } else {
      if (sprintActionActive.current) {
        // AAlsCharacterExample::Input_OnSprint(false) returns to Running.
        setControls({ desiredGait: 'Running' })
      }
      sprintHoldTime.current = 0
      sprintActionActive.current = false
    }
    current.desiredGait = sprintActionActive.current
      ? 'Sprinting'
      : controls.desiredGait
    current.desiredStance = controls.desiredStance
    current.desiredRotationMode = controls.desiredRotationMode
    current.desiredAiming =
      controls.desiredAiming || aimingWithPointer.current || gamepad.aim
    setStance(
      current,
      current.locomotionMode === 'InAir'
        ? 'Standing'
        : current.desiredStance,
    )

    if (controls.viewYawOverride) {
      current.viewYawAngle = debugViewYawWorld.current
    }
    resolveCameraRelativeInput(
      axes,
      current.viewYawAngle,
      inputDirection.current,
    )
    // TryConsumePrePenetrationAdjustmentVelocity() observes the intended velocity separately
    // from collision-adjusted GetVelocity(). Snapshot it before refreshLocomotion() replaces the
    // movement component's working velocity with Rapier's actual result.
    desiredVelocity.current.x = current.movement.velocity.x
    desiredVelocity.current.y = current.movement.velocity.y
    desiredVelocity.current.z = current.movement.velocity.z
    const linearVelocity = body.linvel()
    threeToUnrealVector(linearVelocity, actualVelocity.current)
    threeToUnrealVector(body.translation(), rapierBodyAnchor.current)
    resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      actorLocation.current,
    )
    const queryCapsuleHalfHeight = getAlsCapsuleHalfHeight(current.stance)
    const queryLocation = resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      groundProbeLocation.current,
    )
    let currentGroundSupport: RapierAlsCapsuleSweepHit | null = null
    if (sweepCapsule) {
      currentGroundSupport = probeRapierAlsGround(sweepCapsule, {
        location: queryLocation,
        capsuleRadius: ALS_CAPSULE_RADIUS,
        capsuleHalfHeight: queryCapsuleHalfHeight,
        walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
      })
      refreshRapierAlsLocomotionMode(
        current,
        currentGroundSupport !== null,
        actualVelocity.current.z,
      )
    }
    groundSupport.current = currentGroundSupport
    if (consumeAlsJumpInput(jumpRequested)) {
      const jumpResult = handleAlsJumpInput(current)
      if (jumpResult === 'Uncrouched') {
        values.current.desiredStance = 'Standing'
        setControls({ desiredStance: 'Standing' })
      } else if (jumpResult === 'Jumped') {
        actualVelocity.current.z = ALS_RAPIER_JUMP_SPEED
        onJumped.current?.()
      }
    }
    const previousVelocityX = current.locomotionState.velocity.x
    const previousVelocityY = current.locomotionState.velocity.y
    const previousVelocityZ = current.locomotionState.velocity.z
    refreshAlsCharacter(
      current,
      inputDirection.current,
      actualVelocity.current,
      desiredVelocity.current,
    )
    acceleration.current.x =
      (current.locomotionState.velocity.x - previousVelocityX)
      / ALS_PHYSICS_TIMESTEP
    acceleration.current.y =
      (current.locomotionState.velocity.y - previousVelocityY)
      / ALS_PHYSICS_TIMESTEP
    acceleration.current.z =
      (current.locomotionState.velocity.z - previousVelocityZ)
      / ALS_PHYSICS_TIMESTEP
    if (current.locomotionMode === 'InAir') {
      stepInAirVelocity(
        current.movement,
        inputDirection.current,
        ALS_PHYSICS_TIMESTEP,
      )
    } else {
      stepGroundedVelocity(
        current.movement,
        inputDirection.current,
        ALS_PHYSICS_TIMESTEP,
        current.viewYawAngle,
      )
    }
    unrealToThreeVector(current.movement.velocity, renderedVelocity.current)
    body.setLinvel(renderedVelocity.current, true)

    if (current.locomotionMode === 'InAir') {
      stepInAirCharacterYaw(current, ALS_PHYSICS_TIMESTEP)
    } else if (current.locomotionMode === 'Grounded') {
      stepGroundedCharacterYaw(
        current,
        ALS_PHYSICS_TIMESTEP,
        animationCurves.current.rotationYawOffset,
        animationCurves.current.rotationYawSpeed,
      )
    }
    const root = characterRoot.current
    if (root) {
      root.position.y = resolveAlsMeshRootRelativeY(
        current.stance,
        current.locomotionMode,
      )
      root.rotation.y = unrealYawDegreesToThreeRadians(
        current.actorYawAngle,
      )
    }

    if (current.stance !== previousStance.current) {
      previousStance.current = current.stance
      setRapierAlsStanceCapsules(
        standingCapsule.current,
        crouchingCapsule.current,
        current.stance,
      )
    }

    const state = current.locomotionState
    const frame = animationControls.current
    resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      actorLocation.current,
    )
    publishAlsCharacterAnimationSnapshot(frame, {
      character: current,
      location: actorLocation.current,
      basedMovement: current.locomotionMode === 'Grounded'
        ? rapierAlsMovementBase(groundSupport.current)
        : ALS_NO_BASED_MOVEMENT,
      acceleration: acceleration.current,
      overlayMode: controls.overlayMode,
      movementOverride: controls.movementOverride,
      speedOverride: controls.speed,
      directionOverride: controls.direction,
      rotateInPlaceOverride: controls.rotateInPlace,
    })
    const activeCapsuleHalfHeight = frame.capsuleHalfHeight

    const activeCollider = current.stance === 'Crouching'
      ? crouchingCapsule.current
      : standingCapsule.current
    const colliderTranslation = activeCollider?.translationWrtParent()
    const bodyTranslation = body.translation()
    const colliderHalfExtent =
      activeCollider
        ? activeCollider.halfHeight() + activeCollider.radius()
        : activeCapsuleHalfHeight
    const colliderBottomY = bodyTranslation.y
      + (colliderTranslation?.y ?? 0)
      - colliderHalfExtent
    window.__alsCharacterState = {
      actorYawAngle: current.actorYawAngle,
      desiredGait: current.desiredGait,
      desiredStance: current.desiredStance,
      gait: current.gait,
      stance: current.stance,
      rotationMode: current.rotationMode,
      locomotionMode: current.locomotionMode,
      speed: state.speed,
      direction: frame.direction,
      moving: state.moving,
      capsuleBottomY: colliderBottomY,
      capsuleHalfHeight: colliderHalfExtent,
      meshBaseOffsetY:
        characterRoot.current?.position.y ?? Number.NaN,
      position: bodyTranslation,
      velocity: body.linvel(),
      verticalVelocity: state.velocity.z,
    }
  })

  useAfterPhysicsStep(() => {
    const body = rigidBody.current
    if (!body) {
      poseSample.current.movementBase = null
      return
    }

    const current = character.current
    threeToUnrealVector(body.translation(), rapierBodyAnchor.current)
    threeToUnrealVector(body.linvel(), actualVelocity.current)
    const queryCapsuleHalfHeight = getAlsCapsuleHalfHeight(current.stance)
    const queryLocation = resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      groundProbeLocation.current,
    )
    const currentGroundSupport = sweepCapsule
      ? probeRapierAlsGround(sweepCapsule, {
          location: queryLocation,
          capsuleRadius: ALS_CAPSULE_RADIUS,
          capsuleHalfHeight: queryCapsuleHalfHeight,
          walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
        })
      : null
    groundSupport.current = currentGroundSupport
    if (sweepCapsule) {
      refreshRapierAlsLocomotionMode(
        current,
        currentGroundSupport !== null,
        actualVelocity.current.z,
      )
    }
    poseSample.current.movementBase =
      resolveAlsCameraMovementBaseSnapshot(
        current.locomotionMode,
        currentGroundSupport,
      )

    if (current.stance !== previousStance.current) {
      previousStance.current = current.stance
      setRapierAlsStanceCapsules(
        standingCapsule.current,
        crouchingCapsule.current,
        current.stance,
      )
    }
    const root = characterRoot.current
    if (root) {
      root.position.y = resolveAlsMeshRootRelativeY(
        current.stance,
        current.locomotionMode,
      )
      root.rotation.y = unrealYawDegreesToThreeRadians(
        current.actorYawAngle,
      )
    }

    // UAlsAnimationInstance::NativeUpdateAnimation runs after CharacterMovement. Publish the
    // post-step tags/location/base, but take Speed/Velocity/VelocityYaw/bMoving together from the
    // Character's retained LocomotionState just as RefreshLocomotionOnGameThread() does.
    resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      actorLocation.current,
    )
    const controls = values.current
    publishAlsCharacterAnimationSnapshot(animationControls.current, {
      character: current,
      location: actorLocation.current,
      basedMovement: current.locomotionMode === 'Grounded'
        ? rapierAlsMovementBase(currentGroundSupport)
        : ALS_NO_BASED_MOVEMENT,
      acceleration: acceleration.current,
      overlayMode: controls.overlayMode,
      movementOverride: controls.movementOverride,
      speedOverride: controls.speed,
      directionOverride: controls.direction,
      rotateInPlaceOverride: controls.rotateInPlace,
    })
  })

  return {
    character,
    animationControls,
    animationCurves,
    onJumped,
    overlayMode: overlayMode as AlsOverlayMode,
  }
}
