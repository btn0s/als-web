// Direct GLSL translation of Unreal's VignetteSpace() and ComputeVignetteMask().
export const UNREAL_VIGNETTE_FRAGMENT_SHADER = /* glsl */ `
  uniform float intensity;
  uniform float inverseAspectRatio;

  void mainImage(
    const in vec4 inputColor,
    const in vec2 uv,
    out vec4 outputColor
  ) {
    vec2 viewportPosition = uv * 2.0 - 1.0;
    float scale = sqrt(2.0)
      / sqrt(1.0 + inverseAspectRatio * inverseAspectRatio);
    vec2 vignetteCircleSpacePosition = viewportPosition
      * vec2(1.0, inverseAspectRatio)
      * scale
      * intensity;
    float tan2Angle = dot(
      vignetteCircleSpacePosition,
      vignetteCircleSpacePosition
    );
    float inverse = 1.0 / (tan2Angle + 1.0);
    float mask = inverse * inverse;
    outputColor = vec4(inputColor.rgb * mask, inputColor.a);
  }
`

export function calculateUnrealVignetteMask(
  viewportX: number,
  viewportY: number,
  aspectRatio: number,
  intensity: number,
) {
  const inverseAspectRatio = 1 / aspectRatio
  const scale = Math.SQRT2 / Math.sqrt(
    1 + inverseAspectRatio * inverseAspectRatio,
  )
  const x = viewportX * scale * intensity
  const y = viewportY * inverseAspectRatio * scale * intensity
  const inverse = 1 / (x * x + y * y + 1)
  return inverse * inverse
}
