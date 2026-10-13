import { describe, expect, it } from 'vitest'
import {
  ALS_LAYER_REGIONS,
  ALS_OVERLAY_MODES,
  DEFAULT_OVERLAY_CLIP,
  RIFLE_OVERLAY_CLIPS,
  resolveArmAdditiveSpaceAmounts,
} from './overlayMode'

describe('ALS OverlayMode layering', () => {
  it('preserves the ALS overlay-mode selector and authored Rifle clip manifest', () => {
    expect(ALS_OVERLAY_MODES).toEqual(['Default', 'Rifle', 'PistolTwoHanded', 'PistolOneHanded'])
    expect(DEFAULT_OVERLAY_CLIP).toBe('A_Als_Default_Poses')
    expect(RIFLE_OVERLAY_CLIPS).toEqual({
      poses: 'A_Als_Rifle_Poses',
      runArms: 'A_Als_Rifle_Run_Arms',
      sprintArms: 'A_Als_Rifle_Sprint_Arms',
      sprintImpulseArms: 'A_Als_Rifle_Sprint_Impulse_Arms',
    })
  })

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

  it('keeps mesh-space arms enabled until the authored local-space curve is full weight', () => {
    expect(resolveArmAdditiveSpaceAmounts(0)).toEqual({ local: 0, mesh: 1 })
    expect(resolveArmAdditiveSpaceAmounts(0.5)).toEqual({ local: 0.5, mesh: 1 })
    expect(resolveArmAdditiveSpaceAmounts(1)).toEqual({ local: 1, mesh: 0 })
  })
})
