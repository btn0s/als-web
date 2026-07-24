import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

export interface RootMotionDelta {
  readonly translation: Float32Array
  readonly rotation: Float32Array
  /**
   * UE root motion is an FTransform, so keep its scale channel explicit. The ALS GLB currently
   * carries no authored root Scale3D keys or bUseNormalizedRootMotionScale metadata; both
   * pose-derived and raw-track extraction therefore leave this at identity.
   */
  readonly scale?: Float32Array
  valid: boolean
}

export interface RootMotionExtractor {
  readonly rootBoneIndex: number
  readonly previousPosition: Float32Array
  readonly previousRotation: Float32Array
  readonly delta: RootMotionDelta
  hasPrevious: boolean
}

export function createRootMotionExtractor(
  rig: RigDefinition,
  rootBoneIndex = rig.parentIndices.findIndex((parent) => parent < 0),
): RootMotionExtractor {
  if (rootBoneIndex < 0 || rootBoneIndex >= rig.boneCount) {
    throw new Error('Root-motion extraction requires a valid root bone')
  }
  return {
    rootBoneIndex,
    previousPosition: new Float32Array(3),
    previousRotation: new Float32Array([0, 0, 0, 1]),
    delta: {
      translation: new Float32Array(3),
      rotation: new Float32Array([0, 0, 0, 1]),
      scale: new Float32Array([1, 1, 1]),
      valid: false,
    },
    hasPrevious: false,
  }
}

export function resetRootMotionExtractor(extractor: RootMotionExtractor) {
  extractor.hasPrevious = false
  extractor.delta.translation.fill(0)
  extractor.delta.rotation[0] = 0
  extractor.delta.rotation[1] = 0
  extractor.delta.rotation[2] = 0
  extractor.delta.rotation[3] = 1
  extractor.delta.scale?.fill(1)
  extractor.delta.valid = false
}

/**
 * Extracts the local root delta from the finalized frame pose. ALS's current clips are in-place,
 * so integration only exposes this hook; movement can consume and remove the delta later.
 */
export function extractRootMotionDelta(
  extractor: RootMotionExtractor,
  pose: LocalPoseBuffer,
): RootMotionDelta {
  const p = extractor.rootBoneIndex * 3
  const q = extractor.rootBoneIndex * 4
  const delta = extractor.delta

  if (!extractor.hasPrevious) {
    delta.translation.fill(0)
    delta.rotation[0] = 0
    delta.rotation[1] = 0
    delta.rotation[2] = 0
    delta.rotation[3] = 1
    delta.scale?.fill(1)
    delta.valid = false
    extractor.hasPrevious = true
  } else {
    delta.translation[0] = pose.positions[p] - extractor.previousPosition[0]
    delta.translation[1] = pose.positions[p + 1] - extractor.previousPosition[1]
    delta.translation[2] = pose.positions[p + 2] - extractor.previousPosition[2]

    const cx = pose.rotations[q]
    const cy = pose.rotations[q + 1]
    const cz = pose.rotations[q + 2]
    const cw = pose.rotations[q + 3]
    const px = -extractor.previousRotation[0]
    const py = -extractor.previousRotation[1]
    const pz = -extractor.previousRotation[2]
    const pw = extractor.previousRotation[3]
    delta.rotation[0] = cw * px + cx * pw + cy * pz - cz * py
    delta.rotation[1] = cw * py - cx * pz + cy * pw + cz * px
    delta.rotation[2] = cw * pz + cx * py - cy * px + cz * pw
    delta.rotation[3] = cw * pw - cx * px - cy * py - cz * pz
    delta.scale?.fill(1)
    delta.valid = true
  }

  extractor.previousPosition[0] = pose.positions[p]
  extractor.previousPosition[1] = pose.positions[p + 1]
  extractor.previousPosition[2] = pose.positions[p + 2]
  extractor.previousRotation[0] = pose.rotations[q]
  extractor.previousRotation[1] = pose.rotations[q + 1]
  extractor.previousRotation[2] = pose.rotations[q + 2]
  extractor.previousRotation[3] = pose.rotations[q + 3]
  return delta
}

