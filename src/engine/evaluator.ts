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
import type { LocalPoseBuffer } from './poseBuffer'
import { copyPose, createPoseBuffer, resetPoseToReference } from './poseBuffer'
import type { RigDefinition } from './rig'
import type { RootMotionDelta, RootMotionExtractor } from './rootMotion'
import { extractRootMotionDelta } from './rootMotion'

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

export interface EvaluatePoseInput {
  readonly base: readonly EvaluatorLayerEntry[]
  readonly overlays?: readonly EvaluatorLayerEntry[]
  readonly montages?: readonly EvaluatorLayerEntry[]
  readonly additives?: readonly EvaluatorLayerEntry[]
  readonly dynamicAdditives?: readonly EvaluatorDynamicAdditiveEntry[]
  readonly rootMotion?: RootMotionExtractor
}

export interface EvaluatorDynamicAdditiveEntry {
  readonly referencePose: LocalPoseBuffer
  weight: number
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
  readonly curves: CurveFrame
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
  readonly overlayAccumulator: PoseAccumulator
  readonly meshSpaceScratch: MeshSpaceBlendScratch
  readonly curves: CurveFrame
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
  const curves = createCurveFrame()
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
    overlayAccumulator: createPoseAccumulator(rig.boneCount),
    meshSpaceScratch: createMeshSpaceBlendScratch(rig.boneCount),
    curves,
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

function sampleAndAccumulate(
  evaluator: PoseEvaluator,
  entries: readonly EvaluatorLayerEntry[] | undefined,
  accumulator = evaluator.accumulator,
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
    if (entry.curves) {
      sampleClipCurves(
        evaluator.curves,
        entry.curveKey ?? entry.sampler.clip.name,
        entry.curves,
        resolveClipTime(
          entry.time,
          entry.sampler.clip.duration,
          entry.loop ?? true,
        ),
      )
    }
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

/**
 * Samples and normalizes the full-coverage base, replaces masked regions with normalized overlay
 * groups, then applies ALS dynamic locomotion additives and clip-authored additives.
 */
export function evaluatePose(
  evaluator: PoseEvaluator,
  input: EvaluatePoseInput,
): PoseEvaluationResult {
  clearPoseAccumulator(evaluator.accumulator)
  beginCurveFrame(evaluator.curves)
  sampleAndAccumulate(evaluator, input.base)
  sampleAndAccumulate(evaluator, input.montages)
  checkCoverage(evaluator)
  finalizePose(evaluator.accumulator, evaluator.referencePose, evaluator.outputPose)
  copyPose(evaluator.outputPose, evaluator.basePose)

  if (input.overlays) {
    clearPoseAccumulator(evaluator.overlayAccumulator)
    sampleAndAccumulate(evaluator, input.overlays, evaluator.overlayAccumulator)
    finalizePose(evaluator.overlayAccumulator, evaluator.outputPose, evaluator.overlayPose)
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
      if (entry.weight <= 0) continue
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
          entry.weight,
          evaluator.meshSpaceScratch,
          entry.mask,
        )
      } else {
        applyAdditivePose(
          evaluator.outputPose,
          evaluator.dynamicAdditivePose,
          entry.weight,
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
      if (entry.curves) {
        sampleClipCurves(
          evaluator.curves,
          entry.curveKey ?? entry.sampler.clip.name,
          entry.curves,
          resolveClipTime(
            entry.time,
            entry.sampler.clip.duration,
            entry.loop ?? true,
          ),
        )
      }
    }
  }

  evaluator.result.rootMotionDelta = input.rootMotion
    ? extractRootMotionDelta(input.rootMotion, evaluator.outputPose)
    : undefined
  return evaluator.result
}
