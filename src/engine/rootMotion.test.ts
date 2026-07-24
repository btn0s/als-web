/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { createRigDefinition } from './rig'
import {
  accumulateRootMotion,
  accumulateRootMotionWithBlend,
  compileAuthoredRootMotion,
  createAuthoredRootMotionSample,
  createAuthoredRootMotionDelta,
  createRootMotionMovementParams,
  createRootMotionExtractor,
  extractAuthoredRootMotionDelta,
  extractRootMotionDelta,
  makeUpRootMotionToFullWeight,
  sampleAuthoredRootMotion,
} from './rootMotion'

interface RawRootTrack {
  times: number[]
  translations: number[][]
  rotations: number[][]
}

interface RawRootMotionExtras {
  bEnableRootMotion: boolean
  bForceRootLock: boolean
  RootMotionRootLock: string
  rawRootTrack: RawRootTrack
  notifies?: Array<Record<string, unknown>>
  bUseNormalizedRootMotionScale?: unknown
}

let animations: THREE.AnimationClip[]

function loadAlsAnimations() {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
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
  const animation = animations.find((candidate) => candidate.name === name)
  if (!animation) throw new Error(`Missing ALS root-motion oracle clip "${name}"`)
  return animation
}

function rawExtras(animation: THREE.AnimationClip): RawRootMotionExtras {
  const extras = animation.userData as Partial<RawRootMotionExtras>
  if (!extras.rawRootTrack) throw new Error(`${animation.name} has no rawRootTrack`)
  return extras as RawRootMotionExtras
}

function sampleRawTranslation(raw: RawRootTrack, time: number) {
  if (time <= raw.times[0]) return raw.translations[0]
  const last = raw.times.length - 1
  if (time >= raw.times[last]) return raw.translations[last]
  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (raw.times[middle] <= time) low = middle
    else high = middle
  }
  const alpha = (time - raw.times[low]) / (raw.times[high] - raw.times[low])
  return raw.translations[low].map(
    (from, component) => (
      from + (raw.translations[high][component] - from) * alpha
    ),
  )
}