export type RootMotionRootLock = 'RefPose' | 'AnimFirstFrame' | 'Zero'

export type RootMotionPoseReset =
  | { readonly kind: 'none' }
  | { readonly kind: 'referencePose' }
  | {
      readonly kind: 'animationFirstFrame'
      readonly translation: Float32Array
      readonly rotation: Float32Array
    }
  | {
      readonly kind: 'zero'
      readonly translation: Float32Array
      readonly rotation: Float32Array
    }

interface RawRootTrackExtras {
  readonly times?: unknown
  readonly translations?: unknown
  readonly rotations?: unknown
}

interface RootMotionClipExtras {
  readonly bEnableRootMotion?: unknown
  readonly bForceRootLock?: unknown
  readonly RootMotionRootLock?: unknown
  readonly rawRootTrack?: unknown
}

export interface ClipWithRootMotionExtras {
  readonly name: string
  readonly duration: number
  readonly userData?: RootMotionClipExtras
}

/**
 * Typed, allocation-stable form of `animation.extras.rawRootTrack`.
 *
 * The exact UE property names remain visible here so callers do not have to translate ALS
 * vocabulary. `poseReset` describes the transform Unreal writes to bone zero after consuming
 * the raw trajectory.
 */
export interface CompiledAuthoredRootMotion {
  readonly clipName: string
  readonly duration: number
  readonly bEnableRootMotion: boolean
  readonly bForceRootLock: boolean
  readonly RootMotionRootLock: RootMotionRootLock
  readonly poseReset: RootMotionPoseReset
  readonly times: Float32Array
  readonly translations: Float32Array
  readonly rotations: Float32Array
}

export interface AuthoredRootMotionSample {
  readonly translation: Float32Array
  readonly rotation: Float32Array
  readonly scale: Float32Array
}

export interface AuthoredRootMotionDelta extends RootMotionDelta {
  readonly scale: Float32Array
}

export interface AuthoredRootMotionExtractionOptions {
  readonly loop?: boolean
  /**
   * Mirrors `ACharacter::SetAnimRootMotionTranslationScale()`, which ALS drives from
   * UAlsAnimNotifyState_SetRootMotionScale. It scales translation only, never rotation.
   *
   * This must be supplied by the notify/action caller. The current GLB notify sidecar contains
   * neither the authored value nor its state duration, so inferring it here would invent content.
   */
  readonly translationScale?: number
}

const ROOT_LOCK_MODES = new Set<RootMotionRootLock>([
  'RefPose',
  'AnimFirstFrame',
  'Zero',
])
const LOOP_EPSILON = 1e-9

function isFiniteTuple(value: unknown, size: number): value is number[] {
  return (
    Array.isArray(value)
    && value.length === size
    && value.every((component) => typeof component === 'number' && Number.isFinite(component))
  )
}

function normalizeQuaternionInPlace(values: Float32Array, offset: number) {
  const length = Math.hypot(
    values[offset],
    values[offset + 1],
    values[offset + 2],
    values[offset + 3],
  )
  if (!(length > 0)) throw new Error('Authored root-motion rotations must be non-zero quaternions')
  values[offset] /= length
  values[offset + 1] /= length
  values[offset + 2] /= length
  values[offset + 3] /= length
}

function createPoseReset(
  enabled: boolean,
  mode: RootMotionRootLock,
  translations: Float32Array,
  rotations: Float32Array,
): RootMotionPoseReset {
  if (!enabled) return { kind: 'none' }
  if (mode === 'RefPose') return { kind: 'referencePose' }
  if (mode === 'AnimFirstFrame') {
    return {
      kind: 'animationFirstFrame',
      translation: translations.slice(0, 3),
      rotation: rotations.slice(0, 4),
    }
  }
  return {
    kind: 'zero',
    translation: new Float32Array(3),
    rotation: new Float32Array([0, 0, 0, 1]),
  }
}

