import * as THREE from 'three'
import {
  captureSkinnedMeshWorldBounds,
} from './skinnedMeshBounds'
import type {
  SkinnedMeshWorldBounds,
} from './skinnedMeshBounds'

const DEFAULT_FRAME_COUNT = 90
const MAX_FRAME_COUNT = 240
const DEFAULT_TRACED_BONES = [
  'root',
  'pelvis',
  'foot_l',
  'foot_r',
  'ball_l',
  'ball_r',
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
  /** World position of the supplied rendered component root at this evaluated frame. */
  readonly rootWorldPosition: readonly [number, number, number]
  readonly bones: Readonly<Record<string, AnimationFrameBoneTrace>>
  /** Exact deformed-vertex world bounds at this evaluated pose. */
  readonly skinnedMeshBounds: SkinnedMeshWorldBounds | null
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

export interface AnimationFramePoseDetour {
  readonly frame: number
  readonly translationMeters: AnimationFrameBoneDelta
  readonly rotationDegrees: AnimationFrameBoneDelta
  readonly scale: AnimationFrameBoneDelta
}

export interface AnimationFrameGroundContactDiagnostics {
  readonly frameCount: number
  readonly maximumSeparationMeters: number
  readonly maximumSeparationFrame: number
  readonly minimumSeparationMeters: number
  readonly minimumSeparationFrame: number
}

export interface AnimationFrameRootMotionDiagnostics {
  readonly bodyHorizontalDistanceMeters: number
  readonly consumedHorizontalDistanceMeters: number
  readonly absoluteDifferenceMeters: number
}

export interface AnimationFrameTurnInPlaceDiagnostics {
  /** Number of active edges that had the actor-yaw and published-curve inputs. */
  readonly edgeCount: number
  /** Sum of wrapped actor-yaw deltas over eligible active TurnInPlace edges. */
  readonly signedActorYawDegrees: number
  /** Sum of `PublishedRotationYawSpeed * currentFrame.deltaTime` on those edges. */
  readonly signedCurveYawDegrees: number
  /** Largest absolute difference between one actor-yaw edge and its preceding curve integral. */
  readonly maximumIntegrationErrorDegrees: number
  readonly maximumIntegrationErrorFrame: number
  /** Largest absolute wrapped actor-yaw step during the active turn. */
  readonly maximumActorStepDegrees: number
  readonly maximumActorStepFrame: number
  /** Largest whole-pose rotation detour centered on an active TurnInPlace frame. */
  readonly largestPoseRotationDetour: AnimationFramePoseDetour | null
}

export interface AnimationFrameTransformJitterVector {
  /** Signed middle-frame departure from cadence-correct linear travel. */
  readonly residual: readonly [number, number, number]
  readonly magnitude: number
  readonly frame: number
}

export interface AnimationFrameTransformJitterDiagnostics {
  readonly rawCharacterPosition: AnimationFrameTransformJitterVector | null
  readonly renderedRootWorldPosition: AnimationFrameTransformJitterVector | null
  readonly cameraWorldPosition: AnimationFrameTransformJitterVector | null
}

export interface AnimationFrameCaptureDiagnostics {
  readonly poseDetours: readonly AnimationFramePoseDetour[]
  readonly groundedContact: AnimationFrameGroundContactDiagnostics | null
  readonly rollingContact: AnimationFrameGroundContactDiagnostics | null
  readonly rollingRootMotion: AnimationFrameRootMotionDiagnostics | null
  readonly turnInPlace: AnimationFrameTurnInPlaceDiagnostics | null
  readonly transformJitter: AnimationFrameTransformJitterDiagnostics
}

export interface AnimationFrameCaptureReport {
  readonly boneCount: number
  readonly frameCount: number
  readonly tracedBones: readonly string[]
  readonly frames: readonly AnimationFrameCaptureFrame[]
  readonly deltas: readonly AnimationFrameCaptureDelta[]
  readonly diagnostics: AnimationFrameCaptureDiagnostics
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

function tupleFromVector3(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
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

function vectorDistance3(
  valuesA: Float32Array,
  valuesB: Float32Array,
  offset: number,
) {
  return Math.hypot(
    valuesA[offset] - valuesB[offset],
    valuesA[offset + 1] - valuesB[offset + 1],
    valuesA[offset + 2] - valuesB[offset + 2],
  )
}

function quaternionDistanceDegrees(
  valuesA: Float32Array,
  valuesB: Float32Array,
  offset: number,
) {
  const dot = Math.abs(
    valuesA[offset] * valuesB[offset]
    + valuesA[offset + 1] * valuesB[offset + 1]
    + valuesA[offset + 2] * valuesB[offset + 2]
    + valuesA[offset + 3] * valuesB[offset + 3],
  )
  return THREE.MathUtils.radToDeg(
    2 * Math.acos(Math.min(1, dot)),
  )
}

/**
 * Measures a one-frame excursion independently of animation speed.
 *
 * Half of the triangle-inequality excess is zero for a monotonic path and
 * positive when the middle pose travels away and returns on the next frame.
 * Authored scenario oracles decide the acceptable value; this recorder does
 * not hide a guessed animation threshold.
 */
function measurePoseDetours(
  bones: readonly THREE.Bone[],
  poses: readonly PoseSnapshot[],
): AnimationFramePoseDetour[] {
  const result: AnimationFramePoseDetour[] = []
  for (let frame = 1; frame + 1 < poses.length; frame++) {
    const previous = poses[frame - 1]
    const current = poses[frame]
    const next = poses[frame + 1]
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
      const positionOffset = boneIndex * 3
      const rotationOffset = boneIndex * 4
      const translationExcursion = Math.max(
        0,
        (
          vectorDistance3(previous.positions, current.positions, positionOffset)
          + vectorDistance3(current.positions, next.positions, positionOffset)
          - vectorDistance3(previous.positions, next.positions, positionOffset)
        ) / 2,
      )
      const rotationExcursion = Math.max(
        0,
        (
          quaternionDistanceDegrees(
            previous.rotations,
            current.rotations,
            rotationOffset,
          )
          + quaternionDistanceDegrees(
            current.rotations,
            next.rotations,
            rotationOffset,
          )
          - quaternionDistanceDegrees(
            previous.rotations,
            next.rotations,
            rotationOffset,
          )
        ) / 2,
      )
      const scaleExcursion = Math.max(
        0,
        (
          vectorDistance3(previous.scales, current.scales, positionOffset)
          + vectorDistance3(current.scales, next.scales, positionOffset)
          - vectorDistance3(previous.scales, next.scales, positionOffset)
        ) / 2,
      )
      const bone = bones[boneIndex].name
      if (translationExcursion > translationMeters.value) {
        translationMeters = { bone, value: translationExcursion }
      }
      if (rotationExcursion > rotationDegrees.value) {
        rotationDegrees = { bone, value: rotationExcursion }
      }
      if (scaleExcursion > scale.value) {
        scale = { bone, value: scaleExcursion }
      }
    }

    result.push({
      frame,
      translationMeters,
      rotationDegrees,
      scale,
    })
  }
  return result
}

function numericMetadata(
  frame: AnimationFrameCaptureFrame,
  name: string,
): number | null {
  const value = frame.metadata[name]
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
}

function unwindDegrees(angle: number) {
  let result = angle % 360
  if (result > 180) result -= 360
  if (result <= -180) result += 360
  return result
}

function activeTurnInPlace(frame: AnimationFrameCaptureFrame) {
  return (numericMetadata(frame, 'TurnInPlaceMontageWeight') ?? 0) > 0
}

function turnInPlaceDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
  poseDetours: readonly AnimationFramePoseDetour[],
): AnimationFrameTurnInPlaceDiagnostics | null {
  let edgeCount = 0
  let signedActorYawDegrees = 0
  let signedCurveYawDegrees = 0
  let maximumIntegrationErrorDegrees = -1
  let maximumIntegrationErrorFrame = -1
  let maximumActorStepDegrees = -1
  let maximumActorStepFrame = -1

  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]
    const current = frames[index]
    // Actor yaw at this edge consumed the curve published by the preceding evaluated frame.
    if (!activeTurnInPlace(previous)) continue
    const previousYaw = numericMetadata(previous, 'actorYawAngle')
    const currentYaw = numericMetadata(current, 'actorYawAngle')
    const previousPublishedYawSpeed = numericMetadata(
      previous,
      'PublishedRotationYawSpeed',
    )
    if (
      previousYaw === null
      || currentYaw === null
      || previousPublishedYawSpeed === null
      || current.deltaTime <= 0
    ) continue
    const actualYawDegrees = unwindDegrees(currentYaw - previousYaw)
    const curveYawDegrees = previousPublishedYawSpeed * current.deltaTime
    const integrationErrorDegrees = Math.abs(
      actualYawDegrees - curveYawDegrees,
    )
    edgeCount++
    signedActorYawDegrees += actualYawDegrees
    signedCurveYawDegrees += curveYawDegrees
    if (integrationErrorDegrees > maximumIntegrationErrorDegrees) {
      maximumIntegrationErrorDegrees = integrationErrorDegrees
      maximumIntegrationErrorFrame = current.index
    }
    if (Math.abs(actualYawDegrees) > maximumActorStepDegrees) {
      maximumActorStepDegrees = Math.abs(actualYawDegrees)
      maximumActorStepFrame = current.index
    }
  }

  if (edgeCount === 0) return null
  let largestPoseRotationDetour: AnimationFramePoseDetour | null = null
  for (const detour of poseDetours) {
    const frame = frames[detour.frame]
    if (!frame || !activeTurnInPlace(frame)) continue
    if (
      !largestPoseRotationDetour
      || detour.rotationDegrees.value
        > largestPoseRotationDetour.rotationDegrees.value
    ) {
      largestPoseRotationDetour = detour
    }
  }
  return {
    edgeCount,
    signedActorYawDegrees,
    signedCurveYawDegrees,
    maximumIntegrationErrorDegrees: Math.max(0, maximumIntegrationErrorDegrees),
    maximumIntegrationErrorFrame,
    maximumActorStepDegrees: Math.max(0, maximumActorStepDegrees),
    maximumActorStepFrame,
    largestPoseRotationDetour,
  }
}

