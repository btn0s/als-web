import type { AlsVector3 } from '../State/AlsLocomotionState'
import cameraContentSource from '../../../scripts/extract-als/camera-content.json?raw'

interface ExtractedValue<T> {
  readonly value: T
}

interface ExtractedCameraSettings {
  readonly settings: {
    readonly defaults: {
      readonly bIgnoreTimeDilation: ExtractedValue<boolean>
      readonly TeleportDistanceThreshold: ExtractedValue<number>
      readonly FirstPerson: {
        readonly FieldOfView: ExtractedValue<number>
        readonly CameraSocketName: ExtractedValue<string>
      }
      readonly ThirdPerson: {
        readonly FieldOfView: ExtractedValue<number>
        readonly FirstPivotSocketName: ExtractedValue<string>
        readonly SecondPivotSocketName: ExtractedValue<string>
        readonly TraceRadius: ExtractedValue<number>
        readonly TraceChannel: ExtractedValue<'ECC_Visibility'>
        readonly TraceShoulderLeftSocketName: ExtractedValue<string>
        readonly TraceShoulderRightSocketName: ExtractedValue<string>
        readonly TraceOverrideOffset: ExtractedValue<
          readonly [number, number, number]
        >
        readonly bEnableTraceDistanceSmoothing: ExtractedValue<boolean>
        readonly TraceDistanceSmoothing: {
          readonly InterpolationSpeed: ExtractedValue<number>
        }
      }
    }
  }
}

const extractedSettings = (
  JSON.parse(cameraContentSource) as ExtractedCameraSettings
).settings.defaults
const CENTIMETRES_TO_METRES = 0.01

/**
 * Runtime-metre port of `FAlsFirstPersonCameraSettings`.
 *
 * ALS stores world distances in centimetres. Every public camera solver location and setting in
 * this module is metres; source defaults are converted exactly once at this boundary.
 */
export interface AlsFirstPersonCameraSettings {
  readonly fieldOfView: number
  readonly cameraSocketName: string
}

/** Exact `FAlsTraceDistanceSmoothingSettings` shape. */
export interface AlsTraceDistanceSmoothingSettings {
  readonly interpolationSpeed: number
}

/** Runtime-metre port of `FAlsThirdPersonCameraSettings`. */
export interface AlsThirdPersonCameraSettings {
  readonly fieldOfView: number
  readonly firstPivotSocketName: string
  readonly secondPivotSocketName: string
  /** Metres; `FAlsThirdPersonCameraSettings::TraceRadius` defaults to 15 cm. */
  readonly traceRadius: number
  readonly traceChannel: 'ECC_Visibility'
  readonly traceShoulderLeftSocketName: string
  readonly traceShoulderRightSocketName: string
  /** Metres; the C++ default `{0, 0, 40}` is centimetres. */
  readonly traceOverrideOffset: Readonly<AlsVector3>
  readonly enableTraceDistanceSmoothing: boolean
  readonly traceDistanceSmoothing: AlsTraceDistanceSmoothingSettings
}

/**
 * Pure geometric subset of `UAlsCameraSettings`.
 *
 * `PostProcess` is intentionally outside the framework-free solver. `ignoreTimeDilation` remains
 * represented so an eventual runtime adapter can pass the same effective delta time as C++.
 */
export interface AlsCameraSettings {
  readonly ignoreTimeDilation: boolean
  /** Metres; `UAlsCameraSettings::TeleportDistanceThreshold` defaults to 200 cm. */
  readonly teleportDistanceThreshold: number
  readonly firstPerson: AlsFirstPersonCameraSettings
  readonly thirdPerson: AlsThirdPersonCameraSettings
}

/**
 * Exact defaults from the camera content oracle. The extractor reads the C++ defaults and asserts
 * that CS_Als_Default contributes no serialized overrides; spatial values cross cm→m here once.
 */
export const ALS_CAMERA_SETTINGS: Readonly<AlsCameraSettings> = {
  ignoreTimeDilation: extractedSettings.bIgnoreTimeDilation.value,
  teleportDistanceThreshold:
    extractedSettings.TeleportDistanceThreshold.value
    * CENTIMETRES_TO_METRES,
  firstPerson: {
    fieldOfView: extractedSettings.FirstPerson.FieldOfView.value,
    cameraSocketName: extractedSettings.FirstPerson.CameraSocketName.value,
  },
  thirdPerson: {
    fieldOfView: extractedSettings.ThirdPerson.FieldOfView.value,
    firstPivotSocketName:
      extractedSettings.ThirdPerson.FirstPivotSocketName.value,
    secondPivotSocketName:
      extractedSettings.ThirdPerson.SecondPivotSocketName.value,
    traceRadius:
      extractedSettings.ThirdPerson.TraceRadius.value
      * CENTIMETRES_TO_METRES,
    traceChannel: extractedSettings.ThirdPerson.TraceChannel.value,
    traceShoulderLeftSocketName:
      extractedSettings.ThirdPerson.TraceShoulderLeftSocketName.value,
    traceShoulderRightSocketName:
      extractedSettings.ThirdPerson.TraceShoulderRightSocketName.value,
    traceOverrideOffset: {
      x:
        extractedSettings.ThirdPerson.TraceOverrideOffset.value[0]
        * CENTIMETRES_TO_METRES,
      y:
        extractedSettings.ThirdPerson.TraceOverrideOffset.value[1]
        * CENTIMETRES_TO_METRES,
      z:
        extractedSettings.ThirdPerson.TraceOverrideOffset.value[2]
        * CENTIMETRES_TO_METRES,
    },
    enableTraceDistanceSmoothing:
      extractedSettings.ThirdPerson.bEnableTraceDistanceSmoothing.value,
    traceDistanceSmoothing: {
      interpolationSpeed:
        extractedSettings.ThirdPerson.TraceDistanceSmoothing
          .InterpolationSpeed.value,
    },
  },
}
