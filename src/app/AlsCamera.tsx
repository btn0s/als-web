import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import cameraContentSource from '../../scripts/extract-als/camera-content.json?raw'
import {
  createAlsCameraAnimationInstance,
  refreshAlsCameraAnimationInstance,
  type AlsCameraAnimationInstanceInput,
} from '../als/AlsCamera/AlsCameraAnimationInstance'
import {
  activateAlsCameraComponent,
  createAlsCameraComponentState,
  refreshCameraDeltaTime,
  setRightShoulder,
  tickAlsCameraComponent,
  type AlsCameraComponentInput,
  type AlsCameraMovementBase,
  type AlsCameraRotation,
  type AlsCameraTrace,
} from '../als/AlsCamera/AlsCameraComponent'
import {
  B_Als_CameraShake_Sprint,
} from '../als/AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import { ALS_CAMERA_SETTINGS } from '../als/AlsCamera/AlsCameraSettings'
import { refreshView, setViewMode } from '../als/AlsCharacter'
import type {
  AlsCharacter,
  AlsLocomotionMode,
  AlsViewMode,
} from '../als/AlsCharacter'
import {
  resolveAlsActorLocationFromPresentationGround,
} from '../als/AlsCharacter.hooks'
import type {
  AlsGait,
  AlsRotationMode,
  AlsStance,
} from '../als/Settings/AlsMovementSettings'
import { unwindDegrees } from '../als/State/AlsLocomotionState'
import { createRapierAlsCameraTrace } from '../engine/rapierAlsCameraTrace'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import {
  createAlsCameraShakeRequest,
  createAlsCameraViewBridgeState,
  drainAlsCameraShakeRequests,
  getAlsLocomotionActionTag,
  refreshAlsCameraViewBridge,
} from '../engine/alsCameraBridge'
import { PlayerCameraManager } from '../engine/PlayerCameraManager'
import {
  threeToUnrealVector,
  unrealToThreeVector,
} from '../engine/unrealCoordinateSpace'
import {
  unrealHorizontalFovDegreesToThreeVerticalFovDegrees,
  unrealRotatorToThreeCameraQuaternion,
} from '../engine/unrealCameraView'
import type { CharacterPoseSample } from './CharacterPoseSample'

const LOOK_UP_MOUSE_SENSITIVITY = 1
const LOOK_RIGHT_MOUSE_SENSITIVITY = 1
const LOOK_UP_RATE = 90
const LOOK_RIGHT_RATE = 240
const GAMEPAD_DEAD_ZONE = 0.2
const VIEW_PITCH_MIN = -89.9
const VIEW_PITCH_MAX = 89.9

const VIEW_MODE_TAGS = {
  FirstPerson: 'Als.ViewMode.FirstPerson',
  ThirdPerson: 'Als.ViewMode.ThirdPerson',
} as const satisfies Record<AlsViewMode, string>

const LOCOMOTION_MODE_TAGS = {
  Grounded: 'Als.LocomotionMode.Grounded',
  InAir: 'Als.LocomotionMode.InAir',
} as const satisfies Record<Exclude<AlsLocomotionMode, null>, string>

const ROTATION_MODE_TAGS = {
  VelocityDirection: 'Als.RotationMode.VelocityDirection',
  ViewDirection: 'Als.RotationMode.ViewDirection',
  Aiming: 'Als.RotationMode.Aiming',
} as const satisfies Record<AlsRotationMode, string>

const STANCE_TAGS = {
  Standing: 'Als.Stance.Standing',
  Crouching: 'Als.Stance.Crouching',
} as const satisfies Record<AlsStance, string>

const GAIT_TAGS = {
  Walking: 'Als.Gait.Walking',
  Running: 'Als.Gait.Running',
  Sprinting: 'Als.Gait.Sprinting',
} as const satisfies Record<AlsGait, string>

interface ExtractedCameraSocket {
  readonly name: string
  readonly parentBone: string
  readonly relativeTransformUnreal: {
    readonly translationCm: {
      readonly value: readonly [number, number, number]
    }
  }
}

