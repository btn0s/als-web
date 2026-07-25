import footstepAudioJson from '../../../scripts/extract-als/footstep-audio.json?raw'
import type {
  AlsLocomotionMode,
} from '../AlsCharacter'
import type {
  AlsVector3,
} from '../State/AlsLocomotionState'

export type EAlsFootBone = 'Left' | 'Right'

export type EAlsFootstepSoundType =
  | 'Step'
  | 'WalkRun'
  | 'Land'

export type EAlsFootstepSoundSpawnMode =
  | 'SpawnAtTraceHitLocation'
  | 'SpawnAttachedToFootBone'

interface ExtractedFootstepAudioOracle {
  readonly schemaVersion: 1
  readonly footstepEffectsSettings: {
    readonly effects: readonly {
      readonly Key: string
      readonly Value: {
        readonly Sound: {
          readonly Sound: {
            readonly AssetPathName: string
          }
          readonly SpawnMode: string
        }
      }
    }[]
  }
  readonly notifies: readonly {
    readonly clip: string
    readonly time: number
    readonly notifyName: string
    readonly eventIndex: number
    readonly footBone: string
    readonly bSpawnSound: boolean
    readonly volume: number
    readonly pitch: number
    readonly soundType: string
    readonly bIgnoreFootstepSoundBlockCurve: boolean
    readonly bSkipEffectsWhenInAir: boolean
    readonly triggerWeightThreshold: number
    readonly montageTickType: string
    readonly notifyTriggerChance: number
    readonly notifyFilterType: string
    readonly notifyFilterLod: number
    readonly triggerOnDedicatedServer: boolean
    readonly triggerOnFollower: boolean
  }[]
}

const ORACLE = (
  JSON.parse(footstepAudioJson) as ExtractedFootstepAudioOracle
)

function footBoneFromOracle(value: string): EAlsFootBone {
  if (value === 'EAlsFootBone::Left') return 'Left'
  if (value === 'EAlsFootBone::Right') return 'Right'
  throw new Error(`Unsupported ALS foot bone "${value}"`)
}

function footstepSoundTypeFromOracle(
  value: string,
): EAlsFootstepSoundType {
  if (value === 'EAlsFootstepSoundType::Step') return 'Step'
  if (value === 'EAlsFootstepSoundType::WalkRun') return 'WalkRun'
  if (value === 'EAlsFootstepSoundType::Land') return 'Land'
  throw new Error(`Unsupported ALS footstep sound type "${value}"`)
}

function footstepSoundSpawnModeFromOracle(
  value: string,
): EAlsFootstepSoundSpawnMode {
  if (
    value
    === 'EAlsFootstepSoundSpawnMode::SpawnAtTraceHitLocation'
  ) return 'SpawnAtTraceHitLocation'
  if (
    value
    === 'EAlsFootstepSoundSpawnMode::SpawnAttachedToFootBone'
  ) return 'SpawnAttachedToFootBone'
  throw new Error(`Unsupported ALS footstep sound spawn mode "${value}"`)
}

function montageTickTypeFromOracle(
  value: string,
): 'Queued' {
  if (value === 'EMontageNotifyTickType::Queued') return 'Queued'
  throw new Error(`Unsupported ALS montage notify tick type "${value}"`)
}

function notifyFilterTypeFromOracle(
  value: string,
): 'NoFiltering' {
  if (value === 'ENotifyFilterType::NoFiltering') {
    return 'NoFiltering'
  }
  throw new Error(`Unsupported ALS notify filter type "${value}"`)
}

function notifyTriggerChanceFromOracle(value: number): 1 {
  if (value === 1) return 1
  throw new Error(`Unsupported ALS notify trigger chance "${value}"`)
}

function notifyFilterLodFromOracle(value: number): 0 {
  if (value === 0) return 0
  throw new Error(`Unsupported ALS notify filter LOD "${value}"`)
}

function disabledNotifyFlagFromOracle(
  value: boolean,
  field: string,
): false {
  if (!value) return false
  throw new Error(`Unsupported enabled ALS ${field}`)
}

if (ORACLE.schemaVersion !== 1) {
  throw new Error('Unsupported ALS footstep audio oracle schema')
}

const DEFAULT_EFFECT = ORACLE.footstepEffectsSettings.effects[0]

