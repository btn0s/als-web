import type { AlsCharacter, AlsLocomotionMode } from './AlsCharacter'
import type { AlsOverlayMode } from './AnimGraph/overlayMode'
import { getRelativeAccelerationAmount, type AlsAnimationInstanceControls } from './AlsAnimationCore'
import { calculateMovingSmooth } from './Settings/AlsGeneralAnimationSettings'
import type { AlsStance } from './Settings/AlsMovementSettings'
import { unwindDegrees, type AlsVector3 } from './State/AlsLocomotionState'
import { ALS_NO_BASED_MOVEMENT, type AlsBasedMovement } from './State/AlsMovementBaseState'

export type AlsAnimationCharacter = Pick<AlsCharacter,
  'desiredAiming' | 'desiredRotationMode' | 'desiredStance' | 'desiredGait' |
  'viewMode' | 'locomotionMode' | 'locomotionAction' | 'rotationMode' | 'stance' |
  'gait' | 'actorYawAngle' | 'viewYawAngle' | 'viewPitchAngle' | 'viewYawSpeed' | 'locomotionState'>

export interface AlsAnimationAccelerationLimits {
  readonly maxAcceleration: number
  readonly brakingDeceleration: number
}

// AAlsCharacter::AAlsCharacter(), cpp:36; UAlsCharacterMovementComponent(), cpp:132.
export const ALS_CAPSULE_RADIUS = 0.3
export const ALS_STANDING_CAPSULE_HALF_HEIGHT = 0.9
export const ALS_CROUCHING_CAPSULE_HALF_HEIGHT = 0.56
// AAlsCharacter::AAlsCharacter(), cpp:43. The mesh component stays 2 cm below the standing
// capsule base; aligning its rendered bounds to the floor would erase authored ALS placement.
export const ALS_MESH_RELATIVE_LOCATION_Z = -0.92
// ALS inherits the default CharacterMovement walkable slope.
export const ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS = 0.71

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
  _locomotionMode: AlsLocomotionMode,
  out: AlsVector3 = { x: 0, y: 0, z: 0 },
): AlsVector3 {
  out.x = rapierBodyAnchor.x
  out.y = rapierBodyAnchor.y
  out.z = rapierBodyAnchor.z
    + getAlsCapsuleHalfHeight(stance)
    - ALS_STANDING_CAPSULE_HALF_HEIGHT
  return out
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

export function createAlsCharacterAnimationControls(): AlsCharacterAnimationControls {
  return {
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
    viewMode: 'ThirdPerson',
    viewPitchAngle: 0,
    inputYawAngle: 0,
    targetYawAngle: 0,
    locomotionYawSpeed: 0,
  }
}

export interface AlsCharacterAnimationSnapshotInput {
  readonly character: AlsAnimationCharacter
  readonly location: Readonly<AlsVector3>
  readonly basedMovement: Readonly<AlsBasedMovement>
  readonly accelerationLimits: AlsAnimationAccelerationLimits
  readonly acceleration: Readonly<AlsVector3>
  readonly overlayMode: AlsOverlayMode
  readonly movementOverride: boolean
  readonly speedOverride: number
  readonly directionOverride: number
  readonly rotateInPlaceOverride: boolean
  readonly locomotionYawSpeed: number
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
  output.locomotionAction = character.locomotionAction
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
  output.viewMode = character.viewMode
  output.viewPitchAngle = character.viewPitchAngle
  output.inputYawAngle = state.inputYawAngle
  output.targetYawAngle = state.targetYawAngle
  output.locomotionYawSpeed = input.locomotionYawSpeed

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
    maxAcceleration: input.accelerationLimits.maxAcceleration,
    maxBrakingDeceleration: input.accelerationLimits.brakingDeceleration,
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
