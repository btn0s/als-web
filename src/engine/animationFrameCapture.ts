import * as THREE from 'three'
import {
  captureSkinnedMeshWorldBounds,
} from './skinnedMeshBounds'
import type {
  SkinnedMeshWorldBounds,
} from './skinnedMeshBounds'

const DEFAULT_FRAME_COUNT = 90
// Four seconds at 120 Hz is long enough to compare several authored locomotion loops while
// keeping the retained pose/frame buffers bounded.
const MAX_FRAME_COUNT = 480
const DEFAULT_TRACED_BONES = [
  'root',
  'head',
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
  /** ALS camera's rendered root/head midpoint, when both bones are available. */
  readonly cameraPivotWorldPosition: readonly [number, number, number] | null
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
  /** Root-relative elapsed capture time and the edge duration used to reach this frame. */
  readonly peakWindow: readonly AnimationFrameTransformJitterSample[]
  readonly rmsMagnitude: number
  readonly dominantAxis: 'X' | 'Y' | 'Z'
  readonly signedResidualMinimum: readonly [number, number, number]
  readonly signedResidualMaximum: readonly [number, number, number]
  /**
   * Mean-centered Pearson autocorrelation of signed dominant-axis residuals. Lags begin at two
   * samples (never the misleading adjacent-frame trend), use at least three pairs, and search
   * through half the bounded capture. `null` means a constant or insufficient series.
   */
  readonly autocorrelationPeak: AnimationFrameTransformJitterAutocorrelation | null
  readonly loopPhase: AnimationFrameLoopPhaseDiagnostics | null
}

export interface AnimationFrameTransformJitterSample {
  readonly frame: number
  readonly elapsedSeconds: number
  readonly deltaTime: number
  readonly residual: readonly [number, number, number]
  readonly magnitude: number
  readonly cameraTraceDistanceRatio: number | null
  readonly speed: number | null
  readonly gait: string | null
  readonly moving: boolean | null
  readonly locomotionMode: string | null
  /** Fixed physics update published with this rendered sample, when available. */
  readonly physicsStepIndex: number | null
  readonly physicsStepsFromPreviousFrame: number | null
  readonly physicsStepsToNextFrame: number | null
  /** Highest-weight sampled locomotion loop phase, if capture metadata exposed one. */
  readonly loop: AnimationFrameLoopPhase | null
}

export interface AnimationFrameLoopPhase {
  readonly clip: string
  readonly phase: number
  readonly weight: number
}

export interface AnimationFrameLoopPhaseBin {
  readonly phaseStart: number
  readonly phaseEnd: number
  readonly signedResidualMean: number | null
  readonly sampleCount: number
}

export interface AnimationFrameLoopPhaseDiagnostics {
  readonly clip: string
  readonly contiguousSampleCount: number
  readonly completeCycleCount: number
  readonly observedMedianLoopPeriodSeconds: number | null
  readonly meanWeight: number
  readonly minimumWeight: number
  readonly matchedPhaseBinCount: number
  readonly phaseBins: readonly AnimationFrameLoopPhaseBin[]
  /** Pearson correlation between adjacent inferred cycles at the same phase bins. */
  readonly cycleToCycleCorrelation: number | null
}

export interface AnimationFrameTransformJitterAutocorrelation {
  readonly lagFrames: number
  readonly periodSeconds: number
  readonly coefficient: number
  readonly pairCount: number
}

export interface AnimationFrameCadenceDiagnostics {
  readonly frameCount: number
  readonly durationSeconds: number
  readonly minimumDeltaTime: number
  readonly medianDeltaTime: number
  readonly medianFramesPerSecond: number
  readonly maximumDeltaTime: number
  /** Descriptive only: the capture's longest render edge is not automatically a hitch. */
  readonly maximumDeltaTimeFrame: number
}