if (!DEFAULT_EFFECT) {
  throw new Error('FES_Als_Default has no physical-surface effect')
}

export const ALS_FOOTSTEP_SOUND_ASSET_PATH =
  DEFAULT_EFFECT.Value.Sound.Sound.AssetPathName

export const ALS_FOOTSTEP_SOUND_SPAWN_MODE =
  footstepSoundSpawnModeFromOracle(
    DEFAULT_EFFECT.Value.Sound.SpawnMode,
  )

export interface AlsAnimNotifyFootstepEffectsPayload {
  readonly FootBone: EAlsFootBone
  readonly bSkipEffectsWhenInAir: boolean
  readonly bSpawnSound: boolean
  readonly SoundVolumeMultiplier: number
  readonly SoundPitchMultiplier: number
  readonly SoundType: EAlsFootstepSoundType
  readonly bIgnoreFootstepSoundBlockCurve: boolean
}

export interface AlsAnimNotifyFootstepEffectsDefaults
extends AlsAnimNotifyFootstepEffectsPayload {
  readonly bSpawnDecal: boolean
  readonly bSpawnParticleSystem: boolean
}

export interface AlsAnimNotifyFootstepEffectsEvent
extends AlsAnimNotifyFootstepEffectsPayload {
  readonly Sequence: string
  readonly Time: number
  readonly NotifyName: string
  readonly EventIndex: number
  readonly TriggerWeightThreshold: number
  readonly MontageTickType: 'Queued'
  readonly NotifyTriggerChance: 1
  readonly NotifyFilterType: 'NoFiltering'
  readonly NotifyFilterLOD: 0
  readonly bTriggerOnDedicatedServer: false
  readonly bTriggerOnFollower: false
}

/**
 * Defaults declared by `UAlsAnimNotify_FootstepEffects`.
 *
 * FootstepEffectsSettings itself defaults to null in C++; every shipped event
 * assigns `FES_Als_Default`, which the extracted oracle resolves above.
 */
export const ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_DEFAULTS:
Readonly<AlsAnimNotifyFootstepEffectsDefaults> = Object.freeze({
  FootBone: 'Left',
  bSkipEffectsWhenInAir: false,
  bSpawnSound: true,
  SoundVolumeMultiplier: 1,
  SoundPitchMultiplier: 1,
  SoundType: 'Step',
  bIgnoreFootstepSoundBlockCurve: false,
  bSpawnDecal: true,
  bSpawnParticleSystem: true,
})

/**
 * Every shipped `UAlsAnimNotify_FootstepEffects` payload reachable from
 * `clips.manifest`.
 */
export const ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS:
readonly Readonly<AlsAnimNotifyFootstepEffectsEvent>[] = Object.freeze(
  ORACLE.notifies.map((notify) => Object.freeze({
    Sequence: notify.clip,
    Time: notify.time,
    NotifyName: notify.notifyName,
    EventIndex: notify.eventIndex,
    TriggerWeightThreshold: notify.triggerWeightThreshold,
    MontageTickType:
      montageTickTypeFromOracle(notify.montageTickType),
    NotifyTriggerChance:
      notifyTriggerChanceFromOracle(notify.notifyTriggerChance),
    NotifyFilterType:
      notifyFilterTypeFromOracle(notify.notifyFilterType),
    NotifyFilterLOD:
      notifyFilterLodFromOracle(notify.notifyFilterLod),
    bTriggerOnDedicatedServer:
      disabledNotifyFlagFromOracle(
        notify.triggerOnDedicatedServer,
        'bTriggerOnDedicatedServer',
      ),
    bTriggerOnFollower:
      disabledNotifyFlagFromOracle(
        notify.triggerOnFollower,
        'bTriggerOnFollower',
      ),
    FootBone: footBoneFromOracle(notify.footBone),
    bSkipEffectsWhenInAir: notify.bSkipEffectsWhenInAir,
    bSpawnSound: notify.bSpawnSound,
    SoundVolumeMultiplier: notify.volume,
    SoundPitchMultiplier: notify.pitch,
    SoundType: footstepSoundTypeFromOracle(notify.soundType),
    bIgnoreFootstepSoundBlockCurve:
      notify.bIgnoreFootstepSoundBlockCurve,
  })),
)

