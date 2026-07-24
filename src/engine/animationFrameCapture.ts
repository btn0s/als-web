import * as THREE from 'three'

const DEFAULT_FRAME_COUNT = 90
const MAX_FRAME_COUNT = 240
const DEFAULT_TRACED_BONES = [
  'root',
  'pelvis',
  'foot_l',
  'foot_r',
  'hand_l',
  'hand_r',
  'ik_hand_gun',
  'VB hand_r_to_ik_hand_gun',
] as const

export interface AnimationFrameCaptureMetadata {
  readonly [name: string]: number | string | boolean
}

export interface AnimationFrameBoneTrace {
  readonly localPosition: readonly [number, number, number]
  readonly localRotation: readonly [number, number, number, number]
  readonly localScale: readonly [number, number, number]
  readonly worldPosition: readonly [number, number, number]
}

export interface AnimationFrameCaptureFrame {
  readonly index: number
  readonly deltaTime: number
  readonly metadata: AnimationFrameCaptureMetadata
  readonly bones: Readonly<Record<string, AnimationFrameBoneTrace>>
}

export interface AnimationFrameBoneDelta {
  readonly bone: string
  readonly value: number
}

export interface AnimationFrameCaptureDelta {
  readonly fromFrame: number
  readonly toFrame: number
  readonly translationMeters: AnimationFrameBoneDelta
  readonly rotationDegrees: AnimationFrameBoneDelta
  readonly scale: AnimationFrameBoneDelta
}

export interface AnimationFrameCaptureReport {
  readonly boneCount: number
  readonly frameCount: number
  readonly tracedBones: readonly string[]
  readonly frames: readonly AnimationFrameCaptureFrame[]
  readonly deltas: readonly AnimationFrameCaptureDelta[]
}

interface PoseSnapshot {
  readonly positions: Float32Array
  readonly rotations: Float32Array
  readonly scales: Float32Array
}

interface PendingCapture {
  readonly frameCount: number
  readonly frames: AnimationFrameCaptureFrame[]
  readonly poses: PoseSnapshot[]
  readonly resolve: (report: AnimationFrameCaptureReport) => void
  readonly reject: (error: Error) => void
}

function validateFrameCount(frameCount: number) {
  if (
    !Number.isInteger(frameCount)
    || frameCount < 2
    || frameCount > MAX_FRAME_COUNT
  ) {
    throw new Error(
      `Animation-frame capture requires 2-${MAX_FRAME_COUNT} frames`,
    )
  }
}

function findBones(root: THREE.Object3D) {
  const bones: THREE.Bone[] = []
  const names = new Set<string>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    if (names.has(object.name)) {
      throw new Error(
        `Animation-frame capture found duplicate bone "${object.name}"`,
      )
    }
    names.add(object.name)
    bones.push(object)
  })
  return bones
}

function capturePose(bones: readonly THREE.Bone[]): PoseSnapshot {
  const positions = new Float32Array(bones.length * 3)
  const rotations = new Float32Array(bones.length * 4)
  const scales = new Float32Array(bones.length * 3)
  for (let boneIndex = 0; boneIndex < bones.length; boneIndex++) {
    bones[boneIndex].position.toArray(positions, boneIndex * 3)
    bones[boneIndex].quaternion.toArray(rotations, boneIndex * 4)
    bones[boneIndex].scale.toArray(scales, boneIndex * 3)
  }
  return { positions, rotations, scales }
}

function tuple3(
  values: ArrayLike<number>,
  offset = 0,
): [number, number, number] {
  return [values[offset], values[offset + 1], values[offset + 2]]
}

function tuple4(
  values: ArrayLike<number>,
  offset = 0,
): [number, number, number, number] {
  return [
    values[offset],
    values[offset + 1],
    values[offset + 2],
    values[offset + 3],
  ]
}

function captureTracedBones(
  bonesByName: ReadonlyMap<string, THREE.Bone>,
  tracedBones: readonly string[],
) {
  const result: Record<string, AnimationFrameBoneTrace> = {}
  const worldPosition = new THREE.Vector3()
  for (const name of tracedBones) {
    const bone = bonesByName.get(name)
    if (!bone) continue
    bone.getWorldPosition(worldPosition)
    result[name] = {
      localPosition: tuple3(bone.position.toArray()),
      localRotation: tuple4(bone.quaternion.toArray()),
      localScale: tuple3(bone.scale.toArray()),
      worldPosition: tuple3(worldPosition.toArray()),
    }
  }
  return result
}

