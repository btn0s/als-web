import { ALS_RAGDOLLING_SETTINGS, type AlsRagdollingSettings } from './Settings/AlsRagdollingSettings'
import {
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier'
import { RigidBodyType } from '@dimforge/rapier3d-compat'
import { useFrame } from '@react-three/fiber'
import { folder, useControls } from 'leva'
import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { LEVA_ROOTS } from '../app/levaRoots'
import {
  rapierAlsCameraMovementBaseFromPrimitive,
  rapierAlsCameraMovementBase,
  rapierAlsMovementBaseFromPrimitive,
  rapierAlsMovementBase,
  selectRapierAlsFloor,
} from '../engine/rapierAlsCapsuleSweep'
import type {
  RapierAlsCapsuleSweep,
  RapierAlsCapsuleSweepHit,
  RapierAlsFindFloorResult,
  RapierAlsSupportingCollider,
} from '../engine/rapierAlsCapsuleSweep'
import {
  getRapierAlsAdjustFloorHeightTarget,
  getRapierAlsFindFloorDistance,
  shouldAdjustRapierAlsFloorHeight,
} from '../engine/rapierAlsCharacterMovement'
import {
  moveGroundedWithSlideAlongSurface,
} from '../engine/characterMovementGroundedMove'
import type {
  CharacterMovementGroundedMoveSweep,
} from '../engine/characterMovementGroundedMove'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { getWorldDeltaTime } from '../engine/timeDilation'
import type { WorldTimeState } from '../engine/timeDilation'
import {
  FInputActionInstance,
  UInputTriggerHold,
  UInputTriggerPressed,
  UInputTriggerReleased,
  UInputTriggerTap,
  UInputTriggerDoubleTap,
} from '../engine/InputTriggers'
import { ALS_NO_BASED_MOVEMENT } from './State/AlsMovementBaseState'
import type { AlsBasedMovement } from './State/AlsMovementBaseState'
import {
  setRapierAlsStanceCapsules,
} from '../engine/rapierAlsStanceCapsules'
import {
  createRootMotionMovementParams,
} from '../engine/rootMotion'
import type {
  CompiledAuthoredRootMotion,
  RootMotionMovementParams,
} from '../engine/rootMotion'
import {
  constrainAnimRootMotionVelocity,
} from '../engine/characterMovementRootMotion'
import {
  applyRootMotionSource,
  createRootMotionSourceGroup,
  getRootMotionSourceByID,
  prepareRootMotionSourceGroup,
} from '../engine/rootMotionSourceGroup'
import type {
  RootMotionSourceGroup,
} from '../engine/rootMotionSourceGroup'
import type {
  RapierAlsMantlingAdapter,
} from '../engine/rapierAlsMantling'
import {
  alsMeshRootTranslationToUnrealWorld,
  threeToUnrealVector,
  unrealToThreeVector,
  unrealYawDegreesToThreeRadians,
} from '../engine/unrealCoordinateSpace'
import {
  applyDesiredStance,
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
  AlsLocomotionModeChangedLifecycle,
  AlsLocomotionMode,
} from './AlsCharacter'
import {
  setMovementVelocity,
  stepGroundedVelocity,
  stepInAirVelocity,
} from './AlsCharacterMovementComponent'
import { getRelativeAccelerationAmount } from './AlsAnimationInstance'
import type {
  AlsAnimationInstanceControls,
  AlsMantlingMontageBridge,
  AlsRollingMontageBridge,
} from './AlsAnimationInstance'
import {
  prepareCharacterMantling,
  refreshMantling,
  refreshRollingPhysics,
  startRolling,
  startMantlingGrounded,
  startMantlingImplementation,
  startMantlingInAir,
} from './AlsCharacter_Actions'
import type {
  AlsMantlingLifecycleAdapter,
  AlsRollingPhysicsAdapter,
} from './AlsCharacter_Actions'
import type { CharacterPoseSample } from '../app/CharacterPoseSample'
import {
  ALS_OVERLAY_MODES,
} from './AnimGraph/overlayMode'
import type { AlsOverlayMode } from './AnimGraph/overlayMode'
import type {
  AlsMantlingRootMotionResult,
  AlsRootMotionSource_Mantling,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
  selectAlsMantlingSettings,
} from './Settings/AlsMantlingSettings'
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
import type {
  AlsQuaternion,
} from './State/AlsFeetState'
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

function makeRapierAlsBodyPositionOwned(
  body: RapierRigidBody,
  translation?: Readonly<{ x: number; y: number; z: number }>,
) {
  if (body.bodyType() !== RigidBodyType.KinematicPositionBased) {
    body.setBodyType(RigidBodyType.KinematicPositionBased, true)
  }
  if (translation) body.setTranslation(translation, true)
  const current = body.translation()
  body.setNextKinematicTranslation(current)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
}

function makeRapierAlsBodyDynamic(body: RapierRigidBody) {
  if (body.bodyType() !== RigidBodyType.Dynamic) {
    body.setBodyType(RigidBodyType.Dynamic, true)
  }
}

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
 * Reconstructs `GetOwner()->GetActorLocation()` from the rendered mesh-root frame.
 *
 * The camera must not combine an interpolated pose pivot with Rapier's fixed-step body
 * translation. Grounded CharacterMovement already positions the physical capsule at UE's target
 * floor distance, so presentation reconstruction must not add that distance a second time.
 */
export function resolveAlsActorLocationFromPresentationGround(
  presentationGround: Readonly<AlsVector3>,
  stance: AlsStance,
  locomotionMode: AlsLocomotionMode,
  out: AlsVector3 = { x: 0, y: 0, z: 0 },
): AlsVector3 {
  out.x = presentationGround.x
  out.y = presentationGround.y
  out.z = presentationGround.z
    - resolveAlsMeshRootRelativeY(stance, locomotionMode)
    + getAlsCapsuleHalfHeight(stance)
    - ALS_STANDING_CAPSULE_HALF_HEIGHT
  return out
}

/**
 * UCharacterMovementComponent::GetActorFeetLocation() uses the active scaled capsule, including
 * a crouching capsule. Keeping the subtraction explicit guards the mantling start seam from
 * accidentally assuming the standing half-height.
 */
export function resolveAlsActorFeetLocation(
  actorLocation: Readonly<AlsVector3>,
  stance: AlsStance,
  out: AlsVector3 = { x: 0, y: 0, z: 0 },
): AlsVector3 {
  out.x = actorLocation.x
  out.y = actorLocation.y
  out.z = actorLocation.z - getAlsCapsuleHalfHeight(stance)
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
  _locomotionMode: AlsLocomotionMode,
): number {
  return ALS_MESH_RELATIVE_LOCATION_Z
}

const ALS_MANTLING_OVERLAY_TAGS = new Map<string, string>([
  ['Default', 'Als.OverlayMode.Default'],
  ['Als.OverlayMode.Default', 'Als.OverlayMode.Default'],
  ['Injured', 'Als.OverlayMode.Injured'],
  ['Als.OverlayMode.Injured', 'Als.OverlayMode.Injured'],
  ['HandsTied', 'Als.OverlayMode.HandsTied'],
  ['Als.OverlayMode.HandsTied', 'Als.OverlayMode.HandsTied'],
  ['Rifle', 'Als.OverlayMode.Rifle'],
  ['Als.OverlayMode.Rifle', 'Als.OverlayMode.Rifle'],
  ['PistolOneHanded', 'Als.OverlayMode.PistolOneHanded'],
  ['Als.OverlayMode.PistolOneHanded', 'Als.OverlayMode.PistolOneHanded'],
  ['PistolTwoHanded', 'Als.OverlayMode.PistolTwoHanded'],
  ['Als.OverlayMode.PistolTwoHanded', 'Als.OverlayMode.PistolTwoHanded'],
  ['Bow', 'Als.OverlayMode.Bow'],
  ['Als.OverlayMode.Bow', 'Als.OverlayMode.Bow'],
  ['Torch', 'Als.OverlayMode.Torch'],
  ['Als.OverlayMode.Torch', 'Als.OverlayMode.Torch'],
  ['Binoculars', 'Als.OverlayMode.Binoculars'],
  ['Als.OverlayMode.Binoculars', 'Als.OverlayMode.Binoculars'],
  ['Box', 'Als.OverlayMode.Box'],
  ['Als.OverlayMode.Box', 'Als.OverlayMode.Box'],
  ['Barrel', 'Als.OverlayMode.Barrel'],
  ['Als.OverlayMode.Barrel', 'Als.OverlayMode.Barrel'],
])

/** Exact gameplay tags accepted by B_Als_Character's low-mantle overlay switch. */
export function resolveAlsMantlingOverlayTag(overlayMode: string): string {
  const tag = ALS_MANTLING_OVERLAY_TAGS.get(overlayMode)
  if (!tag) {
    throw new Error(`Unsupported ALS mantling overlay mode "${overlayMode}"`)
  }
  return tag
}

export function alsActorYawQuaternion(
  actorYawAngle: number,
): AlsQuaternion {
  const halfYaw = actorYawAngle * Math.PI / 360
  return {
    x: 0,
    y: 0,
    z: Math.sin(halfYaw),
    w: Math.cos(halfYaw),
  }
}

function multiplyAlsQuaternions(
  left: Readonly<AlsQuaternion>,
  right: Readonly<AlsQuaternion>,
): AlsQuaternion {
  return {
    x: (
      left.w * right.x + left.x * right.w
      + left.y * right.z - left.z * right.y
    ),
    y: (
      left.w * right.y - left.x * right.z
      + left.y * right.w + left.z * right.x
    ),
    z: (
      left.w * right.z + left.x * right.y
      - left.y * right.x + left.z * right.w
    ),
    w: (
      left.w * right.w - left.x * right.x
      - left.y * right.y - left.z * right.z
    ),
  }
}

/**
 * CharacterMovement applies the root source's RotationDelta to the current actor quaternion.
 * The live character currently retains yaw only, so recover exactly that UE rotator component.
 */
export function applyAlsMantlingRotationDelta(
  actorYawAngle: number,
  rotationDelta: Readonly<AlsQuaternion>,
): number {
  const rotation = multiplyAlsQuaternions(
    rotationDelta,
    alsActorYawQuaternion(actorYawAngle),
  )
  return unwindDegrees(
    Math.atan2(
      2 * (
        rotation.w * rotation.z
        + rotation.x * rotation.y
      ),
      1 - 2 * (
        rotation.y * rotation.y
        + rotation.z * rotation.z
      ),
    ) * 180 / Math.PI,
  )
}

interface RapierAlsMantlingMovementBody {
  translation(): { x: number; y: number; z: number }
  setNextKinematicTranslation(
    translation: { x: number; y: number; z: number },
  ): void
  setLinvel(
    velocity: { x: number; y: number; z: number },
    wakeUp: boolean,
  ): void
}

export interface PrepareRapierAlsMantlingMovementBoundaryInput {
  readonly Character: AlsCharacter
  readonly RootMotionSources:
    RootMotionSourceGroup<AlsRootMotionSource_Mantling>
  readonly Lifecycle: AlsMantlingLifecycleAdapter
  readonly MantlingAdapter: RapierAlsMantlingAdapter
  readonly Body: RapierAlsMantlingMovementBody
  readonly ActorFeetLocation: Readonly<AlsVector3>
  readonly DeltaTime: number
  readonly MeshScaleZ?: number
}

export interface PrepareRapierAlsMantlingMovementBoundaryResult {
  readonly PreparedSourceCount: number
  readonly RemovedSourceCount: number
  readonly RootMotionResult: AlsMantlingRootMotionResult | null
  readonly bAppliedDirectTranslation: boolean
}

/**
 * UCharacterMovementComponent's one PerformMovement root-source boundary for live mantling.
 * The source is prepared once, then its velocity-shaped result is consumed as one direct,
 * no-sweep translation rather than being left as Rapier velocity.
 */
export function prepareRapierAlsMantlingMovementBoundary(
  input: Readonly<PrepareRapierAlsMantlingMovementBoundaryInput>,
): PrepareRapierAlsMantlingMovementBoundaryResult {
  let RootMotionResult: AlsMantlingRootMotionResult | null = null
  const activeSourceId =
    input.Character.mantlingState.RootMotionSourceId
  const prepared = prepareRootMotionSourceGroup(
    input.RootMotionSources,
    {
      PrepareRootMotion(Source, LocalID) {
        const bUseRelativeLocation =
          input.MantlingAdapter.UseRelativeLocation(
            Source.TargetPrimitive,
          )
        const result = prepareCharacterMantling({
          Character: input.Character,
          Lifecycle: input.Lifecycle,
          RootMotionSource: Source,
          SimulationDeltaTime: input.DeltaTime,
          DeltaTime: input.DeltaTime,
          bUseRelativeLocation,
          TargetPrimitiveTransform: bUseRelativeLocation
            ? input.MantlingAdapter.GetTargetPrimitiveTransform(
                Source.TargetPrimitive,
              )
            : undefined,
          ActorFeetLocation: input.ActorFeetLocation,
          ActorRotation: alsActorYawQuaternion(
            input.Character.actorYawAngle,
          ),
          MeshScaleZ: input.MeshScaleZ,
          GravityDirection: { x: 0, y: 0, z: -1 },
        })
        if (LocalID === activeSourceId) RootMotionResult = result
      },
    },
  )
  const selectedRootMotionResult =
    RootMotionResult as AlsMantlingRootMotionResult | null

  if (!selectedRootMotionResult?.valid) {
    input.Body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    return {
      ...prepared,
      RootMotionResult: selectedRootMotionResult,
      bAppliedDirectTranslation: false,
    }
  }

  const translation = input.Body.translation()
  const delta = unrealToThreeVector({
    x: selectedRootMotionResult.TranslationVelocity.x
      * input.DeltaTime,
    y: selectedRootMotionResult.TranslationVelocity.y
      * input.DeltaTime,
    z: selectedRootMotionResult.TranslationVelocity.z
      * input.DeltaTime,
  })
  input.Body.setNextKinematicTranslation({
    x: translation.x + delta.x,
    y: translation.y + delta.y,
    z: translation.z + delta.z,
  })
  input.Body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  input.Character.actorYawAngle = applyAlsMantlingRotationDelta(
    input.Character.actorYawAngle,
    selectedRootMotionResult.RotationDelta,
  )
  return {
    ...prepared,
    RootMotionResult: selectedRootMotionResult,
    bAppliedDirectTranslation: true,
  }
}

// Unreal Enhanced Input's default radial dead-zone lower threshold. The authored IMC mapping
// dump owns buttons/axes; this engine-level normalization only suppresses browser gamepad drift.
const GAMEPAD_DEAD_ZONE = 0.2
const COUNTER_CLOCKWISE_ROTATION_ANGLE_THRESHOLD = 5
const IN_AIR_ROTATION_INTERPOLATION_SPEED = 5
const IN_AIR_AIMING_ROTATION_INTERPOLATION_SPEED = 15
const MIN_AIMING_YAW_ANGLE_LIMIT = 70
const UE_KINDA_SMALL_NUMBER = 1e-4

interface InputAxes {
  right: number
  forward: number
}

interface GamepadInput extends InputAxes {
  jump: boolean
  sprint: boolean
  roll: boolean
  ragdoll: boolean
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

export interface AlsCharacterMantlingBridge {
  readonly adapter: RapierAlsMantlingAdapter
  readonly authoredRootMotionBySequence:
    ReadonlyMap<string, CompiledAuthoredRootMotion>
  readonly montage:
    MutableRefObject<AlsMantlingMontageBridge | null>
}

export interface AlsCharacterActionBridge {
  readonly RollingMontage:
    MutableRefObject<AlsRollingMontageBridge | null>
  /** Exact AAlsCharacter::StartRagdolling() runtime seam. */
  readonly StartRagdolling?: () => void
  /** Exact AAlsCharacter::StopRagdolling() runtime seam. */
  readonly StopRagdolling?: () => boolean
  readonly OnLocomotionModeChanged?: (
    PreviousLocomotionMode: AlsLocomotionMode,
  ) => void
}

export function createAlsLocomotionModeChangedLifecycleBridge(
  Character: MutableRefObject<AlsCharacter>,
  Actions: MutableRefObject<AlsCharacterActionBridge | undefined>,
): AlsLocomotionModeChangedLifecycle {
  return {
    StartRagdolling() {
      Actions.current?.StartRagdolling?.()
    },
    StartRolling(PlayRate, TargetYawAngle) {
      const Animation = Actions.current?.RollingMontage.current
      if (Animation) {
        startRolling(
          Character.current,
          PlayRate,
          TargetYawAngle,
          Animation,
        )
      }
    },
    OnLocomotionModeChanged(PreviousLocomotionMode) {
      Actions.current?.OnLocomotionModeChanged?.(
        PreviousLocomotionMode,
      )
    },
  }
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
  /** Exact AAlsCharacter::SetOverlayMode() control seam. */
  readonly SetOverlayMode: (OverlayMode: AlsOverlayMode) => void
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

export interface AlsGamepadBindings {
  jump: number | null
  sprint: number | null
  roll: number | null
  ragdoll: number | null
  walk: number | null
  crouch: number | null
  aim: number | null
  rotationMode: number | null
  shoulderSwap: number | null
  viewMode: number | null
}

export const ALS_GAMEPAD_BINDINGS: Readonly<AlsGamepadBindings> = {
  jump: 0,
  sprint: 1,
  roll: 1,
  ragdoll: 2,
  walk: 5,
  crouch: 10,
  aim: 4,
  rotationMode: 14,
  shoulderSwap: 11,
  viewMode: 15,
}

export function readGamepadButton(gamepad: Gamepad | null | undefined, binding: number | null): boolean {
  return binding !== null && (gamepad?.buttons[binding]?.pressed ?? false)
}

export function sampleGamepad(
  out: GamepadInput,
  bindings: Partial<AlsGamepadBindings> = {},
  enabled = true,
  index?: number,
): GamepadInput {
  out.right = 0
  out.forward = 0
  out.jump = false
  out.sprint = false
  out.roll = false
  out.ragdoll = false
  out.walk = false
  out.crouch = false
  out.aim = false
  out.rotationMode = false
  if (!enabled) return out
  const gamepads = navigator.getGamepads?.()
  if (!gamepads) return out
  const gamepad = Array.from(gamepads).find(
    (candidate) => candidate?.connected && candidate.axes.length >= 2 && (index === undefined || candidate.index === index),
  )
  if (!gamepad) return out

  out.right = gamepad.axes[0] ?? 0
  out.forward = -(gamepad.axes[1] ?? 0)
  applyRadialDeadZone(out)
  const resolved = { ...ALS_GAMEPAD_BINDINGS, ...bindings }
  if (bindings.roll === undefined) resolved.roll = resolved.sprint
  out.jump = readGamepadButton(gamepad, resolved.jump)
  out.sprint = readGamepadButton(gamepad, resolved.sprint)
  out.roll = readGamepadButton(gamepad, resolved.roll)
  out.ragdoll = readGamepadButton(gamepad, resolved.ragdoll)
  out.walk = readGamepadButton(gamepad, resolved.walk)
  out.crouch = readGamepadButton(gamepad, resolved.crouch)
  out.aim = readGamepadButton(gamepad, resolved.aim)
  out.rotationMode = readGamepadButton(gamepad, resolved.rotationMode)
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

export type AlsJumpInputResult =
  | 'Rejected'
  | 'Mantled'
  | 'Uncrouched'
  | 'Jumped'

/**
 * AAlsCharacterExample::Input_OnJump() plus AAlsCharacter::Jump().
 * Ragdoll input is handled at the action boundary; this branch attempts a Grounded mantle before crouch or
 * CharacterMovement jump policy. The backend applies inherited UE vertical speed only after
 * this policy returns Jumped.
 */
export function handleAlsJumpInput(
  character: AlsCharacter,
  StartMantlingGrounded: () => boolean = () => false,
): AlsJumpInputResult {
  if (character.movement.inputBlocked) return 'Rejected'
  if (StartMantlingGrounded()) return 'Mantled'

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
  bMovementModeLocked = false,
  Lifecycle?: AlsLocomotionModeChangedLifecycle,
): AlsLocomotionMode {
  if (bMovementModeLocked || character.locomotionMode === null) {
    return character.locomotionMode
  }
  if (
    character.locomotionMode === 'InAir'
    && verticalVelocity <= 0
    && groundValid
  ) {
    setLocomotionMode(character, 'Grounded', Lifecycle)
  } else if (
    character.locomotionMode === 'Grounded'
    && !groundValid
  ) {
    setLocomotionMode(character, 'InAir', Lifecycle)
  }
  return character.locomotionMode
}

export function shouldProbeRapierAlsGround(
  locomotionMode: AlsLocomotionMode,
  bMovementModeLocked: boolean,
): boolean {
  return !bMovementModeLocked && locomotionMode !== null
}

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

/**
 * `UCharacterMovementComponent::TickCharacterPose()` →
 * `ConstrainAnimRootMotionVelocity()` at the standalone Rapier boundary.
 *
 * `ConsumeExtractedRootMotion()` returns mesh-space metres without
 * ACharacter's scale. Native ACharacter scales translation in place, rotates
 * it through the mesh component and actor, divides by movement DeltaTime, and
 * preserves physics Z while falling.
 */
export function prepareRapierAlsAnimRootMotionVelocity(
  RootMotion: RootMotionMovementParams,
  AnimRootMotionTranslationScale: number,
  ActorYawAngle: number,
  DeltaTime: number,
  LocomotionMode: AlsLocomotionMode,
  CurrentVelocity: Readonly<AlsVector3>,
  Out: AlsVector3 = { x: 0, y: 0, z: 0 },
): boolean {
  if (!RootMotion.valid) return false
  if (!(DeltaTime > 0) || !Number.isFinite(DeltaTime)) {
    throw new Error(
      'ALS animation root motion requires a positive finite DeltaTime',
    )
  }

  RootMotion.translation[0] *= AnimRootMotionTranslationScale
  RootMotion.translation[1] *= AnimRootMotionTranslationScale
  RootMotion.translation[2] *= AnimRootMotionTranslationScale
  alsMeshRootTranslationToUnrealWorld(
    RootMotion.translation,
    ActorYawAngle,
    Out,
  )
  Out.x /= DeltaTime
  Out.y /= DeltaTime
  Out.z /= DeltaTime
  constrainAnimRootMotionVelocity(
    Out,
    CurrentVelocity,
    LocomotionMode === 'InAir',
    Out,
  )
  return true
}

/** Default hold-to-aim pointer buttons: RMB, as in ALS's IA_Aim mapping. */
export const ALS_AIM_POINTER_BUTTONS: readonly number[] = [2]

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
  mantling?: AlsCharacterMantlingBridge,
  actions?: AlsCharacterActionBridge,
  groundedMoveSweep?: CharacterMovementGroundedMoveSweep,
  worldTime?: Readonly<WorldTimeState>,
  /** KeyboardEvent.code toggling VelocityDirection/ViewDirection; `null` disables the binding. */
  toggleRotationModeKey: string | null = 'Digit1',
  /** PointerEvent.button values that hold aim (default RMB). Trackpad layouts can add 0. */
  aimPointerButtons: readonly number[] = ALS_AIM_POINTER_BUTTONS,
  gamepadBindings: Partial<AlsGamepadBindings> = {},
  gamepadEnabled = true,
  gamepadIndex?: number,
  ragdollInputEnabled = true,
  ragdollingSettings?: Partial<AlsRagdollingSettings>,
  gamepadRollBehavior: 'tap' | 'doubleTap' = 'tap',
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

  const character = useRef(createAlsCharacter({ settings: { Ragdolling: { ...ALS_RAGDOLLING_SETTINGS, ...ragdollingSettings } } }))
  const actionBridge = useRef(actions)
  actionBridge.current = actions
  const locomotionModeChangedLifecycle = useRef(
    createAlsLocomotionModeChangedLifecycleBridge(
      character,
      actionBridge,
    ),
  )
  const rollingPhysics = useRef<AlsRollingPhysicsAdapter>({
    GetUpdatedComponentRotation() {
      return {
        Pitch: 0,
        Yaw: character.current.actorYawAngle,
        Roll: 0,
      }
    },
    MoveUpdatedComponent(
      Delta,
      NewRotation,
      bSweep,
      _Teleport,
    ) {
      if (
        bSweep
        || Delta.x !== 0
        || Delta.y !== 0
        || Delta.z !== 0
      ) {
        throw new Error(
          'ALS rolling rotation must use a zero, non-swept move',
        )
      }
      // The Rapier capsule is rotationally symmetric and locked. Its
      // UpdatedComponent rotation is therefore the character-owned yaw.
      character.current.actorYawAngle =
        unwindDegrees(NewRotation.Yaw)
    },
  })
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
    viewMode: 'ThirdPerson',
    viewPitchAngle: 0,
    inputYawAngle: 0,
    targetYawAngle: 0,
    locomotionYawSpeed: 0,
  })
  const previousAnimationActorYawAngle = useRef(character.current.actorYawAngle)
  const animationLocomotionYawSpeed = useRef(0)
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
  const SetOverlayMode = useCallback((
    OverlayMode: AlsOverlayMode,
  ) => {
    if (ALS_OVERLAY_MODES.includes(OverlayMode)) {
      setControls({ overlayMode: OverlayMode })
    }
  }, [setControls])

  const pressedKeys = useRef(new Set<string>())
  const aimingWithPointer = useRef(false)
  const gamepadInput = useRef<GamepadInput>({
    right: 0,
    forward: 0,
    jump: false,
    sprint: false,
    roll: false,
    ragdoll: false,
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
  const sprintAction = useRef(new FInputActionInstance([
    new UInputTriggerHold({
      HoldTimeThreshold: 0.1,
      bIsOneShot: true,
    }),
    new UInputTriggerReleased(),
  ]))
  const rollAction = useRef(new FInputActionInstance([
    new UInputTriggerTap({ TapReleaseTimeThreshold: 0.3 }),
  ]))
  const gamepadDoubleTapAction = useRef(new FInputActionInstance([
    new UInputTriggerDoubleTap({ TapReleaseTimeThreshold: 0.3 }),
  ]))
  const gamepadRollContext = useRef({ index: gamepadIndex, enabled: gamepadEnabled })
  const ragdollAction = useRef(new FInputActionInstance([
    new UInputTriggerPressed(),
  ]))
  const jumpRequested = useRef(false)
  const rollRequested = useRef(false)
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
  const prePenetrationAdjustmentVelocity =
    useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const prePenetrationAdjustmentVelocityValid = useRef(false)
  const renderedVelocity = useRef({ x: 0, y: 0, z: 0 })
  const groundedMoveStart = useRef({ x: 0, y: 0, z: 0 })
  const groundedMoveTarget = useRef({ x: 0, y: 0, z: 0 })
  const groundedMoveApplied = useRef(false)
  const physicsStepIndex = useRef(0)
  const pendingGroundedBodyHeight = useRef<number | null>(null)
  const extractedAnimRootMotion = useRef(
    createRootMotionMovementParams(),
  )
  const animRootMotionVelocity =
    useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const animRootMotionConsumedTranslation =
    useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const debugViewYawWorld = useRef(0)
  const previousStance = useRef<AlsStance>('Standing')
  const capsulesInitialized = useRef(false)
  const movementModeLocked = useRef(false)
  const networkSmoothingMode =
    useRef<'Disabled' | 'Exponential'>('Exponential')
  const activeMantlingTarget = useRef<RapierCollider | null>(null)
  const ragdollRequestedAfterMantlingTargetDestruction =
    useRef(false)
  const rootMotionSources = useRef(
    createRootMotionSourceGroup<AlsRootMotionSource_Mantling>(),
  )
  const actorFeetLocation = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const floorAdjustedBodyAnchor =
    useRef<AlsVector3>({ x: 0, y: 0, z: 0 })

  const mantlingMontageProxy = useRef<AlsMantlingMontageBridge>({
    play(settings, startTime) {
      return mantling?.montage.current?.play(settings, startTime) ?? null
    },
    montageSetPosition(settings, position) {
      return mantling?.montage.current?.montageSetPosition(
        settings,
        position,
      ) ?? false
    },
    montageStop(settings, blendOutDuration) {
      return mantling?.montage.current?.montageStop(
        settings,
        blendOutDuration,
      ) ?? false
    },
    stopMontageInstance(instanceId, blendOutDuration) {
      return mantling?.montage.current?.stopMontageInstance(
        instanceId,
        blendOutDuration,
      ) ?? false
    },
    takeNotifyEvents() {
      return mantling?.montage.current?.takeNotifyEvents() ?? []
    },
  })

  const mantlingLifecycle = useRef<AlsMantlingLifecycleAdapter>({
    SetNetworkSmoothingMode(mode) {
      networkSmoothingMode.current = mode
    },
    ResetMeshRelativeTransform() {
      const current = character.current
      const root = characterRoot.current
      if (root) {
        root.position.y = ALS_MESH_RELATIVE_LOCATION_Z
        root.rotation.y = unrealYawDegreesToThreeRadians(
          current.actorYawAngle,
        )
      }
    },
    SetMovementModeLocked(bLocked) {
      movementModeLocked.current = bLocked
      const body = rigidBody.current
      body?.setGravityScale(bLocked ? 0 : 1, true)
      if (bLocked) {
        if (body) makeRapierAlsBodyPositionOwned(body)
      }
    },
    SetBase(TargetPrimitive) {
      activeMantlingTarget.current =
        TargetPrimitive as RapierCollider
    },
    ApplyRootMotionSource(RootMotionSource) {
      return applyRootMotionSource(
        rootMotionSources.current,
        RootMotionSource,
      )
    },
    GetRootMotionSourceByID(RootMotionSourceId) {
      return getRootMotionSourceByID(
        rootMotionSources.current,
        RootMotionSourceId,
      )
    },
    MantlingMontage: mantlingMontageProxy.current,
    IsTargetPrimitiveValid(TargetPrimitive) {
      return mantling?.adapter.IsTargetValid(TargetPrimitive) ?? false
    },
    OnMantlingStarted() {},
    OnMantlingEnded() {
      activeMantlingTarget.current = null
    },
    ForceNetUpdate() {},
    StartRagdolling() {
      ragdollRequestedAfterMantlingTargetDestruction.current = true
      locomotionModeChangedLifecycle.current.StartRagdolling()
    },
  })

  const tryStartMantling = (
    mode: 'Grounded' | 'InAir',
  ): boolean => {
    const runtime = mantling
    const montage = runtime?.montage.current
    const body = rigidBody.current
    if (!runtime || !montage || !body) return false

    const current = character.current
    threeToUnrealVector(body.translation(), rapierBodyAnchor.current)
    resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      actorLocation.current,
    )
    const Character = {
      ActorLocation: actorLocation.current,
      ActorYawAngle: current.actorYawAngle,
      CapsuleScale: 1,
      CapsuleRadius: ALS_CAPSULE_RADIUS,
      CapsuleHalfHeight: getAlsCapsuleHalfHeight(current.stance),
      LocalRole: 'Authority' as const,
      bIsLocallyControlled: true,
      bIsMantlingAllowedToStart:
        current.locomotionAction === null,
      LocomotionMode: current.locomotionMode,
      LocomotionState: {
        bHasVelocity: current.locomotionState.hasVelocity,
        VelocityYawAngle:
          current.locomotionState.velocityYawAngle,
        bHasInput: current.locomotionState.hasInput,
        InputYawAngle: current.locomotionState.inputYawAngle,
      },
    }
    const start = mode === 'Grounded'
      ? startMantlingGrounded
      : startMantlingInAir
    const Parameters = start({
      Character,
      MantlingSettings: ALS_GENERAL_MANTLING_SETTINGS,
      Collision: runtime.adapter.Collision,
      TargetSpace: runtime.adapter,
    })
    if (!Parameters) return false

    const overlayTag = resolveAlsMantlingOverlayTag(
      values.current.overlayMode,
    )
    const settings = selectAlsMantlingSettings(
      Parameters.MantlingType,
      overlayTag,
    )
    const AuthoredRootMotion =
      runtime.authoredRootMotionBySequence.get(
        settings.Montage.Sequence,
      )
    if (!AuthoredRootMotion) {
      throw new Error(
        `Missing authored root motion for ${settings.Montage.Sequence}`,
      )
    }
    const bUseRelativeLocation =
      runtime.adapter.UseRelativeLocation(
        Parameters.TargetPrimitive,
      )
    resolveAlsActorFeetLocation(
      actorLocation.current,
      current.stance,
      actorFeetLocation.current,
    )
    startMantlingImplementation({
      Character: current,
      Parameters,
      OverlayMode: overlayTag,
      AuthoredRootMotion,
      bUseRelativeLocation,
      TargetPrimitiveTransform: bUseRelativeLocation
        ? runtime.adapter.GetTargetPrimitiveTransform(
            Parameters.TargetPrimitive,
          )
        : undefined,
      ActorFeetLocation: actorFeetLocation.current,
      ActorRotation: alsActorYawQuaternion(
        current.actorYawAngle,
      ),
      Lifecycle: mantlingLifecycle.current,
    })
    return true
  }

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
      } else if (toggleRotationModeKey !== null && event.code === toggleRotationModeKey) {
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
      rollRequested.current = false
      sprintAction.current.reset()
      rollAction.current.reset()
      gamepadDoubleTapAction.current.reset()
      ragdollAction.current.reset()
      values.current.desiredGait = 'Running'
      setControls({ desiredGait: 'Running' })
    }
    const onPointerDown = (event: PointerEvent) => {
      if (aimPointerButtons.includes(event.button)) aimingWithPointer.current = true
    }
    const onPointerUp = (event: PointerEvent) => {
      if (aimPointerButtons.includes(event.button)) aimingWithPointer.current = false
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
  }, [setControls, toggleRotationModeKey, aimPointerButtons])

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
    window.__setOverlayMode = SetOverlayMode
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
    window.__triggerRoll = () => {
      rollRequested.current = true
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
      delete window.__triggerRoll
    }
  }, [SetOverlayMode, setControls])

  useFrame((_, deltaRealTime) => {
    const deltaTime = worldTime
      ? getWorldDeltaTime(worldTime, deltaRealTime)
      : deltaRealTime
    const current = character.current
    // AAlsCharacter::Tick() refreshes actor rotation once with the game-frame DeltaTime before
    // Super::Tick() enters CharacterMovement. Animation curves are intentionally from the
    // preceding skeletal-mesh update; applying them in fixed Rapier substeps visibly quantized
    // turn-in-place and could consume one curve sample multiple times on a slow render frame.
    if (current.locomotionMode === 'InAir') {
      stepInAirCharacterYaw(current, deltaTime)
    } else if (current.locomotionMode === 'Grounded') {
      stepGroundedCharacterYaw(
        current,
        deltaTime,
        animationCurves.current.rotationYawOffset,
        animationCurves.current.rotationYawSpeed,
      )
    }
  }, ALS_FRAME_PRIORITY.Character)

  useBeforePhysicsStep(() => {
    const body = rigidBody.current
    if (!body) return
    const ragdollValue = ragdollInputEnabled &&
      (pressedKeys.current.has('KeyX') || sampleGamepad(gamepadInput.current).ragdoll)
    const ragdollTick = ragdollAction.current.update(
      ragdollValue,
      ALS_PHYSICS_TIMESTEP,
    )
    if (ragdollTick.triggerEvents.includes('Triggered')) {
      if (!actionBridge.current?.StopRagdolling?.()) {
        locomotionModeChangedLifecycle.current.StartRagdolling()
      }
    }

    if (character.current.locomotionAction === 'Ragdolling') {
      const gamepad = sampleGamepad(gamepadInput.current)
      if (gamepad.jump && !previousGamepadInput.current.jump) requestAlsJumpInput(jumpRequested)
      previousGamepadInput.current.jump = gamepad.jump
      if (consumeAlsJumpInput(jumpRequested) && ragdollInputEnabled) actionBridge.current?.StopRagdolling?.()
      if (character.current.locomotionAction === 'Ragdolling') return
    }
    physicsStepIndex.current++
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
    if (current.locomotionMode === 'Grounded') {
      if (body.bodyType() !== RigidBodyType.KinematicPositionBased) {
        const translation = body.translation()
        groundedMoveTarget.current.x = translation.x
        groundedMoveTarget.current.y =
          pendingGroundedBodyHeight.current ?? translation.y
        groundedMoveTarget.current.z = translation.z
        makeRapierAlsBodyPositionOwned(
          body,
          groundedMoveTarget.current,
        )
        actualVelocity.current.z = 0
        pendingGroundedBodyHeight.current = null
      }
    } else if (current.locomotionMode === 'InAir') {
      if (body.bodyType() !== RigidBodyType.Dynamic) {
        makeRapierAlsBodyDynamic(body)
        unrealToThreeVector(
          current.movement.velocity,
          renderedVelocity.current,
        )
        body.setLinvel(renderedVelocity.current, true)
      }
    } else {
      makeRapierAlsBodyPositionOwned(body)
    }
    poseSample.current.character = current
    poseSample.current.ownerRigidBody = body
    const keys = pressedKeys.current
    const gamepad = sampleGamepad(gamepadInput.current, gamepadBindings, gamepadEnabled, gamepadIndex)
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
      controls.desiredStance = controls.desiredStance === 'Standing' ? 'Crouching' : 'Standing'
      setControls({ desiredStance: controls.desiredStance })
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

    const sprintRollValue =
      keys.has('ShiftLeft') || gamepad.sprint
    const sprintTick = sprintAction.current.update(
      sprintRollValue,
      ALS_PHYSICS_TIMESTEP,
    )
    if (!gamepadEnabled || gamepadRollContext.current.index !== gamepadIndex) {
      gamepadDoubleTapAction.current.reset()
    }
    gamepadRollContext.current = { index: gamepadIndex, enabled: gamepadEnabled }
    const gamepadRollTick = gamepadDoubleTapAction.current.update(
      gamepadEnabled && gamepadRollBehavior === 'doubleTap' && gamepad.roll,
      ALS_PHYSICS_TIMESTEP,
    )
    const rollTick = rollAction.current.update(
      keys.has('ShiftLeft') || (gamepadRollBehavior === 'tap' && gamepad.roll),
      ALS_PHYSICS_TIMESTEP,
    )
    if (
      sprintTick.triggerEvents.includes('Triggered')
      || sprintTick.triggerEvents.includes('Canceled')
    ) {
      // AAlsCharacterExample::Input_OnSprint() is bound to both Triggered and
      // Canceled and writes the action value straight into DesiredGait.
      const nextDesiredGait = sprintTick.value === true
        ? 'Sprinting'
        : 'Running'
      values.current.desiredGait = nextDesiredGait
      setControls({ desiredGait: nextDesiredGait })
    }
    current.desiredGait = values.current.desiredGait

    if (
      rollRequested.current
      || rollTick.triggerEvents.includes('Triggered')
      || gamepadRollTick.triggerEvents.includes('Triggered')
    ) {
      rollRequested.current = false
      const Animation =
        actionBridge.current?.RollingMontage.current
      if (Animation) {
        startRolling(current, 1.3, Animation)
      }
    }
    current.desiredStance = controls.desiredStance
    current.desiredRotationMode = controls.desiredRotationMode
    current.desiredAiming =
      controls.desiredAiming || aimingWithPointer.current || gamepad.aim
    applyDesiredStance(current)

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
    const intendedVelocity = prePenetrationAdjustmentVelocityValid.current
      ? prePenetrationAdjustmentVelocity.current
      : current.movement.velocity
    desiredVelocity.current.x = intendedVelocity.x
    desiredVelocity.current.y = intendedVelocity.y
    desiredVelocity.current.z = intendedVelocity.z
    prePenetrationAdjustmentVelocityValid.current = false
    if (body.bodyType() === RigidBodyType.Dynamic) {
      threeToUnrealVector(body.linvel(), actualVelocity.current)
    }
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
    let currentGroundFloor: RapierAlsFindFloorResult | null = null
    if (
      sweepCapsule
      && shouldProbeRapierAlsGround(
        current.locomotionMode,
        movementModeLocked.current,
      )
    ) {
      currentGroundFloor = selectRapierAlsFloor(sweepCapsule, {
        location: queryLocation,
        capsuleRadius: ALS_CAPSULE_RADIUS,
        capsuleHalfHeight: queryCapsuleHalfHeight,
        walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
      })
    }
    groundSupport.current = currentGroundFloor?.HitResult ?? null
    if (consumeAlsJumpInput(jumpRequested)) {
      const jumpResult = handleAlsJumpInput(
        current,
        () => tryStartMantling('Grounded'),
      )
      if (jumpResult === 'Uncrouched') {
        values.current.desiredStance = 'Standing'
        setControls({ desiredStance: 'Standing' })
      } else if (jumpResult === 'Jumped') {
        actualVelocity.current.z = ALS_RAPIER_JUMP_SPEED
        // ACharacter::Jump() writes JumpZVelocity directly to CharacterMovement before
        // PhysFalling. Seed both bridge copies before the body changes to Dynamic.
        setMovementVelocity(current.movement, actualVelocity.current)
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
    // AAlsCharacter::Tick(): action attempts/refresh happen after both rotation branches and
    // immediately before Super::Tick() enters CharacterMovement's root-source boundary.
    if (current.locomotionMode === 'InAir') {
      tryStartMantling('InAir')
    }
    refreshMantling({
      Character: current,
      Lifecycle: mantlingLifecycle.current,
      MantlingSettings: ALS_GENERAL_MANTLING_SETTINGS,
    })
    refreshRollingPhysics(
      current,
      ALS_PHYSICS_TIMESTEP,
      rollingPhysics.current,
    )

    // CharacterMovement consumes the animation instance exactly once at its
    // movement boundary. Multiple fixed substeps before another animation
    // refresh therefore cannot replay the same Roll displacement.
    const rollingAnimation =
      actionBridge.current?.RollingMontage.current
    const animRootMotionOwned =
      rollingAnimation?.IsPlayingRootMotion() ?? false
    const consumedAnimRootMotion =
      rollingAnimation?.ConsumeExtractedRootMotion(
        extractedAnimRootMotion.current,
      )
    const animRootMotionApplied = consumedAnimRootMotion
      ? prepareRapierAlsAnimRootMotionVelocity(
          consumedAnimRootMotion,
          current.animRootMotionTranslationScale,
          current.actorYawAngle,
          ALS_PHYSICS_TIMESTEP,
          current.locomotionMode,
          actualVelocity.current,
          animRootMotionVelocity.current,
        )
      : false
    if (animRootMotionApplied) {
      setMovementVelocity(
        current.movement,
        animRootMotionVelocity.current,
      )
      animRootMotionConsumedTranslation.current.x +=
        animRootMotionVelocity.current.x * ALS_PHYSICS_TIMESTEP
      animRootMotionConsumedTranslation.current.y +=
        animRootMotionVelocity.current.y * ALS_PHYSICS_TIMESTEP
      animRootMotionConsumedTranslation.current.z +=
        animRootMotionVelocity.current.z * ALS_PHYSICS_TIMESTEP
    } else if (animRootMotionOwned) {
      // ACharacter::IsPlayingRootMotion() keeps CharacterMovement out of
      // CalcVelocity even when this fixed substep has no newly extracted
      // animation range. The preceding range has already been applied in
      // full, so a scheduler-only substep contributes zero horizontal motion.
      animRootMotionVelocity.current.x = 0
      animRootMotionVelocity.current.y = 0
      animRootMotionVelocity.current.z =
        current.locomotionMode === 'InAir'
          ? actualVelocity.current.z
          : 0
      setMovementVelocity(
        current.movement,
        animRootMotionVelocity.current,
      )
    }

    const mantlingRuntime = mantling
    const hasRetainedRootMotionSource =
      rootMotionSources.current.RootMotionSourceByID.size > 0
    if (
      mantlingRuntime
      && (
        hasRetainedRootMotionSource
        || current.locomotionMode === null
      )
    ) {
      threeToUnrealVector(body.translation(), rapierBodyAnchor.current)
      resolveAlsActorLocation(
        rapierBodyAnchor.current,
        current.stance,
        current.locomotionMode,
        actorLocation.current,
      )
      resolveAlsActorFeetLocation(
        actorLocation.current,
        current.stance,
        actorFeetLocation.current,
      )
      prepareRapierAlsMantlingMovementBoundary({
        Character: current,
        RootMotionSources: rootMotionSources.current,
        Lifecycle: mantlingLifecycle.current,
        MantlingAdapter: mantlingRuntime.adapter,
        Body: body,
        ActorFeetLocation: actorFeetLocation.current,
        DeltaTime: ALS_PHYSICS_TIMESTEP,
        MeshScaleZ: 1,
      })
    }

    groundedMoveApplied.current = false
    if (current.locomotionMode === null) {
      body.setGravityScale(0, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    } else if (current.locomotionMode === 'InAir') {
      body.setGravityScale(1, true)
      makeRapierAlsBodyDynamic(body)
      if (
        !animRootMotionApplied
        && !animRootMotionOwned
      ) {
        stepInAirVelocity(
          current.movement,
          inputDirection.current,
          ALS_PHYSICS_TIMESTEP,
        )
      }
      unrealToThreeVector(
        current.movement.velocity,
        renderedVelocity.current,
      )
      body.setLinvel(renderedVelocity.current, true)
    } else {
      body.setGravityScale(1, true)
      if (body.bodyType() !== RigidBodyType.KinematicPositionBased) {
        makeRapierAlsBodyPositionOwned(body)
      }
      if (!animRootMotionApplied && !animRootMotionOwned) {
        stepGroundedVelocity(
          current.movement,
          inputDirection.current,
          ALS_PHYSICS_TIMESTEP,
          current.viewYawAngle,
        )
      }

      // UAlsCharacterMovementComponent::PhysWalking() applies both ordinary and animation
      // root-motion velocity through MoveAlongFloor. Grounded collision owns the body position;
      // Rapier's contact solver never receives an unchecked wall-penetrating velocity.
      const intended = current.movement.velocity
      if (!animRootMotionApplied && !animRootMotionOwned) {
        prePenetrationAdjustmentVelocity.current.x = intended.x
        prePenetrationAdjustmentVelocity.current.y = intended.y
        prePenetrationAdjustmentVelocity.current.z = intended.z
        prePenetrationAdjustmentVelocityValid.current = true
      }
      const requestedDelta = {
        x: intended.x * ALS_PHYSICS_TIMESTEP,
        y: intended.y * ALS_PHYSICS_TIMESTEP,
        z: 0,
      }
      const adjustedDelta = groundedMoveSweep
        ? moveGroundedWithSlideAlongSurface({
            start: actorLocation.current,
            delta: requestedDelta,
            capsuleRadius: ALS_CAPSULE_RADIUS,
            capsuleHalfHeight: getAlsCapsuleHalfHeight(current.stance),
            sweepCapsule: groundedMoveSweep,
          }).delta
        : requestedDelta
      setMovementVelocity(current.movement, {
        x: adjustedDelta.x / ALS_PHYSICS_TIMESTEP,
        y: adjustedDelta.y / ALS_PHYSICS_TIMESTEP,
        z: 0,
      })

      const translation = body.translation()
      groundedMoveStart.current.x = translation.x
      groundedMoveStart.current.y = translation.y
      groundedMoveStart.current.z = translation.z
      groundedMoveTarget.current.x = translation.x + adjustedDelta.x
      groundedMoveTarget.current.y =
        pendingGroundedBodyHeight.current ?? translation.y
      groundedMoveTarget.current.z = translation.z + adjustedDelta.y
      pendingGroundedBodyHeight.current = null
      body.setNextKinematicTranslation(groundedMoveTarget.current)
      groundedMoveApplied.current = true
    }
    threeToUnrealVector(body.translation(), rapierBodyAnchor.current)

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
    const mantlingTarget = activeMantlingTarget.current
    const basedMovement = (
      current.locomotionMode === null
      && mantlingTarget !== null
    )
      ? rapierAlsMovementBaseFromPrimitive(
          mantlingTarget as RapierAlsSupportingCollider,
        )
      : current.locomotionMode === 'Grounded'
        ? rapierAlsMovementBase(groundSupport.current)
        : ALS_NO_BASED_MOVEMENT
    publishAlsCharacterAnimationSnapshot(frame, {
      character: current,
      location: actorLocation.current,
      basedMovement,
      acceleration: acceleration.current,
      overlayMode: controls.overlayMode,
      movementOverride: controls.movementOverride,
      speedOverride: controls.speed,
      directionOverride: controls.direction,
      rotateInPlaceOverride: controls.rotateInPlace,
      locomotionYawSpeed: animationLocomotionYawSpeed.current,
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
    resolveAlsActorFeetLocation(
      actorLocation.current,
      current.stance,
      actorFeetLocation.current,
    )
    const rootMotionSource = getRootMotionSourceByID(
      rootMotionSources.current,
      current.mantlingState.RootMotionSourceId,
    )
    window.__alsCharacterState = {
      actorYawAngle: current.actorYawAngle,
      desiredGait: current.desiredGait,
      desiredStance: current.desiredStance,
      gait: current.gait,
      stance: current.stance,
      overlayMode: values.current.overlayMode,
      rotationMode: current.rotationMode,
      locomotionMode: current.locomotionMode,
      locomotionAction: current.locomotionAction,
      animRootMotionTranslationScale:
        current.animRootMotionTranslationScale,
      animRootMotionApplied,
      animRootMotionOwned,
      animRootMotionBlendWeight:
        consumedAnimRootMotion?.blendWeight ?? 0,
      animRootMotionConsumedTranslation: {
        ...animRootMotionConsumedTranslation.current,
      },
      rollingTargetYawAngle:
        current.rollingState.TargetYawAngle,
      speed: state.speed,
      direction: frame.direction,
      moving: state.moving,
      capsuleBottomY: colliderBottomY,
      capsuleHalfHeight: colliderHalfExtent,
      meshBaseOffsetY:
        characterRoot.current?.position.y ?? Number.NaN,
      position: bodyTranslation,
      velocity: body.linvel(),
      physicsStepIndex: physicsStepIndex.current,
      physicsTimeStep: ALS_PHYSICS_TIMESTEP,
      physicsBodyType:
        body.bodyType() === RigidBodyType.Dynamic
          ? 'Dynamic'
          : 'KinematicPositionBased',
      verticalVelocity: state.velocity.z,
      groundFloorDistance: currentGroundFloor
        ? getRapierAlsFindFloorDistance(currentGroundFloor)
        : null,
      groundFloorTrace: currentGroundFloor
        ? currentGroundFloor.bLineTrace
          ? 'Line'
          : 'Sweep'
        : null,
      rootMotionSourceId:
        current.mantlingState.RootMotionSourceId,
      rootMotionSourceStatus:
        rootMotionSource?.Status ?? null,
      rootMotionSourceTime:
        rootMotionSource?.Time ?? null,
      activeMantlingTargetHandle:
        activeMantlingTarget.current?.handle ?? null,
      movementBaseHandle:
        (
          basedMovement.primitive as
            | { readonly handle?: number }
            | null
        )?.handle ?? null,
      bodyAnchor: {
        x: rapierBodyAnchor.current.x,
        y: rapierBodyAnchor.current.y,
        z: rapierBodyAnchor.current.z,
      },
      actorFeet: {
        x: actorFeetLocation.current.x,
        y: actorFeetLocation.current.y,
        z: actorFeetLocation.current.z,
      },
      movementModeLocked: movementModeLocked.current,
      gravityScale: body.gravityScale(),
      networkSmoothingMode: networkSmoothingMode.current,
      ragdollRequestedAfterMantlingTargetDestruction:
        ragdollRequestedAfterMantlingTargetDestruction.current,
    }
  })

  useAfterPhysicsStep(() => {
    const body = rigidBody.current
    if (!body) {
      poseSample.current.movementBase = null
      return
    }

    const current = character.current
    if (current.locomotionAction === 'Ragdolling') return
    const bodyTranslation = body.translation()
    threeToUnrealVector(bodyTranslation, rapierBodyAnchor.current)
    const debugState = window.__alsCharacterState
    if (debugState) {
      // The object is first assembled during the matching pre-physics callback. Replace its raw
      // body snapshot here so Diagnostics compares the completed Rapier step with the rendered
      // component and camera from that same game frame.
      debugState.position = bodyTranslation
      debugState.velocity = body.linvel()
      debugState.physicsStepIndex = physicsStepIndex.current
    }
    if (groundedMoveApplied.current) {
      actualVelocity.current.x = (
        bodyTranslation.x - groundedMoveStart.current.x
      ) / ALS_PHYSICS_TIMESTEP
      actualVelocity.current.y = (
        bodyTranslation.z - groundedMoveStart.current.z
      ) / ALS_PHYSICS_TIMESTEP
      // UCharacterMovementComponent::PhysWalking() converts displacement back to Velocity and
      // immediately calls MaintainHorizontalGroundVelocity().
      actualVelocity.current.z = 0
      setMovementVelocity(current.movement, actualVelocity.current)
      groundedMoveApplied.current = false
    } else {
      threeToUnrealVector(body.linvel(), actualVelocity.current)
    }
    const queryCapsuleHalfHeight = getAlsCapsuleHalfHeight(current.stance)
    const queryLocation =
      resolveAlsActorLocation(
        rapierBodyAnchor.current,
        current.stance,
        current.locomotionMode,
        groundProbeLocation.current,
      )
    const currentGroundFloor = (
      sweepCapsule
      && shouldProbeRapierAlsGround(
        current.locomotionMode,
        movementModeLocked.current,
      )
    )
      ? selectRapierAlsFloor(sweepCapsule, {
          location: queryLocation,
          capsuleRadius: ALS_CAPSULE_RADIUS,
          capsuleHalfHeight: queryCapsuleHalfHeight,
          walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
        })
      : null
    const currentGroundSupport =
      currentGroundFloor?.HitResult ?? null
    groundSupport.current = currentGroundSupport
    const previousLocomotionMode = current.locomotionMode
    if (
      sweepCapsule
      && shouldProbeRapierAlsGround(
        current.locomotionMode,
        movementModeLocked.current,
      )
    ) {
      refreshRapierAlsLocomotionMode(
        current,
        currentGroundFloor !== null,
        actualVelocity.current.z,
        movementModeLocked.current,
        locomotionModeChangedLifecycle.current,
      )
    }
    if (
      current.locomotionMode === 'Grounded'
      && currentGroundFloor !== null
      && shouldAdjustRapierAlsFloorHeight(currentGroundFloor)
    ) {
      getRapierAlsAdjustFloorHeightTarget(
        rapierBodyAnchor.current,
        currentGroundFloor,
        floorAdjustedBodyAnchor.current,
      )
      // Apply on the next pre-physics boundary. React Three Rapier captures interpolation's
      // previous pose before that callback, so landing/floor correction stays presentation-smooth.
      // Both coordinate systems use the same world-up scalar: Unreal Z ↔ Rapier/Three Y.
      pendingGroundedBodyHeight.current =
        floorAdjustedBodyAnchor.current.z
    } else {
      pendingGroundedBodyHeight.current = null
    }
    if (
      previousLocomotionMode === 'Grounded'
      && current.locomotionMode === 'InAir'
    ) {
      makeRapierAlsBodyDynamic(body)
      unrealToThreeVector(
        actualVelocity.current,
        renderedVelocity.current,
      )
      body.setLinvel(renderedVelocity.current, true)
    }
    const mantlingTarget = activeMantlingTarget.current
    poseSample.current.movementBase = (
      current.locomotionMode === null
      && mantlingTarget !== null
    )
      ? rapierAlsCameraMovementBaseFromPrimitive(
          mantlingTarget as RapierAlsSupportingCollider,
        )
      : resolveAlsCameraMovementBaseSnapshot(
          current.locomotionMode,
          currentGroundSupport,
        )

    const basedMovement = (
      current.locomotionMode === null
      && mantlingTarget !== null
    )
      ? rapierAlsMovementBaseFromPrimitive(
          mantlingTarget as RapierAlsSupportingCollider,
        )
      : current.locomotionMode === 'Grounded'
        ? rapierAlsMovementBase(currentGroundSupport)
        : ALS_NO_BASED_MOVEMENT

    if (current.locomotionMode === null) {
      body.setGravityScale(0, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }

    if (current.stance !== previousStance.current) {
      previousStance.current = current.stance
      setRapierAlsStanceCapsules(
        standingCapsule.current,
        crouchingCapsule.current,
        current.stance,
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
      basedMovement,
      acceleration: acceleration.current,
      overlayMode: controls.overlayMode,
      movementOverride: controls.movementOverride,
      speedOverride: controls.speed,
      directionOverride: controls.direction,
      rotateInPlaceOverride: controls.rotateInPlace,
      locomotionYawSpeed: animationLocomotionYawSpeed.current,
    })
  })

  useFrame((_, deltaRealTime) => {
    const deltaTime = worldTime
      ? getWorldDeltaTime(worldTime, deltaRealTime)
      : deltaRealTime
    const current = character.current
    const root = characterRoot.current
    const currentBody = rigidBody.current
    if (currentBody) threeToUnrealVector(currentBody.translation(), rapierBodyAnchor.current)
    if (root) {
      root.position.y = resolveAlsMeshRootRelativeY(
        current.stance,
        current.locomotionMode,
      )
      root.rotation.y = unrealYawDegreesToThreeRadians(
        current.actorYawAngle,
      )
    }

    animationLocomotionYawSpeed.current = deltaTime > 0
      ? unwindDegrees(
          current.actorYawAngle - previousAnimationActorYawAngle.current,
        ) / deltaTime
      : 0
    previousAnimationActorYawAngle.current = current.actorYawAngle

    resolveAlsActorLocation(
      rapierBodyAnchor.current,
      current.stance,
      current.locomotionMode,
      actorLocation.current,
    )
    const mantlingTarget = activeMantlingTarget.current
    const basedMovement = (
      current.locomotionMode === null
      && mantlingTarget !== null
    )
      ? rapierAlsMovementBaseFromPrimitive(
          mantlingTarget as RapierAlsSupportingCollider,
        )
      : current.locomotionMode === 'Grounded'
        ? rapierAlsMovementBase(groundSupport.current)
        : ALS_NO_BASED_MOVEMENT
    const controls = values.current
    publishAlsCharacterAnimationSnapshot(animationControls.current, {
      character: current,
      location: actorLocation.current,
      basedMovement,
      acceleration: acceleration.current,
      overlayMode: controls.overlayMode,
      movementOverride: controls.movementOverride,
      speedOverride: controls.speed,
      directionOverride: controls.direction,
      rotateInPlaceOverride: controls.rotateInPlace,
      locomotionYawSpeed: animationLocomotionYawSpeed.current,
    })
  }, ALS_FRAME_PRIORITY.MeshBase)

  return {
    character,
    animationControls,
    animationCurves,
    onJumped,
    overlayMode: overlayMode as AlsOverlayMode,
    SetOverlayMode,
  }
}
