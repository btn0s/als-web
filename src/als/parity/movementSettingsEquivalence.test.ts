/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_MOVEMENT_SETTINGS,
  ALS_ROTATION_MODES,
  ALS_STANCES,
  sampleGroundedMovementParameters,
} from '../Settings/AlsMovementSettings'

interface ExtractedKey {
  readonly InterpMode: 'RCIM_Constant' | 'RCIM_Linear' | 'RCIM_Cubic'
  readonly Time: number
  readonly Value: number
  readonly ArriveTangent: number
  readonly LeaveTangent: number
}

interface ExtractedChannel {
  readonly keys: readonly ExtractedKey[]
}

interface ExtractedCurve {
  readonly channels: Readonly<Record<string, ExtractedChannel>>
}

interface ExtractedGaitSettings {
  readonly WalkForwardSpeed: number
  readonly WalkBackwardSpeed: number
  readonly RunForwardSpeed: number
  readonly RunBackwardSpeed: number
  readonly SprintSpeed: number
  readonly AccelerationAndDecelerationAndGroundFrictionCurve: string
  readonly RotationInterpolationSpeedCurve: string
}

interface ExtractedMovementSettings {
  readonly settings: {
    readonly rotationModes: Readonly<Record<string, {
      readonly stances: Readonly<Record<string, ExtractedGaitSettings>>
    }>>
  }
  readonly curves: Readonly<Record<string, ExtractedCurve>>
}

const extracted = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/movement-settings.json', import.meta.url),
  'utf8',
)) as ExtractedMovementSettings

function sampleExtracted(keys: readonly ExtractedKey[], time: number) {
  if (time <= keys[0].Time) return keys[0].Value
  if (time >= keys[keys.length - 1].Time) return keys[keys.length - 1].Value
  const index = keys.findIndex((key) => key.Time > time) - 1
  const from = keys[index]
  const to = keys[index + 1]
  if (from.InterpMode === 'RCIM_Constant') return from.Value
  const duration = to.Time - from.Time
  const alpha = (time - from.Time) / duration
  if (from.InterpMode === 'RCIM_Linear') {
    return from.Value + (to.Value - from.Value) * alpha
  }
  const alphaSquared = alpha * alpha
  const alphaCubed = alphaSquared * alpha
  return (
    (2 * alphaCubed - 3 * alphaSquared + 1) * from.Value
    + (alphaCubed - 2 * alphaSquared + alpha)
      * from.LeaveTangent * duration
    + (-2 * alphaCubed + 3 * alphaSquared) * to.Value
    + (alphaCubed - alphaSquared) * to.ArriveTangent * duration
  )
}

function expectedCurveFamily(assetName: string) {
  return assetName.endsWith('_Responsive') ? 'responsive' : 'normal'
}

describe('ALS content oracle: MS_Als_Normal', () => {
  it.each(ALS_ROTATION_MODES.flatMap((rotationMode) =>
    ALS_STANCES.map((stance) => ({ rotationMode, stance })),
  ))(
    '$rotationMode / $stance settings trace to the extracted data asset',
    ({ rotationMode, stance }) => {
      const runtime = ALS_MOVEMENT_SETTINGS[rotationMode][stance]
      const source = extracted.settings.rotationModes[
        `Als.RotationMode.${rotationMode}`
      ].stances[`Als.Stance.${stance}`]

      expect({
        walkForwardSpeed: source.WalkForwardSpeed / 100,
        walkBackwardSpeed: source.WalkBackwardSpeed / 100,
        runForwardSpeed: source.RunForwardSpeed / 100,
        runBackwardSpeed: source.RunBackwardSpeed / 100,
        sprintSpeed: source.SprintSpeed / 100,
        movementCurve: expectedCurveFamily(
          source.AccelerationAndDecelerationAndGroundFrictionCurve,
        ),
        rotationCurve: expectedCurveFamily(
          source.RotationInterpolationSpeedCurve,
        ),
      }).toEqual(runtime)
    },
  )

  it.each(ALS_ROTATION_MODES.flatMap((rotationMode) =>
    ALS_STANCES.map((stance) => ({ rotationMode, stance })),
  ))(
    '$rotationMode / $stance sampled parameters match all extracted rich-curve channels',
    ({ rotationMode, stance }) => {
      const runtimeSettings = ALS_MOVEMENT_SETTINGS[rotationMode][stance]
      const sourceSettings = extracted.settings.rotationModes[
        `Als.RotationMode.${rotationMode}`
      ].stances[`Als.Stance.${stance}`]
      const movementCurve = extracted.curves[
        sourceSettings.AccelerationAndDecelerationAndGroundFrictionCurve
      ].channels
      const rotationCurve = extracted.curves[
        sourceSettings.RotationInterpolationSpeedCurve
      ].channels.RotationInterpolationSpeed

      for (let gaitAmount = 0; gaitAmount <= 3; gaitAmount += 0.125) {
        const actual = sampleGroundedMovementParameters(
          runtimeSettings,
          gaitAmount,
        )
        expect(actual.maxAcceleration).toBeCloseTo(
          sampleExtracted(
            movementCurve.MaxAccelerationWalking.keys,
            gaitAmount,
          ) / 100,
          6,
        )
        expect(actual.brakingDeceleration).toBeCloseTo(
          sampleExtracted(
            movementCurve.BrakingDecelerationWalking.keys,
            gaitAmount,
          ) / 100,
          6,
        )
        expect(actual.groundFriction).toBeCloseTo(
          sampleExtracted(movementCurve.GroundFriction.keys, gaitAmount),
          6,
        )
        expect(actual.rotationInterpolationSpeed).toBeCloseTo(
          sampleExtracted(rotationCurve.keys, Math.max(1, gaitAmount)),
          6,
        )
      }
    },
  )
})
