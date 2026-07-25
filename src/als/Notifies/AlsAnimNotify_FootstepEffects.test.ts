import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import {
  ALS_MESH_COMPONENT_YAW_RADIANS,
} from '../../engine/unrealCoordinateSpace'
import type {
  AlsAnimNotifyFootstepEffectsInput,
  AlsAnimNotifyFootstepEffectsPayload,
  AlsFootstepEffectsTraceHit,
  AlsFootstepEffectsTraceRequest,
  AlsFootstepSoundRequest,
} from './AlsAnimNotify_FootstepEffects'
import {
  ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_DEFAULTS,
  ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS,
  ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS,
  ALS_FOOTSTEP_SOUND_ASSET_PATH,
  ALS_FOOTSTEP_SOUND_SPAWN_MODE,
  getAlsAnimNotifyFootstepEffectsName,
  notifyAlsAnimNotifyFootstepEffects,
} from './AlsAnimNotify_FootstepEffects'

const DEFAULT_HIT: AlsFootstepEffectsTraceHit = {
  ImpactPoint: { x: 4, y: 0, z: -2 },
  ImpactNormal: { x: 0, y: 1, z: 0 },
  PhysicalSurface: 'SurfaceType_Default',
}

function payload(
  overrides: Partial<AlsAnimNotifyFootstepEffectsPayload> = {},
): AlsAnimNotifyFootstepEffectsPayload {
  return {
    ...ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_DEFAULTS,
    ...overrides,
  }
}