describe('root motion extraction', () => {
  it('returns root-track translation delta after the first update', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const pose = resetPoseToReference(createPoseBuffer(1), rig)
    const extractor = createRootMotionExtractor(rig)

    expect(extractRootMotionDelta(extractor, pose).valid).toBe(false)
    pose.positions.set([2, 0, -1])
    const delta = extractRootMotionDelta(extractor, pose)

    expect(delta.valid).toBe(true)
    expect([...delta.translation]).toEqual([2, 0, -1])
    expect([...(delta.scale ?? [])]).toEqual([1, 1, 1])
  })

  it('VERIFIED — matches FRootMotionMovementParams component-linear shortest accumulation', () => {
    const sine = Math.SQRT1_2
    const first = createAuthoredRootMotionDelta()
    first.translation.set([2, 0, 0])
    first.rotation.set([0, sine, 0, sine])
    first.valid = true
    const sameRotationOppositeHemisphere = createAuthoredRootMotionDelta()
    sameRotationOppositeHemisphere.translation.set([0, 0, 2])
    sameRotationOppositeHemisphere.rotation.set([0, -sine, 0, -sine])
    sameRotationOppositeHemisphere.valid = true

    const rootMotion = createRootMotionMovementParams()
    accumulateRootMotionWithBlend(rootMotion, first, 0.2)
    accumulateRootMotionWithBlend(
      rootMotion,
      sameRotationOppositeHemisphere,
      0.1,
    )

    expect([...rootMotion.translation]).toEqual([
      Math.fround(0.4),
      0,
      Math.fround(0.2),
    ])
    expect(rootMotion.rotation[1]).toBeCloseTo(sine * 0.3, 7)
    expect(rootMotion.rotation[3]).toBeCloseTo(sine * 0.3, 7)
    expect(rootMotion.blendWeight).toBeCloseTo(0.3, 8)

    makeUpRootMotionToFullWeight(rootMotion)
    const unnormalizedY = sine * 0.3
    const unnormalizedW = sine * 0.3 + 0.7
    const inverseLength = 1 / Math.hypot(unnormalizedY, unnormalizedW)
    expect(rootMotion.rotation[1])
      .toBeCloseTo(unnormalizedY * inverseLength, 7)
    expect(rootMotion.rotation[3])
      .toBeCloseTo(unnormalizedW * inverseLength, 7)
    expect(rootMotion.blendWeight).toBeCloseTo(1, 8)
  })

  it('VERIFIED — composes Accumulate as InTransform * existing under UE transform order', () => {
    const sine = Math.SQRT1_2
    const first = createAuthoredRootMotionDelta()
    first.translation.set([1, 2, 3])
    first.rotation.set([sine, 0, 0, sine])
    first.valid = true
    const second = createAuthoredRootMotionDelta()
    second.translation.set([4, 5, 6])
    second.rotation.set([0, sine, 0, sine])
    second.valid = true

    const rootMotion = createRootMotionMovementParams()
    accumulateRootMotion(rootMotion, first)
    accumulateRootMotion(rootMotion, second)

    // UE's A * B transform convention applies A first. Therefore
    // `second * first` rotates second's translation by first before adding first's translation,
    // and composes the non-commuting rotations as first.rotation * second.rotation.
    expect(rootMotion.translation[0]).toBeCloseTo(5, 6)
    expect(rootMotion.translation[1]).toBeCloseTo(-4, 6)
    expect(rootMotion.translation[2]).toBeCloseTo(8, 6)
    rootMotion.rotation.forEach((component) => {
      expect(component).toBeCloseTo(0.5, 6)
    })
    expect(rootMotion.blendWeight).toBe(1)
  })

  it('VERIFIED — MakeUpToFullWeight adds identity only above UE_KINDA_SMALL_NUMBER', () => {
    const identity = createAuthoredRootMotionDelta()
    identity.valid = true
    const tolerance = 1e-4
    const weightAtTolerance = 1 - tolerance
    const weightAboveTolerance = 1 - (tolerance + 1e-8)

    const atTolerance = createRootMotionMovementParams()
    accumulateRootMotionWithBlend(atTolerance, identity, weightAtTolerance)
    makeUpRootMotionToFullWeight(atTolerance)
    expect(atTolerance.blendWeight).toBe(weightAtTolerance)

    const aboveTolerance = createRootMotionMovementParams()
    accumulateRootMotionWithBlend(
      aboveTolerance,
      identity,
      weightAboveTolerance,
    )
    makeUpRootMotionToFullWeight(aboveTolerance)
    expect(aboveTolerance.blendWeight).toBe(1)
  })
})

