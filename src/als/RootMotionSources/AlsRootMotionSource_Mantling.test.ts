/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  compileAuthoredRootMotion,
} from '../../engine/rootMotion'
import type {
  CompiledAuthoredRootMotion,
} from '../../engine/rootMotion'
import { sampleRichCurve } from '../../engine/richCurve'
import {
  ALS_MANTLING_SETTINGS,
} from '../Settings/AlsMantlingSettings'
import type {
  AlsMantlingSettings,
} from '../Settings/AlsMantlingSettings'
import {
  ALS_FULL_ANIMATION_WEIGHT,
  calculateMantlingStartTime,
  convertAlsMantlingTrackPositionToSequencePosition,
  createAlsMantlingRootMotionResult,
  createAlsRootMotionSource_Mantling,
  getAlsMantlingSegmentEndPosition,
  isFullAlsAnimationWeight,
  matchesAlsRootMotionSource_Mantling,
  prepareAlsRootMotionSource_Mantling,
  resolveAlsMantlingTargetTransform,
} from './AlsRootMotionSource_Mantling'

interface RawRootTrack {
  readonly times: readonly number[]
  readonly translations: readonly (readonly number[])[]
}

interface RawExtras {
  readonly rawRootTrack: RawRootTrack
}

let animations: THREE.AnimationClip[]

function loadAlsAnimations() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new Promise<THREE.AnimationClip[]>((resolve, reject) => {
    new GLTFLoader().parse(
      data,
      '',
      (gltf) => resolve(gltf.animations),
      reject,
    )
  })
}

function clip(name: string) {
  const animation = animations.find(
    (candidate) => candidate.name === name,
  )
  if (!animation) throw new Error(`Missing ALS clip ${name}`)
  return animation
}

function compiled(name: string): CompiledAuthoredRootMotion {
  const rootMotion = compileAuthoredRootMotion(clip(name))
  if (!rootMotion) throw new Error(`${name} has no raw root track`)
  return rootMotion
}

function sampleRawAlsLocation(
  animation: THREE.AnimationClip,
  time: number,
) {
  const raw = (animation.userData as unknown as RawExtras).rawRootTrack
  let low = 0
  let high = raw.times.length - 1
  if (time <= raw.times[0]) high = 0
  else if (time >= raw.times[high]) low = high
  else {
    while (high - low > 1) {
      const middle = (low + high) >>> 1
      if (raw.times[middle] <= time) low = middle
      else high = middle
    }
  }
  const amount = low === high
    ? 0
    : (time - raw.times[low]) / (raw.times[high] - raw.times[low])
  const from = raw.translations[low]
  const to = raw.translations[high]
  const three = from.map(
    (value, component) => value + (to[component] - value) * amount,
  )
  return {
    x: three[0],
    y: three[2],
    z: three[1],
  }
}

function createSource(
  settings: AlsMantlingSettings,
  rootMotion: CompiledAuthoredRootMotion,
  MantlingHeight: number,
  TargetPrimitive: unknown = {},
  TargetLocation = { x: 0, y: 0, z: 0 },
) {
  return createAlsRootMotionSource_Mantling({
    MantlingSettings: settings,
    AuthoredRootMotion: rootMotion,
    MantlingHeight,
    TargetPrimitive,
    bUseRelativeLocation: false,
    TargetRelativeLocation: TargetLocation,
    TargetRelativeRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
    ActorFeetLocation: {
      x: TargetLocation.x - 0.4,
      y: TargetLocation.y + 0.2,
      z: TargetLocation.z - 0.75,
    },
    ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
  })
}

function syntheticRootMotion(
  clipName: string,
  duration: number,
): CompiledAuthoredRootMotion {
  return {
    clipName,
    duration,
    bEnableRootMotion: true,
    bForceRootLock: true,
    RootMotionRootLock: 'AnimFirstFrame',
    poseReset: {
      kind: 'animationFirstFrame',
      translation: new Float32Array(3),
      rotation: new Float32Array([0, 0, 0, 1]),
    },
    times: new Float32Array([0, duration]),
    // three.js basis: UE +Z is component 1.
    translations: new Float32Array([
      0, 0, 0,
      0, duration, 0,
    ]),
    rotations: new Float32Array([
      0, 0, 0, 1,
      0, 0, 0, 1,
    ]),
  }
}

