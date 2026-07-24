import { describe, expect, it } from 'vitest'
import {
  M_ALS_GRID_PARAMETERS,
  evaluateMAlsGridFadeOpacity,
  evaluateMAlsGridLineOpacity,
} from '../Environment/Materials/M_Als_Grid'
import { M_ALS_SKY_SPHERE_COLOR } from '../Environment/Materials/M_Als_SkySphere'
import { L_ALS_GRID_CONTENT } from './L_Als_Grid.content'
import {
  createUniformUnrealSkyLightEnvironmentTexture,
} from '../../../engine/unrealSkyLight'
import { calculateUnrealVignetteMask } from '../../../engine/unrealVignette'

describe('L_Als_Grid authored content', () => {
  it('keeps the serialized world, floor, sky, skylight, and post-process values', () => {
    expect(L_ALS_GRID_CONTENT.world.bForceNoPrecomputedLighting).toBe(true)
    expect(L_ALS_GRID_CONTENT.floor.boundsExtentCm).toMatchObject({
      X: 50_000,
      Y: 50_000,
    })
    expect(L_ALS_GRID_CONTENT.skySphere.RelativeScale3D).toEqual({
      X: 1_000,
      Y: 1_000,
      Z: 1_000,
    })
    expect(M_ALS_SKY_SPHERE_COLOR).toEqual([0, 0.333333, 2])
    expect(L_ALS_GRID_CONTENT.skyLight.Intensity).toBe(2)
    expect(L_ALS_GRID_CONTENT.skyLight).toMatchObject({
      bLowerHemisphereIsBlack: true,
      LowerHemisphereColor: {
        R: 0,
        G: 0,
        B: 0,
        A: 1,
      },
    })
    expect(L_ALS_GRID_CONTENT.postProcess.settings).toMatchObject({
      AutoExposureBias: 0,
      AutoExposureMinBrightness: 1,
      AutoExposureMaxBrightness: 1,
      VignetteIntensity: expect.closeTo(0.85),
      MotionBlurAmount: 0,
    })
  })

  it('converts the M_Als_Grid scalar parameters from centimetres once', () => {
    expect(M_ALS_GRID_PARAMETERS).toEqual({
      CellWidth: 0.75,
      FadeOffset: 10,
      FadeLength: 20,
      FadeExponent: 5,
      LineWidthExponent: 100,
      LineWidthMultiplier: expect.closeTo(1.075),
    })
  })

  it('pins the independently extracted opacity graph behind the shader', () => {
    const expressions = new Map(
      L_ALS_GRID_CONTENT.gridMaterial.expressions.map((expression) => [
        expression.name,
        expression,
      ]),
    )
    expect(L_ALS_GRID_CONTENT.gridMaterial.OpacityExpression)
      .toBe('MaterialExpressionMultiply_4')
    expect(expressions.get('MaterialExpressionSubtract_1')?.inputs).toEqual({
      A: 'MaterialExpressionWorldPosition_1',
      B: 'MaterialExpressionObjectPositionWS_1',
    })
    expect(expressions.get('MaterialExpressionDivide_0')?.inputs).toEqual({
      A: 'MaterialExpressionSubtract_1',
      B: 'MaterialExpressionScalarParameter_8',
    })
    expect(expressions.get('MaterialExpressionPower_5')?.inputs).toEqual({
      Base: 'MaterialExpressionMultiply_6',
      Exponent: 'MaterialExpressionScalarParameter_7',
    })
    expect(expressions.get('MaterialExpressionDistance_0')?.inputs).toEqual({
      A: 'MaterialExpressionWorldPosition_2',
      B: 'MaterialExpressionCameraPositionWS_2',
    })
    expect(expressions.get('MaterialExpressionPower_2')?.inputs).toEqual({
      Base: 'MaterialExpressionOneMinus_3',
      Exponent: 'MaterialExpressionScalarParameter_5',
    })
    expect(expressions.get('MaterialExpressionMultiply_4')?.inputs).toEqual({
      A: 'MaterialExpressionNamedRerouteUsage_1',
      B: 'MaterialExpressionNamedRerouteUsage_0',
    })
  })

  it('reproduces the authored periodic line and distance-fade graph', () => {
    expect(evaluateMAlsGridLineOpacity(0, 0)).toBe(1)
    expect(evaluateMAlsGridLineOpacity(0.75, 0.75)).toBe(1)
    expect(evaluateMAlsGridLineOpacity(0.375, 0.375)).toBe(0)

    expect(evaluateMAlsGridFadeOpacity(10)).toBe(1)
    expect(evaluateMAlsGridFadeOpacity(20)).toBeCloseTo(0.03125)
    expect(evaluateMAlsGridFadeOpacity(30)).toBe(0)
  })

  it('reproduces Unreal cosine-fourth vignetting in viewport space', () => {
    expect(calculateUnrealVignetteMask(0, 0, 16 / 9, 0.85)).toBe(1)
    const authoredCornerMask = 1 / (1 + 2 * 0.85 ** 2) ** 2
    expect(calculateUnrealVignetteMask(1, 1, 16 / 9, 0.85))
      .toBeCloseTo(authoredCornerMask, 12)
    expect(calculateUnrealVignetteMask(1, 1, 4 / 3, 0.85))
      .toBeCloseTo(authoredCornerMask, 12)
    expect(calculateUnrealVignetteMask(1, 1, 16 / 9, 0)).toBe(1)
  })

  it('builds the specified white cubemap with the inherited black lower hemisphere', () => {
    const texture = createUniformUnrealSkyLightEnvironmentTexture({
      name: L_ALS_GRID_CONTENT.skyLight.Cubemap,
      upperHemisphereColor:
        L_ALS_GRID_CONTENT.skyLight.cubemapSource.ColorMin,
      lowerHemisphereIsBlack:
        L_ALS_GRID_CONTENT.skyLight.bLowerHemisphereIsBlack,
      lowerHemisphereColor:
        L_ALS_GRID_CONTENT.skyLight.LowerHemisphereColor,
    })
    const data = texture.image.data as Uint8Array
    const width = texture.image.width
    const height = texture.image.height
    const lower = 0
    const upper = ((height - 1) * width) * 4

    expect(Array.from(data.slice(lower, lower + 4))).toEqual([0, 0, 0, 255])
    expect(Array.from(data.slice(upper, upper + 4)))
      .toEqual([255, 255, 255, 255])
    expect(texture.name).toBe('TC_Als_WhiteLight_HDRI')
    texture.dispose()
  })
})