describe('authored ALS root motion', () => {
  beforeAll(async () => {
    animations = await loadAlsAnimations()
  })

  it.each([
    ['A_Als_Roll', true, 46, [0, 0, 2.75]],
    ['A_Als_Mantle_High', false, 81, [0, 2, 0.65]],
    ['A_Als_Mantle_Low_Left', false, 46, [0, 1, 0.65]],
    ['A_Als_Mantle_Low_Right', false, 46, [0, 1, 0.65]],
  ] as const)(
    'VERIFIED — %s compiles the independently pinned settings and trajectory endpoint',
    (name, enabled, keyCount, expectedEnd) => {
      const animation = clip(name)
      const raw = rawExtras(animation)

      // Independent content oracle: inspect GLB extras before exercising the runtime compiler.
      expect(raw.bEnableRootMotion).toBe(enabled)
      expect(raw.bForceRootLock).toBe(true)
      expect(raw.RootMotionRootLock).toBe('RefPose')
      expect(raw.rawRootTrack.times).toHaveLength(keyCount)
      expect(raw.rawRootTrack.translations[0]).toEqual([0, 0, 0])
      expectedEnd.forEach((value, component) => {
        expect(raw.rawRootTrack.translations.at(-1)?.[component]).toBeCloseTo(value, 6)
      })

      const compiled = compileAuthoredRootMotion(animation)
      if (!compiled) throw new Error(`${name} did not compile authored root motion`)
      expect(compiled.bEnableRootMotion).toBe(enabled)
      expect(compiled.bForceRootLock).toBe(true)
      expect(compiled.RootMotionRootLock).toBe('RefPose')
      expect(compiled.poseReset).toEqual({ kind: 'referencePose' })

      const end = sampleAuthoredRootMotion(
        compiled,
        compiled.duration,
        false,
        createAuthoredRootMotionSample(),
      )
      expectedEnd.forEach((value, component) => {
        expect(end.translation[component]).toBeCloseTo(value, 6)
      })
      expect([...end.scale]).toEqual([1, 1, 1])
    },
  )

  it('VERIFIED — preserves a baked turn trajectory beside its RefPose-locked output channel', () => {
    const animation = clip('A_Als_Turn_90_Left')
    const raw = rawExtras(animation)
    const output = animation.tracks.find((track) => track.name === 'root.quaternion')
    if (!output) throw new Error('A_Als_Turn_90_Left has no emitted root rotation')

    const outputFirst = Array.from(output.values.slice(0, 4))
    const outputLast = Array.from(output.values.slice(-4))
    expect(outputLast).toEqual(outputFirst)
    expect(raw.rawRootTrack.rotations[0][1]).toBeCloseTo(0, 6)
    expect(raw.rawRootTrack.rotations.at(-1)?.[1]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(raw.rawRootTrack.rotations.at(-1)?.[3]).toBeCloseTo(Math.SQRT1_2, 6)

    const compiled = compileAuthoredRootMotion(animation)
    if (!compiled) throw new Error('A_Als_Turn_90_Left did not compile raw root rotation')
    expect(compiled.bEnableRootMotion).toBe(false)
    expect(compiled.poseReset).toEqual({ kind: 'referencePose' })

    const forward = extractAuthoredRootMotionDelta(compiled, 0, compiled.duration)
    const reverse = extractAuthoredRootMotionDelta(compiled, compiled.duration, 0)
    expect(forward.rotation[1]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(forward.rotation[3]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(reverse.rotation[1]).toBeCloseTo(-Math.SQRT1_2, 5)
    expect(reverse.rotation[3]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('VERIFIED — accumulates Roll forward, reverse, and across both loop boundaries', () => {
    const animation = clip('A_Als_Roll')
    const raw = rawExtras(animation).rawRootTrack
    const compiled = compileAuthoredRootMotion(animation)
    if (!compiled) throw new Error('A_Als_Roll did not compile authored root motion')

    expect(
      extractAuthoredRootMotionDelta(compiled, 0, compiled.duration).translation[2],
    ).toBeCloseTo(2.75, 6)
    expect(
      extractAuthoredRootMotionDelta(compiled, compiled.duration, 0).translation[2],
    ).toBeCloseTo(-2.75, 6)
    expect(
      extractAuthoredRootMotionDelta(
        compiled,
        0,
        compiled.duration,
        { loop: true },
      ).translation[2],
    ).toBeCloseTo(2.75, 6)
    expect(
      extractAuthoredRootMotionDelta(
        compiled,
        0,
        -compiled.duration,
        { loop: true },
      ).translation[2],
    ).toBeCloseTo(-2.75, 6)

    const boundaryOffset = 0.1
    const start = sampleRawTranslation(raw, 0)
    const beforeEnd = sampleRawTranslation(raw, compiled.duration - boundaryOffset)
    const end = sampleRawTranslation(raw, compiled.duration)
    const afterStart = sampleRawTranslation(raw, boundaryOffset)
    const expectedForward = (end[2] - beforeEnd[2]) + (afterStart[2] - start[2])
    const expectedReverse = -expectedForward

    expect(
      extractAuthoredRootMotionDelta(
        compiled,
        compiled.duration - boundaryOffset,
        compiled.duration + boundaryOffset,
        { loop: true },
      ).translation[2],
    ).toBeCloseTo(expectedForward, 6)
    expect(
      extractAuthoredRootMotionDelta(
        compiled,
        boundaryOffset,
        -boundaryOffset,
        { loop: true },
      ).translation[2],
    ).toBeCloseTo(expectedReverse, 6)
  })

  it('VERIFIED — applies only an explicit ALS translation scale and never invents one from Roll', () => {
    const animation = clip('A_Als_Roll')
    const extras = rawExtras(animation)
    const rootMotionScaleNotify = extras.notifies?.find(
      (notify) => notify.name === 'AlsRootMotionScale',
    )

    // The source class has TranslationScale, but this GLB sidecar emits only notify name/time.
    expect(rootMotionScaleNotify).toEqual({ name: 'AlsRootMotionScale', time: 0 })
    expect(extras.bUseNormalizedRootMotionScale).toBeUndefined()
    expect(
      (extras.rawRootTrack as RawRootTrack & { scales?: unknown }).scales,
    ).toBeUndefined()

    const compiled = compileAuthoredRootMotion(animation)
    if (!compiled) throw new Error('A_Als_Roll did not compile authored root motion')
    const halfScale = extractAuthoredRootMotionDelta(
      compiled,
      0,
      compiled.duration,
      { translationScale: 0.5 },
    )
    expect([...halfScale.translation]).toEqual([0, 0, 1.375])
    expect([...halfScale.scale]).toEqual([1, 1, 1])
    expect(() => extractAuthoredRootMotionDelta(
      compiled,
      0,
      compiled.duration,
      { translationScale: -1 },
    )).toThrow(/non-negative/)
  })

  it('VERIFIED — compiles all three UE root-lock reset modes without renaming them', () => {
    const makeClip = (
      RootMotionRootLock: 'AnimFirstFrame' | 'Zero',
    ): Parameters<typeof compileAuthoredRootMotion>[0] => ({
      name: `reset-${RootMotionRootLock}`,
      duration: 1,
      userData: {
        bEnableRootMotion: false,
        bForceRootLock: true,
        RootMotionRootLock,
        rawRootTrack: {
          times: [0, 1],
          translations: [[2, 3, 4], [5, 6, 7]],
          rotations: [[0, 0, 0, 1], [0, 0, 1, 0]],
        },
      },
    })

    expect(compileAuthoredRootMotion(makeClip('AnimFirstFrame'))?.poseReset).toEqual({
      kind: 'animationFirstFrame',
      translation: new Float32Array([2, 3, 4]),
      rotation: new Float32Array([0, 0, 0, 1]),
    })
    expect(compileAuthoredRootMotion(makeClip('Zero'))?.poseReset).toEqual({
      kind: 'zero',
      translation: new Float32Array([0, 0, 0]),
      rotation: new Float32Array([0, 0, 0, 1]),
    })
  })

  it('HYPOTHESIS — composes a mixed six-DoF root as local transforms', () => {
    // ALS content independently verifies pure translation and single-axis rotation above, but
    // contains no clip that mixes both. This mathematical transform composition is original
    // engine substrate until a future ALS asset provides an independent mixed-motion oracle.
    const synthetic = compileAuthoredRootMotion({
      name: 'mixed-root',
      duration: 2,
      userData: {
        bEnableRootMotion: true,
        bForceRootLock: true,
        RootMotionRootLock: 'Zero',
        rawRootTrack: {
          times: [0, 1, 2],
          translations: [[0, 0, 0], [1, 0, 0], [1, 0, -1]],
          rotations: [
            [0, 0, 0, 1],
            [0, Math.SQRT1_2, 0, Math.SQRT1_2],
            [0, 1, 0, 0],
          ],
        },
      },
    })
    if (!synthetic) throw new Error('Synthetic mixed root did not compile')

    const delta = extractAuthoredRootMotionDelta(synthetic, 0, 2)
    expect([...delta.translation]).toEqual([1, 0, -1])
    expect(delta.rotation[1]).toBeCloseTo(1, 6)
    expect(delta.rotation[3]).toBeCloseTo(0, 6)
  })
})