function transformJitterVector(
  frames: readonly AnimationFrameCaptureFrame[],
  position: (frame: AnimationFrameCaptureFrame) => readonly [number, number, number] | null,
): AnimationFrameTransformJitterVector | null {
  let maximum: AnimationFrameTransformJitterVector | null = null
  for (let index = 1; index + 1 < frames.length; index++) {
    const previous = frames[index - 1]
    const current = frames[index]
    const next = frames[index + 1]
    const previousPosition = position(previous)
    const currentPosition = position(current)
    const nextPosition = position(next)
    const duration = current.deltaTime + next.deltaTime
    if (
      !previousPosition
      || !currentPosition
      || !nextPosition
      || !Number.isFinite(duration)
      || duration <= 0
      || current.deltaTime < 0
      || next.deltaTime < 0
    ) continue
    const alpha = current.deltaTime / duration
    const residual: [number, number, number] = [
      currentPosition[0] - (previousPosition[0] + (nextPosition[0] - previousPosition[0]) * alpha),
      currentPosition[1] - (previousPosition[1] + (nextPosition[1] - previousPosition[1]) * alpha),
      currentPosition[2] - (previousPosition[2] + (nextPosition[2] - previousPosition[2]) * alpha),
    ]
    const magnitude = Math.hypot(...residual)
    if (!maximum || magnitude > maximum.magnitude) {
      maximum = { residual, magnitude, frame: current.index }
    }
  }
  return maximum
}