function input(
  Trace: AlsAnimNotifyFootstepEffectsInput['Trace'],
  PlayFootstepSound: (
    request: Readonly<AlsFootstepSoundRequest>,
  ) => void,
  overrides: Partial<AlsAnimNotifyFootstepEffectsInput> = {},
): AlsAnimNotifyFootstepEffectsInput {
  return {
    LocomotionMode: 'Grounded',
    FootWorldTransform: {
      Location: { x: 1, y: 2, z: 3 },
      Rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    MeshScaleZ: 1,
    FootstepSoundBlock: 0,
    Trace,
    SoundSink: { PlayFootstepSound },
    ...overrides,
  }
}

// ALS Refactored 4.15:
// Source/ALS/{Public,Private}/Notifies/AlsAnimNotify_FootstepEffects.*
describe('UAlsAnimNotify_FootstepEffects', () => {
  it('freezes the C++ defaults and FES_Als_Default sound route', () => {
    expect(ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_DEFAULTS).toEqual({
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
    expect(ALS_FOOTSTEP_EFFECTS_SETTINGS_DEFAULTS).toEqual({
      SurfaceTraceChannel: 'Visibility',
      SurfaceTraceDistanceCentimetres: 50,
      FootLeftYAxis: { x: 0, y: 0, z: 1 },
      FootLeftZAxis: { x: 1, y: 0, z: 0 },
      FootRightYAxis: { x: 0, y: 0, z: 1 },
      FootRightZAxis: { x: -1, y: 0, z: 0 },
    })
    expect(ALS_FOOTSTEP_SOUND_ASSET_PATH)
      .toBe(
        '/ALS/ALS/Audio/Footsteps/'
        + 'MS_Als_Footstep.MS_Als_Footstep',
      )
    expect(ALS_FOOTSTEP_SOUND_SPAWN_MODE)
      .toBe('SpawnAtTraceHitLocation')
  })

  it('freezes all 154 authored events, including intentional silence', () => {
    expect(ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS).toHaveLength(154)
    expect(new Set(
      ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS.map(
        (event) => event.Sequence,
      ),
    ).size).toBe(65)
    expect(
      ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS.filter(
        (event) => !event.bSpawnSound,
      ),
    ).toHaveLength(25)
    expect(
      ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS.filter(
        (event) => event.bSkipEffectsWhenInAir,
      ),
    ).toHaveLength(3)

    expect(
      ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS.find(
        (event) => event.Sequence === 'A_Als_Sprint'
          && event.EventIndex === 0,
      ),
    ).toMatchObject({
      Time: expect.closeTo(0.06666667, 7),
      NotifyName: 'BMAnimNotifyFootstep',
      FootBone: 'Left',
      bSpawnSound: true,
      SoundVolumeMultiplier: 1.5,
      SoundPitchMultiplier: 1.2,
      SoundType: 'WalkRun',
      bIgnoreFootstepSoundBlockCurve: false,
      bSkipEffectsWhenInAir: false,
      TriggerWeightThreshold: expect.closeTo(0.3, 7),
      MontageTickType: 'Queued',
      NotifyTriggerChance: 1,
      NotifyFilterType: 'NoFiltering',
      NotifyFilterLOD: 0,
      bTriggerOnDedicatedServer: false,
      bTriggerOnFollower: false,
    })
    expect(
      ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS.find(
        (event) => event.Sequence === 'A_Als_Land_Light'
          && event.EventIndex === 1,
      ),
    ).toMatchObject({
      Time: expect.closeTo(0.1, 7),
      FootBone: 'Right',
      bSpawnSound: false,
      SoundType: 'Land',
      bIgnoreFootstepSoundBlockCurve: true,
      TriggerWeightThreshold: expect.closeTo(1e-5, 10),
    })
  })

  it('traces the transformed authored foot Z axis at scaled distance', () => {
    const traces: Readonly<AlsFootstepEffectsTraceRequest>[] = []
    const sounds: Readonly<AlsFootstepSoundRequest>[] = []
    const sine = Math.sin(Math.PI / 4)
    const cosine = Math.cos(Math.PI / 4)

    const request = notifyAlsAnimNotifyFootstepEffects(
      payload({
        SoundType: 'WalkRun',
        SoundPitchMultiplier: 1.2,
      }),
      input(
        (trace) => {
          traces.push(trace)
          return DEFAULT_HIT
        },
        (sound) => sounds.push(sound),
        {
          MeshScaleZ: 2,
          FootWorldTransform: {
            Location: { x: 1, y: 2, z: 3 },
            Rotation: {
              x: 0,
              y: sine,
              z: 0,
              w: cosine,
            },
          },
        },
      ),
    )

    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      Start: { x: 1, y: 2, z: 3 },
      TraceChannel: 'Visibility',
      bIgnoreOwningActor: true,
    })
    expect(traces[0]?.End.x).toBeCloseTo(1, 12)
    expect(traces[0]?.End.y).toBeCloseTo(2, 12)
    // Three +90° about Y maps local +X to world -Z. The trace subtracts it.
    expect(traces[0]?.End.z).toBeCloseTo(4, 12)
    expect(request).toEqual({
      SoundType: 'WalkRun',
      SpawnMode: 'SpawnAtTraceHitLocation',
      FootBone: 'Left',
      Location: { x: 4, y: 0, z: -2 },
      VolumeMultiplier: 1,
      PitchMultiplier: 1.2,
    })
    expect(sounds).toEqual([request])
  })

  it('proves the shipped SK_Als foot axes point down after the authored mesh mount', async () => {
    const bytes = readFileSync(
      new URL('../../../public/assets/skm-als.glb', import.meta.url),
    )
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    const gltf = await new GLTFLoader().parseAsync(data, '')
    const mount = new THREE.Group()
    mount.rotation.y = ALS_MESH_COMPONENT_YAW_RADIANS
    mount.add(gltf.scene)
    mount.updateMatrixWorld(true)

    for (const [boneName, localAxis, expected] of [
      [
        'foot_l',
        new THREE.Vector3(1, 0, 0),
        [0.0127942472, 0.9998082259, 0.0148262860],
      ],
      [
        'foot_r',
        new THREE.Vector3(-1, 0, 0),
        [0.0127942791, 0.9998082303, -0.0148259596],
      ],
    ] as const) {
      const bone = gltf.scene.getObjectByName(boneName)
      if (!(bone instanceof THREE.Bone)) {
        throw new Error(`Missing ${boneName} in SK_Als`)
      }
      const axis = localAxis.applyQuaternion(
        bone.getWorldQuaternion(new THREE.Quaternion()),
      )
      expect(axis.x).toBeCloseTo(expected[0], 8)
      expect(axis.y).toBeCloseTo(expected[1], 8)
      expect(axis.z).toBeCloseTo(expected[2], 8)
    }
  })

  it('uses the mirrored right-foot axis, then world down as fallback', () => {
    const traces: Readonly<AlsFootstepEffectsTraceRequest>[] = []
    const PlayFootstepSound = vi.fn()
    notifyAlsAnimNotifyFootstepEffects(
      payload({ FootBone: 'Right' }),
      input(
        (trace) => {
          traces.push(trace)
          return traces.length === 1 ? null : DEFAULT_HIT
        },
        PlayFootstepSound,
      ),
    )

    expect(traces).toEqual([
      {
        Start: { x: 1, y: 2, z: 3 },
        End: { x: 1.5, y: 2, z: 3 },
        TraceChannel: 'Visibility',
        bIgnoreOwningActor: true,
      },
      {
        Start: { x: 1, y: 2, z: 3 },
        End: { x: 1, y: 1.5, z: 3 },
        TraceChannel: 'Visibility',
        bIgnoreOwningActor: true,
      },
    ])
    expect(PlayFootstepSound).toHaveBeenCalledTimes(1)
  })

  it('requires a blocking surface hit, including for attached sounds', () => {
    const PlayFootstepSound = vi.fn()
    const Trace = vi.fn<
      AlsAnimNotifyFootstepEffectsInput['Trace']
    >(() => null)

    expect(notifyAlsAnimNotifyFootstepEffects(
      payload(),
      input(Trace, PlayFootstepSound, {
        SoundSpawnMode: 'SpawnAttachedToFootBone',
      }),
    )).toBeNull()
    expect(Trace).toHaveBeenCalledTimes(2)
    expect(PlayFootstepSound).not.toHaveBeenCalled()

    Trace.mockReturnValue(DEFAULT_HIT)
    const request = notifyAlsAnimNotifyFootstepEffects(
      payload({ FootBone: 'Right' }),
      input(Trace, PlayFootstepSound, {
        SoundSpawnMode: 'SpawnAttachedToFootBone',
      }),
    )
    expect(request).toMatchObject({
      SpawnMode: 'SpawnAttachedToFootBone',
      FootBone: 'Right',
      Location: { x: 1, y: 2, z: 3 },
    })
  })

  it('applies FootstepSoundBlock while leaving authored pitch unchanged', () => {
    const PlayFootstepSound = vi.fn()
    const notify = payload({
      SoundVolumeMultiplier: 0.5,
      SoundPitchMultiplier: 0.8,
    })

    const request = notifyAlsAnimNotifyFootstepEffects(
      notify,
      input(() => DEFAULT_HIT, PlayFootstepSound, {
        FootstepSoundBlock: 0.25,
      }),
    )
    expect(request).toMatchObject({
      VolumeMultiplier: 0.375,
      PitchMultiplier: 0.8,
    })

    const ignored = notifyAlsAnimNotifyFootstepEffects(
      {
        ...notify,
        bIgnoreFootstepSoundBlockCurve: true,
      },
      input(() => DEFAULT_HIT, PlayFootstepSound, {
        FootstepSoundBlock: 1,
      }),
    )
    expect(ignored).toMatchObject({
      VolumeMultiplier: 0.5,
      PitchMultiplier: 0.8,
    })
  })

  it('uses FAnimWeight relevance after clamping the block curve', () => {
    const PlayFootstepSound = vi.fn()

    expect(notifyAlsAnimNotifyFootstepEffects(
      payload(),
      input(() => DEFAULT_HIT, PlayFootstepSound, {
        FootstepSoundBlock: 2,
      }),
    )).toBeNull()
    expect(notifyAlsAnimNotifyFootstepEffects(
      payload({
        SoundVolumeMultiplier: 1e-5,
        bIgnoreFootstepSoundBlockCurve: true,
      }),
      input(() => DEFAULT_HIT, PlayFootstepSound),
    )).toBeNull()
    expect(PlayFootstepSound).not.toHaveBeenCalled()

    expect(notifyAlsAnimNotifyFootstepEffects(
      payload({
        SoundVolumeMultiplier: 1e-5 + Number.EPSILON,
        bIgnoreFootstepSoundBlockCurve: true,
      }),
      input(() => DEFAULT_HIT, PlayFootstepSound),
    )).not.toBeNull()
    expect(PlayFootstepSound).toHaveBeenCalledTimes(1)
  })

  it('ports the in-air and bSpawnSound gates in C++ order', () => {
    const PlayFootstepSound = vi.fn()
    const Trace = vi.fn(() => DEFAULT_HIT)

    expect(notifyAlsAnimNotifyFootstepEffects(
      payload({ bSkipEffectsWhenInAir: true }),
      input(Trace, PlayFootstepSound, {
        LocomotionMode: 'InAir',
      }),
    )).toBeNull()
    expect(Trace).not.toHaveBeenCalled()

    expect(notifyAlsAnimNotifyFootstepEffects(
      payload({
        bSkipEffectsWhenInAir: false,
        bSpawnSound: false,
      }),
      input(Trace, PlayFootstepSound, {
        LocomotionMode: 'InAir',
      }),
    )).toBeNull()
    // The shared effects hit is resolved before the SpawnSound branch.
    expect(Trace).toHaveBeenCalledTimes(1)
    expect(PlayFootstepSound).not.toHaveBeenCalled()

    expect(notifyAlsAnimNotifyFootstepEffects(
      payload({ bSkipEffectsWhenInAir: true }),
      input(Trace, PlayFootstepSound, {
        // C++ only applies the gate when Mesh->GetOwner() is an AAlsCharacter.
        LocomotionMode: null,
      }),
    )).not.toBeNull()
    expect(Trace).toHaveBeenCalledTimes(2)
    expect(PlayFootstepSound).toHaveBeenCalledTimes(1)
  })

  it('matches the C++ display name', () => {
    expect(getAlsAnimNotifyFootstepEffectsName('Left'))
      .toBe('Als Footstep Effects: Left')
    expect(getAlsAnimNotifyFootstepEffectsName('Right'))
      .toBe('Als Footstep Effects: Right')
  })
})
