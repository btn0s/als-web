import type { BoneMask, PoseAccumulator } from './blend'
import {
  accumulatePose,
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  clearPoseAccumulator,
  createMeshSpaceBlendScratch,
  createPoseAccumulator,
  finalizePose,
  makeDynamicAdditivePose,
} from './blend'
import type { MeshSpaceBlendScratch } from './blend'
import type { CompiledClipSampler } from './clipSampler'
import { resolveClipTime, sampleClip } from './clipSampler'
import type { ClipCurveSamplers, CurveFrame } from './curves'
import { beginCurveFrame, createCurveFrame, sampleClipCurves } from './curves'
import {
  applyOutputInertialization,
  createBlendedCurveFrame,
  createOutputInertialization,
  prepareOutputInertialization,
} from './inertializationOutput'
import type {
  BlendedCurveFrame,
  OutputInertialization,
  ResolveBlendedCurves,
} from './inertializationOutput'
import type { LocalPoseBuffer } from './poseBuffer'
import { copyPose, createPoseBuffer, resetPoseToReference } from './poseBuffer'
import type { RigDefinition } from './rig'
import type { RootMotionDelta, RootMotionExtractor } from './rootMotion'
import { extractRootMotionDelta } from './rootMotion'
import {
  applyInertialization,
  createInertialization,
} from './inertialization'
import type { Inertialization } from './inertialization'

export interface EvaluatorClipEntry {
  readonly sampler: CompiledClipSampler
  time: number
  weight: number
  loop?: boolean
  curveKey?: string
  curves?: ClipCurveSamplers
}

export interface EvaluatorLayerEntry extends EvaluatorClipEntry {
  mask?: BoneMask
  additiveSpace?: 'local' | 'mesh'
}

/** One AB_Als_Layering replacement alpha applied to the evaluated linked Overlay pose. */
export interface EvaluatorOverlayLayer {
  weight: number
  /** Resolves the same-frame alpha from the inertialized linked Overlay curve container. */
  resolveWeight?: (curves: ReadonlyMap<string, number>) => number
  mask?: BoneMask
}

/**
 * One code-authored linked-layer graph that consumes the complete locomotion and Overlay poses.
 *
 * Unreal evaluates linked animation layers as graph subtrees, not as pre-masked clip entries.
 * The web runtime exposes that same seam so graph code can own its cached poses and ordered
 * per-bone nodes while the evaluator still owns sampling, staged inertialization, and the single
 * skeleton write.
 */
export interface EvaluatorLinkedLayerContext {
  readonly rig: RigDefinition
  readonly locomotionPose: LocalPoseBuffer
  readonly overlayPose: LocalPoseBuffer
  readonly outputPose: LocalPoseBuffer
  readonly overlayCurves: ReadonlyMap<string, number>
}

export type EvaluatorLinkedLayer = (
  context: EvaluatorLinkedLayerContext,
) => void

/**
 * One authored pose graph evaluated as a tree instead of flattening all leaf clips into a single
 * accumulator.
 *
 * The callback owns its scratch poses and every intermediate node boundary. This is required for
 * Unreal parity because FAnimationRuntime normalizes rotations at each TwoWay/MultiWay node, so
 * multiplying leaf weights into one flat blend is not pose-equivalent.
 */
export interface EvaluatorPoseGraphContext {
  readonly rig: RigDefinition
  readonly referencePose: LocalPoseBuffer
  readonly outputPose: LocalPoseBuffer
  readonly outputCurves: Map<string, number>
}

export type EvaluatorPoseGraph = (
  context: EvaluatorPoseGraphContext,
) => void

/**
 * A raw authored source sequence plus the pose named by its UAnimSequence additive metadata.
 *
 * Unlike `additives`, this entry has not been converted to identity-relative transform tracks.
 */
export interface EvaluatorAuthoredAdditiveEntry extends EvaluatorClipEntry {
  readonly referencePose: LocalPoseBuffer
  readonly additiveSpace: 'local' | 'mesh'
  mask?: BoneMask
}

/**
 * One authored FAnimNode_Inertialization instance at a graph boundary.
 *
 * Pose history, resolved curve history, and request accounting belong to the node instance.
 * Root-motion attributes are deliberately absent because the flattened evaluator does not expose
 * branch-local root motion yet.
 */
