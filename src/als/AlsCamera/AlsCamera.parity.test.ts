/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createAlsCameraComponentState } from './AlsCameraComponent'

interface ExtractedValue<T> {
  readonly value: T
  readonly source?: {
    readonly path?: string
    readonly line?: number
  }
}

interface CameraContentOracle {
  readonly component: {
    readonly defaults: {
      readonly bRightShoulder: ExtractedValue<boolean>
      readonly FieldOfViewOverride: ExtractedValue<number>
    }
  }
  readonly settings: {
    readonly defaults: {
      readonly ThirdPerson: {
        readonly FirstPivotSocketName: ExtractedValue<string>
        readonly SecondPivotSocketName: ExtractedValue<string>
      }
    }
  }
  readonly sockets: readonly {
    readonly name: string
    readonly parentBone: string
    readonly relativeTransformUnreal: {
      readonly translationCm: ExtractedValue<readonly [
        number,
        number,
        number,
      ]>
    }
  }[]
  readonly curveNames: readonly { readonly name: string }[]
  readonly animGraph: unknown
}

const oracle = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/camera-content.json', import.meta.url),
  'utf8',
)) as CameraContentOracle

function collectModifierCurveNames(
  value: unknown,
  output: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const child of value) collectModifierCurveNames(child, output)
    return output
  }
  if (!value || typeof value !== 'object') return output

  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'curveNames'
      && Array.isArray(child)
      && child.every((name) => typeof name === 'string')
    ) {
      output.push(...child)
    } else {
      collectModifierCurveNames(child, output)
    }
  }
  return output
}

describe('ALS Refactored 4.15 camera parity contract', () => {
  it('defaults to the right shoulder from UAlsCameraComponent', () => {
    // Source oracle: Source/ALSCamera/Public/AlsCameraComponent.h, bRightShoulder.
    expect(oracle.component.defaults.bRightShoulder).toMatchObject({
      value: true,
      source: {
        path: 'Source/ALSCamera/Public/AlsCameraComponent.h',
      },
    })
    expect(createAlsCameraComponentState().rightShoulder).toBe(
      oracle.component.defaults.bRightShoulder.value,
    )
  })

  it('uses root+head pivot sockets and the authored head trace sockets', () => {
    // Source oracle: FAlsThirdPersonCameraSettings and serialized SK_Als sockets.
    expect([
      oracle.settings.defaults.ThirdPerson.FirstPivotSocketName.value,
      oracle.settings.defaults.ThirdPerson.SecondPivotSocketName.value,
    ]).toEqual(['root', 'head'])

    expect(oracle.sockets.map((socket) => ({
      name: socket.name,
      parentBone: socket.parentBone,
      translationCm: socket.relativeTransformUnreal.translationCm.value,
    }))).toEqual([
      {
        name: 'FirstPersonCamera',
        parentBone: 'head',
        translationCm: [4, 14, 0],
      },
      {
        name: 'ThirdPersonTraceShoulderLeft',
        parentBone: 'head',
        translationCm: [5, 0, -20],
      },
      {
        name: 'ThirdPersonTraceShoulderRight',
        parentBone: 'head',
        translationCm: [5, 0, 20],
      },
    ])
  })

  it('does not invent reticle zoom absent from AB_Als_Camera', () => {
    // ALS exposes the FovOffset named curve and a component FOV override, but the extracted
    // AB_Als_Camera graph authors no FovOffset modifier. There is no reticle-anchor input or
    // camera-graph branch in ALS Refactored 4.15 to port.
    expect(oracle.curveNames.map(({ name }) => name)).toContain('FovOffset')
    expect(collectModifierCurveNames(oracle.animGraph)).not.toContain(
      'FovOffset',
    )
    expect(oracle.component.defaults.FieldOfViewOverride.value).toBe(90)
  })

  it('publishes DesiredRotationMode only while FirstPerson', () => {
    // Source: UAlsCameraAnimationInstance::NativeUpdateAnimation(),
    // Source/ALSCamera/Private/AlsCameraAnimationInstance.cpp:45-58.
    const liveCameraSource = readFileSync(
      new URL('../../app/AlsCamera.tsx', import.meta.url),
      'utf8',
    )
    expect(liveCameraSource).toMatch(
      /input\.RotationMode\s*=\s*ROTATION_MODE_TAGS\[\s*character\.viewMode\s*===\s*'FirstPerson'\s*\?\s*character\.desiredRotationMode\s*:\s*character\.rotationMode\s*\]/,
    )
  })
})