export interface AlsQuaternion {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

export interface AlsFootWorldTransform {
  /** Final, post-Control-Rig three.js world position in metres. */
  readonly Location: Readonly<AlsVector3>
  /** Final, post-Control-Rig three.js world rotation. */
  readonly Rotation: Readonly<AlsQuaternion>
}

export interface AlsFootstepEffectsTraceRequest {
  /** Three.js world position in metres. */
  readonly Start: Readonly<AlsVector3>
  /** Three.js world position in metres. */
  readonly End: Readonly<AlsVector3>
  readonly TraceChannel: 'Visibility'
  readonly bIgnoreOwningActor: true
}

export interface AlsFootstepEffectsTraceHit {
  /** Three.js world position in metres. */
  readonly ImpactPoint: Readonly<AlsVector3>
  /** Unit surface normal in three.js world coordinates. */
  readonly ImpactNormal: Readonly<AlsVector3>
  /**
   * Rapier has no UE physical-material table. FES_Als_Default currently
   * contains only this surface, so the bridge resolves every hit to it.
   */
  readonly PhysicalSurface: 'SurfaceType_Default'
}

export type AlsFootstepEffectsTrace = (
  request: Readonly<AlsFootstepEffectsTraceRequest>,
) => Readonly<AlsFootstepEffectsTraceHit> | null

export interface AlsFootstepSoundRequest {
  readonly SoundType: EAlsFootstepSoundType
  readonly SpawnMode: EAlsFootstepSoundSpawnMode
  readonly FootBone: EAlsFootBone
  /** Three.js world position in metres. */
  readonly Location: Readonly<AlsVector3>
  readonly VolumeMultiplier: number
  readonly PitchMultiplier: number
}

export interface AlsFootstepSoundSink {
  PlayFootstepSound(
    request: Readonly<AlsFootstepSoundRequest>,
  ): void
}

export interface AlsAnimNotifyFootstepEffectsInput {
  readonly LocomotionMode: AlsLocomotionMode
  readonly FootWorldTransform: Readonly<AlsFootWorldTransform>
  /** `USkeletalMeshComponent::GetComponentScale().Z`. */
  readonly MeshScaleZ: number
  readonly FootstepSoundBlock: number
  readonly Trace: AlsFootstepEffectsTrace
  readonly SoundSink: AlsFootstepSoundSink
  /**
   * Defaults to FES_Als_Default's extracted value. This preserves the C++
   * attached branch if a downstream surface settings asset authors it.
   */
  readonly SoundSpawnMode?: EAlsFootstepSoundSpawnMode
}

/**
 * `UAlsFootstepEffectsSettings` constructor defaults, kept in authored Unreal
 * coordinates and units.
 */
export const ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS = Object.freeze({
  SurfaceTraceChannel: 'Visibility' as const,
  SurfaceTraceDistanceCentimetres: 50,
  FootLeftYAxis: Object.freeze({ x: 0, y: 0, z: 1 }),
  FootLeftZAxis: Object.freeze({ x: 1, y: 0, z: 0 }),
  FootRightYAxis: Object.freeze({ x: 0, y: 0, z: 1 }),
  FootRightZAxis: Object.freeze({ x: -1, y: 0, z: 0 }),
})

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5
const CENTIMETRES_TO_METRES = 0.01

function rotateThreeVector(
  vector: Readonly<AlsVector3>,
  rotation: Readonly<AlsQuaternion>,
): AlsVector3 {
  // THREE.Quaternion::applyToVector3(), expanded to keep this policy
  // framework-free.
  const ix = rotation.w * vector.x
    + rotation.y * vector.z
    - rotation.z * vector.y
  const iy = rotation.w * vector.y
    + rotation.z * vector.x
    - rotation.x * vector.z
  const iz = rotation.w * vector.z
    + rotation.x * vector.y
    - rotation.y * vector.x
  const iw = -rotation.x * vector.x
    - rotation.y * vector.y
    - rotation.z * vector.z

  return {
    x: ix * rotation.w
      + iw * -rotation.x
      + iy * -rotation.z
      - iz * -rotation.y,
    y: iy * rotation.w
      + iw * -rotation.y
      + iz * -rotation.x
      - ix * -rotation.z,
    z: iz * rotation.w
      + iw * -rotation.z
      + ix * -rotation.y
      - iy * -rotation.x,
  }
}

/**
 * Converts an authored Unreal local direction through the extractor basis
 * C:(X,Y,Z)->(X,Z,Y), then through the final foot world rotation.
 */
function transformAuthoredFootDirection(
  direction: Readonly<AlsVector3>,
  rotation: Readonly<AlsQuaternion>,
): AlsVector3 {
  return rotateThreeVector({
    x: direction.x,
    y: direction.z,
    z: direction.y,
  }, rotation)
}

function traceFootstepSurface(
  notify: Readonly<AlsAnimNotifyFootstepEffectsPayload>,
  input: Readonly<AlsAnimNotifyFootstepEffectsInput>,
): Readonly<AlsFootstepEffectsTraceHit> | null {
  const location = input.FootWorldTransform.Location
  const footZAxis = transformAuthoredFootDirection(
    notify.FootBone === 'Left'
      ? ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS.FootLeftZAxis
      : ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS.FootRightZAxis,
    input.FootWorldTransform.Rotation,
  )
  const distance =
    ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS
      .SurfaceTraceDistanceCentimetres
    * CENTIMETRES_TO_METRES
    * input.MeshScaleZ
  const request = {
    Start: { x: location.x, y: location.y, z: location.z },
    End: {
      x: location.x - footZAxis.x * distance,
      y: location.y - footZAxis.y * distance,
      z: location.z - footZAxis.z * distance,
    },
    TraceChannel:
      ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS.SurfaceTraceChannel,
    bIgnoreOwningActor: true as const,
  }

  const hit = input.Trace(request)
  if (hit) return hit

  // C++ fallback: world -Z in Unreal is world -Y after C.
  return input.Trace({
    ...request,
    End: {
      x: location.x,
      y: location.y - distance,
      z: location.z,
    },
  })
}

/**
 * Sound-producing slice of `UAlsAnimNotify_FootstepEffects::Notify()` and
 * `SpawnSound()`.
 *
 * C++ traces before checking bSpawnSound because decals and particles share
 * the hit. This port intentionally retains that order even while the current
 * web runtime only consumes the sound request.
 */
export function notifyAlsAnimNotifyFootstepEffects(
  notify: Readonly<AlsAnimNotifyFootstepEffectsPayload>,
  input: Readonly<AlsAnimNotifyFootstepEffectsInput>,
): Readonly<AlsFootstepSoundRequest> | null {
  if (
    notify.bSkipEffectsWhenInAir
    && input.LocomotionMode === 'InAir'
  ) {
    return null
  }

  const hit = traceFootstepSurface(notify, input)
  if (!hit || !notify.bSpawnSound) return null

  let volumeMultiplier = notify.SoundVolumeMultiplier
  if (!notify.bIgnoreFootstepSoundBlockCurve) {
    const block = Math.min(
      1,
      Math.max(0, input.FootstepSoundBlock),
    )
    volumeMultiplier *= 1 - block
  }
  if (!(volumeMultiplier > ZERO_ANIMATION_WEIGHT_THRESHOLD)) {
    return null
  }

  const spawnMode =
    input.SoundSpawnMode ?? ALS_FOOTSTEP_SOUND_SPAWN_MODE
  const request: Readonly<AlsFootstepSoundRequest> = Object.freeze({
    SoundType: notify.SoundType,
    SpawnMode: spawnMode,
    FootBone: notify.FootBone,
    Location: Object.freeze(
      spawnMode === 'SpawnAtTraceHitLocation'
        ? {
            x: hit.ImpactPoint.x,
            y: hit.ImpactPoint.y,
            z: hit.ImpactPoint.z,
          }
        : {
            x: input.FootWorldTransform.Location.x,
            y: input.FootWorldTransform.Location.y,
            z: input.FootWorldTransform.Location.z,
          },
    ),
    VolumeMultiplier: volumeMultiplier,
    PitchMultiplier: notify.SoundPitchMultiplier,
  })

  input.SoundSink.PlayFootstepSound(request)
  return request
}

/** Exact display-name prefix from `GetNotifyName_Implementation()`. */
export function getAlsAnimNotifyFootstepEffectsName(
  FootBone: EAlsFootBone,
): string {
  return `Als Footstep Effects: ${FootBone}`
}