export interface EvaluatorInertializationStage {
  readonly inertialization: Inertialization
  readonly outputInertialization: OutputInertialization
  readonly curveSamples: CurveFrame
  readonly curves: Map<string, number>
  readonly resolveBlendedCurves?: ResolveBlendedCurves
}

export function createEvaluatorInertializationStage(
  boneCount: number,
  resolveBlendedCurves?: ResolveBlendedCurves,
): EvaluatorInertializationStage {
  return {
    inertialization: createInertialization(boneCount),
    outputInertialization: createOutputInertialization(),
    curveSamples: createCurveFrame(),
    curves: new Map(),
    resolveBlendedCurves,
  }
}

export interface EvaluatePoseInput {
  readonly base: readonly EvaluatorLayerEntry[]
  /**
   * Complete AB_Als_Locomotion graph output before AB_Als_Grounded node 35.
   *
   * State poses finish their internal blends, additives, and slots before the outer state-machine
   * transition. A flat `base` list cannot preserve those authored node boundaries.
   */
  readonly locomotionGraph?: EvaluatorPoseGraph
  /**
   * Non-additive Slot nodes evaluated inside the base branch. A Slot blends its active montage
   * over the complementary source pose, then contributes that composed pose to its parent graph.
   */
  readonly slots?: readonly EvaluatorSlotEntry[]
  /**
   * Legacy flattened Layering inputs. Their masks already bake AB_Als_Layering policy, so an
   * overlay inertialization stage cannot be applied to this representation.
   */
  readonly overlays?: readonly EvaluatorLayerEntry[]
  /** Full linked Overlay output before AB_Als_Layering consumes its pose and curves. */
  readonly overlayBranch?: readonly EvaluatorLayerEntry[]
  /** Exact authored linked Overlay graph, preserving every intermediate blend-node boundary. */
  readonly overlayGraph?: EvaluatorPoseGraph
  /** Graph implementation evaluated after the linked Overlay inertialization node. */
  readonly linkedLayer?: EvaluatorLinkedLayer
  /** Region alphas applied after the linked Overlay branch and its inertialization node. */
  readonly overlayLayers?: readonly EvaluatorOverlayLayer[]
  readonly montages?: readonly EvaluatorLayerEntry[]
  /**
   * ALS's separate authored nodes after the AB_Als_Grounded state machine and on the linked
   * Overlay input. They own independent histories and cannot be collapsed into the final output
   * inertializer.
   */
  readonly stagedInertialization?: EvaluatorStagedInertialization
  /** Additive slot output that is part of the locomotion base consumed by downstream layering. */
  readonly preOverlayAdditives?: readonly EvaluatorAuthoredAdditiveEntry[]
  /** Authored additives evaluated on the linked-overlay pose before region layering. */
  readonly overlayAdditives?: readonly EvaluatorAuthoredAdditiveEntry[]
  readonly additives?: readonly EvaluatorLayerEntry[]
  readonly dynamicAdditives?: readonly EvaluatorDynamicAdditiveEntry[]
  readonly rootMotion?: RootMotionExtractor
  readonly resolveBlendedCurves?: ResolveBlendedCurves
  deltaTime?: number
}

export interface EvaluatorSlotEntry {
  readonly source: readonly EvaluatorLayerEntry[]
  montage?: EvaluatorLayerEntry
  /** Weight of the Slot output in its parent state/graph. */
  weight: number
  /** Active montage alpha; the source receives exactly `1 - montageWeight`. */
  montageWeight: number
}

export interface EvaluatorStagedInertialization {
  /** AB_Als_Grounded node 35: after the state machine and before Transition-slot composition. */
  readonly locomotion?: EvaluatorInertializationStage
  /** AB_Als node 11: on the linked Overlay branch before AB_Als_Layering. */
  readonly overlay?: EvaluatorInertializationStage
}

export interface EvaluatorDynamicAdditiveEntry {
  readonly referencePose: LocalPoseBuffer
  weight: number
  /** Resolves Layer*Additive/LocalSpace from same-frame inertialized Overlay curves. */
  resolveWeight?: (curves: ReadonlyMap<string, number>) => number
  mask?: BoneMask
  additiveSpace: 'local' | 'mesh'
}

