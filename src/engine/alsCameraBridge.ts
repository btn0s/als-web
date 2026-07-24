import {
  ALS_ANIM_NOTIFY_CAMERA_SHAKE_DEFAULTS,
} from '../als/AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import type {
  AlsAnimNotifyCameraShakePayload,
  AlsPlayerCameraManager,
} from '../als/AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import type {
  AlsCameraComponentState,
  AlsCameraRotation,
} from '../als/AlsCamera/AlsCameraComponent'
import type { AlsLocomotionAction } from '../als/AlsCharacter'
import type { AlsVector3 } from '../als/State/AlsLocomotionState'
import type {
  FMinimalViewInfo,
  PlayerCameraManager,
} from './PlayerCameraManager'

const UNREAL_CENTIMETRES_PER_METRE = 100
const REPO_METRES_PER_UNREAL_CENTIMETRE = 0.01

const LOCOMOTION_ACTION_TAGS = {
  Mantling: 'Als.LocomotionAction.Mantling',
  Ragdolling: 'Als.LocomotionAction.Ragdolling',
  GettingUp: 'Als.LocomotionAction.GettingUp',
  Rolling: 'Als.LocomotionAction.Rolling',
} as const satisfies Record<
  Exclude<AlsLocomotionAction, null>,
  string
>

export interface AlsCameraRenderView {
  readonly cameraLocation: AlsVector3
  readonly cameraRotation: AlsCameraRotation
  cameraFieldOfView: number
}

export interface AlsCameraViewBridgeState {
  /** UE's `FMinimalViewInfo`: centimetres, degrees, and horizontal-FOV degrees. */
  readonly viewInfo: FMinimalViewInfo
  /** Renderer-facing copy, with location converted back to repository metres. */
  readonly renderView: AlsCameraRenderView
}

export interface MutableAlsCameraShakeRequest {
  CameraShakeClass: string | null
  CameraShakeScale: number
}

/** Exact gameplay-tag value copied by `UAlsCameraAnimationInstance::NativeUpdateAnimation()`. */
export function getAlsLocomotionActionTag(
  action: AlsLocomotionAction,
): string | null {
  return action === null ? null : LOCOMOTION_ACTION_TAGS[action]
}

/**
 * Queued boundary between animation-notify evaluation and the camera frame.
 *
 * `StartCameraShake()` intentionally matches the one `APlayerCameraManager` method called by
 * `UAlsAnimNotify_CameraShake::Notify()`. The live camera drains the exact FIFO payload before
 * its player-camera modifier pass; animation dispatch publishing into this queue is the remaining
 * crossing seam.
 */
export class AlsCameraShakeRequestQueue
implements AlsPlayerCameraManager {
  private readonly cameraShakeClasses: (string | null)[] = []
  private readonly cameraShakeScales: number[] = []
  private readIndex = 0

  get Num(): number {
    return this.cameraShakeClasses.length - this.readIndex
  }

  StartCameraShake(
    CameraShakeClass: string | null,
    CameraShakeScale: number,
  ): void {
    this.cameraShakeClasses.push(CameraShakeClass)
    this.cameraShakeScales.push(CameraShakeScale)
  }

  Dequeue(OutRequest: MutableAlsCameraShakeRequest): boolean {
    if (this.readIndex >= this.cameraShakeClasses.length) return false

    OutRequest.CameraShakeClass =
      this.cameraShakeClasses[this.readIndex] ?? null
    OutRequest.CameraShakeScale =
      this.cameraShakeScales[this.readIndex] ?? 0
    this.cameraShakeClasses[this.readIndex] = null
    this.readIndex++

    if (this.readIndex === this.cameraShakeClasses.length) {
      this.cameraShakeClasses.length = 0
      this.cameraShakeScales.length = 0
      this.readIndex = 0
    }
    return true
  }

  Reset(): void {
    this.cameraShakeClasses.length = 0
    this.cameraShakeScales.length = 0
    this.readIndex = 0
  }
}

