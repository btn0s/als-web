import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { compileClipSampler } from './clipSampler'
import type { CurveFrame } from './curves'
import {
  createEvaluatorInertializationStage,
  createPoseEvaluator,
  evaluatePose,
} from './evaluator'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { createRigDefinition } from './rig'

function constantPositionClip(name: string, x: number) {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [x, 0, 0, x, 0, 0]),
  ])
}

function oneBoneRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  return createRigDefinition(root)
}

function resolveCurve(
  name: string,
  samples: CurveFrame,
  output: Map<string, number>,
) {
  for (const clipName of samples.activeClips) {
    const value = samples.byClip.get(clipName)?.get(name)
    if (value !== undefined) output.set(name, value)
  }
}

describe('pose evaluator staged inertialization', () => {
  it('keeps Grounded and linked Overlay histories, requests, and curves independent', () => {
    const rig = oneBoneRig()
    const baseBefore = compileClipSampler(constantPositionClip('base-before', 0), rig)
    const baseAfter = compileClipSampler(constantPositionClip('base-after', 100), rig)
    const overlayBefore = compileClipSampler(
      constantPositionClip('overlay-before', 10),
      rig,
    )
    const overlayAfter = compileClipSampler(
      constantPositionClip('overlay-after', 20),
      rig,
    )

    function evaluateBranchChange(request: 'locomotion' | 'overlay') {
      const evaluator = createPoseEvaluator(rig)
      const resolver = (
        samples: CurveFrame,
        output: Map<string, number>,
      ) => resolveCurve('BranchValue', samples, output)
      const locomotion = createEvaluatorInertializationStage(
        rig.boneCount,
        resolver,
      )
      const overlay = createEvaluatorInertializationStage(
        rig.boneCount,
        resolver,
      )
      const stagedInertialization = { locomotion, overlay }
      const overlayLayers = [{
        weight: 0,
        resolveWeight: (curves: ReadonlyMap<string, number>) =>
          (curves.get('BranchValue') ?? 0) / 20,
      }]

      evaluatePose(evaluator, {
        base: [{
          sampler: baseBefore,
          time: 0,
          weight: 1,
          curves: { BranchValue: () => 1 },
        }],
        overlayBranch: [{
          sampler: overlayBefore,
          time: 0,
          weight: 1,
          curves: { BranchValue: () => 10 },
        }],
        overlayLayers,
        stagedInertialization,
        deltaTime: 0,
      })
      const requested = request === 'locomotion' ? locomotion : overlay
      requested.inertialization.requestInertialization(1)

      const result = evaluatePose(evaluator, {
        base: [{
          sampler: baseAfter,
          time: 0,
          weight: 1,
          curves: { BranchValue: () => 3 },
        }],
        overlayBranch: [{
          sampler: overlayAfter,
          time: 0,
          weight: 1,
          curves: { BranchValue: () => 20 },
        }],
        overlayLayers,
        stagedInertialization,
        deltaTime: 0,
      })
      return {
        base: evaluator.basePose.positions[0],
        overlay: evaluator.overlayPose.positions[0],
        output: result.pose.positions[0],
        finalRequests: evaluator.inertialization.requestCount,
        locomotionRequests: locomotion.inertialization.requestCount,
        overlayRequests: overlay.inertialization.requestCount,
        locomotionCurve: locomotion.curves.get('BranchValue'),
        overlayCurve: overlay.curves.get('BranchValue'),
      }
    }

    expect(evaluateBranchChange('locomotion')).toEqual({
      base: 0,
      overlay: 20,
      output: 20,
      finalRequests: 0,
      locomotionRequests: 1,
      overlayRequests: 0,
      locomotionCurve: 1,
      overlayCurve: 20,
    })
    expect(evaluateBranchChange('overlay')).toEqual({
      base: 100,
      overlay: 10,
      output: 55,
      finalRequests: 0,
      locomotionRequests: 0,
      overlayRequests: 1,
      locomotionCurve: 3,
      overlayCurve: 10,
    })
  })

  it('normalizes the full linked Overlay once and evaluates Layering nodes in order', () => {
    const rig = oneBoneRig()
    const evaluator = createPoseEvaluator(rig)
    const overlay = createEvaluatorInertializationStage(rig.boneCount)
    const base = compileClipSampler(constantPositionClip('base', 0), rig)
    const sourceA = compileClipSampler(constantPositionClip('overlay-a', 10), rig)
    const sourceB = compileClipSampler(constantPositionClip('overlay-b', 30), rig)
    const curveA = vi.fn(() => 1)
    const curveB = vi.fn(() => 1)

    const result = evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlayBranch: [
        {
          sampler: sourceA,
          time: 0,
          weight: 0.25,
          curves: { LayerHead: curveA },
        },
        {
          sampler: sourceB,
          time: 0,
          weight: 0.75,
          curves: { LayerHead: curveB },
        },
      ],
      overlayLayers: [{ weight: 0.5 }, { weight: 0.5 }],
      stagedInertialization: { overlay },
      deltaTime: 0,
    })

    expect(evaluator.overlayPose.positions[0]).toBeCloseTo(25)
    expect(result.pose.positions[0]).toBeCloseTo(18.75)
    expect(curveA).toHaveBeenCalledOnce()
    expect(curveB).toHaveBeenCalledOnce()
  })

  it('evaluates a linked-layer graph after Overlay pose and curve inertialization', () => {
    const rig = oneBoneRig()
    const evaluator = createPoseEvaluator(rig)
    const base = compileClipSampler(constantPositionClip('base', 3), rig)
    const overlayClip = compileClipSampler(
      constantPositionClip('overlay', 17),
      rig,
    )
    const overlay = createEvaluatorInertializationStage(
      rig.boneCount,
      (samples, output) => resolveCurve('LayerHead', samples, output),
    )
    const linkedLayer = vi.fn((context) => {
      expect(context.locomotionPose.positions[0]).toBe(3)
      expect(context.overlayPose.positions[0]).toBe(17)
      expect(context.overlayCurves.get('LayerHead')).toBe(0.75)
      context.outputPose.positions[0] = 41
    })

    const result = evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlayBranch: [{
        sampler: overlayClip,
        time: 0,
        weight: 1,
        curves: { LayerHead: () => 0.75 },
      }],
      linkedLayer,
      stagedInertialization: { overlay },
      deltaTime: 0,
    })

    expect(linkedLayer).toHaveBeenCalledOnce()
    expect(result.pose.positions[0]).toBe(41)
  })

  it('uses same-frame inertialized Overlay curves for Layering and dynamic additive weights', () => {
    const rig = oneBoneRig()
    const evaluator = createPoseEvaluator(rig)
    const baseBefore = compileClipSampler(constantPositionClip('base-before', 0), rig)
    const baseAfter = compileClipSampler(constantPositionClip('base-after', 100), rig)
    const overlayBefore = compileClipSampler(
      constantPositionClip('overlay-before', 10),
      rig,
    )
    const overlayAfter = compileClipSampler(
      constantPositionClip('overlay-after', 20),
      rig,
    )
    const referencePose = resetPoseToReference(createPoseBuffer(1), rig)
    const overlay = createEvaluatorInertializationStage(
      rig.boneCount,
      (samples, output) =>
        resolveCurve('LayerSpineAdditive', samples, output),
    )
    const stagedInertialization = { overlay }
    const resolveWeight = (curves: ReadonlyMap<string, number>) =>
      curves.get('LayerSpineAdditive') ?? 0
    const overlayLayers = [{ weight: 0, resolveWeight }]
    const dynamicAdditives = [{
      referencePose,
      additiveSpace: 'local' as const,
      weight: 0,
      resolveWeight,
    }]

    evaluatePose(evaluator, {
      base: [{ sampler: baseBefore, time: 0, weight: 1 }],
      overlayBranch: [{
        sampler: overlayBefore,
        time: 0,
        weight: 1,
        curves: { LayerSpineAdditive: () => 0.5 },
      }],
      overlayLayers,
      dynamicAdditives,
      stagedInertialization,
      deltaTime: 0,
    })
    overlay.inertialization.requestInertialization(1)
    const result = evaluatePose(evaluator, {
      base: [{ sampler: baseAfter, time: 0, weight: 1 }],
      overlayBranch: [{
        sampler: overlayAfter,
        time: 0,
        weight: 1,
        curves: { LayerSpineAdditive: () => 1 },
      }],
      overlayLayers,
      dynamicAdditives,
      stagedInertialization,
      deltaTime: 0,
    })

    expect(overlay.curves.get('LayerSpineAdditive')).toBeCloseTo(0.5)
    expect(evaluator.overlayPose.positions[0]).toBeCloseTo(10)
    expect(result.pose.positions[0]).toBeCloseTo(105)
  })

  it('rejects applying an Overlay stage to already-masked legacy entries', () => {
    const rig = oneBoneRig()
    const evaluator = createPoseEvaluator(rig)
    const base = compileClipSampler(constantPositionClip('base', 0), rig)
    const overlayClip = compileClipSampler(constantPositionClip('overlay', 10), rig)
    const overlay = createEvaluatorInertializationStage(rig.boneCount)

    expect(() => evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlays: [{ sampler: overlayClip, time: 0, weight: 1 }],
      stagedInertialization: { overlay },
    })).toThrow('full pre-Layering overlayBranch')
  })

  it('requires exactly one post-Overlay graph representation', () => {
    const rig = oneBoneRig()
    const evaluator = createPoseEvaluator(rig)
    const base = compileClipSampler(constantPositionClip('base', 0), rig)
    const overlayClip = compileClipSampler(
      constantPositionClip('overlay', 10),
      rig,
    )
    const overlayBranch = [{
      sampler: overlayClip,
      time: 0,
      weight: 1,
    }]

    expect(() => evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlayBranch,
    })).toThrow('requires a linkedLayer or post-inertialization overlayLayers')
    expect(() => evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      linkedLayer: () => undefined,
    })).toThrow('linkedLayer requires a full pre-Layering overlayBranch')
    expect(() => evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlayBranch,
      linkedLayer: () => undefined,
      overlayLayers: [],
    })).toThrow('either linkedLayer or flattened overlayLayers')
  })

  it('evaluates Grounded inertia before montage and Transition-slot composition', () => {
    const rig = oneBoneRig()
    const evaluator = createPoseEvaluator(rig)
    const locomotion = createEvaluatorInertializationStage(rig.boneCount)
    const before = compileClipSampler(constantPositionClip('before', 0), rig)
    const after = compileClipSampler(constantPositionClip('after', 100), rig)
    const montageBefore = compileClipSampler(
      constantPositionClip('montage-before', 20),
      rig,
    )
    const montageAfter = compileClipSampler(
      constantPositionClip('montage-after', 40),
      rig,
    )
    const stagedInertialization = { locomotion }

    evaluatePose(evaluator, {
      base: [{ sampler: before, time: 0, weight: 1 }],
      montages: [{ sampler: montageBefore, time: 0, weight: 0.5 }],
      stagedInertialization,
      deltaTime: 0,
    })
    locomotion.inertialization.requestInertialization(1)
    const result = evaluatePose(evaluator, {
      base: [{ sampler: after, time: 0, weight: 1 }],
      montages: [{ sampler: montageAfter, time: 0, weight: 0.5 }],
      stagedInertialization,
      deltaTime: 0,
    })

    expect(locomotion.inertialization.previousPose.positions[0]).toBe(0)
    expect(evaluator.basePose.positions[0]).toBe(20)
    expect(result.pose.positions[0]).toBe(20)
  })

  it('does not diagnose pre-slot Grounded coverage as final output coverage', () => {
    const rig = oneBoneRig()
    const warning = vi.fn()
    const evaluator = createPoseEvaluator(rig, {
      development: true,
      onCoverageWarning: warning,
    })
    const locomotion = createEvaluatorInertializationStage(rig.boneCount)
    const base = compileClipSampler(constantPositionClip('base', 0), rig)
    const montage = compileClipSampler(constantPositionClip('montage', 10), rig)

    evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 0.5 }],
      montages: [{ sampler: montage, time: 0, weight: 0.5 }],
      stagedInertialization: { locomotion },
      deltaTime: 0,
    })

    expect(warning).not.toHaveBeenCalled()
  })
})
