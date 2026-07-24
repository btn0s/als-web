import { describe, expect, it, vi } from 'vitest'
import {
  ALS_LAYER_REGIONS,
  blendOverlayCurve,
  resolveArmAdditiveSpaceAmounts,
  resolveRifleOverlaySourceWeights,
} from './overlayMode'

describe('ALS OverlayMode layering', () => {
  it('maps every non-slot UAlsConstants Layer* region and variant', () => {
    expect(ALS_LAYER_REGIONS).toEqual([
      {
        region: 'head',
        baseCurve: 'LayerHead',
        additiveCurve: 'LayerHeadAdditive',
        additiveSpace: 'mesh',
      },
      {
        region: 'armLeft',
        baseCurve: 'LayerArmLeft',
        additiveCurve: 'LayerArmLeftAdditive',
        localSpaceCurve: 'LayerArmLeftLocalSpace',
      },
      {
        region: 'armRight',
        baseCurve: 'LayerArmRight',
        additiveCurve: 'LayerArmRightAdditive',
        localSpaceCurve: 'LayerArmRightLocalSpace',
      },
      { region: 'handLeft', baseCurve: 'LayerHandLeft' },
      { region: 'handRight', baseCurve: 'LayerHandRight' },
      {
        region: 'spine',
        baseCurve: 'LayerSpine',
        additiveCurve: 'LayerSpineAdditive',
        additiveSpace: 'mesh',
      },
      { region: 'pelvis', baseCurve: 'LayerPelvis' },
      { region: 'legs', baseCurve: 'LayerLegs' },
    ])
  })

  it('selects the pose bank, run arms, and sprint arms at ALS PoseGait landmarks', () => {
    expect(resolveRifleOverlaySourceWeights(0)).toEqual({
      poses: 1,
      runArms: 0,
      sprintArms: 0,
    })
    expect(resolveRifleOverlaySourceWeights(1)).toEqual({
      poses: 1,
      runArms: 0,
      sprintArms: 0,
    })
    expect(resolveRifleOverlaySourceWeights(1.5)).toEqual({
      poses: 0.5,
      runArms: 0.5,
      sprintArms: 0,
    })
    expect(resolveRifleOverlaySourceWeights(2)).toEqual({
      poses: 0,
      runArms: 1,
      sprintArms: 0,
    })
    expect(resolveRifleOverlaySourceWeights(2.5)).toEqual({
      poses: 0,
      runArms: 0.5,
      sprintArms: 0.5,
    })
    expect(resolveRifleOverlaySourceWeights(3)).toEqual({
      poses: 0,
      runArms: 0,
      sprintArms: 1,
    })
  })

  it('samples each source clip own curve and treats missing curves as zero', () => {
    const posesCurve = vi.fn(() => 0.5)
    const runCurve = vi.fn(() => 1)
    expect(blendOverlayCurve([
      { curves: { LayerArmRightAdditive: posesCurve }, time: 0, weight: 0.25 },
      { curves: { LayerArmRightAdditive: runCurve }, time: 0.4, weight: 0.5 },
      { curves: {}, time: 0.2, weight: 0.25 },
    ], 'LayerArmRightAdditive')).toBeCloseTo(0.625)
    expect(posesCurve).toHaveBeenCalledWith(0)
    expect(runCurve).toHaveBeenCalledWith(0.4)
  })

  it('clamps authored float noise to an evaluator-safe alpha', () => {
    expect(blendOverlayCurve([
      { curves: { LayerArmLeftAdditive: () => -4.32134e-8 }, time: 0, weight: 1 },
    ], 'LayerArmLeftAdditive')).toBe(0)
  })

  it('keeps mesh-space arms enabled until the authored local-space curve is full weight', () => {
    expect(resolveArmAdditiveSpaceAmounts(0)).toEqual({ local: 0, mesh: 1 })
    expect(resolveArmAdditiveSpaceAmounts(0.5)).toEqual({ local: 0.5, mesh: 1 })
    expect(resolveArmAdditiveSpaceAmounts(1)).toEqual({ local: 1, mesh: 0 })
  })
})