export interface AnimationFramePhysicsCadenceDiagnostics {
  readonly fixedTimeStepSeconds: number | null
  readonly edgeCount: number
  readonly totalStepCount: number
  readonly minimumStepsPerRenderEdge: number
  readonly medianStepsPerRenderEdge: number
  readonly maximumStepsPerRenderEdge: number
  readonly maximumStepsFrame: number
  readonly zeroStepEdgeCount: number
  readonly singleStepEdgeCount: number
  readonly multipleStepEdgeCount: number
  readonly resetEdgeCount: number
}

export interface AnimationFrameTransformJitterDiagnostics {
  readonly rawCharacterPosition: AnimationFrameTransformJitterVector | null
  readonly renderedRootWorldPosition: AnimationFrameTransformJitterVector | null
  readonly cameraWorldPosition: AnimationFrameTransformJitterVector | null
  readonly cameraPivotWorldPosition: AnimationFrameTransformJitterVector | null
  readonly cameraPivotTargetPosition: AnimationFrameTransformJitterVector | null
  readonly cameraPivotLagPosition: AnimationFrameTransformJitterVector | null
  readonly cameraPivotPosition: AnimationFrameTransformJitterVector | null
  readonly cameraComponentPosition: AnimationFrameTransformJitterVector | null
  readonly frameCadence: AnimationFrameCadenceDiagnostics | null
  readonly physicsCadence: AnimationFramePhysicsCadenceDiagnostics | null
}

export interface AnimationFrameTransformJitterPathSummary {
  readonly peakResidualMillimeters: readonly [number, number, number]
  readonly peakMagnitudeMillimeters: number
  readonly rmsMagnitudeMillimeters: number
  readonly peakFrame: number
  readonly dominantAxis: 'X' | 'Y' | 'Z'
  /** Descriptive candidate only; loop attribution comes from `loopPhase`. */
  readonly autocorrelationPeak: AnimationFrameTransformJitterAutocorrelation | null
  readonly loopPhase: {
    readonly clip: string
    readonly contiguousSampleCount: number
    readonly completeCycleCount: number
    readonly observedMedianLoopPeriodSeconds: number | null
    readonly meanWeight: number
    readonly minimumWeight: number
    readonly matchedPhaseBinCount: number
    readonly cycleToCycleCorrelation: number | null
    readonly signedResidualMeanMillimetersByPhaseBin:
      readonly (number | null)[]
    readonly sampleCountByPhaseBin: readonly number[]
  } | null
}

export interface AnimationFrameTransformJitterSummary {
  readonly frameCadence: AnimationFrameCadenceDiagnostics | null
  readonly physicsCadence: AnimationFramePhysicsCadenceDiagnostics | null
  readonly paths: {
    readonly rawCharacterPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly renderedRootWorldPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly cameraPivotWorldPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly cameraPivotTargetPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly cameraPivotLagPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly cameraPivotPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly cameraComponentPosition:
      AnimationFrameTransformJitterPathSummary | null
    readonly cameraWorldPosition:
      AnimationFrameTransformJitterPathSummary | null
  }
}

export interface AnimationFrameCaptureDiagnostics {
  readonly poseDetours: readonly AnimationFramePoseDetour[]
  readonly groundedContact: AnimationFrameGroundContactDiagnostics | null
  readonly rollingContact: AnimationFrameGroundContactDiagnostics | null
  readonly rollingRootMotion: AnimationFrameRootMotionDiagnostics | null
  readonly turnInPlace: AnimationFrameTurnInPlaceDiagnostics | null
  readonly transformJitter: AnimationFrameTransformJitterDiagnostics
  /** Token-efficient first read; full peak windows remain in `transformJitter`. */
  readonly transformJitterSummary: AnimationFrameTransformJitterSummary
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

function captureCameraPivotWorldPosition(
  bonesByName: ReadonlyMap<string, THREE.Bone>,
): [number, number, number] | null {
  const root = bonesByName.get('root')
  const head = bonesByName.get('head')
  if (!root || !head) return null
  const rootPosition = new THREE.Vector3()
  const headPosition = new THREE.Vector3()
  root.getWorldPosition(rootPosition)
  head.getWorldPosition(headPosition)
  return tupleFromVector3(rootPosition.add(headPosition).multiplyScalar(0.5))
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

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle]
}