describe('FAlsRootMotionSource_Mantling', () => {
  beforeAll(async () => {
    animations = await loadAlsAnimations()
  })

  it('maps manual mantling height to the authored start-time ranges', () => {
    const high = ALS_MANTLING_SETTINGS.MS_Als_High
    const highRoot = compiled(high.Montage.Sequence)
    expect(calculateMantlingStartTime(high, 1.25, highRoot))
      .toBeCloseTo(0.6, 7)
    expect(calculateMantlingStartTime(high, 1.625, highRoot))
      .toBeCloseTo(0.3, 7)
    expect(calculateMantlingStartTime(high, 2, highRoot)).toBe(0)
    expect(calculateMantlingStartTime(high, 10, highRoot)).toBe(0)

    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const lowRoot = compiled(low.Montage.Sequence)
    expect(calculateMantlingStartTime(low, 0.5, lowRoot)).toBe(0.5)
    expect(calculateMantlingStartTime(low, 0.75, lowRoot)).toBe(0.25)
    expect(calculateMantlingStartTime(low, 1, lowRoot)).toBe(0)
  })

  it('ports the auto start-time binary search on the real High root track', () => {
    const high = ALS_MANTLING_SETTINGS.MS_Als_High
    const highRoot = compiled(high.Montage.Sequence)
    const autoSettings: AlsMantlingSettings = {
      ...high,
      bAutoCalculateStartTime: true,
    }
    const animation = clip(high.Montage.Sequence)
    const end = sampleRawAlsLocation(
      animation,
      high.Montage.PlayLength,
    )
    const atHalfSecond = sampleRawAlsLocation(animation, 0.5)
    const height = end.z - atHalfSecond.z
    const startTime = calculateMantlingStartTime(
      autoSettings,
      height,
      highRoot,
    )

    expect(startTime).toBeCloseTo(0.5, 1)
    expect(Math.abs(startTime - 0.5))
      .toBeLessThanOrEqual(1 / high.Montage.SamplingFrameRate)
  })

  it('ports UE segment rate, looping, and reverse clock conversion literally', () => {
    const base = ALS_MANTLING_SETTINGS.MS_Als_Low.Montage
    const forward = {
      ...base,
      StartPos: 2,
      AnimStartTime: 0.25,
      AnimEndTime: 1.25,
      AnimPlayRate: 2,
      SequenceRateScale: 0.5,
      LoopingCount: 2,
    }
    expect(getAlsMantlingSegmentEndPosition(forward)).toBe(4)
    expect(convertAlsMantlingTrackPositionToSequencePosition(forward, 2))
      .toBe(0.25)
    expect(convertAlsMantlingTrackPositionToSequencePosition(forward, 2.5))
      .toBe(0.75)
    expect(convertAlsMantlingTrackPositionToSequencePosition(forward, 3))
      .toBe(0.25)
    expect(convertAlsMantlingTrackPositionToSequencePosition(forward, 4))
      .toBe(1.25)

    const reverse = {
      ...forward,
      AnimPlayRate: -2,
    }
    expect(getAlsMantlingSegmentEndPosition(reverse)).toBe(4)
    expect(convertAlsMantlingTrackPositionToSequencePosition(reverse, 2))
      .toBe(1.25)
    expect(convertAlsMantlingTrackPositionToSequencePosition(reverse, 2.5))
      .toBe(0.75)
    // UE 5.5 subtracts the loop span without multiplying by rate sign.
    expect(convertAlsMantlingTrackPositionToSequencePosition(reverse, 3))
      .toBe(-0.75)
    expect(convertAlsMantlingTrackPositionToSequencePosition(reverse, 4))
      .toBe(-1.75)
  })

  it('uses ALS literal Segment.GetEndPos endpoint sampling', () => {
    const base = ALS_MANTLING_SETTINGS.MS_Als_Low
    const rootMotion = syntheticRootMotion('SyntheticMantle', 3)
    const settings: AlsMantlingSettings = {
      ...base,
      StartTimeReferenceHeight: [0, 1],
      StartTime: [0, 0],
      Montage: {
        ...base.Montage,
        Name: 'SyntheticMantleMontage',
        Sequence: rootMotion.clipName,
        PlayLength: 2.5,
        SequenceLength: rootMotion.duration,
        SequenceRateScale: 1,
        RateScale: 1,
        StartPos: 2,
        AnimStartTime: 0.25,
        AnimEndTime: 1.25,
        AnimPlayRate: 2,
        LoopingCount: 1,
      },
    }
    const source = createSource(settings, rootMotion, 0)

    expect(getAlsMantlingSegmentEndPosition(settings.Montage)).toBe(2.5)
    expect(convertAlsMantlingTrackPositionToSequencePosition(
      settings.Montage,
      2.5,
    )).toBe(1.25)
    expect(source.TargetAnimationLocation.z).toBe(2.5)
  })

  it('uses the exact FAnimWeight full-weight boundary', () => {
    expect(isFullAlsAnimationWeight(ALS_FULL_ANIMATION_WEIGHT - 1e-12))
      .toBe(false)
    expect(isFullAlsAnimationWeight(ALS_FULL_ANIMATION_WEIGHT)).toBe(true)
    expect(isFullAlsAnimationWeight(1)).toBe(true)
  })

  it('initializes ALS priority, endpoint, rate-scaled duration, and identity', () => {
    const high = ALS_MANTLING_SETTINGS.MS_Als_High
    const target = {}
    const source = createSource(
      high,
      compiled(high.Montage.Sequence),
      1.25,
      target,
    )

    expect(source.Priority).toBe(1000)
    expect(source.Time).toBe(0)
    expect(source.MontageStartTime).toBeCloseTo(0.6, 7)
    expect(source.Duration).toBeCloseTo(
      (high.Montage.PlayLength - source.MontageStartTime)
      / high.Montage.RateScale,
      8,
    )
    expect(source.TargetAnimationLocation).toEqual({
      x: 0,
      y: 0.6499999761581421,
      z: 2,
    })
    expect(source.Status).toBe('Active')

    const same = createSource(
      high,
      source.AuthoredRootMotion,
      1.25,
      target,
    )
    const otherTarget = createSource(
      high,
      source.AuthoredRootMotion,
      1.25,
      {},
    )
    expect(matchesAlsRootMotionSource_Mantling(source, same)).toBe(true)
    expect(matchesAlsRootMotionSource_Mantling(source, otherTarget)).toBe(false)
  })

  it('normalizes the stored target and actor rotation offsets like ALS', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const source = createAlsRootMotionSource_Mantling({
      MantlingSettings: low,
      AuthoredRootMotion: compiled(low.Montage.Sequence),
      MantlingHeight: 0.75,
      TargetPrimitive: {},
      bUseRelativeLocation: false,
      TargetRelativeLocation: { x: 0, y: 0, z: 0 },
      TargetRelativeRotation: { Pitch: 0, Yaw: -390, Roll: 720 },
      ActorFeetLocation: { x: 0, y: 0, z: 0 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(source.TargetRelativeRotation).toEqual({
      Pitch: 0,
      Yaw: -30,
      Roll: 0,
    })
    expect(source.ActorRotationOffset.Pitch).toBe(0)
    expect(source.ActorRotationOffset.Yaw).toBeCloseTo(30, 12)
    expect(source.ActorRotationOffset.Roll).toBeCloseTo(0, 12)
  })

  it('reconstructs ALS inverse-relative moving-target transforms in UE axes', () => {
    const result = resolveAlsMantlingTargetTransform({
      bUseRelativeLocation: true,
      TargetPrimitiveTransform: {
        Location: { x: 10, y: 20, z: 30 },
        Rotation: {
          x: 0,
          y: 0,
          z: Math.sin(Math.PI / 4),
          w: Math.cos(Math.PI / 4),
        },
        Scale3D: { x: 2, y: 2, z: 2 },
      },
      TargetRelativeLocation: { x: -1, y: 0, z: 0 },
      TargetRelativeRotation: { Pitch: 0, Yaw: 30, Roll: 0 },
    })

    expect(result.Rotation.x).toBeCloseTo(0, 12)
    expect(result.Rotation.y).toBeCloseTo(0, 12)
    expect(result.Rotation.z).toBeCloseTo(Math.sin(Math.PI / 6), 12)
    expect(result.Rotation.w).toBeCloseTo(Math.cos(Math.PI / 6), 12)
    expect(result.Location.x).toBeCloseTo(10.5, 12)
    expect(result.Location.y).toBeCloseTo(20 + Math.sqrt(3) / 2, 12)
    expect(result.Location.z).toBeCloseTo(30, 12)
  })

  it('uses one authoritative clock for montage position, root sampling, and correction curves', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const animation = clip(low.Montage.Sequence)
    const target = { x: 2, y: 3, z: 1 }
    const source = createSource(
      low,
      compiled(low.Montage.Sequence),
      0.75,
      {},
      target,
    )
    const output = createAlsMantlingRootMotionResult()
    const actorFeet = { x: 1.6, y: 3.2, z: 0.25 }
    const result = prepareAlsRootMotionSource_Mantling(
      source,
      {
        SimulationDeltaTime: 0.1,
        DeltaTime: 0.1,
        TargetPrimitiveValid: true,
        bUseRelativeLocation: false,
        ActorFeetLocation: actorFeet,
        ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      output,
    )

    expect(result).toBe(output)
    expect(result.Clock.RootMotionTime).toBeCloseTo(0.1, 12)
    expect(result.Clock.MontageTime).toBeCloseTo(0.35, 12)
    expect(result.Clock.MontagePosition).toBeCloseTo(0.25, 12)
    const currentRoot = sampleRawAlsLocation(
      animation,
      result.Clock.MontageTime,
    )
    const interpolation = (
      currentRoot.z / source.TargetAnimationLocation.z
    )
    const horizontal = sampleRichCurve(
      low.HorizontalCorrectionCurve.Keys,
      result.Clock.MontageTime,
    )
    const vertical = sampleRichCurve(
      low.VerticalCorrectionCurve.Keys,
      result.Clock.MontageTime,
    )
    expect(result.InterpolationAmount).toBeCloseTo(interpolation, 7)
    expect(result.HorizontalCorrectionAmount).toBeCloseTo(horizontal, 7)
    expect(result.VerticalCorrectionAmount).toBeCloseTo(vertical, 7)
    expect(result.BlendInAmount).toBeCloseTo(0.5, 7)

    const targetAnimationOffset = {
      x: -source.TargetAnimationLocation.y,
      y: 0,
      z: -source.TargetAnimationLocation.z,
    }
    const corrected = {
      x: (
        source.ActorFeetLocationOffset.x
        + (
          targetAnimationOffset.x - source.ActorFeetLocationOffset.x
        ) * horizontal
      ),
      y: (
        source.ActorFeetLocationOffset.y
        + (
          targetAnimationOffset.y - source.ActorFeetLocationOffset.y
        ) * horizontal
      ),
      z: (
        source.ActorFeetLocationOffset.z
        + (
          targetAnimationOffset.z - source.ActorFeetLocationOffset.z
        ) * vertical
      ),
    }
    const expectedOffset = {
      x: source.ActorFeetLocationOffset.x + (
        corrected.x * (1 - interpolation)
        - source.ActorFeetLocationOffset.x
      ) * result.BlendInAmount,
      y: source.ActorFeetLocationOffset.y + (
        corrected.y * (1 - interpolation)
        - source.ActorFeetLocationOffset.y
      ) * result.BlendInAmount,
      z: source.ActorFeetLocationOffset.z + (
        corrected.z * (1 - interpolation)
        - source.ActorFeetLocationOffset.z
      ) * result.BlendInAmount,
    }
    expect(result.TargetTransform.Location.x)
      .toBeCloseTo(target.x + expectedOffset.x, 7)
    expect(result.TargetTransform.Location.y)
      .toBeCloseTo(target.y + expectedOffset.y, 7)
    expect(result.TargetTransform.Location.z)
      .toBeCloseTo(target.z + expectedOffset.z, 7)
    expect(result.TranslationVelocity.x).toBeCloseTo(
      (result.TargetTransform.Location.x - actorFeet.x) / 0.1,
      7,
    )
    expect(result.RotationVelocity.x)
      .toBeCloseTo(result.RotationDelta.x / 0.1, 12)
    expect(result.RotationVelocity.y)
      .toBeCloseTo(result.RotationDelta.y / 0.1, 12)
    expect(result.RotationVelocity.z)
      .toBeCloseTo(result.RotationDelta.z / 0.1, 12)
    expect(result.RotationVelocity.w)
      .toBeCloseTo(result.RotationDelta.w / 0.1, 12)
    expect(result.valid).toBe(true)
    expect(result.finished).toBe(false)
  })

  it('advances the High montage clock by its authored RateScale', () => {
    const high = ALS_MANTLING_SETTINGS.MS_Als_High
    const animation = clip(high.Montage.Sequence)
    const source = createSource(
      high,
      compiled(high.Montage.Sequence),
      1.25,
    )
    const result = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: 0.1,
      DeltaTime: 0.1,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0, y: 0, z: 0 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    const expectedMontageTime = (
      source.MontageStartTime
      + source.Time * high.Montage.RateScale
    )

    expect(result.Clock.RootMotionTime).toBeCloseTo(0.1, 12)
    expect(result.Clock.MontageTime)
      .toBeCloseTo(expectedMontageTime, 12)
    expect(result.Clock.MontagePosition)
      .toBeCloseTo(expectedMontageTime - 0.1, 12)
    expect(result.InterpolationAmount).toBeCloseTo(
      sampleRawAlsLocation(animation, expectedMontageTime).z
      / source.TargetAnimationLocation.z,
      7,
    )
  })

  it('uses the authored HermiteCubic montage blend-in option', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const source = createSource(
      low,
      compiled(low.Montage.Sequence),
      0.75,
    )
    const result = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: 0.05,
      DeltaTime: 0.05,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: -0.4, y: 0.2, z: -0.75 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(result.BlendInAmount).toBeCloseTo(0.15625, 7)
  })

  it('follows a moving target and finishes exactly at the final target transform', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const targetPrimitive = {}
    const source = createAlsRootMotionSource_Mantling({
      MantlingSettings: low,
      AuthoredRootMotion: compiled(low.Montage.Sequence),
      MantlingHeight: 0.75,
      TargetPrimitive: targetPrimitive,
      bUseRelativeLocation: true,
      TargetPrimitiveTransform: {
        Location: { x: 1, y: 3, z: 1 },
        Rotation: { x: 0, y: 0, z: 0, w: 1 },
        Scale3D: { x: 1, y: 1, z: 1 },
      },
      // This is Primitive.GetRelativeTransform(Target), not target-local.
      TargetRelativeLocation: { x: -1, y: 0, z: 0 },
      TargetRelativeRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
      ActorFeetLocation: { x: 1.6, y: 3.2, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    const first = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: 0.1,
      DeltaTime: 0.1,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: true,
      TargetPrimitiveTransform: {
        Location: { x: 1, y: 3, z: 1 },
        Rotation: { x: 0, y: 0, z: 0, w: 1 },
        Scale3D: { x: 1, y: 1, z: 1 },
      },
      ActorFeetLocation: { x: 1.6, y: 3.2, z: 0.25 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    const moved = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: 0.1,
      DeltaTime: 0.1,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: true,
      TargetPrimitiveTransform: {
        Location: { x: 2, y: 3, z: 1 },
        Rotation: { x: 0, y: 0, z: 0, w: 1 },
        Scale3D: { x: 1, y: 1, z: 1 },
      },
      ActorFeetLocation: first.TargetTransform.Location,
      ActorRotation: first.TargetTransform.Rotation,
    })
    expect(moved.TargetTransform.Location.x)
      .toBeGreaterThan(first.TargetTransform.Location.x)

    const remaining = source.Duration - source.Time
    const finalTarget = { x: 4, y: -2, z: 1.5 }
    const completed = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: remaining,
      DeltaTime: 1 / 60,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: true,
      TargetPrimitiveTransform: {
        Location: { x: finalTarget.x - 1, y: -2, z: 1.5 },
        Rotation: { x: 0, y: 0, z: 0, w: 1 },
        Scale3D: { x: 2, y: 2, z: 2 },
      },
      ActorFeetLocation: moved.TargetTransform.Location,
      ActorRotation: moved.TargetTransform.Rotation,
    })

    expect(completed.Clock.MontageTime)
      .toBeCloseTo(low.Montage.PlayLength, 7)
    expect(completed.TargetTransform.Location).toEqual(finalTarget)
    expect(completed.TargetTransform.Rotation.x).toBeCloseTo(0, 12)
    expect(completed.TargetTransform.Rotation.y).toBeCloseTo(0, 12)
    expect(completed.TargetTransform.Rotation.z).toBeCloseTo(0, 12)
    expect(completed.TargetTransform.Rotation.w).toBeCloseTo(1, 12)
    expect(source.Status).toBe('Finished')
    expect(completed.finished).toBe(true)
    expect(completed.valid).toBe(true)
  })

  it('returns identity montage root sampling after a source-level overshoot', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const source = createSource(
      low,
      compiled(low.Montage.Sequence),
      0.75,
    )
    const result = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: source.Duration + 0.1,
      DeltaTime: 1 / 60,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: -0.4, y: 0.2, z: -0.75 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(result.Clock.MontageTime).toBeGreaterThan(low.Montage.PlayLength)
    expect(result.InterpolationAmount).toBe(0)
    expect(result.valid).toBe(true)
    expect(result.finished).toBe(false)
    expect(source.Status).toBe('Active')
  })

  it('removes pitch/roll from the target and applies normalized yaw offset', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const source = createAlsRootMotionSource_Mantling({
      MantlingSettings: low,
      AuthoredRootMotion: compiled(low.Montage.Sequence),
      MantlingHeight: 0.75,
      TargetPrimitive: {},
      bUseRelativeLocation: false,
      TargetRelativeLocation: { x: 0, y: 0, z: 0 },
      TargetRelativeRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
      ActorFeetLocation: { x: 0, y: 0, z: 0 },
      ActorRotation: {
        x: 0,
        y: 0,
        z: Math.sin(15 * Math.PI / 180),
        w: Math.cos(15 * Math.PI / 180),
      },
    })
    const half = Math.PI / 4
    const result = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: 0,
      DeltaTime: 1 / 60,
      TargetPrimitiveValid: true,
      bUseRelativeLocation: true,
      TargetPrimitiveTransform: {
        Location: { x: 0, y: 0, z: 0 },
        // Relative identity reconstructs the primitive rotation.
        Rotation: {
          x: -Math.sin(half),
          y: 0,
          z: 0,
          w: Math.cos(half),
        },
        Scale3D: { x: 1, y: 1, z: 1 },
      },
      ActorFeetLocation: { x: 0, y: 0, z: 0 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(result.TargetTransform.Rotation.x).toBeCloseTo(0, 7)
    expect(result.TargetTransform.Rotation.y).toBeCloseTo(0, 7)
    expect(result.TargetTransform.Rotation.z)
      .toBeCloseTo(Math.sin(15 * Math.PI / 180), 7)
    expect(result.TargetTransform.Rotation.w)
      .toBeCloseTo(Math.cos(15 * Math.PI / 180), 7)
  })

  it('advances the root clock but clears motion for invalid targets or tiny frame deltas', () => {
    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    const source = createSource(
      low,
      compiled(low.Montage.Sequence),
      0.75,
    )
    const result = prepareAlsRootMotionSource_Mantling(source, {
      SimulationDeltaTime: 0.1,
      DeltaTime: 0,
      TargetPrimitiveValid: false,
      bUseRelativeLocation: false,
      ActorFeetLocation: { x: 0, y: 0, z: 0 },
      ActorRotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    expect(source.Time).toBeCloseTo(0.1, 12)
    expect(result.Clock.RootMotionTime).toBeCloseTo(0.1, 12)
    expect(result.valid).toBe(false)
    expect(result.TranslationVelocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.RotationDelta).toEqual({ x: 0, y: 0, z: 0, w: 1 })
  })
})
