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
const CHARACTER_JITTER_LANDMARKS = [
  'root',
  'pelvis',
  'head',
  'foot_l',
  'foot_r',
  'hand_l',
  'hand_r',
] as const
const CONTROL_RIG_JITTER_LANDMARKS = [
  'root',
  'pelvis',
  'head',
  'foot_l',
  'foot_r',
] as const

export interface AnimationFrameCaptureMetadata {
  readonly [name: string]: number | string | boolean
}

export interface AnimationFrameCapturePresentation {
  readonly camera: THREE.Camera
  readonly getDrawingBufferSize: (out: THREE.Vector2) => THREE.Vector2
}

export interface AnimationFrameBoneTrace {
  readonly localPosition: readonly [number, number, number]
  readonly localRotation: readonly [number, number, number, number]
  readonly localScale: readonly [number, number, number]
  readonly componentPosition: readonly [number, number, number]
  readonly worldPosition: readonly [number, number, number]
  readonly viewPosition: readonly [number, number, number] | null
  readonly screenPositionPixels: readonly [number, number, number] | null
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
  readonly skinViewCentroid: readonly [number, number, number] | null
  readonly skinScreenCentroidPixels:
    readonly [number, number, number] | null
  readonly drawingBufferSizePixels: readonly [number, number] | null
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
  readonly physicsCadenceCoupling:
    AnimationFramePhysicsCadenceCoupling | null
}

export interface AnimationFramePhysicsCadenceCoupling {
  readonly edge: 'FromPreviousFrame' | 'ToNextFrame'
  readonly mode: 'TangentialResidual' | 'ResidualMagnitude'
  readonly correlation: number
  readonly sampleCount: number
  readonly zeroStepSampleCount: number
  readonly oneStepSampleCount: number
  readonly zeroStepSignalMean: number
  readonly oneStepSignalMean: number
  /** Half the zero-step to one-step mean separation, in the path's native unit. */
  readonly amplitude: number
}

export interface AnimationFrameTransformJitterSample {
  readonly frame: number
  readonly elapsedSeconds: number
  readonly deltaTime: number
  readonly residual: readonly [number, number, number]
  readonly magnitude: number
  /** Signed residual projected onto the previous-to-next path chord. */
  readonly tangentialResidual: number | null
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
  readonly skinWorldCentroid: AnimationFrameTransformJitterVector | null
  readonly skinViewCentroid: AnimationFrameTransformJitterVector | null
  readonly skinScreenCentroidPixels:
    AnimationFrameTransformJitterVector | null
  readonly bonePositions: Readonly<Record<
    string,
    AnimationFrameBonePositionJitterDiagnostics
  >>
  readonly frameCadence: AnimationFrameCadenceDiagnostics | null
  readonly physicsCadence: AnimationFramePhysicsCadenceDiagnostics | null
}

export interface AnimationFrameBonePositionJitterDiagnostics {
  readonly component: AnimationFrameTransformJitterVector | null
  readonly world: AnimationFrameTransformJitterVector | null
  readonly view: AnimationFrameTransformJitterVector | null
  readonly screenPixels: AnimationFrameTransformJitterVector | null
}

export interface AnimationFramePhysicsCadenceCouplingMillimeters {
  readonly edge: AnimationFramePhysicsCadenceCoupling['edge']
  readonly mode: AnimationFramePhysicsCadenceCoupling['mode']
  readonly correlation: number
  readonly sampleCount: number
  readonly zeroStepSampleCount: number
  readonly oneStepSampleCount: number
  readonly zeroStepSignalMeanMillimeters: number
  readonly oneStepSignalMeanMillimeters: number
  readonly amplitudeMillimeters: number
}