function elapsedCaptureSeconds(frames: readonly AnimationFrameCaptureFrame[]) {
  const elapsed = new Float64Array(frames.length)
  for (let index = 1; index < frames.length; index++) {
    elapsed[index] = elapsed[index - 1] + frames[index].deltaTime
  }
  return elapsed
}

function sampledLoopPhase(
  frame: AnimationFrameCaptureFrame,
): AnimationFrameLoopPhase | null {
  let result: AnimationFrameLoopPhase | null = null
  for (const [name, value] of Object.entries(frame.metadata)) {
    if (
      !name.startsWith('clipPhase.')
      || typeof value !== 'number'
      || !Number.isFinite(value)
    ) {
      continue
    }
    const clip = name.slice('clipPhase.'.length)
    const weight =
      numericMetadata(frame, clip)
      ?? numericMetadata(frame, `InAirPlayer.${clip}`)
    if (
      weight === null
      || weight <= 0
      || (result && weight <= result.weight)
    ) {
      continue
    }
    result = { clip, phase: value, weight }
  }
  return result
}

function transformJitterSamples(
  frames: readonly AnimationFrameCaptureFrame[],
  position: (
    frame: AnimationFrameCaptureFrame
  ) => readonly [number, number, number] | null,
): AnimationFrameTransformJitterSample[] {
  const elapsed = elapsedCaptureSeconds(frames)
  const samples: AnimationFrameTransformJitterSample[] = []
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
      currentPosition[0] - (
        previousPosition[0]
        + (nextPosition[0] - previousPosition[0]) * alpha
      ),
      currentPosition[1] - (
        previousPosition[1]
        + (nextPosition[1] - previousPosition[1]) * alpha
      ),
      currentPosition[2] - (
        previousPosition[2]
        + (nextPosition[2] - previousPosition[2]) * alpha
      ),
    ]
    const magnitude = Math.hypot(...residual)
    const previousPhysicsStep = numericMetadata(previous, 'physicsStepIndex')
    const currentPhysicsStep = numericMetadata(current, 'physicsStepIndex')
    const nextPhysicsStep = numericMetadata(next, 'physicsStepIndex')
    samples.push({
      frame: current.index,
      elapsedSeconds: elapsed[index],
      deltaTime: current.deltaTime,
      residual,
      magnitude,
      loop: sampledLoopPhase(current),
      cameraTraceDistanceRatio: numericMetadata(
        current,
        'cameraTraceDistanceRatio',
      ),
      speed: numericMetadata(current, 'speed'),
      gait: typeof current.metadata.gait === 'string' ? current.metadata.gait : null,
      moving: typeof current.metadata.moving === 'boolean' ? current.metadata.moving : null,
      locomotionMode: typeof current.metadata.locomotionMode === 'string'
        ? current.metadata.locomotionMode
        : null,
      physicsStepIndex: currentPhysicsStep,
      physicsStepsFromPreviousFrame:
        previousPhysicsStep === null || currentPhysicsStep === null
          ? null
          : currentPhysicsStep - previousPhysicsStep,
      physicsStepsToNextFrame:
        currentPhysicsStep === null || nextPhysicsStep === null
          ? null
          : nextPhysicsStep - currentPhysicsStep,
    })
  }
  return samples
}

function pearsonCorrelation(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (left.length < 2 || left.length !== right.length) return null
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let numerator = 0
  let leftEnergy = 0
  let rightEnergy = 0
  for (let index = 0; index < left.length; index++) {
    const centeredLeft = left[index] - leftMean
    const centeredRight = right[index] - rightMean
    numerator += centeredLeft * centeredRight
    leftEnergy += centeredLeft * centeredLeft
    rightEnergy += centeredRight * centeredRight
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy)
  return denominator === 0 ? null : numerator / denominator
}

function loopWrapIndices(
  run: readonly AnimationFrameTransformJitterSample[],
) {
  const wraps: number[] = []
  for (let index = 1; index < run.length; index++) {
    if (run[index].loop!.phase % 1 < run[index - 1].loop!.phase % 1) {
      wraps.push(index)
    }
  }
  return wraps
}

