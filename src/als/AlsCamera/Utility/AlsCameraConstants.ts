// UAlsCameraConstants animation-curve names.
export const CAMERA_OFFSET_X_CURVE_NAME = 'CameraOffsetX'
export const CAMERA_OFFSET_Y_CURVE_NAME = 'CameraOffsetY'
export const CAMERA_OFFSET_Z_CURVE_NAME = 'CameraOffsetZ'
export const FOV_OFFSET_CURVE_NAME = 'FovOffset'
export const PIVOT_OFFSET_X_CURVE_NAME = 'PivotOffsetX'
export const PIVOT_OFFSET_Y_CURVE_NAME = 'PivotOffsetY'
export const PIVOT_OFFSET_Z_CURVE_NAME = 'PivotOffsetZ'
export const LOCATION_LAG_X_CURVE_NAME = 'LocationLagX'
export const LOCATION_LAG_Y_CURVE_NAME = 'LocationLagY'
export const LOCATION_LAG_Z_CURVE_NAME = 'LocationLagZ'
export const ROTATION_LAG_CURVE_NAME = 'RotationLag'
export const FIRST_PERSON_OVERRIDE_CURVE_NAME = 'FirstPersonOverride'
export const TRACE_OVERRIDE_CURVE_NAME = 'TraceOverride'

// UAlsCameraConstants debug-display names.
export const CAMERA_CURVES_DEBUG_DISPLAY_NAME = 'ALS.CameraCurves'
export const CAMERA_SHAPES_DEBUG_DISPLAY_NAME = 'ALS.CameraShapes'
export const CAMERA_TRACES_DEBUG_DISPLAY_NAME = 'ALS.CameraTraces'

export const ALS_CAMERA_CURVE_NAMES = [
  CAMERA_OFFSET_X_CURVE_NAME,
  CAMERA_OFFSET_Y_CURVE_NAME,
  CAMERA_OFFSET_Z_CURVE_NAME,
  FOV_OFFSET_CURVE_NAME,
  PIVOT_OFFSET_X_CURVE_NAME,
  PIVOT_OFFSET_Y_CURVE_NAME,
  PIVOT_OFFSET_Z_CURVE_NAME,
  LOCATION_LAG_X_CURVE_NAME,
  LOCATION_LAG_Y_CURVE_NAME,
  LOCATION_LAG_Z_CURVE_NAME,
  ROTATION_LAG_CURVE_NAME,
  FIRST_PERSON_OVERRIDE_CURVE_NAME,
  TRACE_OVERRIDE_CURVE_NAME,
] as const

export type AlsCameraCurveName = typeof ALS_CAMERA_CURVE_NAMES[number]
