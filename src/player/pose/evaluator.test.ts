import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { compileClipSampler } from './clipSampler'
import { createPoseEvaluator, evaluatePose } from './evaluator'
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
})
