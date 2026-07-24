import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { compileClipSampler } from './clipSampler'
import {
  createEvaluatorInertializationStage,
  createPoseEvaluator,
  evaluatePose,
} from './evaluator'
import { compileBoneMask } from './blend'
import { accumulateAdditiveCurveValues } from './curves'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { createRigDefinition } from './rig'

function constantPositionClip(name: string, x: number) {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [x, 0, 0, x, 0, 0]),
  ])
}

describe('pose evaluator', () => {
  it('normalizes under-covered active weights without blending toward ref pose and warns in dev', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    root.position.x = 100
    const rig = createRigDefinition(root)
    const warning = vi.fn()
    const evaluator = createPoseEvaluator(rig, {
      development: true,
      onCoverageWarning: warning,
    })
    const a = compileClipSampler(constantPositionClip('a', 0), rig)
    const b = compileClipSampler(constantPositionClip('b', 10), rig)

    const result = evaluatePose(evaluator, {
      base: [
        { sampler: a, time: 0, weight: 0.25 },
        { sampler: b, time: 0, weight: 0.25 },
      ],
    })

    expect(result.pose.positions[0]).toBeCloseTo(5)
    expect(warning).toHaveBeenCalledOnce()
    expect(warning.mock.calls[0][0]).toMatchObject({
      minimum: 0.5,
      underCoveredBones: 1,
    })
  })

  it('skips zero-weight clip sampling, including its curves', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const active = compileClipSampler(constantPositionClip('active', 2), rig)
    const inactive = compileClipSampler(constantPositionClip('inactive', 20), rig)
    const inactiveCurve = vi.fn(() => 1)

    const result = evaluatePose(evaluator, {
      base: [
        { sampler: active, time: 0, weight: 1 },
        {
          sampler: inactive,
          time: 0,
          weight: 0,
          curves: { FootLeftLock: inactiveCurve },
        },
      ],
    })

    expect(result.pose.positions[0]).toBeCloseTo(2)
    expect(inactiveCurve).not.toHaveBeenCalled()
    expect(result.curves.activeClips.size).toBe(0)
  })

  it('exposes active per-clip scalar curve samples at the resolved clip time', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const clip = compileClipSampler(constantPositionClip('walk', 2), rig)
    const footLock = vi.fn((time: number) => time * 2)

    const result = evaluatePose(evaluator, {
      base: [{
        sampler: clip,
        time: 1.25,
        weight: 1,
        loop: true,
        curves: { FootLeftLock: footLock },
      }],
    })

    expect(footLock).toHaveBeenCalledWith(0.25)
    expect(result.curves.byClip.get('walk')?.get('FootLeftLock')).toBeCloseTo(0.5)
    expect(result.curves.activeClips.has('walk')).toBe(true)
  })

  it('fully replaces a masked region when its overlay Layer alpha is one', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const hand = new THREE.Bone()
    hand.name = 'hand_l'
    root.add(hand)
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const base = compileClipSampler(constantPositionClip('base', 2), rig)
    const overlay = compileClipSampler(constantPositionClip('overlay', 10), rig)

    const result = evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlays: [{
        sampler: overlay,
        time: 0,
        weight: 1,
        mask: compileBoneMask(rig, (name) => name === 'root'),
      }],
    })

    expect(result.pose.positions[0]).toBeCloseTo(10)
    expect(result.pose.positions[3]).toBeCloseTo(0)
  })

  it('applies dynamic locomotion delta after the overlay pose', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const locomotion = compileClipSampler(constantPositionClip('locomotion', 4), rig)
    const overlay = compileClipSampler(constantPositionClip('overlay', 10), rig)
    const reference = resetPoseToReference(createPoseBuffer(1), rig)

    const result = evaluatePose(evaluator, {
      base: [{ sampler: locomotion, time: 0, weight: 1 }],
      overlays: [{ sampler: overlay, time: 0, weight: 1 }],
      dynamicAdditives: [{
        referencePose: reference,
        additiveSpace: 'local',
        weight: 0.5,
      }],
    })

    expect(result.pose.positions[0]).toBeCloseTo(12)
  })

  it('derives a raw authored additive over its named reference before copying the layering base', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const child = new THREE.Bone()
    child.name = 'child'
    root.add(child)
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const base = compileClipSampler(new THREE.AnimationClip('base', 1, [
      new THREE.VectorKeyframeTrack(
        'root.position',
        [0, 1],
        [20, 0, 0, 20, 0, 0],
      ),
      new THREE.VectorKeyframeTrack(
        'child.position',
        [0, 1],
        [30, 0, 0, 30, 0, 0],
      ),
    ]), rig)
    const rawSource = compileClipSampler(new THREE.AnimationClip('transition', 1, [
      new THREE.VectorKeyframeTrack(
        'root.position',
        [0, 1],
        [13, 0, 0, 13, 0, 0],
      ),
    ]), rig)
    const overlay = compileClipSampler(constantPositionClip('overlay', 100), rig)
    const authoredReference = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    authoredReference.positions[0] = 10
    authoredReference.positions[3] = 7

    const result = evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1, loop: false }],
      preOverlayAdditives: [{
        sampler: rawSource,
        referencePose: authoredReference,
        additiveSpace: 'local',
        time: 0,
        weight: 0.5,
        loop: false,
        curveKey: 'transition',
        curves: {
          AllowTransitions: () => -1,
          FootstepSoundBlock: () => 1,
        },
      }],
      overlays: [{
        sampler: overlay,
        time: 0,
        weight: 1,
        mask: compileBoneMask(rig, (name) => name === 'root'),
      }],
      resolveBlendedCurves(samples, output) {
        output.set('AllowTransitions', 1)
        accumulateAdditiveCurveValues(samples, output, [
          { clipKey: 'transition', weight: 0.5 },
        ])
      },
    })

    // Raw source 13 minus authored reference 10 produces a +3 delta, weighted to +1.5.
    expect(evaluator.basePose.positions[0]).toBeCloseTo(21.5)
    // The source omits child tracks, so authored-reference fallback makes its child delta zero.
    expect(evaluator.basePose.positions[3]).toBeCloseTo(30)
    // The downstream overlay sees the composed base but still owns its masked final region.
    expect(result.pose.positions[0]).toBeCloseTo(100)
    expect(result.pose.positions[3]).toBeCloseTo(30)
    expect(result.curves.byClip.get('transition')?.get('AllowTransitions')).toBe(-1)
    expect(result.curves.values.get('AllowTransitions')).toBeCloseTo(0.5)
    expect(result.curves.values.get('FootstepSoundBlock')).toBeCloseTo(0.5)
  })

  it('derives an authored additive inside the linked-overlay pose', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const base = compileClipSampler(constantPositionClip('base', 20), rig)
    const overlay = compileClipSampler(constantPositionClip('overlay', 10), rig)
    const rawSource = compileClipSampler(
      constantPositionClip('secondary-motion', 13),
      rig,
    )
    const authoredReference = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    authoredReference.positions[0] = 10

    const result = evaluatePose(evaluator, {
      base: [{ sampler: base, time: 0, weight: 1 }],
      overlays: [{ sampler: overlay, time: 0, weight: 1 }],
      overlayAdditives: [{
        sampler: rawSource,
        referencePose: authoredReference,
        additiveSpace: 'local',
        time: 0,
        weight: 0.75,
      }],
    })

    expect(evaluator.basePose.positions[0]).toBeCloseTo(20)
    expect(result.pose.positions[0]).toBeCloseTo(12.25)
  })

  it('evaluates every retained non-additive montage with the Slot source complement', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const source = compileClipSampler(constantPositionClip('source', 10), rig)
    const outgoing = compileClipSampler(constantPositionClip('outgoing', 20), rig)
    const incoming = compileClipSampler(constantPositionClip('incoming', 40), rig)

    const result = evaluatePose(evaluator, {
      base: [],
      slots: [{
        source: [{ sampler: source, time: 0, weight: 1 }],
        montages: [
          { sampler: outgoing, time: 0, weight: 0.25 },
          { sampler: incoming, time: 0, weight: 0.5 },
        ],
        weight: 1,
        montageWeight: 0,
      }],
    })

    // GetSlotWeight returns SourceWeight 0.25; SlotEvaluatePose blends all three weights directly.
    expect(result.pose.positions[0]).toBeCloseTo(
      10 * 0.25 + 20 * 0.25 + 40 * 0.5,
    )
  })

  it('normalizes retained montage poses when their raw total exceeds one', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const source = compileClipSampler(constantPositionClip('source', 10), rig)
    const first = compileClipSampler(constantPositionClip('first', 20), rig)
    const second = compileClipSampler(constantPositionClip('second', 40), rig)

    const result = evaluatePose(evaluator, {
      base: [],
      slots: [{
        source: [{ sampler: source, time: 0, weight: 1 }],
        montages: [
          { sampler: first, time: 0, weight: 0.8 },
          { sampler: second, time: 0, weight: 0.7 },
        ],
        weight: 1,
        montageWeight: 0,
      }],
    })

    expect(result.pose.positions[0]).toBeCloseTo(
      (20 * 0.8 + 40 * 0.7) / 1.5,
    )
  })

  it('applies retained additive montages after the non-additive Slot pass', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const source = compileClipSampler(constantPositionClip('source', 10), rig)
    const additive = compileClipSampler(constantPositionClip('additive', 4), rig)

    const result = evaluatePose(evaluator, {
      base: [],
      slots: [{
        source: [{ sampler: source, time: 0, weight: 1 }],
        montages: [{
          sampler: additive,
          time: 0,
          weight: 0.5,
          additiveSpace: 'local',
        }],
        weight: 1,
        montageWeight: 0,
      }],
    })

    expect(result.pose.positions[0]).toBeCloseTo(12)
  })

  it('evaluates PostLocomotion as a distinct sequential Slot after Transition', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const transition = compileClipSampler(
      constantPositionClip('transition', 20),
      rig,
    )
    const mantle = compileClipSampler(
      constantPositionClip('mantle', 40),
      rig,
    )

    const result = evaluatePose(evaluator, {
      base: [],
      locomotionGraph(context) {
        context.outputPose.positions.fill(0)
        context.outputPose.positions[0] = 10
        context.outputPose.rotations.fill(0)
        context.outputPose.rotations[3] = 1
        context.outputPose.scales.fill(1)
        context.outputCurves.clear()
      },
      montages: [{
        sampler: transition,
        time: 0,
        weight: 0.5,
      }],
      postLocomotionMontages: [{
        sampler: mantle,
        time: 0,
        weight: 0.5,
      }],
      stagedInertialization: {
        locomotion: createEvaluatorInertializationStage(rig.boneCount),
      },
    })

    // Transition: lerp(10, 20, .5) = 15. PostLocomotion then receives that Slot output:
    // lerp(15, 40, .5) = 27.5. Flattening both montages into one node would produce 22.5.
    expect(result.pose.positions[0]).toBeCloseTo(27.5)
  })

  it('evaluates a full-weight PostLocomotion Slot after authored Transition additive output', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const locomotion = compileClipSampler(
      constantPositionClip('locomotion', 10),
      rig,
    )
    const transition = compileClipSampler(
      constantPositionClip('transition-additive', 7),
      rig,
    )
    const mantle = compileClipSampler(
      constantPositionClip('mantle', 40),
      rig,
    )
    const transitionReference = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    transitionReference.positions[0] = 2

    const result = evaluatePose(evaluator, {
      base: [{
        sampler: locomotion,
        time: 0,
        weight: 1,
      }],
      preOverlayAdditives: [{
        sampler: transition,
        referencePose: transitionReference,
        additiveSpace: 'local',
        time: 0,
        weight: 1,
      }],
      postLocomotionMontages: [{
        sampler: mantle,
        time: 0,
        weight: 1,
      }],
    })

    // Transition first produces 10 + (7 - 2) = 15. The full PostLocomotion Slot then replaces
    // that complete result with 40. Applying Transition after node 15 would incorrectly yield 45.
    expect(result.pose.positions[0]).toBeCloseTo(40)
  })
})