function maximumDelta(
  bones: readonly THREE.Bone[],
  previous: PoseSnapshot,
  current: PoseSnapshot,
): AnimationFrameCaptureDelta {
  let translationMeters: AnimationFrameBoneDelta = {
    bone: bones[0]?.name ?? '',
    value: 0,
  }
  let rotationDegrees: AnimationFrameBoneDelta = {
    bone: bones[0]?.name ?? '',
    value: 0,
  }
  let scale: AnimationFrameBoneDelta = {
    bone: bones[0]?.name ?? '',
    value: 0,
  }

  for (let boneIndex = 0; boneIndex < bones.length; boneIndex++) {
    const p = boneIndex * 3
    const q = boneIndex * 4
    const translation = Math.hypot(
      current.positions[p] - previous.positions[p],
      current.positions[p + 1] - previous.positions[p + 1],
      current.positions[p + 2] - previous.positions[p + 2],
    )
    const scaleDistance = Math.hypot(
      current.scales[p] - previous.scales[p],
      current.scales[p + 1] - previous.scales[p + 1],
      current.scales[p + 2] - previous.scales[p + 2],
    )
    const quaternionDot = Math.abs(
      current.rotations[q] * previous.rotations[q]
      + current.rotations[q + 1] * previous.rotations[q + 1]
      + current.rotations[q + 2] * previous.rotations[q + 2]
      + current.rotations[q + 3] * previous.rotations[q + 3],
    )
    const rotation = THREE.MathUtils.radToDeg(
      2 * Math.acos(Math.min(1, quaternionDot)),
    )
    const bone = bones[boneIndex].name
    if (translation > translationMeters.value) {
      translationMeters = { bone, value: translation }
    }
    if (rotation > rotationDegrees.value) {
      rotationDegrees = { bone, value: rotation }
    }
    if (scaleDistance > scale.value) {
      scale = { bone, value: scaleDistance }
    }
  }

  return {
    fromFrame: 0,
    toFrame: 0,
    translationMeters,
    rotationDegrees,
    scale,
  }
}

/**
 * Bounded, opt-in pose recorder for diagnosing single-frame animation discontinuities.
 *
 * The recorder snapshots every local bone transform so its delta report can identify a pop on
 * any physical or generated virtual bone. Only the requested bone traces are retained in the
 * public frame report; the complete pose copies are discarded when the capture resolves.
 */
export class AnimationFrameCapture {
  readonly bones: readonly THREE.Bone[]
  readonly bonesByName: ReadonlyMap<string, THREE.Bone>
  readonly tracedBones: readonly string[]
  private pending: PendingCapture | null = null

  constructor(
    root: THREE.Object3D,
    tracedBones: readonly string[] = DEFAULT_TRACED_BONES,
  ) {
    this.bones = findBones(root)
    this.bonesByName = new Map(this.bones.map((bone) => [bone.name, bone]))
    this.tracedBones = [...new Set(tracedBones)]
  }

  start(frameCount = DEFAULT_FRAME_COUNT): Promise<AnimationFrameCaptureReport> {
    validateFrameCount(frameCount)
    if (this.pending) {
      return Promise.reject(
        new Error('An animation-frame capture is already in progress.'),
      )
    }
    return new Promise((resolve, reject) => {
      this.pending = {
        frameCount,
        frames: [],
        poses: [],
        resolve,
        reject,
      }
    })
  }

  recordFrame(
    deltaTime: number,
    metadata: AnimationFrameCaptureMetadata = {},
  ) {
    const pending = this.pending
    if (!pending) return false
    const frameIndex = pending.frames.length
    pending.poses.push(capturePose(this.bones))
    pending.frames.push({
      index: frameIndex,
      deltaTime: Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0,
      metadata: { ...metadata },
      bones: captureTracedBones(
        this.bonesByName,
        this.tracedBones,
      ),
    })
    if (pending.frames.length < pending.frameCount) return true

    const deltas = pending.poses.slice(1).map((pose, index) => ({
      ...maximumDelta(this.bones, pending.poses[index], pose),
      fromFrame: index,
      toFrame: index + 1,
    }))
    this.pending = null
    pending.resolve({
      boneCount: this.bones.length,
      frameCount: pending.frames.length,
      tracedBones: this.tracedBones.filter((name) => (
        this.bonesByName.has(name)
      )),
      frames: pending.frames,
      deltas,
    })
    return true
  }

  cancel(reason = 'Animation-frame recorder was removed before capture completed.') {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.reject(new Error(reason))
  }
}

