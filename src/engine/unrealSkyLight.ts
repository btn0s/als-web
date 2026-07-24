import * as THREE from 'three'

export interface UnrealLinearColor {
  readonly R: number
  readonly G: number
  readonly B: number
}

export interface UniformUnrealSkyLightEnvironment {
  readonly name: string
  readonly upperHemisphereColor: UnrealLinearColor
  readonly lowerHemisphereIsBlack: boolean
  readonly lowerHemisphereColor: UnrealLinearColor
}

const ENVIRONMENT_WIDTH = 64
const ENVIRONMENT_HEIGHT = 32

function writeLinearColor(
  data: Uint8Array,
  offset: number,
  color: UnrealLinearColor,
) {
  data[offset] = Math.round(THREE.MathUtils.clamp(color.R, 0, 1) * 255)
  data[offset + 1] = Math.round(
    THREE.MathUtils.clamp(color.G, 0, 1) * 255,
  )
  data[offset + 2] = Math.round(
    THREE.MathUtils.clamp(color.B, 0, 1) * 255,
  )
  data[offset + 3] = 255
}

/**
 * Builds the equirectangular source consumed by three.js's PMREM convolution for a uniform
 * specified cubemap. ALS's TC_Als_WhiteLight_HDRI is uniform; non-uniform cubemaps need their
 * source pixels rather than this compact path.
 */
export function createUniformUnrealSkyLightEnvironmentTexture(
  source: UniformUnrealSkyLightEnvironment,
) {
  const data = new Uint8Array(
    ENVIRONMENT_WIDTH * ENVIRONMENT_HEIGHT * 4,
  )
  for (let y = 0; y < ENVIRONMENT_HEIGHT; y++) {
    const upperHemisphere = y >= ENVIRONMENT_HEIGHT / 2
    const color = upperHemisphere
      ? source.upperHemisphereColor
      : source.lowerHemisphereIsBlack
        ? source.lowerHemisphereColor
        : source.upperHemisphereColor
    for (let x = 0; x < ENVIRONMENT_WIDTH; x++) {
      writeLinearColor(
        data,
        (y * ENVIRONMENT_WIDTH + x) * 4,
        color,
      )
    }
  }

  const texture = new THREE.DataTexture(
    data,
    ENVIRONMENT_WIDTH,
    ENVIRONMENT_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = source.name
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