function completeLoopCycles(
  run: readonly AnimationFrameTransformJitterSample[],
  wraps: readonly number[],
) {
  return wraps.slice(0, -1).map(
    (start, index) => run.slice(start, wraps[index + 1]),
  )
}

function loopPhaseDiagnostics(
  samples: readonly AnimationFrameTransformJitterSample[],
  axis: 0 | 1 | 2,
): AnimationFrameLoopPhaseDiagnostics | null {
  interface LoopRunCandidate {
    readonly clip: string
    readonly start: number
    readonly samples: readonly AnimationFrameTransformJitterSample[]
    readonly wraps: readonly number[]
    readonly completeCycles:
      readonly (readonly AnimationFrameTransformJitterSample[])[]
    readonly meanWeight: number
  }

  const candidates: LoopRunCandidate[] = []
  let start = 0
  while (start < samples.length) {
    const loop = samples[start].loop
    if (!loop) {
      start++
      continue
    }
    let end = start + 1
    while (end < samples.length && samples[end].loop?.clip === loop.clip) end++
    const run = samples.slice(start, end)
    const wraps = loopWrapIndices(run)
    const completeCycles = completeLoopCycles(run, wraps)
    candidates.push({
      clip: loop.clip,
      start,
      samples: run,
      wraps,
      completeCycles,
      meanWeight:
        run.reduce((sum, sample) => sum + sample.loop!.weight, 0)
        / run.length,
    })
    start = end
  }
  if (candidates.length === 0) return null

  // A full wrap-to-wrap interval is evidence of a real loop; a longer one-shot landing or
  // transition run is only a fallback when no observed candidate completed a cycle. Remaining
  // ties are deliberately deterministic so the report never changes due to metadata ordering.
  candidates.sort((left, right) => (
    right.completeCycles.length - left.completeCycles.length
    || right.samples.length - left.samples.length
    || right.meanWeight - left.meanWeight
    || (left.clip < right.clip ? -1 : left.clip > right.clip ? 1 : 0)
    || left.start - right.start
  ))
  const selected = candidates[0]
  const run = selected.samples
  const wraps = selected.wraps
  const completeCycles = selected.completeCycles
  const binCount = 8
  const bins = Array.from({ length: binCount }, () => [] as number[])
  const cycles = completeCycles.map(() => ({
    sums: Array.from({ length: binCount }, () => 0),
    counts: Array.from({ length: binCount }, () => 0),
  }))
  for (
    let cycleIndex = 0;
    cycleIndex < completeCycles.length;
    cycleIndex++
  ) {
    for (const sample of completeCycles[cycleIndex]) {
      const phase = sample.loop!.phase - Math.floor(sample.loop!.phase)
      const bin = Math.min(binCount - 1, Math.floor(phase * binCount))
      bins[bin].push(sample.residual[axis])
      cycles[cycleIndex].sums[bin] += sample.residual[axis]
      cycles[cycleIndex].counts[bin]++
    }
  }
  const adjacentLeft: number[] = []
  const adjacentRight: number[] = []
  for (let cycle = 1; cycle < cycles.length; cycle++) {
    for (let bin = 0; bin < binCount; bin++) {
      const previous = cycles[cycle - 1]
      const current = cycles[cycle]
      if (previous.counts[bin] > 0 && current.counts[bin] > 0) {
        adjacentLeft.push(previous.sums[bin] / previous.counts[bin])
        adjacentRight.push(current.sums[bin] / current.counts[bin])
      }
    }
  }
  const matchedPhaseBinCount = adjacentLeft.length
  const wrapPeriods = wraps.slice(1).map((wrap, index) => (
    run[wrap].elapsedSeconds - run[wraps[index]].elapsedSeconds
  ))
  const weights = run.map((sample) => sample.loop!.weight)
  return {
    clip: selected.clip,
    contiguousSampleCount: run.length,
    completeCycleCount: completeCycles.length,
    observedMedianLoopPeriodSeconds:
      wrapPeriods.length === 0 ? null : median(wrapPeriods),
    meanWeight:
      weights.reduce((sum, weight) => sum + weight, 0) / weights.length,
    minimumWeight: Math.min(...weights),
    matchedPhaseBinCount,
    phaseBins: bins.map((values, bin) => ({
      phaseStart: bin / binCount,
      phaseEnd: (bin + 1) / binCount,
      signedResidualMean: values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length,
      sampleCount: values.length,
    })),
    cycleToCycleCorrelation:
      completeCycles.length >= 2 && matchedPhaseBinCount >= 3
        ? pearsonCorrelation(adjacentLeft, adjacentRight)
        : null,
  }
}