/**
 * Compiles the lossless raw root sidecar emitted by `scripts/extract-als/assemble-glb.mjs`.
 * Clips without a raw trajectory return undefined. If a trajectory exists, malformed or
 * contradictory metadata is fatal instead of silently falling back to the already-locked pose.
 */
export function compileAuthoredRootMotion(
  clip: ClipWithRootMotionExtras,
): CompiledAuthoredRootMotion | undefined {
  const extras = clip.userData
  const rawTrack = extras?.rawRootTrack
  if (rawTrack === undefined) return undefined
  if (!rawTrack || typeof rawTrack !== 'object' || Array.isArray(rawTrack)) {
    throw new Error(`${clip.name} rawRootTrack must be an object`)
  }
  if (
    typeof extras?.bEnableRootMotion !== 'boolean'
    || typeof extras.bForceRootLock !== 'boolean'
    || !ROOT_LOCK_MODES.has(extras.RootMotionRootLock as RootMotionRootLock)
  ) {
    throw new Error(`${clip.name} has malformed root-motion settings`)
  }
  if (!extras.bForceRootLock) {
    throw new Error(`${clip.name} has rawRootTrack without bForceRootLock`)
  }

  const raw = rawTrack as RawRootTrackExtras
  if (
    !Array.isArray(raw.times)
    || !Array.isArray(raw.translations)
    || !Array.isArray(raw.rotations)
    || raw.times.length === 0
    || raw.translations.length !== raw.times.length
    || raw.rotations.length !== raw.times.length
  ) {
    throw new Error(`${clip.name} rawRootTrack arrays must have the same non-zero key count`)
  }

  const times = new Float32Array(raw.times.length)
  const translations = new Float32Array(raw.times.length * 3)
  const rotations = new Float32Array(raw.times.length * 4)
  for (let index = 0; index < raw.times.length; index++) {
    const time = raw.times[index]
    const translation = raw.translations[index]
    const rotation = raw.rotations[index]
    if (
      typeof time !== 'number'
      || !Number.isFinite(time)
      || (index === 0 && Math.abs(time) > LOOP_EPSILON)
      || (index > 0 && time <= times[index - 1])
      || !isFiniteTuple(translation, 3)
      || !isFiniteTuple(rotation, 4)
    ) {
      throw new Error(`${clip.name} rawRootTrack key ${index} is malformed`)
    }
    times[index] = time
    translations.set(translation, index * 3)
    rotations.set(rotation, index * 4)
    normalizeQuaternionInPlace(rotations, index * 4)
  }

  const duration = times[times.length - 1]
  if (
    !(duration > 0)
    || !Number.isFinite(clip.duration)
    || Math.abs(duration - clip.duration) > 1e-5
  ) {
    throw new Error(
      `${clip.name} rawRootTrack duration ${duration} does not match clip ${clip.duration}`,
    )
  }

  const RootMotionRootLock = extras.RootMotionRootLock as RootMotionRootLock
  return {
    clipName: clip.name,
    duration,
    bEnableRootMotion: extras.bEnableRootMotion,
    bForceRootLock: extras.bForceRootLock,
    RootMotionRootLock,
    poseReset: createPoseReset(
      extras.bForceRootLock,
      RootMotionRootLock,
      translations,
      rotations,
    ),
    times,
    translations,
    rotations,
  }
}

export function createAuthoredRootMotionSample(): AuthoredRootMotionSample {
  return {
    translation: new Float32Array(3),
    rotation: new Float32Array([0, 0, 0, 1]),
    scale: new Float32Array([1, 1, 1]),
  }
}

export function createAuthoredRootMotionDelta(): AuthoredRootMotionDelta {
  return {
    translation: new Float32Array(3),
    rotation: new Float32Array([0, 0, 0, 1]),
    scale: new Float32Array([1, 1, 1]),
    valid: false,
  }
}

function positiveModulo(value: number, divisor: number) {
  const result = ((value % divisor) + divisor) % divisor
  return result < LOOP_EPSILON || divisor - result < LOOP_EPSILON ? 0 : result
}