function rawCharacterPosition(
  frame: AnimationFrameCaptureFrame,
): [number, number, number] | null {
  const x = numericMetadata(frame, 'characterPositionX')
  const y = numericMetadata(frame, 'characterPositionY')
  const z = numericMetadata(frame, 'characterPositionZ')
  return x === null || y === null || z === null ? null : [x, y, z]
}

function cameraWorldPosition(
  frame: AnimationFrameCaptureFrame,
): [number, number, number] | null {
  const x = numericMetadata(frame, 'cameraPositionX')
  const y = numericMetadata(frame, 'cameraPositionY')
  const z = numericMetadata(frame, 'cameraPositionZ')
  return x === null || y === null || z === null ? null : [x, y, z]
}

function contactDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
  include: (frame: AnimationFrameCaptureFrame) => boolean,
): AnimationFrameGroundContactDiagnostics | null {
  let frameCount = 0
  let maximumSeparationMeters = Number.NEGATIVE_INFINITY
  let maximumSeparationFrame = -1
  let minimumSeparationMeters = Number.POSITIVE_INFINITY
  let minimumSeparationFrame = -1
  for (const frame of frames) {
    if (!include(frame) || !frame.skinnedMeshBounds) continue
    const capsuleBottomY = numericMetadata(frame, 'capsuleBottomY')
    if (capsuleBottomY === null) continue
    const separation =
      frame.skinnedMeshBounds.min[1] - capsuleBottomY
    frameCount++
    if (separation > maximumSeparationMeters) {
      maximumSeparationMeters = separation
      maximumSeparationFrame = frame.index
    }
    if (separation < minimumSeparationMeters) {
      minimumSeparationMeters = separation
      minimumSeparationFrame = frame.index
    }
  }
  return frameCount === 0
    ? null
    : {
        frameCount,
        maximumSeparationMeters,
        maximumSeparationFrame,
        minimumSeparationMeters,
        minimumSeparationFrame,
      }
}

function rollingRootMotionDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
): AnimationFrameRootMotionDiagnostics | null {
  const rollingFrames = frames.filter(
    ({ metadata }) => metadata.locomotionAction === 'Rolling',
  )
  if (rollingFrames.length === 0) return null
  const first = frames[Math.max(0, rollingFrames[0].index - 1)]
  const last = frames[frames.length - 1]
  const startPositionX = numericMetadata(first, 'characterPositionX')
  const startPositionZ = numericMetadata(first, 'characterPositionZ')
  const endPositionX = numericMetadata(last, 'characterPositionX')
  const endPositionZ = numericMetadata(last, 'characterPositionZ')
  const startConsumedX = numericMetadata(first, 'rootMotionConsumedX')
  const startConsumedY = numericMetadata(first, 'rootMotionConsumedY')
  const endConsumedX = numericMetadata(last, 'rootMotionConsumedX')
  const endConsumedY = numericMetadata(last, 'rootMotionConsumedY')
  if (
    startPositionX === null
    || startPositionZ === null
    || endPositionX === null
    || endPositionZ === null
    || startConsumedX === null
    || startConsumedY === null
    || endConsumedX === null
    || endConsumedY === null
  ) {
    return null
  }
  const bodyHorizontalDistanceMeters = Math.hypot(
    endPositionX - startPositionX,
    endPositionZ - startPositionZ,
  )
  const consumedHorizontalDistanceMeters = Math.hypot(
    endConsumedX - startConsumedX,
    endConsumedY - startConsumedY,
  )
  return {
    bodyHorizontalDistanceMeters,
    consumedHorizontalDistanceMeters,
    absoluteDifferenceMeters: Math.abs(
      bodyHorizontalDistanceMeters - consumedHorizontalDistanceMeters,
    ),
  }
}

function createDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
  poses: readonly PoseSnapshot[],
  bones: readonly THREE.Bone[],
): AnimationFrameCaptureDiagnostics {
  const poseDetours = measurePoseDetours(bones, poses)
  return {
    poseDetours,
    groundedContact: contactDiagnostics(
      frames,
      ({ metadata }) => metadata.locomotionMode === 'Grounded',
    ),
    rollingContact: contactDiagnostics(
      frames,
      ({ metadata }) => metadata.locomotionAction === 'Rolling',
    ),
    rollingRootMotion: rollingRootMotionDiagnostics(frames),
    turnInPlace: turnInPlaceDiagnostics(frames, poseDetours),
    transformJitter: {
      rawCharacterPosition: transformJitterVector(frames, rawCharacterPosition),
      renderedRootWorldPosition: transformJitterVector(
        frames,
        (frame) => frame.rootWorldPosition,
      ),
      cameraWorldPosition: transformJitterVector(
        frames,
        cameraWorldPosition,
      ),
    },
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
  readonly root: THREE.Object3D
  readonly bones: readonly THREE.Bone[]
  readonly bonesByName: ReadonlyMap<string, THREE.Bone>
  readonly tracedBones: readonly string[]
  private pending: PendingCapture | null = null

  constructor(
    root: THREE.Object3D,
    tracedBones: readonly string[] = DEFAULT_TRACED_BONES,
  ) {
    this.root = root
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
    const rootWorldPosition = new THREE.Vector3()
    this.root.getWorldPosition(rootWorldPosition)
    pending.poses.push(capturePose(this.bones))
    pending.frames.push({
      index: frameIndex,
      deltaTime: Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0,
      metadata: { ...metadata },
      rootWorldPosition: tupleFromVector3(rootWorldPosition),
      bones: captureTracedBones(
        this.bonesByName,
        this.tracedBones,
      ),
      skinnedMeshBounds: captureSkinnedMeshWorldBounds(
        this.root,
        new Set(this.tracedBones),
      ),
    })
    if (pending.frames.length < pending.frameCount) return true

    const deltas = pending.poses.slice(1).map((pose, index) => ({
      ...maximumDelta(this.bones, pending.poses[index], pose),
      fromFrame: index,
      toFrame: index + 1,
    }))
    const report: AnimationFrameCaptureReport = {
      boneCount: this.bones.length,
      frameCount: pending.frames.length,
      tracedBones: this.tracedBones.filter((name) => (
        this.bonesByName.has(name)
      )),
      frames: pending.frames,
      deltas,
      diagnostics: createDiagnostics(
        pending.frames,
        pending.poses,
        this.bones,
      ),
    }
    this.pending = null
    pending.resolve(report)
    return true
  }

  cancel(reason = 'Animation-frame recorder was removed before capture completed.') {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.reject(new Error(reason))
  }
}