export interface CoverageWarning {
  readonly minimum: number
  readonly underCoveredBones: number
  readonly threshold: number
}

export interface PoseEvaluationResult {
  readonly pose: LocalPoseBuffer
  readonly curves: BlendedCurveFrame
  rootMotionDelta?: RootMotionDelta
}

export interface PoseEvaluator {
  readonly rig: RigDefinition
  readonly referencePose: LocalPoseBuffer
  readonly samplePose: LocalPoseBuffer
  readonly basePose: LocalPoseBuffer
  readonly overlayPose: LocalPoseBuffer
  readonly dynamicAdditivePose: LocalPoseBuffer
  readonly outputPose: LocalPoseBuffer
  readonly accumulator: PoseAccumulator
  readonly slotAccumulator: PoseAccumulator
  readonly overlayAccumulator: PoseAccumulator
  readonly overlayGraphCurves: Map<string, number>
  readonly meshSpaceScratch: MeshSpaceBlendScratch
  readonly curves: BlendedCurveFrame
  readonly inertialization: Inertialization
  readonly outputInertialization: OutputInertialization
  readonly result: PoseEvaluationResult
  readonly development: boolean
  readonly coverageThreshold: number
  readonly onCoverageWarning: (warning: CoverageWarning) => void
  coverageWarningActive: boolean
}

export interface PoseEvaluatorOptions {
  development?: boolean
  coverageThreshold?: number
  onCoverageWarning?: (warning: CoverageWarning) => void
}

export function createPoseEvaluator(
  rig: RigDefinition,
  options: PoseEvaluatorOptions = {},
): PoseEvaluator {
  const referencePose = resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
  const outputPose = resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
  const curves = createBlendedCurveFrame(createCurveFrame())
  const result: PoseEvaluationResult = { pose: outputPose, curves }
  return {
    rig,
    referencePose,
    samplePose: createPoseBuffer(rig.boneCount),
    basePose: createPoseBuffer(rig.boneCount),
    overlayPose: createPoseBuffer(rig.boneCount),
    dynamicAdditivePose: createPoseBuffer(rig.boneCount),
    outputPose,
    accumulator: createPoseAccumulator(rig.boneCount),
    slotAccumulator: createPoseAccumulator(rig.boneCount),
    overlayAccumulator: createPoseAccumulator(rig.boneCount),
    overlayGraphCurves: new Map(),
    meshSpaceScratch: createMeshSpaceBlendScratch(rig.boneCount),
    curves,
    inertialization: createInertialization(rig.boneCount),
    outputInertialization: createOutputInertialization(),
    result,
    development: options.development ?? false,
    coverageThreshold: options.coverageThreshold ?? 0.999,
    onCoverageWarning: options.onCoverageWarning ?? ((warning) => {
      console.warn(
        `[Animation] Base pose coverage ${warning.minimum.toFixed(3)} is below `
        + `${warning.threshold.toFixed(3)} on ${warning.underCoveredBones} bone(s); `
        + 'the owned evaluator normalized active weights instead of blending toward bind pose.',
      )
    }),
    coverageWarningActive: false,
  }
}

function sampleEntryCurves(
  evaluator: PoseEvaluator,
  entry: EvaluatorClipEntry,
  stage?: EvaluatorInertializationStage,
) {
  if (!entry.curves) return
  const clipKey = entry.curveKey ?? entry.sampler.clip.name
  const time = resolveClipTime(
    entry.time,
    entry.sampler.clip.duration,
    entry.loop ?? true,
  )
  sampleClipCurves(
    evaluator.curves,
    clipKey,
    entry.curves,
    time,
  )
  if (!stage) return

  const sampled = evaluator.curves.byClip.get(clipKey)
  let stageValues = stage.curveSamples.byClip.get(clipKey)
  if (!stageValues) {
    stageValues = new Map()
    stage.curveSamples.byClip.set(clipKey, stageValues)
  }
  stage.curveSamples.activeClips.add(clipKey)
  for (const [name, value] of sampled ?? []) stageValues.set(name, value)
}

