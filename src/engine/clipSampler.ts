import * as THREE from 'three'
import type { LocalPoseBuffer } from './poseBuffer'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToAdditiveIdentity,
  resetPoseToReference,
} from './poseBuffer'
import type { RigDefinition } from './rig'
import {
  createVirtualBonePoseScratch,
  refreshVirtualBonePose,
  type VirtualBonePoseScratch,
} from './virtualBones'

export type TransformProperty = 'position' | 'quaternion' | 'scale'

export interface CompiledTrackBinding {
  readonly boneIndex: number
  readonly property: TransformProperty
  readonly times: ArrayLike<number>
  readonly values: ArrayLike<number>
  readonly interpolation: THREE.InterpolationModes
  readonly timeline: number
}

export interface CompiledClipSampler {
  readonly clip: THREE.AnimationClip
  readonly bindings: readonly CompiledTrackBinding[]
  readonly timelines: readonly ArrayLike<number>[]
  readonly virtualBoneScratch: VirtualBonePoseScratch | null
}

export type ClipSampleFallback =
  | 'reference'
  | 'additiveIdentity'
  | LocalPoseBuffer

const PROPERTY_SIZES: Record<TransformProperty, number> = {
  position: 3,
  quaternion: 4,
  scale: 3,
}

type CompiledBindings = { readonly bindings: readonly CompiledTrackBinding[]; readonly timelines: readonly ArrayLike<number>[] }

const bindingCache = new WeakMap<THREE.AnimationClip, Map<string, CompiledBindings>>()

function sameTimes(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
  return true
}

type SampleCacheEntry = { time: number; fallback: ClipSampleFallback; pose: LocalPoseBuffer }

const SAMPLE_CACHE_SIZE = 4
const sampleCaches = new WeakMap<RigDefinition, WeakMap<readonly CompiledTrackBinding[], SampleCacheEntry[]>>()

function sampleCacheFor(rig: RigDefinition, bindings: readonly CompiledTrackBinding[]) {
  let byBindings = sampleCaches.get(rig)
  if (!byBindings) sampleCaches.set(rig, byBindings = new WeakMap())
  let entries = byBindings.get(bindings)
  if (!entries) byBindings.set(bindings, entries = [])
  return entries
}

let timelineKeys = new Int32Array(0)
let timelineAlphas = new Float64Array(0)

export function precompileClipSamplers(clips: readonly THREE.AnimationClip[], rig: RigDefinition): void {
  for (const clip of clips) compileClipSampler(clip, rig)
}

export function compileClipSampler(
  clip: THREE.AnimationClip,
  rig: RigDefinition,
): CompiledClipSampler {
  const signature = JSON.stringify(rig.boneNames)
  let cached = bindingCache.get(clip)
  const existing = cached?.get(signature)
  if (existing) return {
    clip,
    ...existing,
    virtualBoneScratch: rig.virtualBones.length > 0 ? createVirtualBonePoseScratch(rig.boneCount) : null,
  }
  const indices = new Map(rig.boneNames.map((name, index) => [name, index]))
  const bindings: CompiledTrackBinding[] = []
  const timelines: ArrayLike<number>[] = []

  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
    const boneIndex = parsed.nodeName === undefined ? undefined : indices.get(parsed.nodeName)
    const property = parsed.propertyName
    if (
      boneIndex === undefined
      || (property !== 'position' && property !== 'quaternion' && property !== 'scale')
    ) {
      continue
    }

    let timeline = timelines.findIndex(times => sameTimes(times, track.times))
    if (timeline < 0) timeline = timelines.push(track.times) - 1
    bindings.push({
      boneIndex,
      property,
      times: track.times,
      values: track.values,
      interpolation: track.getInterpolation(),
      timeline,
    })
  }

  if (!cached) {
    cached = new Map()
    bindingCache.set(clip, cached)
  }
  cached.set(signature, { bindings, timelines })
  return {
    clip,
    bindings,
    timelines,
    virtualBoneScratch: rig.virtualBones.length > 0
      ? createVirtualBonePoseScratch(rig.boneCount)
      : null,
  }
}

export function resolveClipTime(time: number, duration: number, loop: boolean): number {
  if (!loop || duration <= 0) return Math.min(Math.max(time, 0), Math.max(duration, 0))
  return ((time % duration) + duration) % duration
}

