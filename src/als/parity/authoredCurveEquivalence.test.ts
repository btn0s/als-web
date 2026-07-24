/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileClipCurveSamplers } from '../../engine/curves'

type AuthoredCurveKey = readonly [
  time: number,
  value: number,
  interpolationMode: number,
  tangentMode: number,
  tangentWeightMode: number,
  arriveTangent: number,
  arriveTangentWeight: number,
  leaveTangent: number,
  leaveTangentWeight: number,
]

interface AuthoredCurve {
  readonly name: string
  readonly flags: number
  readonly keys: readonly AuthoredCurveKey[]
}

interface GlbAnimation {
  readonly name: string
  readonly extras?: {
    readonly alsCurves?: readonly AuthoredCurve[]
  }
}

function readAnimations() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes.toString('utf8', 20, 20 + jsonLength),
  ) as { readonly animations: readonly GlbAnimation[] }
  return json.animations
}

function oracleSegment(
  from: AuthoredCurveKey,
  to: AuthoredCurveKey,
  time: number,
) {
  if (from[2] === 1) return from[1]
  const duration = to[0] - from[0]
  const alpha = (time - from[0]) / duration
  if (from[2] === 0) return from[1] + (to[1] - from[1]) * alpha

  const alphaSquared = alpha * alpha
  const alphaCubed = alphaSquared * alpha
  return (
    (2 * alphaCubed - 3 * alphaSquared + 1) * from[1]
    + (alphaCubed - 2 * alphaSquared + alpha) * from[7] * duration
    + (-2 * alphaCubed + 3 * alphaSquared) * to[1]
    + (alphaCubed - alphaSquared) * to[5] * duration
  )
}

describe('authored animation rich-curve equivalence', () => {
  it('retains every FRichCurveKey field and matches UE unweighted evaluation', () => {
    const animations = readAnimations()
    let curveCount = 0
    let keyCount = 0
    let cubicKeyCount = 0
    const nonzeroTangentKeys: {
      clip: string
      curve: string
      key: AuthoredCurveKey
    }[] = []

    for (const animation of animations) {
      const curves = animation.extras?.alsCurves ?? []
      const samplers = compileClipCurveSamplers({
        userData: { alsCurves: curves },
      })
      curveCount += curves.length
      for (const curve of curves) {
        keyCount += curve.keys.length
        for (const key of curve.keys) {
          expect(key).toHaveLength(9)
          expect(key[4]).toBe(0)
          if (key[2] === 2) cubicKeyCount++
          if (key[5] !== 0 || key[7] !== 0) {
            nonzeroTangentKeys.push({
              clip: animation.name,
              curve: curve.name,
              key,
            })
          }
        }

        for (let keyIndex = 0; keyIndex < curve.keys.length - 1; keyIndex++) {
          const from = curve.keys[keyIndex]
          const to = curve.keys[keyIndex + 1]
          for (const alpha of [0.125, 1 / 3, 0.5, 0.777]) {
            const time = from[0] + (to[0] - from[0]) * alpha
            const expected = oracleSegment(from, to, time)
            const actual = samplers[curve.name](time)
            const error = Math.abs(actual - expected)
            if (error > 1e-12) {
              throw new Error(
                `${animation.name}/${curve.name} segment ${keyIndex} `
                + `diverged by ${error} at alpha ${alpha}`,
              )
            }
          }
        }
      }
    }

    expect({
      animationCount: animations.length,
      curveCount,
      keyCount,
      cubicKeyCount,
    }).toEqual({
      animationCount: 119,
      curveCount: 361,
      keyCount: 1646,
      cubicKeyCount: 70,
    })
    expect(nonzeroTangentKeys).toEqual([
      {
        clip: 'A_Als_Land_Light',
        curve: 'FootstepSoundBlock',
        key: [
          0.5,
          -5.364418e-8,
          2,
          1,
          0,
          -4.793421,
          0,
          -4.7934184,
          0,
        ],
      },
      {
        clip: 'A_Als_Land_Heavy',
        curve: 'FootstepSoundBlock',
        key: [
          0.7,
          -4.321337e-8,
          2,
          1,
          0,
          -4.181564,
          0,
          -4.181564,
          0,
        ],
      },
      {
        clip: 'A_Als_Land_Light_Additive',
        curve: 'FootstepSoundBlock',
        key: [
          0.5,
          -4.321337e-8,
          2,
          1,
          0,
          -4.7638817,
          0,
          -4.7638683,
          0,
        ],
      },
      {
        clip: 'A_Als_Land_Heavy_Additive',
        curve: 'FootstepSoundBlock',
        key: [
          0.7,
          -4.321337e-8,
          2,
          1,
          0,
          -4.181564,
          0,
          -4.181564,
          0,
        ],
      },
    ])
  })
})