function sampleAndAccumulate(
  evaluator: PoseEvaluator,
  entries: readonly EvaluatorLayerEntry[] | undefined,
  accumulator = evaluator.accumulator,
  stage?: EvaluatorInertializationStage,
) {
  if (!entries) return
  for (const entry of entries) {
    if (entry.weight <= 0) continue
    sampleClip(
      entry.sampler,
      evaluator.rig,
      entry.time,
      evaluator.samplePose,
      entry.loop,
    )
    accumulatePose(accumulator, evaluator.samplePose, entry.weight, entry.mask)
    sampleEntryCurves(evaluator, entry, stage)
  }
}

function sampleSlotAndAccumulate(
  evaluator: PoseEvaluator,
  slots: readonly EvaluatorSlotEntry[] | undefined,
  stage?: EvaluatorInertializationStage,
) {
  if (!slots) return
  for (const slot of slots) {
    if (slot.weight <= 0) continue
    const montageWeight = Math.max(0, Math.min(1, slot.montageWeight))
    const montage = slot.montage

    // FAnimNode_Slot with bAlwaysUpdateSourcePose=false skips its source when the montage owns the
    // complete output.
    if (!montage || montageWeight < 1) {
      clearPoseAccumulator(evaluator.slotAccumulator)
      sampleAndAccumulate(
        evaluator,
        slot.source,
        evaluator.slotAccumulator,
        stage,
      )
      finalizePose(
        evaluator.slotAccumulator,
        evaluator.referencePose,
        evaluator.overlayPose,
      )
      if (!montage || montageWeight <= 0) {
        accumulatePose(evaluator.accumulator, evaluator.overlayPose, slot.weight)
        continue
      }

      sampleClip(
        montage.sampler,
        evaluator.rig,
        montage.time,
        evaluator.samplePose,
        montage.loop,
      )
      sampleEntryCurves(evaluator, montage, stage)
      blendPoseInPlace(
        evaluator.overlayPose,
        evaluator.samplePose,
        montageWeight,
      )
      accumulatePose(evaluator.accumulator, evaluator.overlayPose, slot.weight)
      continue
    }

    sampleClip(
      montage.sampler,
      evaluator.rig,
      montage.time,
      evaluator.samplePose,
      montage.loop,
    )
    sampleEntryCurves(evaluator, montage, stage)
    accumulatePose(evaluator.accumulator, evaluator.samplePose, slot.weight)
  }
}

function applyAuthoredAdditives(
  evaluator: PoseEvaluator,
  target: LocalPoseBuffer,
  entries: readonly EvaluatorAuthoredAdditiveEntry[] | undefined,
  stage?: EvaluatorInertializationStage,
) {
  if (!entries) return
  for (const entry of entries) {
    if (entry.weight <= 0) continue
    sampleClip(
      entry.sampler,
      evaluator.rig,
      entry.time,
      evaluator.samplePose,
      entry.loop,
      entry.referencePose,
    )
    makeDynamicAdditivePose(
      evaluator.samplePose,
      entry.referencePose,
      evaluator.rig,
      evaluator.dynamicAdditivePose,
      entry.additiveSpace,
      evaluator.meshSpaceScratch,
    )
    if (entry.additiveSpace === 'mesh') {
      applyMeshSpaceAdditivePose(
        target,
        evaluator.dynamicAdditivePose,
        evaluator.rig,
        entry.weight,
        evaluator.meshSpaceScratch,
        entry.mask,
      )
    } else {
      applyAdditivePose(
        target,
        evaluator.dynamicAdditivePose,
        entry.weight,
        entry.mask,
      )
    }
    sampleEntryCurves(evaluator, entry, stage)
  }
}

function checkCoverage(evaluator: PoseEvaluator) {
  if (!evaluator.development || evaluator.rig.boneCount === 0) return
  let minimum = Infinity
  let underCoveredBones = 0
  for (let i = 0; i < evaluator.accumulator.weights.length; i++) {
    const coverage = evaluator.accumulator.weights[i]
    if (coverage < minimum) minimum = coverage
    if (coverage < evaluator.coverageThreshold) underCoveredBones++
  }

  if (underCoveredBones > 0) {
    if (!evaluator.coverageWarningActive) {
      evaluator.onCoverageWarning({
        minimum,
        underCoveredBones,
        threshold: evaluator.coverageThreshold,
      })
    }
    evaluator.coverageWarningActive = true
  } else {
    evaluator.coverageWarningActive = false
  }
}