export interface AnimationFrameTransformJitterPathSummary {
  readonly peakResidualMillimeters: readonly [number, number, number]
  readonly peakMagnitudeMillimeters: number
  readonly rmsMagnitudeMillimeters: number
  readonly peakFrame: number
  readonly dominantAxis: 'X' | 'Y' | 'Z'
  readonly physicsCadenceCoupling:
    AnimationFramePhysicsCadenceCouplingMillimeters | null
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

export interface AnimationFrameCompactJitterSummary {
  readonly unit: 'Millimeters' | 'Pixels' | 'Scalar'
  readonly peakResidual: readonly [number, number, number]
  readonly peakMagnitude: number
  readonly rmsMagnitude: number
  readonly peakFrame: number
  readonly dominantAxis: 'X' | 'Y' | 'Z'
  readonly physicsCadenceAmplitude: number | null
  readonly physicsCadenceCorrelation: number | null
  readonly physicsCadenceMode:
    AnimationFramePhysicsCadenceCoupling['mode'] | null
  readonly physicsCadenceEdge:
    AnimationFramePhysicsCadenceCoupling['edge'] | null
  readonly physicsCadenceSampleCount: number | null
  readonly loopPhase: {
    readonly clip: string
    readonly observedMedianLoopPeriodSeconds: number | null
    readonly cycleToCycleCorrelation: number | null
  } | null
}

export interface AnimationFrameCharacterLandmarkJitterSummary {
  readonly bone: string
  readonly componentRmsMillimeters: number | null
  readonly componentPhysicsCadenceAmplitudeMillimeters: number | null
  readonly componentPhysicsCadenceCorrelation: number | null
  readonly worldRmsMillimeters: number | null
  readonly worldPhysicsCadenceAmplitudeMillimeters: number | null
  readonly worldPhysicsCadenceCorrelation: number | null
  readonly viewRmsMillimeters: number | null
  readonly viewPhysicsCadenceAmplitudeMillimeters: number | null
  readonly viewPhysicsCadenceCorrelation: number | null
  readonly screenRmsPixels: number | null
  readonly screenPhysicsCadenceAmplitudePixels: number | null
  readonly screenPhysicsCadenceCorrelation: number | null
}

export interface AnimationFrameControlRigJitterSummary {
  readonly executedFrameCount: number
  readonly pelvisOffset: AnimationFrameCompactJitterSummary | null
  readonly footLeftTraceOffset: AnimationFrameCompactJitterSummary | null
  readonly footRightTraceOffset: AnimationFrameCompactJitterSummary | null
  readonly footLeftAppliedOffset: AnimationFrameCompactJitterSummary | null
  readonly footRightAppliedOffset: AnimationFrameCompactJitterSummary | null
  readonly footLeftIkWeight: AnimationFrameCompactJitterSummary | null
  readonly footRightIkWeight: AnimationFrameCompactJitterSummary | null
  readonly footLeftTraceHitRate: number | null
  readonly footRightTraceHitRate: number | null
  readonly footLeftTraceHitTransitionCount: number
  readonly footRightTraceHitTransitionCount: number
  /**
   * Pre-solve positions, post-solve positions, and the positional delta authored by CR_Als.
   * Final local-rotation diagnostics remain separate because these five landmarks do not
   * attribute a pure Control Rig rotation across the Forward Solve boundary.
   */
  readonly stageLandmarks:
    readonly AnimationFrameControlRigStageJitterSummary[]
}

export interface AnimationFrameControlRigStageJitterSummary {
  readonly bone: string
  readonly preRmsMillimeters: number | null
  readonly prePhysicsCadenceAmplitudeMillimeters: number | null
  readonly prePhysicsCadenceCorrelation: number | null
  readonly postRmsMillimeters: number | null
  readonly postPhysicsCadenceAmplitudeMillimeters: number | null
  readonly postPhysicsCadenceCorrelation: number | null
  readonly solveDeltaRmsMillimeters: number | null
  readonly solveDeltaPhysicsCadenceAmplitudeMillimeters: number | null
  readonly solveDeltaPhysicsCadenceCorrelation: number | null
}

export interface AnimationFrameCharacterJitterSummary {
  readonly drawingBufferSizePixels: readonly [number, number] | null
  readonly skin: {
    readonly world: AnimationFrameCompactJitterSummary | null
    readonly view: AnimationFrameCompactJitterSummary | null
    readonly screen: AnimationFrameCompactJitterSummary | null
  }
  readonly controlRig: AnimationFrameControlRigJitterSummary
  /** Highest screen-space fixed-step amplitude first; all seven stable landmarks are retained. */
  readonly landmarks: readonly AnimationFrameCharacterLandmarkJitterSummary[]
  /** Strongest physics-cadence local rotations; origins can remain still while these visibly step. */
  readonly localRotations: readonly AnimationFrameLocalRotationJitterSummary[]
}

export interface AnimationFrameLocalRotationJitterSummary {
  readonly bone: string
  readonly peakDegrees: number
  readonly rmsDegrees: number
  readonly peakFrame: number
  readonly physicsCadenceCorrelation: number | null
  readonly physicsCadenceAmplitudeDegrees: number | null
  readonly physicsCadenceMode:
    AnimationFramePhysicsCadenceCoupling['mode'] | null
  readonly physicsCadenceEdge:
    AnimationFramePhysicsCadenceCoupling['edge'] | null
  readonly physicsCadenceSampleCount: number | null
  readonly loopClip: string | null
  readonly loopPeriodSeconds: number | null
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
  readonly character: AnimationFrameCharacterJitterSummary
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

function findCharacterObjects(root: THREE.Object3D) {
  const skinnedMeshes: THREE.SkinnedMesh[] = []
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinnedMeshes.push(object)
  })
  const primaryMesh = skinnedMeshes.reduce<THREE.SkinnedMesh | null>(
    (selected, mesh) => (
      !selected
      || mesh.skeleton.bones.length > selected.skeleton.bones.length
        ? mesh
        : selected
    ),
    null,
  )
  const primaryBones = primaryMesh
    ? new Set(primaryMesh.skeleton.bones)
    : null
  const characterMeshes = primaryBones
    ? new Set(skinnedMeshes.filter((mesh) => (
        mesh.skeleton.bones.some((bone) => primaryBones.has(bone))
      )))
    : new Set<THREE.SkinnedMesh>()
  const bones: THREE.Bone[] = []
  const names = new Set<string>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    if (primaryBones && !primaryBones.has(object)) {
      if (object.userData.alsVirtualBone !== true) return
      let ancestor = object.parent
      while (ancestor && !primaryBones.has(ancestor as THREE.Bone)) {
        ancestor = ancestor.parent
      }
      if (!ancestor) return
    }
    if (names.has(object.name)) {
      throw new Error(
        `Animation-frame capture found duplicate bone "${object.name}"`,
      )
    }
    names.add(object.name)
    bones.push(object)
  })
  return { bones, skinnedMeshes: characterMeshes }
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

function screenPositionPixels(
  worldPosition: THREE.Vector3,
  camera: THREE.Camera,
  drawingBufferSize: THREE.Vector2,
  out: THREE.Vector3,
) {
  out.copy(worldPosition).project(camera)
  out.x = (out.x * 0.5 + 0.5) * drawingBufferSize.x
  out.y = (-out.y * 0.5 + 0.5) * drawingBufferSize.y
  out.z = 0
  return out
}

