import { L_ALS_GRID_CONTENT, unrealCentimetersToMeters } from '../../Levels/L_Als_Grid.content'

const authored = L_ALS_GRID_CONTENT.gridMaterial.parameters

export const M_ALS_GRID_PARAMETERS = {
  CellWidth: unrealCentimetersToMeters(authored.CellWidth),
  FadeOffset: unrealCentimetersToMeters(authored.FadeOffset),
  FadeLength: unrealCentimetersToMeters(authored.FadeLength),
  FadeExponent: authored.FadeExponent,
  LineWidthExponent: authored.LineWidthExponent,
  LineWidthMultiplier: authored.LineWidthMultiplier,
} as const

function positiveClampedPower(base: number, exponent: number) {
  return Math.pow(Math.max(base, 0), exponent)
}

function lineOpacityForCoordinate(coordinate: number) {
  const gridCoordinate = coordinate / M_ALS_GRID_PARAMETERS.CellWidth
  const fraction = gridCoordinate - Math.floor(gridCoordinate)
  const distanceFromCellCenter = Math.abs(fraction - 0.5)
  const biasedDistance = (distanceFromCellCenter - 0.25) * 4
  return positiveClampedPower(
    biasedDistance * M_ALS_GRID_PARAMETERS.LineWidthMultiplier,
    M_ALS_GRID_PARAMETERS.LineWidthExponent,
  )
}

export function evaluateMAlsGridLineOpacity(
  worldX: number,
  worldZ: number,
) {
  return Math.min(
    lineOpacityForCoordinate(worldX) + lineOpacityForCoordinate(worldZ),
    1,
  )
}

export function evaluateMAlsGridFadeOpacity(distanceFromCamera: number) {
  const normalizedDistance = Math.min(
    Math.max(
      (distanceFromCamera - M_ALS_GRID_PARAMETERS.FadeOffset)
        / M_ALS_GRID_PARAMETERS.FadeLength,
      0,
    ),
    1,
  )
  return Math.pow(
    1 - normalizedDistance,
    M_ALS_GRID_PARAMETERS.FadeExponent,
  )
}

// Direct transliteration of M_Als_Grid's serialized material-expression graph.
// Unreal centimetres are converted at the data boundary; the shader stays in metres.
export const M_ALS_GRID_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vGridPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vGridPosition = worldPosition.xz - modelMatrix[3].xz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const M_ALS_GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform float CellWidth;
  uniform float FadeOffset;
  uniform float FadeLength;
  uniform float FadeExponent;
  uniform float LineWidthExponent;
  uniform float LineWidthMultiplier;

  varying vec3 vWorldPosition;
  varying vec2 vGridPosition;

  void main() {
    vec2 gridCoordinate = vGridPosition / CellWidth;
    vec2 distanceFromCellCenter = abs(fract(gridCoordinate) - 0.5);
    vec2 biasedDistance = (distanceFromCellCenter - 0.25) * 4.0;
    vec2 lineOpacity = pow(
      max(biasedDistance * LineWidthMultiplier, vec2(0.0)),
      vec2(LineWidthExponent)
    );

    float distanceFromCamera = distance(vWorldPosition, cameraPosition);
    float normalizedDistance = clamp(
      (distanceFromCamera - FadeOffset) / FadeLength,
      0.0,
      1.0
    );
    float fadeOpacity = pow(1.0 - normalizedDistance, FadeExponent);
    float opacity = min((lineOpacity.x + lineOpacity.y) * fadeOpacity, 1.0);

    gl_FragColor = vec4(1.0, 1.0, 1.0, opacity);
  }
`