function beginInertializationStage(
  stage: EvaluatorInertializationStage | undefined,
) {
  if (!stage) return
  beginCurveFrame(stage.curveSamples)
  stage.curves.clear()
}

function applyInertializationStage(
  pose: LocalPoseBuffer,
  stage: EvaluatorInertializationStage | undefined,
  deltaTime: number,
  curvesAlreadyResolved = false,
) {
  if (!stage) return
  if (!curvesAlreadyResolved) {
    stage.resolveBlendedCurves?.(stage.curveSamples, stage.curves)
  }
  prepareOutputInertialization(
    stage.outputInertialization,
    stage.inertialization,
  )
  applyInertialization(stage.inertialization, pose, deltaTime)
  applyOutputInertialization(
    stage.outputInertialization,
    stage.curves,
    undefined,
    deltaTime,
    stage.inertialization,
  )
}

function applyMontageLayersAfterInertialization(
  evaluator: PoseEvaluator,
  montages: readonly EvaluatorLayerEntry[] | undefined,
) {
  if (!montages || montages.length === 0) return
  clearPoseAccumulator(evaluator.overlayAccumulator)
  sampleAndAccumulate(
    evaluator,
    montages,
    evaluator.overlayAccumulator,
  )
  finalizePose(
    evaluator.overlayAccumulator,
    evaluator.outputPose,
    evaluator.overlayPose,
  )
  blendPoseInPlace(
    evaluator.outputPose,
    evaluator.overlayPose,
    1,
    evaluator.overlayAccumulator.weights,
  )
}

const EMPTY_LAYERING_CURVES: ReadonlyMap<string, number> = new Map()

function resolveLayeringWeight(
  fallback: number,
  resolveWeight: (
    (curves: ReadonlyMap<string, number>) => number
  ) | undefined,
  overlayInertialization: EvaluatorInertializationStage | undefined,
) {
  if (!resolveWeight) return fallback
  const resolved = resolveWeight(
    overlayInertialization?.curves ?? EMPTY_LAYERING_CURVES,
  )
  return Number.isFinite(resolved) ? resolved : fallback
}

function applyOverlayLayers(
  evaluator: PoseEvaluator,
  layers: readonly EvaluatorOverlayLayer[],
  overlayInertialization: EvaluatorInertializationStage | undefined,
) {
  for (const layer of layers) {
    const weight = resolveLayeringWeight(
      layer.weight,
      layer.resolveWeight,
      overlayInertialization,
    )
    if (weight <= 0) continue
    if (layer.mask && layer.mask.length !== evaluator.rig.boneCount) {
      throw new Error('Overlay layer mask has an incompatible bone count')
    }
    // AB_Als_Layering is an ordered chain. Overlapping masks replace sequentially rather than
    // summing into a single mask: two 0.5 nodes produce 0.75 total replacement.
    blendPoseInPlace(
      evaluator.outputPose,
      evaluator.overlayPose,
      weight,
      layer.mask,
    )
  }
}

/**
 * Samples and normalizes the full-coverage base, applies raw authored slot additives that must be
 * visible to downstream layering, replaces masked regions with normalized overlay groups, then
 * applies ALS dynamic locomotion additives and already-delta clip additives.
 */
