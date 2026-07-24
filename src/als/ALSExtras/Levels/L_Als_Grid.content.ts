import gridLevelContentSource from '../../../../scripts/extract-als/grid-level-content.json?raw'

interface LinearColor {
  readonly R: number
  readonly G: number
  readonly B: number
  readonly A: number
}

interface Vector {
  readonly X: number
  readonly Y: number
  readonly Z: number
}

interface MaterialExpression {
  readonly name: string
  readonly type: string
  readonly inputs?: Readonly<Record<string, string>>
  readonly values?: Readonly<Record<string, string | number | boolean>>
  readonly declaration?: string
}

export interface LAlsGridContent {
  readonly schemaVersion: number
  readonly world: {
    readonly bForceNoPrecomputedLighting: boolean
  }
  readonly postProcess: {
    readonly bUnbound: boolean
    readonly settings: {
      readonly AutoExposureBias: number
      readonly AutoExposureMinBrightness: number
      readonly AutoExposureMaxBrightness: number
      readonly VignetteIntensity: number
      readonly MotionBlurAmount: number
    }
  }
  readonly floor: {
    readonly actorLabel: string
    readonly mesh: string
    readonly material: string
    readonly CastShadow: boolean
    readonly boundsExtentCm: Vector
  }
  readonly gridMaterial: {
    readonly BlendMode: string
    readonly ShadingModel: string
    readonly TwoSided: boolean
    readonly EmissiveColor: LinearColor
    readonly OpacityExpression: string
    readonly parameters: {
      readonly CellWidth: number
      readonly FadeOffset: number
      readonly FadeLength: number
      readonly FadeExponent: number
      readonly LineWidthExponent: number
      readonly LineWidthMultiplier: number
    }
    readonly expressions: readonly MaterialExpression[]
  }
  readonly skySphere: {
    readonly actorLabel: string
    readonly mesh: string
    readonly material: string
    readonly RelativeScale3D: Vector
    readonly CastShadow: boolean
    readonly CollisionEnabled: string
    readonly ShadingModel: string
    readonly TwoSided: boolean
    readonly bIsSky: boolean
    readonly ColorParameter: {
      readonly name: string
      readonly value: LinearColor
    }
  }
  readonly skyLight: {
    readonly actorLabel: string
    readonly SourceType: string
    readonly Cubemap: string
    readonly Intensity: number
    readonly bLowerHemisphereIsBlack: boolean
    readonly LowerHemisphereColor: LinearColor
    readonly cubemapSource: {
      readonly NumSlices: number
      readonly ColorMin: LinearColor
      readonly ColorMax: LinearColor
    }
  }
  readonly validations: readonly {
    readonly name: string
    readonly passed: boolean
  }[]
}

function parseContent(source: string): LAlsGridContent {
  const content = JSON.parse(source) as LAlsGridContent
  if (
    content.schemaVersion !== 1
    || content.validations.some((validation) => !validation.passed)
  ) {
    throw new Error('L_Als_Grid content oracle failed validation')
  }
  return content
}

export const L_ALS_GRID_CONTENT = parseContent(gridLevelContentSource)

export function unrealCentimetersToMeters(value: number) {
  return value * 0.01
}