function captureTracedBones(
  bonesByName: ReadonlyMap<string, THREE.Bone>,
  tracedBones: readonly string[],
  componentWorldInverse: THREE.Matrix4,
  presentation: AnimationFrameCapturePresentation | null,
  drawingBufferSize: THREE.Vector2,
) {
  const result: Record<string, AnimationFrameBoneTrace> = {}
  const worldPosition = new THREE.Vector3()
  const componentPosition = new THREE.Vector3()
  const viewPosition = new THREE.Vector3()
  const screenPosition = new THREE.Vector3()
  for (const name of tracedBones) {
    const bone = bonesByName.get(name)
    if (!bone) continue
    bone.getWorldPosition(worldPosition)
    componentPosition.copy(worldPosition).applyMatrix4(
      componentWorldInverse,
    )
    if (presentation) {
      viewPosition.copy(worldPosition).applyMatrix4(
        presentation.camera.matrixWorldInverse,
      )
      screenPositionPixels(
        worldPosition,
        presentation.camera,
        drawingBufferSize,
        screenPosition,
      )
    }
    result[name] = {
      localPosition: tuple3(bone.position.toArray()),
      localRotation: tuple4(bone.quaternion.toArray()),
      localScale: tuple3(bone.scale.toArray()),
      componentPosition: tupleFromVector3(componentPosition),
      worldPosition: tuple3(worldPosition.toArray()),
      viewPosition: presentation
        ? tupleFromVector3(viewPosition)
        : null,
      screenPositionPixels: presentation
        ? tupleFromVector3(screenPosition)
        : null,
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

function createTransformJitterSample(
  frames: readonly AnimationFrameCaptureFrame[],
  frameIndex: number,
  elapsedSeconds: number,
  residual: [number, number, number],
  magnitude: number,
  tangentialResidual: number | null,
): AnimationFrameTransformJitterSample {
  const previous = frames[frameIndex - 1]
  const current = frames[frameIndex]
  const next = frames[frameIndex + 1]
  const previousPhysicsStep = numericMetadata(
    previous,
    'physicsStepIndex',
  )
  const currentPhysicsStep = numericMetadata(
    current,
    'physicsStepIndex',
  )
  const nextPhysicsStep = numericMetadata(next, 'physicsStepIndex')
  return {
    frame: current.index,
    elapsedSeconds,
    deltaTime: current.deltaTime,
    residual,
    magnitude,
    tangentialResidual,
    loop: sampledLoopPhase(current),
    cameraTraceDistanceRatio: numericMetadata(
      current,
      'cameraTraceDistanceRatio',
    ),
    speed: numericMetadata(current, 'speed'),
    gait: typeof current.metadata.gait === 'string'
      ? current.metadata.gait
      : null,
    moving: typeof current.metadata.moving === 'boolean'
      ? current.metadata.moving
      : null,
    locomotionMode:
      typeof current.metadata.locomotionMode === 'string'
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
  }
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
    const chord: [number, number, number] = [
      nextPosition[0] - previousPosition[0],
      nextPosition[1] - previousPosition[1],
      nextPosition[2] - previousPosition[2],
    ]
    const chordLength = Math.hypot(...chord)
    const tangentialResidual = chordLength > Number.EPSILON
      ? (
          residual[0] * chord[0]
          + residual[1] * chord[1]
          + residual[2] * chord[2]
        ) / chordLength
      : null
    samples.push(createTransformJitterSample(
      frames,
      index,
      elapsed[index],
      residual,
      magnitude,
      tangentialResidual,
    ))
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

function physicsCadenceCoupling(
  samples: readonly AnimationFrameTransformJitterSample[],
): AnimationFramePhysicsCadenceCoupling | null {
  const edges = [
    {
      edge: 'FromPreviousFrame' as const,
      steps: (sample: AnimationFrameTransformJitterSample) =>
        sample.physicsStepsFromPreviousFrame,
    },
    {
      edge: 'ToNextFrame' as const,
      steps: (sample: AnimationFrameTransformJitterSample) =>
        sample.physicsStepsToNextFrame,
    },
  ]
  const signals = [
    {
      mode: 'TangentialResidual' as const,
      value: (sample: AnimationFrameTransformJitterSample) =>
        sample.tangentialResidual,
    },
    {
      mode: 'ResidualMagnitude' as const,
      value: (sample: AnimationFrameTransformJitterSample) =>
        sample.magnitude,
    },
  ]
  const candidates = edges.flatMap(({ edge, steps }) => (
    signals.map(({ mode, value }) => {
      const stepCounts: number[] = []
      const signalValues: number[] = []
      const zeroStepSignals: number[] = []
      const oneStepSignals: number[] = []
      for (const sample of samples) {
        const stepCount = steps(sample)
        const signal = value(sample)
        if (
          (stepCount !== 0 && stepCount !== 1)
          || signal === null
        ) continue
        stepCounts.push(stepCount)
        signalValues.push(signal)
        const stepSignals = stepCount === 0
          ? zeroStepSignals
          : oneStepSignals
        stepSignals.push(signal)
      }
      const correlation = pearsonCorrelation(
        stepCounts,
        signalValues,
      )
      if (
        correlation === null
        || zeroStepSignals.length < 3
        || oneStepSignals.length < 3
      ) {
        return null
      }
      const mean = (values: readonly number[]) => (
        values.reduce((sum, entry) => sum + entry, 0)
        / values.length
      )
      const zeroStepSignalMean = mean(zeroStepSignals)
      const oneStepSignalMean = mean(oneStepSignals)
      return {
        edge,
        mode,
        correlation,
        sampleCount: stepCounts.length,
        zeroStepSampleCount: zeroStepSignals.length,
        oneStepSampleCount: oneStepSignals.length,
        zeroStepSignalMean,
        oneStepSignalMean,
        amplitude: Math.abs(
          oneStepSignalMean - zeroStepSignalMean,
        ) * 0.5,
      }
    })
  )).filter(
    (candidate): candidate is AnimationFramePhysicsCadenceCoupling =>
      candidate !== null,
  )
  candidates.sort((left, right) => (
    (
      right.amplitude * Math.abs(right.correlation)
      - left.amplitude * Math.abs(left.correlation)
    )
    || right.amplitude - left.amplitude
    || Math.abs(right.correlation) - Math.abs(left.correlation)
    || (
      left.edge === 'FromPreviousFrame'
        ? -1
        : right.edge === 'FromPreviousFrame' ? 1 : 0
    )
  ))
  return candidates[0] ?? null
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

interface LoopRunCandidate {
  readonly clip: string
  readonly start: number
  readonly samples: readonly AnimationFrameTransformJitterSample[]
  readonly wraps: readonly number[]
  readonly completeCycles:
    readonly (readonly AnimationFrameTransformJitterSample[])[]
  readonly meanWeight: number
}

function selectLoopRun(
  samples: readonly AnimationFrameTransformJitterSample[],
): LoopRunCandidate | null {
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
  return candidates[0]
}

function loopPhaseDiagnostics(
  samples: readonly AnimationFrameTransformJitterSample[],
  axis: 0 | 1 | 2,
): AnimationFrameLoopPhaseDiagnostics | null {
  const selected = selectLoopRun(samples)
  if (!selected) return null
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
  return jitterVectorFromSamples(transformJitterSamples(frames, position))
}

function quaternionRotationVectorDegrees(
  quaternion: THREE.Quaternion,
): [number, number, number] {
  // q and -q encode the same orientation. Keeping w non-negative produces the shortest error.
  if (quaternion.w < 0) {
    quaternion.set(
      -quaternion.x,
      -quaternion.y,
      -quaternion.z,
      -quaternion.w,
    )
  }
  const vectorLength = Math.hypot(quaternion.x, quaternion.y, quaternion.z)
  if (vectorLength <= Number.EPSILON) return [0, 0, 0]
  const angleDegrees = THREE.MathUtils.radToDeg(
    2 * Math.atan2(vectorLength, Math.max(-1, Math.min(1, quaternion.w))),
  )
  return [
    quaternion.x / vectorLength * angleDegrees,
    quaternion.y / vectorLength * angleDegrees,
    quaternion.z / vectorLength * angleDegrees,
  ]
}

function localRotationJitterVector(
  frames: readonly AnimationFrameCaptureFrame[],
  poses: readonly PoseSnapshot[],
  boneIndex: number,
): AnimationFrameTransformJitterVector | null {
  const elapsed = elapsedCaptureSeconds(frames)
  const samples: AnimationFrameTransformJitterSample[] = []
  const offset = boneIndex * 4
  const previous = new THREE.Quaternion()
  const current = new THREE.Quaternion()
  const next = new THREE.Quaternion()
  const expected = new THREE.Quaternion()
  const error = new THREE.Quaternion()
  for (let index = 1; index + 1 < poses.length; index++) {
    const duration = frames[index].deltaTime + frames[index + 1].deltaTime
    if (!Number.isFinite(duration) || duration <= 0) continue
    const alpha = frames[index].deltaTime / duration
    previous.fromArray(poses[index - 1].rotations, offset).normalize()
    current.fromArray(poses[index].rotations, offset).normalize()
    next.fromArray(poses[index + 1].rotations, offset).normalize()
    // Slerp uses its shortest arc, matching the cadence-correct expected local orientation.
    expected.copy(previous).slerp(next, alpha)
    error.copy(expected).invert().multiply(current).normalize()
    const residual = quaternionRotationVectorDegrees(error)
    const magnitude = Math.hypot(...residual)
    // The endpoint chord is the shortest prev-to-next rotation vector. It is absent for
    // out-and-back motion, where magnitude remains the cadence signal by design.
    const chord = quaternionRotationVectorDegrees(
      new THREE.Quaternion().copy(previous).invert().multiply(next).normalize(),
    )
    const chordLength = Math.hypot(...chord)
    const tangentialResidual = chordLength > Number.EPSILON
      ? (residual[0] * chord[0] + residual[1] * chord[1] + residual[2] * chord[2])
        / chordLength
      : null
    samples.push(createTransformJitterSample(
      frames, index, elapsed[index], residual, magnitude, tangentialResidual,
    ))
  }
  return jitterVectorFromSamples(samples)
}

function jitterVectorFromSamples(
  samples: readonly AnimationFrameTransformJitterSample[],
): AnimationFrameTransformJitterVector | null {
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
  const loopRun = selectLoopRun(samples)
  const cadenceSamples = loopRun && loopRun.completeCycles.length > 0
    ? loopRun.samples : samples
  return {
    residual: maximum.residual, magnitude: maximum.magnitude, frame: maximum.frame,
    peakWindow: samples.slice(Math.max(0, peakIndex - 2), Math.min(samples.length, peakIndex + 3)),
    rmsMagnitude: Math.sqrt(magnitudeSquares / samples.length),
    dominantAxis: (['X', 'Y', 'Z'] as const)[dominantAxisIndex],
    signedResidualMinimum: minimum, signedResidualMaximum: maximumSigned,
    autocorrelationPeak: jitterAutocorrelationPeak(samples, dominantAxisIndex),
    loopPhase: loopPhaseDiagnostics(samples, dominantAxisIndex),
    physicsCadenceCoupling: physicsCadenceCoupling(cadenceSamples),
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

function metadataScalarPosition(
  name: string,
): (frame: AnimationFrameCaptureFrame) => [number, number, number] | null {
  return (frame) => {
    const value = numericMetadata(frame, name)
    return value === null ? null : [value, 0, 0]
  }
}

const cameraWorldPosition = metadataPosition('cameraPosition')
const cameraPivotTargetPosition = metadataPosition('cameraPivotTargetPosition')
const cameraPivotLagPosition = metadataPosition('cameraPivotLagPosition')
const cameraPivotPosition = metadataPosition('cameraPivotPosition')
const cameraComponentPosition = metadataPosition('cameraComponentPosition')

function bonePosition(
  boneName: string,
  space:
    | 'componentPosition'
    | 'worldPosition'
    | 'viewPosition'
    | 'screenPositionPixels',
) {
  return (
    frame: AnimationFrameCaptureFrame,
  ): readonly [number, number, number] | null => (
    frame.bones[boneName]?.[space] ?? null
  )
}

function skinWorldCentroid(
  frame: AnimationFrameCaptureFrame,
): readonly [number, number, number] | null {
  return frame.skinnedMeshBounds?.centroid ?? null
}

function skinViewCentroid(
  frame: AnimationFrameCaptureFrame,
): readonly [number, number, number] | null {
  return frame.skinViewCentroid
}

function skinScreenCentroidPixels(
  frame: AnimationFrameCaptureFrame,
): readonly [number, number, number] | null {
  return frame.skinScreenCentroidPixels
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

function transformJitterDiagnostics(
  frames: readonly AnimationFrameCaptureFrame[],
): AnimationFrameTransformJitterDiagnostics {
  const bonePositions: Record<
    string,
    AnimationFrameBonePositionJitterDiagnostics
  > = {}
  for (const boneName of CHARACTER_JITTER_LANDMARKS) {
    if (!frames.some((frame) => frame.bones[boneName])) continue
    bonePositions[boneName] = {
      component: transformJitterVector(
        frames,
        bonePosition(boneName, 'componentPosition'),
      ),
      world: transformJitterVector(
        frames,
        bonePosition(boneName, 'worldPosition'),
      ),
      view: transformJitterVector(
        frames,
        bonePosition(boneName, 'viewPosition'),
      ),
      screenPixels: transformJitterVector(
        frames,
        bonePosition(boneName, 'screenPositionPixels'),
      ),
    }
  }
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
    skinWorldCentroid: transformJitterVector(
      frames,
      skinWorldCentroid,
    ),
    skinViewCentroid: transformJitterVector(
      frames,
      skinViewCentroid,
    ),
    skinScreenCentroidPixels: transformJitterVector(
      frames,
      skinScreenCentroidPixels,
    ),
    bonePositions,
    frameCadence: frameCadenceDiagnostics(frames),
    physicsCadence: physicsCadenceDiagnostics(frames),
  }
}

function transformJitterPathSummary(
  diagnostics: AnimationFrameTransformJitterVector | null,
): AnimationFrameTransformJitterPathSummary | null {
  if (!diagnostics) return null
  const loop = diagnostics.loopPhase
  const coupling = diagnostics.physicsCadenceCoupling
  return {
    peakResidualMillimeters: diagnostics.residual.map(
      (value) => value * 1_000,
    ) as [number, number, number],
    peakMagnitudeMillimeters: diagnostics.magnitude * 1_000,
    rmsMagnitudeMillimeters: diagnostics.rmsMagnitude * 1_000,
    peakFrame: diagnostics.frame,
    dominantAxis: diagnostics.dominantAxis,
    physicsCadenceCoupling: coupling
      ? {
          edge: coupling.edge,
          mode: coupling.mode,
          correlation: coupling.correlation,
          sampleCount: coupling.sampleCount,
          zeroStepSampleCount: coupling.zeroStepSampleCount,
          oneStepSampleCount: coupling.oneStepSampleCount,
          zeroStepSignalMeanMillimeters:
            coupling.zeroStepSignalMean * 1_000,
          oneStepSignalMeanMillimeters:
            coupling.oneStepSignalMean * 1_000,
          amplitudeMillimeters: coupling.amplitude * 1_000,
        }
      : null,
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

function compactJitterSummary(
  diagnostics: AnimationFrameTransformJitterVector | null,
  unit: AnimationFrameCompactJitterSummary['unit'],
): AnimationFrameCompactJitterSummary | null {
  if (!diagnostics) return null
  const scale = unit === 'Millimeters' ? 1_000 : 1
  const loop = diagnostics.loopPhase
  return {
    unit,
    peakResidual: diagnostics.residual.map(
      (value) => value * scale,
    ) as [number, number, number],
    peakMagnitude: diagnostics.magnitude * scale,
    rmsMagnitude: diagnostics.rmsMagnitude * scale,
    peakFrame: diagnostics.frame,
    dominantAxis: diagnostics.dominantAxis,
    physicsCadenceAmplitude:
      diagnostics.physicsCadenceCoupling === null
        ? null
        : diagnostics.physicsCadenceCoupling.amplitude * scale,
    physicsCadenceCorrelation:
      diagnostics.physicsCadenceCoupling?.correlation ?? null,
    physicsCadenceMode:
      diagnostics.physicsCadenceCoupling?.mode ?? null,
    physicsCadenceEdge:
      diagnostics.physicsCadenceCoupling?.edge ?? null,
    physicsCadenceSampleCount:
      diagnostics.physicsCadenceCoupling?.sampleCount ?? null,
    loopPhase: loop
      ? {
          clip: loop.clip,
          observedMedianLoopPeriodSeconds:
            loop.observedMedianLoopPeriodSeconds,
          cycleToCycleCorrelation: loop.cycleToCycleCorrelation,
        }
      : null,
  }
}

function landmarkJitterSummary(
  bone: string,
  diagnostics: AnimationFrameBonePositionJitterDiagnostics,
): AnimationFrameCharacterLandmarkJitterSummary {
  return {
    bone,
    componentRmsMillimeters:
      jitterMillimeters(diagnostics.component, 'rmsMagnitude'),
    componentPhysicsCadenceAmplitudeMillimeters:
      jitterMillimeters(
        diagnostics.component,
        'physicsCadenceAmplitude',
      ),
    componentPhysicsCadenceCorrelation:
      jitterPhysicsCadenceCorrelation(diagnostics.component),
    worldRmsMillimeters:
      jitterMillimeters(diagnostics.world, 'rmsMagnitude'),
    worldPhysicsCadenceAmplitudeMillimeters:
      jitterMillimeters(diagnostics.world, 'physicsCadenceAmplitude'),
    worldPhysicsCadenceCorrelation:
      jitterPhysicsCadenceCorrelation(diagnostics.world),
    viewRmsMillimeters:
      jitterMillimeters(diagnostics.view, 'rmsMagnitude'),
    viewPhysicsCadenceAmplitudeMillimeters:
      jitterMillimeters(diagnostics.view, 'physicsCadenceAmplitude'),
    viewPhysicsCadenceCorrelation:
      jitterPhysicsCadenceCorrelation(diagnostics.view),
    screenRmsPixels: diagnostics.screenPixels?.rmsMagnitude ?? null,
    screenPhysicsCadenceAmplitudePixels:
      diagnostics.screenPixels?.physicsCadenceCoupling?.amplitude
      ?? null,
    screenPhysicsCadenceCorrelation:
      jitterPhysicsCadenceCorrelation(diagnostics.screenPixels),
  }
}

function jitterMillimeters(
  path: AnimationFrameTransformJitterVector | null,
  value: 'rmsMagnitude' | 'physicsCadenceAmplitude',
) {
  if (!path) return null
  const magnitude = value === 'rmsMagnitude'
    ? path.rmsMagnitude
    : path.physicsCadenceCoupling?.amplitude
  return magnitude === undefined ? null : magnitude * 1_000
}

function jitterPhysicsCadenceCorrelation(
  path: AnimationFrameTransformJitterVector | null,
) {
  return path?.physicsCadenceCoupling?.correlation ?? null
}

function controlRigExecuted(frame: AnimationFrameCaptureFrame) {
  return (numericMetadata(frame, 'ControlRigExecuted') ?? 0) > 0
}

function controlRigMetadataScalarPosition(name: string) {
  const position = metadataScalarPosition(name)
  return (frame: AnimationFrameCaptureFrame) => (
    controlRigExecuted(frame) ? position(frame) : null
  )
}

function controlRigComponentPosition(
  stage: 'Pre' | 'Post',
  bone: string,
) {
  const position = metadataPosition(
    `ControlRig${stage}ComponentPosition.${bone}.`,
  )
  return (frame: AnimationFrameCaptureFrame) => (
    controlRigExecuted(frame) ? position(frame) : null
  )
}

function controlRigSolveDeltaPosition(bone: string) {
  const pre = controlRigComponentPosition('Pre', bone)
  const post = controlRigComponentPosition('Post', bone)
  return (
    frame: AnimationFrameCaptureFrame,
  ): [number, number, number] | null => {
    const prePosition = pre(frame)
    const postPosition = post(frame)
    return prePosition && postPosition
      ? [
          postPosition[0] - prePosition[0],
          postPosition[1] - prePosition[1],
          postPosition[2] - prePosition[2],
        ]
      : null
  }
}

function binaryMetadataSummary(
  frames: readonly AnimationFrameCaptureFrame[],
  name: string,
  include: (frame: AnimationFrameCaptureFrame) => boolean = () => true,
) {
  const values = frames
    .filter(include)
    .map((frame) => numericMetadata(frame, name))
    .filter((value): value is number => value !== null)
    .map((value) => Number(value > 0))
  let transitionCount = 0
  for (let index = 1; index < values.length; index++) {
    if (values[index] !== values[index - 1]) transitionCount++
  }
  return {
    rate: values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length,
    transitionCount,
  }
}

function controlRigJitterSummary(
  frames: readonly AnimationFrameCaptureFrame[],
): AnimationFrameControlRigJitterSummary {
  const path = (name: string) => transformJitterVector(
    frames,
    controlRigMetadataScalarPosition(name),
  )
  const footLeftTraceHit = binaryMetadataSummary(
    frames,
    'ControlRigFootLeftTraceHit',
    controlRigExecuted,
  )
  const footRightTraceHit = binaryMetadataSummary(
    frames,
    'ControlRigFootRightTraceHit',
    controlRigExecuted,
  )
  const stageLandmarks = CONTROL_RIG_JITTER_LANDMARKS.map((bone) => {
    const pre = transformJitterVector(
      frames,
      controlRigComponentPosition('Pre', bone),
    )
    const post = transformJitterVector(
      frames,
      controlRigComponentPosition('Post', bone),
    )
    const solveDelta = transformJitterVector(
      frames,
      controlRigSolveDeltaPosition(bone),
    )
    return {
      bone,
      preRmsMillimeters:
        jitterMillimeters(pre, 'rmsMagnitude'),
      prePhysicsCadenceAmplitudeMillimeters:
        jitterMillimeters(pre, 'physicsCadenceAmplitude'),
      prePhysicsCadenceCorrelation:
        jitterPhysicsCadenceCorrelation(pre),
      postRmsMillimeters:
        jitterMillimeters(post, 'rmsMagnitude'),
      postPhysicsCadenceAmplitudeMillimeters:
        jitterMillimeters(post, 'physicsCadenceAmplitude'),
      postPhysicsCadenceCorrelation:
        jitterPhysicsCadenceCorrelation(post),
      solveDeltaRmsMillimeters:
        jitterMillimeters(solveDelta, 'rmsMagnitude'),
      solveDeltaPhysicsCadenceAmplitudeMillimeters:
        jitterMillimeters(solveDelta, 'physicsCadenceAmplitude'),
      solveDeltaPhysicsCadenceCorrelation:
        jitterPhysicsCadenceCorrelation(solveDelta),
    }
  })
  stageLandmarks.sort((left, right) => (
    (
      right.solveDeltaPhysicsCadenceAmplitudeMillimeters
      ?? right.postPhysicsCadenceAmplitudeMillimeters
      ?? right.prePhysicsCadenceAmplitudeMillimeters
      ?? 0
    ) - (
      left.solveDeltaPhysicsCadenceAmplitudeMillimeters
      ?? left.postPhysicsCadenceAmplitudeMillimeters
      ?? left.prePhysicsCadenceAmplitudeMillimeters
      ?? 0
    )
    || left.bone.localeCompare(right.bone)
  ))
  return {
    executedFrameCount: frames.filter(controlRigExecuted).length,
    pelvisOffset: compactJitterSummary(
      path('ControlRigPelvisOffset'),
      'Millimeters',
    ),
    footLeftTraceOffset: compactJitterSummary(
      path('ControlRigFootLeftTraceOffset'),
      'Millimeters',
    ),
    footRightTraceOffset: compactJitterSummary(
      path('ControlRigFootRightTraceOffset'),
      'Millimeters',
    ),
    footLeftAppliedOffset: compactJitterSummary(
      path('ControlRigFootLeftAppliedOffset'),
      'Millimeters',
    ),
    footRightAppliedOffset: compactJitterSummary(
      path('ControlRigFootRightAppliedOffset'),
      'Millimeters',
    ),
    footLeftIkWeight: compactJitterSummary(
      path('ControlRigFootLeftIkWeight'),
      'Scalar',
    ),
    footRightIkWeight: compactJitterSummary(
      path('ControlRigFootRightIkWeight'),
      'Scalar',
    ),
    footLeftTraceHitRate: footLeftTraceHit.rate,
    footRightTraceHitRate: footRightTraceHit.rate,
    footLeftTraceHitTransitionCount:
      footLeftTraceHit.transitionCount,
    footRightTraceHitTransitionCount:
      footRightTraceHit.transitionCount,
    stageLandmarks,
  }
}

function characterJitterSummary(
  diagnostics: AnimationFrameTransformJitterDiagnostics,
  frames: readonly AnimationFrameCaptureFrame[],
  poses: readonly PoseSnapshot[],
  bones: readonly THREE.Bone[],
): AnimationFrameCharacterJitterSummary {
  const landmarks = Object.entries(diagnostics.bonePositions).map(
    ([bone, paths]) => landmarkJitterSummary(bone, paths),
  )
  landmarks.sort((left, right) => (
    (
      right.screenPhysicsCadenceAmplitudePixels
      ?? right.viewPhysicsCadenceAmplitudeMillimeters
      ?? right.worldPhysicsCadenceAmplitudeMillimeters
      ?? 0
    ) - (
      left.screenPhysicsCadenceAmplitudePixels
      ?? left.viewPhysicsCadenceAmplitudeMillimeters
      ?? left.worldPhysicsCadenceAmplitudeMillimeters
      ?? 0
    )
    || left.bone.localeCompare(right.bone)
  ))
  const drawingBufferSizePixels =
    frames.findLast(
      (frame) => frame.drawingBufferSizePixels !== null,
    )?.drawingBufferSizePixels ?? null
  const localRotations = bones.map((bone, boneIndex) => {
    const jitter = localRotationJitterVector(frames, poses, boneIndex)
    return jitter === null ? null : {
      bone: bone.name,
      peakDegrees: jitter.magnitude,
      rmsDegrees: jitter.rmsMagnitude,
      peakFrame: jitter.frame,
      physicsCadenceCorrelation:
        jitter.physicsCadenceCoupling?.correlation ?? null,
      physicsCadenceAmplitudeDegrees:
        jitter.physicsCadenceCoupling?.amplitude ?? null,
      physicsCadenceMode: jitter.physicsCadenceCoupling?.mode ?? null,
      physicsCadenceEdge: jitter.physicsCadenceCoupling?.edge ?? null,
      physicsCadenceSampleCount:
        jitter.physicsCadenceCoupling?.sampleCount ?? null,
      loopClip: jitter.loopPhase?.clip ?? null,
      loopPeriodSeconds:
        jitter.loopPhase?.observedMedianLoopPeriodSeconds ?? null,
    }
  }).filter((summary): summary is AnimationFrameLocalRotationJitterSummary => (
    summary !== null
  ))
  localRotations.sort((left, right) => (
    (
      (right.physicsCadenceAmplitudeDegrees ?? 0)
      * Math.abs(right.physicsCadenceCorrelation ?? 0)
      - (left.physicsCadenceAmplitudeDegrees ?? 0)
      * Math.abs(left.physicsCadenceCorrelation ?? 0)
    )
    || (
      (right.physicsCadenceAmplitudeDegrees ?? 0)
      - (left.physicsCadenceAmplitudeDegrees ?? 0)
    )
    || right.peakDegrees - left.peakDegrees
    || right.rmsDegrees - left.rmsDegrees
    || left.bone.localeCompare(right.bone)
  ))
  return {
    drawingBufferSizePixels,
    skin: {
      world: compactJitterSummary(
        diagnostics.skinWorldCentroid,
        'Millimeters',
      ),
      view: compactJitterSummary(
        diagnostics.skinViewCentroid,
        'Millimeters',
      ),
      screen: compactJitterSummary(
        diagnostics.skinScreenCentroidPixels,
        'Pixels',
      ),
    },
    controlRig: controlRigJitterSummary(frames),
    landmarks,
    localRotations: localRotations.slice(0, 10),
  }
}

function transformJitterSummary(
  diagnostics: AnimationFrameTransformJitterDiagnostics,
  frames: readonly AnimationFrameCaptureFrame[],
  poses: readonly PoseSnapshot[],
  bones: readonly THREE.Bone[],
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
    character: characterJitterSummary(diagnostics, frames, poses, bones),
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
    transformJitterSummary: transformJitterSummary(
      transformJitter,
      frames,
      poses,
      bones,
    ),
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
  readonly presentation: AnimationFrameCapturePresentation | null
  readonly skinnedMeshes: ReadonlySet<THREE.SkinnedMesh>
  private readonly componentWorldInverse = new THREE.Matrix4()
  private readonly drawingBufferSize = new THREE.Vector2()
  private readonly skinWorldCentroid = new THREE.Vector3()
  private readonly skinViewCentroid = new THREE.Vector3()
  private readonly skinScreenCentroidPixels = new THREE.Vector3()
  private readonly skinScreenVertexPixels = new THREE.Vector3()
  private pending: PendingCapture | null = null

  constructor(
    root: THREE.Object3D,
    tracedBones: readonly string[] = DEFAULT_TRACED_BONES,
    presentation: AnimationFrameCapturePresentation | null = null,
  ) {
    this.root = root
    const characterObjects = findCharacterObjects(root)
    this.bones = characterObjects.bones
    this.bonesByName = new Map(this.bones.map((bone) => [bone.name, bone]))
    this.tracedBones = [...new Set(tracedBones)]
    this.presentation = presentation
    this.skinnedMeshes = characterObjects.skinnedMeshes
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
    this.root.updateWorldMatrix(true, true)
    this.root.getWorldPosition(rootWorldPosition)
    this.componentWorldInverse.copy(this.root.matrixWorld).invert()
    const presentation = this.presentation
    if (presentation) {
      presentation.camera.updateMatrixWorld(true)
      presentation.getDrawingBufferSize(this.drawingBufferSize)
      this.skinScreenCentroidPixels.set(0, 0, 0)
    }
    const skinnedMeshBounds = captureSkinnedMeshWorldBounds(
      this.root,
      new Set(this.tracedBones),
      this.skinnedMeshes,
      presentation
        ? (vertex) => {
            screenPositionPixels(
              vertex,
              presentation.camera,
              this.drawingBufferSize,
              this.skinScreenVertexPixels,
            )
            this.skinScreenCentroidPixels.add(
              this.skinScreenVertexPixels,
            )
          }
        : undefined,
    )
    let skinViewCentroid: [number, number, number] | null = null
    let skinScreenCentroidPixels: [number, number, number] | null = null
    if (presentation && skinnedMeshBounds) {
      this.skinWorldCentroid.fromArray(skinnedMeshBounds.centroid)
      this.skinViewCentroid
        .copy(this.skinWorldCentroid)
        .applyMatrix4(presentation.camera.matrixWorldInverse)
      this.skinScreenCentroidPixels.multiplyScalar(
        1 / skinnedMeshBounds.vertexCount,
      )
      skinViewCentroid = tupleFromVector3(this.skinViewCentroid)
      skinScreenCentroidPixels = tupleFromVector3(
        this.skinScreenCentroidPixels,
      )
    }
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
        this.componentWorldInverse,
        presentation,
        this.drawingBufferSize,
      ),
      skinnedMeshBounds,
      skinViewCentroid,
      skinScreenCentroidPixels,
      drawingBufferSizePixels: presentation
        ? [this.drawingBufferSize.x, this.drawingBufferSize.y]
        : null,
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