function slerpQuaternion(
  values: ArrayLike<number>,
  aOffset: number,
  bOffset: number,
  alpha: number,
  out: Float32Array,
  outOffset: number,
) {
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
  if (dot < 0.9995) {
    const theta = Math.acos(Math.min(1, dot))
    const sinTheta = Math.sin(theta)
    aWeight = Math.sin((1 - alpha) * theta) / sinTheta
    bWeight = Math.sin(alpha * theta) / sinTheta
  }

  ax = ax * aWeight + bx * bWeight
  ay = ay * aWeight + by * bWeight
  az = az * aWeight + bz * bWeight
  aw = aw * aWeight + bw * bWeight
  const inverseLength = 1 / Math.hypot(ax, ay, az, aw)
  out[outOffset] = ax * inverseLength
  out[outOffset + 1] = ay * inverseLength
  out[outOffset + 2] = az * inverseLength
  out[outOffset + 3] = aw * inverseLength
}

export function sampleClip(
  sampler: CompiledClipSampler,
  rig: RigDefinition,
  time: number,
  out: LocalPoseBuffer,
  loop = true,
  fallback: ClipSampleFallback = 'reference',
): LocalPoseBuffer {
  const sampleTime = resolveClipTime(time, sampler.clip.duration, loop)
  const cache = typeof fallback === 'string' && out.boneCount === rig.boneCount
    ? sampleCacheFor(rig, sampler.bindings)
    : null
  if (cache) {
    for (let index = 0; index < cache.length; index++) {
      const entry = cache[index]
      if (entry.time !== sampleTime || entry.fallback !== fallback) continue
      if (index > 0) {
        cache.splice(index, 1)
        cache.unshift(entry)
      }
      out.data.set(entry.pose.data)
      return out
    }
  }

  if (fallback === 'additiveIdentity') resetPoseToAdditiveIdentity(out)
  else if (fallback === 'reference') resetPoseToReference(out, rig)
  else copyPose(fallback, out)

  const timelines = sampler.timelines
  if (timelineKeys.length < timelines.length * 2) {
    timelineKeys = new Int32Array(timelines.length * 2)
    timelineAlphas = new Float64Array(timelines.length)
  }
  for (let timeline = 0; timeline < timelines.length; timeline++) {
    const times = timelines[timeline]
    const last = times.length - 1
    let a = 0
    let b = 0
    let rawAlpha = 0
    if (last > 0 && sampleTime > times[0]) {
      if (sampleTime >= times[last]) {
        a = last
        b = last
      } else {
        let low = 0
        let high = last
        while (high - low > 1) {
          const middle = (low + high) >>> 1
          if (times[middle] <= sampleTime) low = middle
          else high = middle
        }
        a = low
        b = high
        const span = times[high] - times[low]
        rawAlpha = span > 0 ? (sampleTime - times[low]) / span : 0
      }
    }
    timelineKeys[timeline * 2] = a
    timelineKeys[timeline * 2 + 1] = b
    timelineAlphas[timeline] = rawAlpha
  }
  for (const binding of sampler.bindings) {
    const a = timelineKeys[binding.timeline * 2]
    const b = timelineKeys[binding.timeline * 2 + 1]
    const rawAlpha = timelineAlphas[binding.timeline]
    const alpha = binding.interpolation === THREE.InterpolateDiscrete ? 0 : rawAlpha
    const size = PROPERTY_SIZES[binding.property]
    const sourceA = a * size
    const sourceB = b * size
    const target =
      binding.property === 'position'
        ? out.positions
        : binding.property === 'quaternion'
          ? out.rotations
          : out.scales
    const targetOffset = binding.boneIndex * size

    if (binding.property === 'quaternion' && a !== b) {
      slerpQuaternion(binding.values, sourceA, sourceB, alpha, target, targetOffset)
      continue
    }

    for (let component = 0; component < size; component++) {
      const from = binding.values[sourceA + component]
      target[targetOffset + component] =
        a === b ? from : from + (binding.values[sourceB + component] - from) * alpha
    }
  }

  if (
    fallback !== 'additiveIdentity'
    && sampler.virtualBoneScratch
  ) {
    refreshVirtualBonePose(out, rig, sampler.virtualBoneScratch)
  }

  if (cache) {
    const entry = cache.length < SAMPLE_CACHE_SIZE
      ? { time: sampleTime, fallback, pose: createPoseBuffer(rig.boneCount) }
      : cache.pop()!
    entry.time = sampleTime
    entry.fallback = fallback
    entry.pose.data.set(out.data)
    cache.unshift(entry)
  }

  return out
}
