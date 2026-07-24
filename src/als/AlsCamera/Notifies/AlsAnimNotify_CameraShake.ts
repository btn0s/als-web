import cameraContentJson from '../../../../scripts/extract-als/camera-content.json?raw'

interface ExtractedValue<Value> {
  readonly value: Value
}

interface CameraShakeContentOracle {
  readonly cameraShake: {
    readonly asset: string
    readonly rootPattern: {
      readonly type: string
      readonly values: {
        readonly RotationAmplitudeMultiplier: number
        readonly Pitch: {
          readonly Amplitude: number
          readonly Frequency: number
        }
        readonly Yaw: {
          readonly Amplitude: number
          readonly Frequency: number
        }
        readonly Roll: {
          readonly Amplitude: number
          readonly Frequency: number
        }
        readonly Duration: number
        readonly BlendInTime: number
        readonly BlendOutTime: number
      }
    }
    readonly notifyDefaults: {
      readonly CameraShakeScale: ExtractedValue<number>
    }
    readonly notifies: readonly {
      readonly sequence: string
      readonly sequenceLength: number
      readonly loop: boolean
      readonly notifyName: string
      readonly time: number
      readonly triggerWeightThreshold: number
      readonly montageTickType: string
      readonly notifyTriggerChance: number
      readonly notifyFilterType: string
      readonly notifyFilterLod: number
      readonly triggerOnDedicatedServer: boolean
      readonly triggerOnFollower: boolean
      readonly cameraShakeClass: ExtractedValue<string>
      readonly cameraShakeScale: ExtractedValue<number>
    }[]
  }
}

const ORACLE = (
  JSON.parse(cameraContentJson) as CameraShakeContentOracle
).cameraShake

export interface AlsWaveOscillator {
  readonly Amplitude: number
  readonly Frequency: number
}

/**
 * Serialized runtime values from `B_Als_CameraShake_Sprint`'s
 * `UWaveOscillatorCameraShakePattern`.
 *
 * Properties absent from the asset retain UE's `UWaveOscillatorCameraShakePattern` defaults.
 * They are deliberately not guessed here; the camera-manager implementation owns those engine
 * defaults when it ports `StartCameraShake()`.
 */
export interface AlsWaveOscillatorCameraShakePattern {
  readonly Type: 'WaveOscillatorCameraShakePattern'
  readonly RotationAmplitudeMultiplier: number
  readonly Pitch: AlsWaveOscillator
  readonly Yaw: AlsWaveOscillator
  readonly Roll: AlsWaveOscillator
  readonly Duration: number
  readonly BlendInTime: number
  readonly BlendOutTime: number
}

/** Exact authored payload of `B_Als_CameraShake_Sprint`. */
export const B_Als_CameraShake_Sprint:
Readonly<{
  CameraShakeClass: 'B_Als_CameraShake_Sprint_C'
  RootShakePattern: AlsWaveOscillatorCameraShakePattern
}> = Object.freeze({
  CameraShakeClass: 'B_Als_CameraShake_Sprint_C',
  RootShakePattern: Object.freeze({
    Type: ORACLE.rootPattern.type as 'WaveOscillatorCameraShakePattern',
    RotationAmplitudeMultiplier:
      ORACLE.rootPattern.values.RotationAmplitudeMultiplier,
    Pitch: Object.freeze({ ...ORACLE.rootPattern.values.Pitch }),
    Yaw: Object.freeze({ ...ORACLE.rootPattern.values.Yaw }),
    Roll: Object.freeze({ ...ORACLE.rootPattern.values.Roll }),
    Duration: ORACLE.rootPattern.values.Duration,
    BlendInTime: ORACLE.rootPattern.values.BlendInTime,
    BlendOutTime: ORACLE.rootPattern.values.BlendOutTime,
  }),
})

export interface AlsAnimNotifyCameraShakePayload {
  readonly CameraShakeClass: string | null
  readonly CameraShakeScale: number
}

export interface AlsAnimNotifyCameraShakeEvent
extends AlsAnimNotifyCameraShakePayload {
  readonly Sequence: string
  readonly SequenceLength: number
  readonly bLoop: boolean
  readonly NotifyName: 'AlsCameraShake'
  readonly Time: number
  readonly TriggerWeightThreshold: number
  readonly MontageTickType: 'EMontageNotifyTickType::Queued'
  readonly NotifyTriggerChance: number
  readonly NotifyFilterType: 'ENotifyFilterType::NoFiltering'
  readonly NotifyFilterLOD: number
  readonly bTriggerOnDedicatedServer: boolean
  readonly bTriggerOnFollower: boolean
}

/** Defaults declared by `UAlsAnimNotify_CameraShake`. */
export const ALS_ANIM_NOTIFY_CAMERA_SHAKE_DEFAULTS:
Readonly<AlsAnimNotifyCameraShakePayload> = Object.freeze({
  CameraShakeClass: null,
  CameraShakeScale: ORACLE.notifyDefaults.CameraShakeScale.value,
})

/**
 * Every shipped `UAlsAnimNotify_CameraShake` instance reachable from the curated ALS clips.
 *
 * The source events live on Sprint, Sprint Acceleration, and Roll. Keeping their trigger
 * thresholds is required: Unreal only queues an animation notify when its source pose contributes
 * at least that authored weight.
 */
export const ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS:
readonly Readonly<AlsAnimNotifyCameraShakeEvent>[] = Object.freeze(
  ORACLE.notifies.map((notify) => Object.freeze({
    Sequence: notify.sequence,
    SequenceLength: notify.sequenceLength,
    bLoop: notify.loop,
    NotifyName: notify.notifyName as 'AlsCameraShake',
    Time: notify.time,
    TriggerWeightThreshold: notify.triggerWeightThreshold,
    MontageTickType:
      notify.montageTickType as 'EMontageNotifyTickType::Queued',
    NotifyTriggerChance: notify.notifyTriggerChance,
    NotifyFilterType:
      notify.notifyFilterType as 'ENotifyFilterType::NoFiltering',
    NotifyFilterLOD: notify.notifyFilterLod,
    bTriggerOnDedicatedServer: notify.triggerOnDedicatedServer,
    bTriggerOnFollower: notify.triggerOnFollower,
    CameraShakeClass: notify.cameraShakeClass.value,
    CameraShakeScale: notify.cameraShakeScale.value,
  })),
)

/**
 * The one `APlayerController::PlayerCameraManager` operation used by
 * `UAlsAnimNotify_CameraShake::Notify()`.
 */
export interface AlsPlayerCameraManager {
  StartCameraShake(
    CameraShakeClass: string | null,
    CameraShakeScale: number,
  ): void
}

/** Exact side-effect seam of `UAlsAnimNotify_CameraShake::Notify()`. */
export function notifyAlsAnimNotifyCameraShake(
  CameraManager: AlsPlayerCameraManager | null | undefined,
  Notify: Readonly<AlsAnimNotifyCameraShakePayload>,
): void {
  if (CameraManager) {
    CameraManager.StartCameraShake(
      Notify.CameraShakeClass,
      Notify.CameraShakeScale,
    )
  }
}

/** Exact display-name prefix from `GetNotifyName_Implementation()`. */
export function getAlsAnimNotifyCameraShakeName(
  CameraShakeClass: string | null | undefined,
): string {
  return `Als Camera Shake: ${CameraShakeClass ?? ''}`
}