interface ExtractedCameraContent {
  readonly sockets: readonly ExtractedCameraSocket[]
}

interface MutableCameraAnimationInput {
  ViewMode: string | null
  LocomotionMode: string | null
  RotationMode: string | null
  Stance: string | null
  Gait: string | null
  LocomotionAction: string | null
  bRightShoulder: boolean
}

interface MutableCameraComponentInput {
  deltaTime: number
  allowLag: boolean
  pivotTargetLocation: { x: number; y: number; z: number }
  firstPersonCameraLocation: { x: number; y: number; z: number }
  thirdPersonTraceStartLocation: { x: number; y: number; z: number }
  ownerLocation: { x: number; y: number; z: number }
  cameraTargetRotation: AlsCameraRotation
  meshRotation: AlsCameraRotation
  movementBase: AlsCameraMovementBase | null
  meshScale: number
  curves: Record<string, number>
  trace: AlsCameraTrace
}

interface CameraDebugState {
  activated: boolean
  pointerLocked: boolean
  rightShoulder: boolean
  viewMode: AlsViewMode
  firstPersonOverride: number
  traceDistanceRatio: number
  horizontalFieldOfView: number
  location: { x: number; y: number; z: number }
  rotation: AlsCameraRotation
}

type CameraDebugWindow = Window & {
  __alsCameraState?: CameraDebugState
  __setCameraRightShoulder?: (rightShoulder: boolean) => void
  __setCameraViewMode?: (viewMode: AlsViewMode) => void
  __setCameraViewRotation?: (pitch: number, yaw: number) => void
}

const extractedCameraContent = JSON.parse(
  cameraContentSource,
) as ExtractedCameraContent

function socketOffset(name: string): THREE.Vector3 {
  const socket = extractedCameraContent.sockets.find(
    (candidate) => candidate.name === name,
  )
  if (!socket || socket.parentBone !== 'head') {
    throw new Error(`ALS camera socket "${name}" is not parented to head`)
  }
  const [x, y, z] = socket.relativeTransformUnreal.translationCm.value
  return new THREE.Vector3(x * 0.01, z * 0.01, y * 0.01)
}

const FIRST_PERSON_CAMERA_OFFSET = socketOffset(
  ALS_CAMERA_SETTINGS.firstPerson.cameraSocketName,
)
const TRACE_SHOULDER_LEFT_OFFSET = socketOffset(
  ALS_CAMERA_SETTINGS.thirdPerson.traceShoulderLeftSocketName,
)
const TRACE_SHOULDER_RIGHT_OFFSET = socketOffset(
  ALS_CAMERA_SETTINGS.thirdPerson.traceShoulderRightSocketName,
)

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

function findBone(scene: THREE.Object3D, name: string): THREE.Bone | null {
  const candidate = scene.getObjectByName(name)
  return candidate instanceof THREE.Bone ? candidate : null
}

function toggleViewMode(character: AlsCharacter | null) {
  if (!character) return
  setViewMode(
    character,
    character.viewMode === 'ThirdPerson'
      ? 'FirstPerson'
      : 'ThirdPerson',
  )
}

function updateAnimationInput(
  input: MutableCameraAnimationInput,
  character: AlsCharacter,
  rightShoulder: boolean,
) {
  input.ViewMode = VIEW_MODE_TAGS[character.viewMode]
  input.LocomotionMode = character.locomotionMode === null
    ? null
    : LOCOMOTION_MODE_TAGS[character.locomotionMode]
  input.RotationMode = ROTATION_MODE_TAGS[
    character.viewMode === 'FirstPerson'
      ? character.desiredRotationMode
      : character.rotationMode
  ]
  input.Stance = STANCE_TAGS[character.stance]
  input.Gait = GAIT_TAGS[character.gait]
  input.LocomotionAction = getAlsLocomotionActionTag(
    character.locomotionAction,
  )
  input.bRightShoulder = rightShoulder
}