function jitterAutocorrelationPeak(
  samples: readonly AnimationFrameTransformJitterSample[],
  axis: 0 | 1 | 2,
): AnimationFrameTransformJitterAutocorrelation | null {
  // Lag one is intentionally excluded: a monotonic transient can look highly related without
  // being a repeating pattern. Mean-centering removes constant offsets.
  const values = samples.map((sample) => sample.residual[axis])
  if (values.length < 5) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const maximumLag = Math.floor(values.length / 2)
  let best: AnimationFrameTransformJitterAutocorrelation | null = null
  for (let lag = 2; lag <= maximumLag; lag++) {
    const pairCount = values.length - lag
    if (pairCount < 3) continue
    let numerator = 0
    let leftEnergy = 0
    let rightEnergy = 0
    const periods: number[] = []
    for (let index = 0; index < pairCount; index++) {
      const left = values[index] - mean
      const right = values[index + lag] - mean
      numerator += left * right
      leftEnergy += left * left
      rightEnergy += right * right
      periods.push(samples[index + lag].elapsedSeconds - samples[index].elapsedSeconds)
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy)
    if (denominator === 0) continue
    const coefficient = numerator / denominator
    if (!best || coefficient > best.coefficient) {
      best = {
        lagFrames: lag,
        periodSeconds: median(periods),
        coefficient,
        pairCount,
      }
    }
  }
  return best
}

function transformJitterVector(
  frames: readonly AnimationFrameCaptureFrame[],
  position: (
    frame: AnimationFrameCaptureFrame
  ) => readonly [number, number, number] | null,
): AnimationFrameTransformJitterVector | null {
  const samples = transformJitterSamples(frames, position)
  if (samples.length === 0) return null
  let maximum = samples[0]
  const minimum: [number, number, number] = [...samples[0].residual]
  const maximumSigned: [number, number, number] = [...samples[0].residual]
  const axisSquares: [number, number, number] = [0, 0, 0]
  let magnitudeSquares = 0
  for (const sample of samples) {
    if (sample.magnitude > maximum.magnitude) maximum = sample
    magnitudeSquares += sample.magnitude * sample.magnitude
    for (let axis = 0 as 0 | 1 | 2; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], sample.residual[axis])
      maximumSigned[axis] = Math.max(maximumSigned[axis], sample.residual[axis])
      axisSquares[axis] += sample.residual[axis] * sample.residual[axis]
    }
  }
  const dominantAxisIndex = axisSquares[1] > axisSquares[0]
    ? axisSquares[2] > axisSquares[1] ? 2 : 1
    : axisSquares[2] > axisSquares[0] ? 2 : 0
  const peakIndex = samples.indexOf(maximum)
  return {
    residual: maximum.residual,
    magnitude: maximum.magnitude,
    frame: maximum.frame,
    peakWindow: samples.slice(
      Math.max(0, peakIndex - 2),
      Math.min(samples.length, peakIndex + 3),
    ),
    rmsMagnitude: Math.sqrt(magnitudeSquares / samples.length),
    dominantAxis: (['X', 'Y', 'Z'] as const)[dominantAxisIndex],
    signedResidualMinimum: minimum,
    signedResidualMaximum: maximumSigned,
    autocorrelationPeak: jitterAutocorrelationPeak(samples, dominantAxisIndex),
    loopPhase: loopPhaseDiagnostics(samples, dominantAxisIndex),
  }
}

function frameCadenceDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
): AnimationFrameCadenceDiagnostics | null {
  const samples = frames.slice(1).filter((frame) => frame.deltaTime > 0)
  if (samples.length === 0) return null
  let longestEdge = samples[0]
  for (const frame of samples) {
    if (frame.deltaTime > longestEdge.deltaTime) longestEdge = frame
  }
  const deltas = samples.map((frame) => frame.deltaTime)
  const medianDeltaTime = median(deltas)
  return {
    frameCount: samples.length,
    durationSeconds: deltas.reduce((sum, deltaTime) => sum + deltaTime, 0),
    minimumDeltaTime: Math.min(...deltas),
    medianDeltaTime,
    medianFramesPerSecond: 1 / medianDeltaTime,
    maximumDeltaTime: longestEdge.deltaTime,
    maximumDeltaTimeFrame: longestEdge.index,
  }
}

function physicsCadenceDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
): AnimationFramePhysicsCadenceDiagnostics | null {
  const steps: Array<{ frame: number; count: number }> = []
  let resetEdgeCount = 0
  for (let index = 1; index < frames.length; index++) {
    const previous = numericMetadata(frames[index - 1], 'physicsStepIndex')
    const current = numericMetadata(frames[index], 'physicsStepIndex')
    if (previous === null || current === null) continue
    const count = current - previous
    if (count < 0) {
      resetEdgeCount++
      continue
    }
    steps.push({ frame: frames[index].index, count })
  }
  if (steps.length === 0) return null
  let maximum = steps[0]
  for (const step of steps) {
    if (step.count > maximum.count) maximum = step
  }
  const counts = steps.map(({ count }) => count)
  const fixedTimeSteps = frames
    .map((frame) => numericMetadata(frame, 'physicsTimeStep'))
    .filter((value): value is number => value !== null && value > 0)
  return {
    fixedTimeStepSeconds:
      fixedTimeSteps.length === 0 ? null : median(fixedTimeSteps),
    edgeCount: counts.length,
    totalStepCount: counts.reduce((sum, count) => sum + count, 0),
    minimumStepsPerRenderEdge: Math.min(...counts),
    medianStepsPerRenderEdge: median(counts),
    maximumStepsPerRenderEdge: maximum.count,
    maximumStepsFrame: maximum.frame,
    zeroStepEdgeCount: counts.filter((count) => count === 0).length,
    singleStepEdgeCount: counts.filter((count) => count === 1).length,
    multipleStepEdgeCount: counts.filter((count) => count > 1).length,
    resetEdgeCount,
  }
}

function rawCharacterPosition(
  frame: AnimationFrameCaptureFrame,
): [number, number, number] | null {
  const x = numericMetadata(frame, 'characterPositionX')
  const y = numericMetadata(frame, 'characterPositionY')
  const z = numericMetadata(frame, 'characterPositionZ')
  return x === null || y === null || z === null ? null : [x, y, z]
}

function metadataPosition(
  prefix: string,
): (frame: AnimationFrameCaptureFrame) => [number, number, number] | null {
  return (frame) => {
    const x = numericMetadata(frame, `${prefix}X`)
    const y = numericMetadata(frame, `${prefix}Y`)
    const z = numericMetadata(frame, `${prefix}Z`)
    return x === null || y === null || z === null ? null : [x, y, z]
  }
}

const cameraWorldPosition = metadataPosition('cameraPosition')
const cameraPivotTargetPosition = metadataPosition('cameraPivotTargetPosition')
const cameraPivotLagPosition = metadataPosition('cameraPivotLagPosition')
const cameraPivotPosition = metadataPosition('cameraPivotPosition')
const cameraComponentPosition = metadataPosition('cameraComponentPosition')

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

function transformJitterDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
): AnimationFrameTransformJitterDiagnostics {
  return {
    rawCharacterPosition: transformJitterVector(frames, rawCharacterPosition),
    renderedRootWorldPosition: transformJitterVector(
      frames,
      (frame) => frame.rootWorldPosition,
    ),
    cameraWorldPosition: transformJitterVector(
      frames,
      cameraWorldPosition,
    ),
    cameraPivotWorldPosition: transformJitterVector(
      frames,
      (frame) => frame.cameraPivotWorldPosition,
    ),
    cameraPivotTargetPosition: transformJitterVector(
      frames,
      cameraPivotTargetPosition,
    ),
    cameraPivotLagPosition: transformJitterVector(
      frames,
      cameraPivotLagPosition,
    ),
    cameraPivotPosition: transformJitterVector(frames, cameraPivotPosition),
    cameraComponentPosition: transformJitterVector(
      frames,
      cameraComponentPosition,
    ),
    frameCadence: frameCadenceDiagnostics(frames),
    physicsCadence: physicsCadenceDiagnostics(frames),
  }
}

function transformJitterPathSummary(
  diagnostics: AnimationFrameTransformJitterVector | null,
): AnimationFrameTransformJitterPathSummary | null {
  if (!diagnostics) return null
  const loop = diagnostics.loopPhase
  return {
    peakResidualMillimeters: diagnostics.residual.map(
      (value) => value * 1_000,
    ) as [number, number, number],
    peakMagnitudeMillimeters: diagnostics.magnitude * 1_000,
    rmsMagnitudeMillimeters: diagnostics.rmsMagnitude * 1_000,
    peakFrame: diagnostics.frame,
    dominantAxis: diagnostics.dominantAxis,
    autocorrelationPeak: diagnostics.autocorrelationPeak,
    loopPhase: loop
      ? {
          clip: loop.clip,
          contiguousSampleCount: loop.contiguousSampleCount,
          completeCycleCount: loop.completeCycleCount,
          observedMedianLoopPeriodSeconds:
            loop.observedMedianLoopPeriodSeconds,
          meanWeight: loop.meanWeight,
          minimumWeight: loop.minimumWeight,
          matchedPhaseBinCount: loop.matchedPhaseBinCount,
          cycleToCycleCorrelation: loop.cycleToCycleCorrelation,
          signedResidualMeanMillimetersByPhaseBin: loop.phaseBins.map(
            ({ signedResidualMean }) => (
              signedResidualMean === null
                ? null
                : signedResidualMean * 1_000
            ),
          ),
          sampleCountByPhaseBin: loop.phaseBins.map(
            ({ sampleCount }) => sampleCount,
          ),
        }
      : null,
  }
}

function transformJitterSummary(
  diagnostics: AnimationFrameTransformJitterDiagnostics,
): AnimationFrameTransformJitterSummary {
  return {
    frameCadence: diagnostics.frameCadence,
    physicsCadence: diagnostics.physicsCadence,
    paths: {
      rawCharacterPosition:
        transformJitterPathSummary(diagnostics.rawCharacterPosition),
      renderedRootWorldPosition:
        transformJitterPathSummary(diagnostics.renderedRootWorldPosition),
      cameraPivotWorldPosition:
        transformJitterPathSummary(diagnostics.cameraPivotWorldPosition),
      cameraPivotTargetPosition:
        transformJitterPathSummary(diagnostics.cameraPivotTargetPosition),
      cameraPivotLagPosition:
        transformJitterPathSummary(diagnostics.cameraPivotLagPosition),
      cameraPivotPosition:
        transformJitterPathSummary(diagnostics.cameraPivotPosition),
      cameraComponentPosition:
        transformJitterPathSummary(diagnostics.cameraComponentPosition),
      cameraWorldPosition:
        transformJitterPathSummary(diagnostics.cameraWorldPosition),
    },
  }
}

function createDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
  poses: readonly PoseSnapshot[],
  bones: readonly THREE.Bone[],
): AnimationFrameCaptureDiagnostics {
  const poseDetours = measurePoseDetours(bones, poses)
  const transformJitter = transformJitterDiagnostics(frames)
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
    transformJitter,
    transformJitterSummary: transformJitterSummary(transformJitter),
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
      cameraPivotWorldPosition: captureCameraPivotWorldPosition(
        this.bonesByName,
      ),
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