function findKeyInterval(times: Float32Array, time: number) {
  const last = times.length - 1
  if (time <= times[0]) return { a: 0, b: 0, alpha: 0 }
  if (time >= times[last]) return { a: last, b: last, alpha: 0 }
  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (times[middle] <= time) low = middle
    else high = middle
  }
  return {
    a: low,
    b: high,
    alpha: (time - times[low]) / (times[high] - times[low]),
  }
}

function sampleQuaternion(
  values: Float32Array,
  a: number,
  b: number,
  alpha: number,
  out: Float32Array,
) {
  const aOffset = a * 4
  const bOffset = b * 4
  let ax = values[aOffset]
  let ay = values[aOffset + 1]
  let az = values[aOffset + 2]
  let aw = values[aOffset + 3]
  let bx = values[bOffset]
  let by = values[bOffset + 1]
  let bz = values[bOffset + 2]
  let bw = values[bOffset + 3]
  let dot = ax * bx + ay * by + az * bz + aw * bw
  if (dot < 0) {
    dot = -dot
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }

  let aWeight = 1 - alpha
  let bWeight = alpha
  if (a !== b && dot < 0.9995) {
    const theta = Math.acos(Math.min(1, dot))
    const inverseSinTheta = 1 / Math.sin(theta)
    aWeight = Math.sin((1 - alpha) * theta) * inverseSinTheta
    bWeight = Math.sin(alpha * theta) * inverseSinTheta
  }
  ax = ax * aWeight + bx * bWeight
  ay = ay * aWeight + by * bWeight
  az = az * aWeight + bz * bWeight
  aw = aw * aWeight + bw * bWeight
  const inverseLength = 1 / Math.hypot(ax, ay, az, aw)
  out[0] = ax * inverseLength
  out[1] = ay * inverseLength
  out[2] = az * inverseLength
  out[3] = aw * inverseLength
}

/**
 * Samples the authored root transform. Raw tracks are emitted with glTF LINEAR interpolation:
 * component-linear translation and shortest-arc quaternion slerp.
 */
export function sampleAuthoredRootMotion(
  rootMotion: CompiledAuthoredRootMotion,
  time: number,
  loop = false,
  out = createAuthoredRootMotionSample(),
): AuthoredRootMotionSample {
  if (!Number.isFinite(time)) throw new Error('Root-motion sample time must be finite')
  const sampleTime = loop
    ? positiveModulo(time, rootMotion.duration)
    : Math.min(Math.max(time, 0), rootMotion.duration)
  const { a, b, alpha } = findKeyInterval(rootMotion.times, sampleTime)
  for (let component = 0; component < 3; component++) {
    const from = rootMotion.translations[a * 3 + component]
    out.translation[component] =
      a === b
        ? from
        : from + (rootMotion.translations[b * 3 + component] - from) * alpha
  }
  sampleQuaternion(rootMotion.rotations, a, b, alpha, out.rotation)
  out.scale.fill(1)
  return out
}

function multiplyQuaternion(
  a: Float32Array,
  b: Float32Array,
  out: Float32Array,
) {
  const ax = a[0]
  const ay = a[1]
  const az = a[2]
  const aw = a[3]
  const bx = b[0]
  const by = b[1]
  const bz = b[2]
  const bw = b[3]
  out[0] = aw * bx + ax * bw + ay * bz - az * by
  out[1] = aw * by - ax * bz + ay * bw + az * bx
  out[2] = aw * bz + ax * by - ay * bx + az * bw
  out[3] = aw * bw - ax * bx - ay * by - az * bz
  normalizeQuaternionInPlace(out, 0)
}

function rotateVector(
  quaternion: Float32Array,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
) {
  const qx = quaternion[0]
  const qy = quaternion[1]
  const qz = quaternion[2]
  const qw = quaternion[3]
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx
}