function applyRadialDeadZone(axes: { x: number; y: number }) {
  const magnitude = Math.hypot(axes.x, axes.y)
  if (magnitude <= GAMEPAD_DEAD_ZONE) {
    axes.x = 0
    axes.y = 0
    return
  }
  const scaledMagnitude = Math.min(
    1,
    (magnitude - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE),
  )
  axes.x *= scaledMagnitude / magnitude
  axes.y *= scaledMagnitude / magnitude
}

function activeGamepad(): Gamepad | null {
  const gamepads = navigator.getGamepads?.()
  if (!gamepads) return null
  for (const gamepad of gamepads) {
    if (gamepad?.connected) return gamepad
  }
  return null
}

function updateSocketLocation(
  bone: THREE.Bone,
  offset: Readonly<THREE.Vector3>,
  threeLocation: THREE.Vector3,
  unrealLocation: { x: number; y: number; z: number },
) {
  threeLocation.copy(offset)
  bone.localToWorld(threeLocation)
  threeToUnrealVector(threeLocation, unrealLocation)
}

export function AlsCamera({
  poseSample,
}: {
  poseSample: MutableRefObject<CharacterPoseSample>
}) {
  const { camera, gl, scene, size } = useThree()
  const { world } = useRapier()
  const cameraAnimationState = useRef(
    createAlsCameraAnimationInstance(),
  ).current
  const cameraComponentState = useRef(
    createAlsCameraComponentState(),
  ).current
  const playerCameraManager = useMemo(
    () => new PlayerCameraManager({
      CameraShakeClasses: [B_Als_CameraShake_Sprint],
    }),
    [],
  )
  const cameraViewBridge = useMemo(
    createAlsCameraViewBridgeState,
    [],
  )
  const cameraShakeRequest = useMemo(
    createAlsCameraShakeRequest,
    [],
  )
  const activated = useRef(false)
  const rootBone = useRef<THREE.Bone | null>(null)
  const headBone = useRef<THREE.Bone | null>(null)
  const pointerDelta = useRef({ x: 0, y: 0 })
  const pressedKeys = useRef(new Set<string>())
  const previousGamepadButtons = useRef({
    switchShoulder: false,
    viewMode: false,
  })
  const viewRotation = useRef<AlsCameraRotation>({
    pitch: 0,
    yaw: 0,
    roll: 0,
  })
  const scratch = useMemo(() => ({
    rootThree: new THREE.Vector3(),
    headThree: new THREE.Vector3(),
    socketThree: new THREE.Vector3(),
    cameraThree: new THREE.Vector3(),
    cameraQuaternion: new THREE.Quaternion(),
    gamepadLook: { x: 0, y: 0 },
    pointerYawInput: 0,
    keyboardLookRight: 0,
    gamepadLookRight: 0,
    projectionAspect: Number.NaN,
    projectionHorizontalFieldOfView: Number.NaN,
  }), [])
  const trace = useMemo(
    () => createRapierAlsCameraTrace({
      world,
      getOwnerRigidBody: () => poseSample.current.ownerRigidBody,
      queryFilterForChannel: () => ({}),
    }),
    [poseSample, world],
  )
  const animationInput = useMemo<MutableCameraAnimationInput>(() => ({
    ViewMode: VIEW_MODE_TAGS.ThirdPerson,
    LocomotionMode: LOCOMOTION_MODE_TAGS.Grounded,
    RotationMode: ROTATION_MODE_TAGS.VelocityDirection,
    Stance: STANCE_TAGS.Standing,
    Gait: GAIT_TAGS.Walking,
    LocomotionAction: null,
    bRightShoulder: true,
  }), [])
  const componentInput = useMemo<MutableCameraComponentInput>(() => ({
    deltaTime: 0,
    allowLag: true,
    pivotTargetLocation: { x: 0, y: 0, z: 0 },
    firstPersonCameraLocation: { x: 0, y: 0, z: 0 },
    thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
    ownerLocation: { x: 0, y: 0, z: 0 },
    cameraTargetRotation: { pitch: 0, yaw: 0, roll: 0 },
    meshRotation: { pitch: 0, yaw: -90, roll: 0 },
    movementBase: null,
    meshScale: 1,
    curves: cameraAnimationState.curves,
    trace,
  }), [cameraAnimationState.curves, trace])
  const deltaTimeInput = useMemo(() => ({
    deltaTime: 0,
    deltaRealTime: 0,
    effectiveGlobalTimeDilation: 1,
    customTimeDilation: 1,
  }), [])
  const debugState = useMemo<CameraDebugState>(() => ({
    activated: false,
    pointerLocked: false,
    rightShoulder: true,
    viewMode: 'ThirdPerson',
    firstPersonOverride: 0,
    traceDistanceRatio: 1,
    horizontalFieldOfView: 90,
    location: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
  }), [])

  useEffect(() => {
    const cameraShakeRequests = poseSample.current.cameraShakeRequests
    return () => cameraShakeRequests.Reset()
  }, [poseSample])

  useEffect(() => {
    const canvas = gl.domElement
    const onPointerDown = () => {
      if (document.pointerLockElement === canvas) return
      void canvas.requestPointerLock().catch(() => {
        // Browsers may reject lock when devtools or another document owns it. A later click can
        // retry; drag-to-look remains available through the buttons fallback below.
      })
    }
    const onPointerMove = (event: PointerEvent) => {
      const looking =
        document.pointerLockElement === canvas
        || (event.buttons & 3) !== 0
      if (!looking) return
      pointerDelta.current.x +=
        event.movementX * LOOK_RIGHT_MOUSE_SENSITIVITY
      pointerDelta.current.y -=
        event.movementY * LOOK_UP_MOUSE_SENSITIVITY
    }
    const onContextMenu = (event: Event) => event.preventDefault()
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return
      pressedKeys.current.add(event.code)
      if (event.repeat) return
      if (event.code === 'Digit2') {
        toggleViewMode(poseSample.current.character)
      } else if (event.code === 'KeyC') {
        setRightShoulder(
          cameraComponentState,
          !cameraComponentState.rightShoulder,
        )
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.current.delete(event.code)
    }
    const clearInput = () => {
      pressedKeys.current.clear()
      pointerDelta.current.x = 0
      pointerDelta.current.y = 0
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInput)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInput)
    }
  }, [cameraComponentState, gl.domElement, poseSample])

  useEffect(() => {
    const debugWindow = window as CameraDebugWindow
    debugWindow.__alsCameraState = debugState
    debugWindow.__setCameraRightShoulder = (rightShoulder) => {
      setRightShoulder(cameraComponentState, rightShoulder)
    }
    debugWindow.__setCameraViewMode = (viewMode) => {
      const character = poseSample.current.character
      if (character) setViewMode(character, viewMode)
    }
    debugWindow.__setCameraViewRotation = (pitch, yaw) => {
      viewRotation.current.pitch = THREE.MathUtils.clamp(
        pitch,
        VIEW_PITCH_MIN,
        VIEW_PITCH_MAX,
      )
      viewRotation.current.yaw = unwindDegrees(yaw)
      const character = poseSample.current.character
      if (character) {
        refreshView(
          character,
          viewRotation.current.yaw,
          0,
          viewRotation.current.pitch,
        )
        poseSample.current.viewYawAngle = unwindDegrees(
          viewRotation.current.yaw - character.actorYawAngle,
        )
      }
    }
    return () => {
      delete debugWindow.__alsCameraState
      delete debugWindow.__setCameraRightShoulder
      delete debugWindow.__setCameraViewMode
      delete debugWindow.__setCameraViewRotation
    }
  }, [cameraComponentState, debugState, poseSample])

  useFrame((_, deltaTime) => {
    const sample = poseSample.current
    const character = sample.character
    if (!character) return

    const gamepad = activeGamepad()
    const switchShoulderPressed =
      gamepad?.buttons[11]?.pressed ?? false
    const viewModePressed = gamepad?.buttons[15]?.pressed ?? false
    if (
      switchShoulderPressed
      && !previousGamepadButtons.current.switchShoulder
    ) {
      setRightShoulder(
        cameraComponentState,
        !cameraComponentState.rightShoulder,
      )
    }
    if (
      viewModePressed
      && !previousGamepadButtons.current.viewMode
    ) {
      toggleViewMode(character)
    }
    previousGamepadButtons.current.switchShoulder =
      switchShoulderPressed
    previousGamepadButtons.current.viewMode = viewModePressed

    const rotation = viewRotation.current
    rotation.yaw = character.viewYawAngle
    scratch.pointerYawInput = pointerDelta.current.x
    scratch.gamepadLook.x = gamepad?.axes[2] ?? 0
    scratch.gamepadLook.y = -(gamepad?.axes[3] ?? 0)
    applyRadialDeadZone(scratch.gamepadLook)
    scratch.gamepadLookRight = scratch.gamepadLook.x
    scratch.keyboardLookRight =
      (pressedKeys.current.has('ArrowRight') ? 1 : 0)
      - (pressedKeys.current.has('ArrowLeft') ? 1 : 0)
    const keyboardLookUp =
      (pressedKeys.current.has('ArrowUp') ? 1 : 0)
      - (pressedKeys.current.has('ArrowDown') ? 1 : 0)
    rotation.pitch = THREE.MathUtils.clamp(
      rotation.pitch
        + pointerDelta.current.y
        + (
          keyboardLookUp + scratch.gamepadLook.y
        ) * LOOK_UP_RATE * deltaTime,
      VIEW_PITCH_MIN,
      VIEW_PITCH_MAX,
    )
    rotation.yaw = unwindDegrees(
      rotation.yaw
        + pointerDelta.current.x
        + (
          scratch.keyboardLookRight + scratch.gamepadLook.x
        ) * LOOK_RIGHT_RATE * deltaTime,
    )
    pointerDelta.current.x = 0
    pointerDelta.current.y = 0
    refreshView(character, rotation.yaw, deltaTime, rotation.pitch)
    sample.viewYawAngle = unwindDegrees(
      character.viewYawAngle - character.actorYawAngle,
    )
    sample.viewYawSpeed = character.viewYawSpeed
  }, ALS_FRAME_PRIORITY.ControlRotation)

  useFrame((_, rawDeltaTime) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return

    const sample = poseSample.current
    const character = sample.character
    if (!sample.ready || !character) return

    rootBone.current ??= findBone(scene, 'root')
    headBone.current ??= findBone(scene, 'head')
    const root = rootBone.current
    const head = headBone.current
    if (!root || !head) return

    const deltaTime = refreshCameraDeltaTime(
      cameraComponentState,
      ALS_CAMERA_SETTINGS,
      Object.assign(deltaTimeInput, {
        deltaTime: rawDeltaTime,
        deltaRealTime: rawDeltaTime,
      }),
    )

    const rotation = viewRotation.current
    rotation.yaw = character.viewYawAngle
    sample.viewYawAngle = unwindDegrees(
      rotation.yaw - character.actorYawAngle,
    )
    sample.viewYawSpeed = character.viewYawSpeed

    root.getWorldPosition(scratch.rootThree)
    head.getWorldPosition(scratch.headThree)
    const input = componentInput
    threeToUnrealVector(
      scratch.rootThree,
      input.pivotTargetLocation,
    )
    threeToUnrealVector(scratch.headThree, input.firstPersonCameraLocation)
    input.pivotTargetLocation.x =
      (
        input.pivotTargetLocation.x
        + input.firstPersonCameraLocation.x
      ) * 0.5
    input.pivotTargetLocation.y =
      (
        input.pivotTargetLocation.y
        + input.firstPersonCameraLocation.y
      ) * 0.5
    input.pivotTargetLocation.z =
      (
        input.pivotTargetLocation.z
        + input.firstPersonCameraLocation.z
      ) * 0.5

    updateSocketLocation(
      head,
      FIRST_PERSON_CAMERA_OFFSET,
      scratch.socketThree,
      input.firstPersonCameraLocation,
    )
    updateSocketLocation(
      head,
      cameraComponentState.rightShoulder
        ? TRACE_SHOULDER_RIGHT_OFFSET
        : TRACE_SHOULDER_LEFT_OFFSET,
      scratch.socketThree,
      input.thirdPersonTraceStartLocation,
    )
    // ALS uses GetOwner()->GetActorLocation(), but the camera pivot is evaluated from the
    // rendered skeleton. Derive the active capsule root from that same presentation frame rather
    // than reading Rapier's fixed-step body transform here.
    threeToUnrealVector(sample.ground, input.ownerLocation)
    resolveAlsActorLocationFromPresentationGround(
      input.ownerLocation,
      character.stance,
      character.locomotionMode,
      input.ownerLocation,
    )
    input.cameraTargetRotation.pitch = rotation.pitch
    input.cameraTargetRotation.yaw = rotation.yaw
    input.cameraTargetRotation.roll = 0
    input.meshRotation.pitch = 0
    input.meshRotation.yaw = character.actorYawAngle - 90
    input.meshRotation.roll = 0
    input.deltaTime = deltaTime
    input.allowLag = true
    input.movementBase = sample.movementBase

    updateAnimationInput(
      animationInput,
      character,
      cameraComponentState.rightShoulder,
    )
    refreshAlsCameraAnimationInstance(
      cameraAnimationState,
      animationInput as AlsCameraAnimationInstanceInput,
      activated.current ? deltaTime : 0,
    )

    if (!activated.current) {
      const {
        deltaTime: _deltaTime,
        allowLag: _allowLag,
        ...activationInput
      } = input
      void _deltaTime
      void _allowLag
      activateAlsCameraComponent(
        cameraComponentState,
        activationInput as Omit<
          AlsCameraComponentInput,
          'deltaTime' | 'allowLag'
        >,
      )
      activated.current = true
    } else {
      tickAlsCameraComponent(
        cameraComponentState,
        input as AlsCameraComponentInput,
      )
    }

    drainAlsCameraShakeRequests(
      sample.cameraShakeRequests,
      playerCameraManager,
      cameraShakeRequest,
    )
    const renderView = refreshAlsCameraViewBridge(
      cameraViewBridge,
      playerCameraManager,
      cameraComponentState,
      deltaTime,
    )

    unrealToThreeVector(
      renderView.cameraLocation,
      scratch.cameraThree,
    )
    camera.position.copy(scratch.cameraThree)
    unrealRotatorToThreeCameraQuaternion(
      renderView.cameraRotation,
      scratch.cameraQuaternion,
    )
    camera.quaternion.copy(scratch.cameraQuaternion)

    const aspectRatio = size.width / size.height
    if (
      scratch.projectionAspect !== aspectRatio
      || scratch.projectionHorizontalFieldOfView
        !== renderView.cameraFieldOfView
    ) {
      scratch.projectionAspect = aspectRatio
      scratch.projectionHorizontalFieldOfView =
        renderView.cameraFieldOfView
      camera.fov =
        unrealHorizontalFovDegreesToThreeVerticalFovDegrees(
          renderView.cameraFieldOfView,
          aspectRatio,
        )
      camera.near = 0.1
      camera.updateProjectionMatrix()
    }

    debugState.activated = true
    debugState.pointerLocked =
      document.pointerLockElement === gl.domElement
    debugState.rightShoulder = cameraComponentState.rightShoulder
    debugState.viewMode = character.viewMode
    debugState.firstPersonOverride =
      cameraAnimationState.curves.FirstPersonOverride
    debugState.traceDistanceRatio =
      cameraComponentState.traceDistanceRatio
    debugState.horizontalFieldOfView =
      renderView.cameraFieldOfView
    debugState.location.x = renderView.cameraLocation.x
    debugState.location.y = renderView.cameraLocation.y
    debugState.location.z = renderView.cameraLocation.z
    debugState.rotation.pitch = renderView.cameraRotation.pitch
    debugState.rotation.yaw = renderView.cameraRotation.yaw
    debugState.rotation.roll = renderView.cameraRotation.roll
  }, ALS_FRAME_PRIORITY.Camera)

  return null
}