export function evaluatePose(
  evaluator: PoseEvaluator,
  input: EvaluatePoseInput,
): PoseEvaluationResult {
  const deltaTime = input.deltaTime ?? 0
  const locomotionInertialization =
    input.stagedInertialization?.locomotion
  const overlayInertialization = input.stagedInertialization?.overlay
  const fullOverlayCount =
    Number(input.overlayBranch !== undefined)
    + Number(input.overlayGraph !== undefined)
  if (fullOverlayCount > 1) {
    throw new Error(
      'Use either overlayBranch or overlayGraph for the full linked Overlay output, not both',
    )
  }
  const hasFullOverlay = fullOverlayCount === 1
  if (hasFullOverlay && input.overlays) {
    throw new Error(
      'Use either a full linked Overlay output or legacy flattened overlays, not both',
    )
  }
  if (
    hasFullOverlay
    && !input.linkedLayer
    && !input.overlayLayers
  ) {
    throw new Error(
      `${input.overlayGraph ? 'overlayGraph' : 'overlayBranch'} requires a `
      + 'linkedLayer or post-inertialization overlayLayers',
    )
  }
  if (input.linkedLayer && !hasFullOverlay) {
    throw new Error(
      'linkedLayer requires a full pre-Layering overlayBranch or overlayGraph',
    )
  }
  if (input.linkedLayer && input.overlayLayers) {
    throw new Error('Use either linkedLayer or flattened overlayLayers, not both')
  }
  if (overlayInertialization && !hasFullOverlay) {
    throw new Error(
      'Overlay inertialization requires a full pre-Layering overlayBranch or overlayGraph',
    )
  }
  if (input.locomotionGraph) {
    if (!locomotionInertialization) {
      throw new Error(
        'locomotionGraph requires its authored locomotion inertialization stage',
      )
    }
    if (input.base.length > 0 || (input.slots?.length ?? 0) > 0) {
      throw new Error(
        'Use either locomotionGraph or flattened base/slots, not both',
      )
    }
  }

  clearPoseAccumulator(evaluator.accumulator)
  beginCurveFrame(evaluator.curves)
  evaluator.curves.values.clear()
  beginInertializationStage(locomotionInertialization)
  beginInertializationStage(overlayInertialization)
  if (input.locomotionGraph) {
    input.locomotionGraph({
      rig: evaluator.rig,
      referencePose: evaluator.referencePose,
      outputPose: evaluator.outputPose,
      outputCurves: locomotionInertialization!.curves,
    })
    applyInertializationStage(
      evaluator.outputPose,
      locomotionInertialization,
      deltaTime,
      true,
    )
  } else {
    sampleAndAccumulate(
      evaluator,
      input.base,
      evaluator.accumulator,
      locomotionInertialization,
    )
    sampleSlotAndAccumulate(
      evaluator,
      input.slots,
      locomotionInertialization,
    )
    // AB_Als_Grounded finalizes its state-machine pose and inertializes it before the Transition
    // slot. Preserve the legacy normalized-accumulator path when no staged node is supplied.
    if (!locomotionInertialization) {
      sampleAndAccumulate(evaluator, input.montages)
      checkCoverage(evaluator)
    }
    finalizePose(
      evaluator.accumulator,
      evaluator.referencePose,
      evaluator.outputPose,
    )
    applyInertializationStage(
      evaluator.outputPose,
      locomotionInertialization,
      deltaTime,
    )
  }
  if (locomotionInertialization) {
    applyMontageLayersAfterInertialization(evaluator, input.montages)
  }
  applyAuthoredAdditives(
    evaluator,
    evaluator.outputPose,
    input.preOverlayAdditives,
  )
  copyPose(evaluator.outputPose, evaluator.basePose)

  let resolvedOverlayCurves: ReadonlyMap<string, number> =
    EMPTY_LAYERING_CURVES
  if (input.overlayBranch) {
    clearPoseAccumulator(evaluator.overlayAccumulator)
    sampleAndAccumulate(
      evaluator,
      input.overlayBranch,
      evaluator.overlayAccumulator,
      overlayInertialization,
    )
    finalizePose(
      evaluator.overlayAccumulator,
      evaluator.referencePose,
      evaluator.overlayPose,
    )
    applyAuthoredAdditives(
      evaluator,
      evaluator.overlayPose,
      input.overlayAdditives,
      overlayInertialization,
    )
    applyInertializationStage(
      evaluator.overlayPose,
      overlayInertialization,
      deltaTime,
    )
    resolvedOverlayCurves =
      overlayInertialization?.curves ?? EMPTY_LAYERING_CURVES
  } else if (input.overlayGraph) {
    evaluator.overlayGraphCurves.clear()
    input.overlayGraph({
      rig: evaluator.rig,
      referencePose: evaluator.referencePose,
      outputPose: evaluator.overlayPose,
      outputCurves: evaluator.overlayGraphCurves,
    })
    applyAuthoredAdditives(
      evaluator,
      evaluator.overlayPose,
      input.overlayAdditives,
    )
    if (overlayInertialization) {
      overlayInertialization.curves.clear()
      for (const [name, value] of evaluator.overlayGraphCurves) {
        overlayInertialization.curves.set(name, value)
      }
      applyInertializationStage(
        evaluator.overlayPose,
        overlayInertialization,
        deltaTime,
        true,
      )
      resolvedOverlayCurves = overlayInertialization.curves
    } else {
      resolvedOverlayCurves = evaluator.overlayGraphCurves
    }
  }

  if (hasFullOverlay) {
    if (input.linkedLayer) {
      input.linkedLayer({
        rig: evaluator.rig,
        locomotionPose: evaluator.basePose,
        overlayPose: evaluator.overlayPose,
        outputPose: evaluator.outputPose,
        overlayCurves: resolvedOverlayCurves,
      })
    } else {
      applyOverlayLayers(
        evaluator,
        input.overlayLayers!,
        overlayInertialization,
      )
    }
  } else if (input.overlays) {
    clearPoseAccumulator(evaluator.overlayAccumulator)
    sampleAndAccumulate(evaluator, input.overlays, evaluator.overlayAccumulator)
    finalizePose(evaluator.overlayAccumulator, evaluator.outputPose, evaluator.overlayPose)
    applyAuthoredAdditives(
      evaluator,
      evaluator.overlayPose,
      input.overlayAdditives,
    )
    // The accumulator's per-bone coverage is the authored Layer* alpha. Its normalized pose is
    // the linked overlay source blend (pose bank/run arms/sprint arms).
    blendPoseInPlace(
      evaluator.outputPose,
      evaluator.overlayPose,
      1,
      evaluator.overlayAccumulator.weights,
    )
  }

  if (input.dynamicAdditives) {
    for (const entry of input.dynamicAdditives) {
      const weight = resolveLayeringWeight(
        entry.weight,
        entry.resolveWeight,
        overlayInertialization,
      )
      if (weight <= 0) continue
      makeDynamicAdditivePose(
        evaluator.basePose,
        entry.referencePose,
        evaluator.rig,
        evaluator.dynamicAdditivePose,
        entry.additiveSpace,
        evaluator.meshSpaceScratch,
      )
      if (entry.additiveSpace === 'mesh') {
        applyMeshSpaceAdditivePose(
          evaluator.outputPose,
          evaluator.dynamicAdditivePose,
          evaluator.rig,
          weight,
          evaluator.meshSpaceScratch,
          entry.mask,
        )
      } else {
        applyAdditivePose(
          evaluator.outputPose,
          evaluator.dynamicAdditivePose,
          weight,
          entry.mask,
        )
      }
    }
  }

  if (input.additives) {
    for (const entry of input.additives) {
      if (entry.weight <= 0) continue
      sampleClip(
        entry.sampler,
        evaluator.rig,
        entry.time,
        evaluator.samplePose,
        entry.loop,
        'additiveIdentity',
      )
      if (entry.additiveSpace === 'mesh') {
        applyMeshSpaceAdditivePose(
          evaluator.outputPose,
          evaluator.samplePose,
          evaluator.rig,
          entry.weight,
          evaluator.meshSpaceScratch,
          entry.mask,
        )
      } else {
        applyAdditivePose(evaluator.outputPose, evaluator.samplePose, entry.weight, entry.mask)
      }
      sampleEntryCurves(evaluator, entry)
    }
  }

  input.resolveBlendedCurves?.(evaluator.curves, evaluator.curves.values)

  // This evaluator-owned final node remains the backwards-compatible debug/solo transition and
  // root-motion bridge. ALS graph requests use the staged nodes above.
  prepareOutputInertialization(
    evaluator.outputInertialization,
    evaluator.inertialization,
  )
  evaluator.result.rootMotionDelta = input.rootMotion
    ? extractRootMotionDelta(input.rootMotion, evaluator.outputPose)
    : undefined
  applyInertialization(
    evaluator.inertialization,
    evaluator.outputPose,
    deltaTime,
  )
  applyOutputInertialization(
    evaluator.outputInertialization,
    evaluator.curves.values,
    evaluator.result.rootMotionDelta,
    deltaTime,
    evaluator.inertialization,
  )
  return evaluator.result
}
