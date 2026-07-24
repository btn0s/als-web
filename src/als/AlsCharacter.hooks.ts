import {
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
  threeToUnrealVector,
  unrealToThreeVector,
  unrealYawDegreesToThreeRadians,
} from '../engine/unrealCoordinateSpace'
import {
  createAlsCharacter,
  refreshAlsCharacter,
  refreshGroundedFacingTarget,
  setStance,
} from './AlsCharacter'
import type { AlsCharacter } from './AlsCharacter'
import {
  stepGroundedVelocity,
} from './AlsCharacterMovementComponent'
import { getRelativeAccelerationAmount } from './AlsAnimationInstance'
import type { AlsAnimationInstanceControls } from './AlsAnimationInstance'
import type { CharacterPoseSample } from './AlsCamera/poseCameraState'
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
export const ALS_PHYSICS_TIMESTEP = 1 / 60

// Unreal Enhanced Input's default radial dead-zone lower threshold. The authored IMC mapping
// dump owns buttons/axes; this engine-level normalization only suppresses browser gamepad drift.
const GAMEPAD_DEAD_ZONE = 0.2
const COUNTER_CLOCKWISE_ROTATION_ANGLE_THRESHOLD = 5
const SPRINT_HOLD_TIME_THRESHOLD = 0.1

/** Enhanced Input `UInputTriggerHold` threshold check for IMC_Als_Default's Sprint mapping. */
export function hasTriggeredSprintHold(heldTime: number): boolean {
  return heldTime + Number.EPSILON >= SPRINT_HOLD_TIME_THRESHOLD
}

interface InputAxes {
  right: number
  forward: number
}

interface GamepadInput extends InputAxes {
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
  readonly animationControls: MutableRefObject<AlsAnimationInstanceControls>
  readonly overlayMode: AlsOverlayMode
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
  // IMC_Als_Default: FaceButtonRight, RightShoulder, LeftThumbstick, LeftShoulder, DPadLeft.
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
): number {
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
  capsule: MutableRefObject<RapierCollider | null>,
  characterRoot: MutableRefObject<THREE.Group | null>,
  poseSample: MutableRefObject<CharacterPoseSample>,
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
  const animationControls = useRef<AlsAnimationInstanceControls>({
    gait: 'Walking',
    moving: false,
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
    sprint: false,
    walk: false,
    crouch: false,
    aim: false,
    rotationMode: false,
  })
  const previousGamepadInput = useRef({
    walk: false,
    crouch: false,
    rotationMode: false,
  })
  const sprintHoldTime = useRef(0)
  const sprintActionActive = useRef(false)
  const inputAxes = useRef<InputAxes>({ right: 0, forward: 0 })
  const inputDirection = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const actualVelocity = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const acceleration = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const desiredVelocity = useRef<AlsVector3>({ x: 0, y: 0, z: 0 })
  const renderedVelocity = useRef({ x: 0, y: 0, z: 0 })
  const debugViewYawWorld = useRef(0)
  const previousStance = useRef<AlsStance>('Standing')

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
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.current.delete(event.code)
    }
    const clearInputs = () => {
      pressedKeys.current.clear()
      aimingWithPointer.current = false
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
    return () => {
      delete window.__setSpeed
      delete window.__setGait
      delete window.__setStance
      delete window.__setRotationMode
      delete window.__setOverlayMode
      delete window.__setViewYaw
      delete window.__setMovementOverride
    }
  }, [setControls])

  useBeforePhysicsStep(() => {
    const body = rigidBody.current
    if (!body) return

    const controls = values.current
    const current = character.current
    const keys = pressedKeys.current
    const gamepad = sampleGamepad(gamepadInput.current)
    const previousGamepad = previousGamepadInput.current
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
    setStance(current, current.desiredStance)

    const relativeViewYaw = controls.viewYawOverride
      ? unwindDegrees(debugViewYawWorld.current - current.actorYawAngle)
      : poseSample.current.viewYawAngle
    current.viewYawAngle = unwindDegrees(
      current.actorYawAngle + relativeViewYaw,
    )
    current.viewYawSpeed = poseSample.current.viewYawSpeed

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
    const previousVelocityX = current.locomotionState.velocity.x
    const previousVelocityY = current.locomotionState.velocity.y
    const previousVelocityZ = current.locomotionState.velocity.z
    const locomotionActorYaw = current.actorYawAngle * Math.PI / 180
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
    stepGroundedVelocity(
      current.movement,
      inputDirection.current,
      ALS_PHYSICS_TIMESTEP,
      current.viewYawAngle,
    )
    unrealToThreeVector(current.movement.velocity, renderedVelocity.current)
    body.setLinvel(renderedVelocity.current, true)

    stepGroundedCharacterYaw(current, ALS_PHYSICS_TIMESTEP)
    const root = characterRoot.current
    if (root) {
      root.rotation.y = unrealYawDegreesToThreeRadians(
        current.actorYawAngle,
      )
    }

    if (current.stance !== previousStance.current) {
      previousStance.current = current.stance
      const halfHeight = current.stance === 'Crouching'
        ? ALS_CROUCHING_CAPSULE_HALF_HEIGHT
        : ALS_STANDING_CAPSULE_HALF_HEIGHT
      capsule.current?.setHalfHeight(halfHeight - ALS_CAPSULE_RADIUS)
      capsule.current?.setTranslationWrtParent({
        x: 0,
        y: halfHeight - ALS_STANDING_CAPSULE_HALF_HEIGHT,
        z: 0,
      })
    }

    const state = current.locomotionState
    const frame = animationControls.current
    frame.gait = controls.movementOverride
      ? current.desiredGait
      : current.gait
    frame.moving = controls.movementOverride
      ? controls.speed > 0
      : state.moving
    frame.stance = current.stance
    frame.rotationMode = current.rotationMode
    frame.overlayMode = controls.overlayMode
    frame.speed = controls.movementOverride
      ? Math.max(0, controls.speed)
      : state.speed
    frame.direction = controls.movementOverride
      ? controls.direction
      : unwindDegrees(state.velocityYawAngle - current.actorYawAngle)
    const relativeAccelerationAmount = getRelativeAccelerationAmount({
      actorYaw: locomotionActorYaw,
      acceleration: acceleration.current,
      velocity: state.velocity,
      maxAcceleration: current.movement.maxAccelerationWalking,
      maxBrakingDeceleration:
        current.movement.brakingDecelerationWalking,
    })
    frame.relativeAccelerationAmount.x = controls.movementOverride
      ? 0
      : relativeAccelerationAmount.x
    frame.relativeAccelerationAmount.y = controls.movementOverride
      ? 0
      : relativeAccelerationAmount.y
    frame.rotateInPlace = controls.rotateInPlace
    frame.viewYawAngle = relativeViewYaw
    frame.viewYawSpeed = current.viewYawSpeed

    window.__alsCharacterState = {
      actorYawAngle: current.actorYawAngle,
      desiredGait: current.desiredGait,
      gait: current.gait,
      stance: current.stance,
      rotationMode: current.rotationMode,
      speed: state.speed,
      direction: frame.direction,
      moving: state.moving,
      position: body.translation(),
      velocity: body.linvel(),
    }
  })

  return {
    character,
    animationControls,
    overlayMode: overlayMode as AlsOverlayMode,
  }
}