const scratchStart = createAuthoredRootMotionSample()
const scratchEnd = createAuthoredRootMotionSample()
const scratchInverseRotation = new Float32Array(4)
const scratchSegmentTranslation = new Float32Array(3)
const scratchSegmentRotation = new Float32Array(4)
const scratchRotatedTranslation = new Float32Array(3)
const scratchComposedRotation = new Float32Array(4)

function appendContiguousDelta(
  rootMotion: CompiledAuthoredRootMotion,
  startTime: number,
  endTime: number,
  out: AuthoredRootMotionDelta,
) {
  sampleAuthoredRootMotion(rootMotion, startTime, false, scratchStart)
  sampleAuthoredRootMotion(rootMotion, endTime, false, scratchEnd)

  scratchInverseRotation[0] = -scratchStart.rotation[0]
  scratchInverseRotation[1] = -scratchStart.rotation[1]
  scratchInverseRotation[2] = -scratchStart.rotation[2]
  scratchInverseRotation[3] = scratchStart.rotation[3]
  multiplyQuaternion(
    scratchInverseRotation,
    scratchEnd.rotation,
    scratchSegmentRotation,
  )
  rotateVector(
    scratchInverseRotation,
    scratchEnd.translation[0] - scratchStart.translation[0],
    scratchEnd.translation[1] - scratchStart.translation[1],
    scratchEnd.translation[2] - scratchStart.translation[2],
    scratchSegmentTranslation,
  )

  rotateVector(
    out.rotation,
    scratchSegmentTranslation[0],
    scratchSegmentTranslation[1],
    scratchSegmentTranslation[2],
    scratchRotatedTranslation,
  )
  out.translation[0] += scratchRotatedTranslation[0]
  out.translation[1] += scratchRotatedTranslation[1]
  out.translation[2] += scratchRotatedTranslation[2]
  multiplyQuaternion(out.rotation, scratchSegmentRotation, scratchComposedRotation)
  out.rotation.set(scratchComposedRotation)
}

/**
 * Extracts root motion between unwrapped playback times.
 *
 * With looping enabled, full-cycle motion is retained rather than disappearing when both times
 * resolve to the same clip position. Forward and reverse boundary crossings are split into the
 * same contiguous ranges consumed by UE's no-loop `ExtractRootMotionFromRange()`.
 */
export function extractAuthoredRootMotionDelta(
  rootMotion: CompiledAuthoredRootMotion,
  previousTime: number,
  currentTime: number,
  options: AuthoredRootMotionExtractionOptions = {},
  out = createAuthoredRootMotionDelta(),
): AuthoredRootMotionDelta {
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    throw new Error('Root-motion extraction times must be finite')
  }
  const translationScale = options.translationScale ?? 1
  if (!Number.isFinite(translationScale) || translationScale < 0) {
    throw new Error('ALS root-motion translation scale must be finite and non-negative')
  }

  out.translation.fill(0)
  out.rotation[0] = 0
  out.rotation[1] = 0
  out.rotation[2] = 0
  out.rotation[3] = 1
  out.scale.fill(1)

  if (!options.loop) {
    appendContiguousDelta(
      rootMotion,
      Math.min(Math.max(previousTime, 0), rootMotion.duration),
      Math.min(Math.max(currentTime, 0), rootMotion.duration),
      out,
    )
  } else {
    let cursor = previousTime
    let remaining = currentTime - previousTime
    while (Math.abs(remaining) > LOOP_EPSILON) {
      if (remaining > 0) {
        const start = positiveModulo(cursor, rootMotion.duration)
        const step = Math.min(remaining, rootMotion.duration - start)
        appendContiguousDelta(rootMotion, start, start + step, out)
        cursor += step
        remaining -= step
      } else {
        const wrapped = positiveModulo(cursor, rootMotion.duration)
        const start = wrapped === 0 ? rootMotion.duration : wrapped
        const step = Math.min(-remaining, start)
        appendContiguousDelta(rootMotion, start, start - step, out)
        cursor -= step
        remaining += step
      }
    }
  }

  out.translation[0] *= translationScale
  out.translation[1] *= translationScale
  out.translation[2] *= translationScale
  out.valid = true
  return out
}