export function createAlsCameraShakeRequest(
  overrides: Partial<AlsAnimNotifyCameraShakePayload> = {},
): MutableAlsCameraShakeRequest {
  return {
    CameraShakeClass: overrides.CameraShakeClass
      ?? ALS_ANIM_NOTIFY_CAMERA_SHAKE_DEFAULTS.CameraShakeClass,
    CameraShakeScale: overrides.CameraShakeScale
      ?? ALS_ANIM_NOTIFY_CAMERA_SHAKE_DEFAULTS.CameraShakeScale,
  }
}

/**
 * Delivers already-published queued notifies immediately before the player-camera modifier pass.
 * The caller owns `requestScratch`, keeping an empty camera frame allocation-free.
 */
export function drainAlsCameraShakeRequests(
  queue: AlsCameraShakeRequestQueue,
  cameraManager: PlayerCameraManager,
  requestScratch: MutableAlsCameraShakeRequest,
): number {
  let deliveredRequestCount = 0
  while (queue.Dequeue(requestScratch)) {
    cameraManager.StartCameraShake(
      requestScratch.CameraShakeClass,
      requestScratch.CameraShakeScale,
    )
    deliveredRequestCount++
  }
  return deliveredRequestCount
}

export function createAlsCameraViewBridgeState():
AlsCameraViewBridgeState {
  return {
    viewInfo: {
      Location: { x: 0, y: 0, z: 0 },
      Rotation: { pitch: 0, yaw: 0, roll: 0 },
      FOV: 90,
    },
    renderView: {
      cameraLocation: { x: 0, y: 0, z: 0 },
      cameraRotation: { pitch: 0, yaw: 0, roll: 0 },
      cameraFieldOfView: 90,
    },
  }
}

/**
 * `UAlsCameraComponent::GetViewInfo()` followed by UE's player-camera modifier pass.
 *
 * The component remains in repository metres and never receives the shaken result back, so
 * camera-local offsets cannot feed into the next ALS camera tick. Only `FMinimalViewInfo`
 * location crosses into Unreal centimetres for the engine camera-shake runtime; rotation and
 * horizontal FOV remain degrees throughout.
 */
export function refreshAlsCameraViewBridge(
  state: AlsCameraViewBridgeState,
  cameraManager: PlayerCameraManager,
  component: Pick<
    AlsCameraComponentState,
    'cameraLocation' | 'cameraRotation' | 'cameraFieldOfView'
  >,
  deltaTime: number,
): AlsCameraRenderView {
  const viewInfo = state.viewInfo
  viewInfo.Location.x =
    component.cameraLocation.x * UNREAL_CENTIMETRES_PER_METRE
  viewInfo.Location.y =
    component.cameraLocation.y * UNREAL_CENTIMETRES_PER_METRE
  viewInfo.Location.z =
    component.cameraLocation.z * UNREAL_CENTIMETRES_PER_METRE
  viewInfo.Rotation.pitch = component.cameraRotation.pitch
  viewInfo.Rotation.yaw = component.cameraRotation.yaw
  viewInfo.Rotation.roll = component.cameraRotation.roll
  viewInfo.FOV = component.cameraFieldOfView

  cameraManager.UpdateAndApplyCameraShakes(deltaTime, viewInfo)

  const renderView = state.renderView
  renderView.cameraLocation.x =
    viewInfo.Location.x * REPO_METRES_PER_UNREAL_CENTIMETRE
  renderView.cameraLocation.y =
    viewInfo.Location.y * REPO_METRES_PER_UNREAL_CENTIMETRE
  renderView.cameraLocation.z =
    viewInfo.Location.z * REPO_METRES_PER_UNREAL_CENTIMETRE
  renderView.cameraRotation.pitch = viewInfo.Rotation.pitch
  renderView.cameraRotation.yaw = viewInfo.Rotation.yaw
  renderView.cameraRotation.roll = viewInfo.Rotation.roll
  renderView.cameraFieldOfView = viewInfo.FOV
  return renderView
}
