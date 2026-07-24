/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
  evaluateBlendSpace,
} from './blendSpace'
import type {
  AuthoredBlendSpace,
  BlendSpaceSampleWeights,
} from './blendSpace'

interface ExtractedBlendSpaces {
  readonly schemaVersion: number
  readonly source: {
    readonly release: string
    readonly engineVersion: string
  }
  readonly blendSpaces: Readonly<Record<string, AuthoredBlendSpace>>
}

const extracted = JSON.parse(readFileSync(
  new URL('../../scripts/extract-als/blend-spaces.json', import.meta.url),
  'utf8',
)) as ExtractedBlendSpaces

function denseWeights(
  result: BlendSpaceSampleWeights,
  sampleCount: number,
) {
  const dense = Array.from({ length: sampleCount }, () => 0)
  for (let index = 0; index < result.count; index++) {
    dense[result.sampleIndices[index]] = result.weights[index]
  }
  return dense
}

function expectWeightsClose(
  actual: readonly number[],
  expected: readonly number[],
) {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index], 12)
  }
}

function expectedWalkRunTriangleWeights(x: number, y: number) {
  const clampedX = Math.min(Math.max(x, 0), 1)
  const clampedY = Math.min(Math.max(y, 0), 1)
  if (clampedX + clampedY <= 1) {
    return [
      clampedX,
      1 - clampedX - clampedY,
      0,
      clampedY,
    ]
  }
  return [
    1 - clampedY,
    0,
    clampedX + clampedY - 1,
    1 - clampedX,
  ]
}

function expectedWalkRunGridWeights(x: number, y: number) {
  const clampedX = Math.min(Math.max(x, 0), 1)
  const clampedY = Math.min(Math.max(y, 0), 1)
  return [
    clampedX * (1 - clampedY),
    (1 - clampedX) * (1 - clampedY),
    clampedX * clampedY,
    (1 - clampedX) * clampedY,
  ]
}

function expectedLookWeights(pitch: number) {
  const normalized = Math.min(Math.max(pitch, -90), 90) / 90
  return [
    1 - Math.abs(normalized),
    Math.max(-normalized, 0),
    Math.max(normalized, 0),
  ]
}

function expectedLeanWeights(x: number, y: number) {
  const clampedX = Math.min(Math.max(x, -1), 1)
  const clampedY = Math.min(Math.max(y, -1), 1)
  let xAmount = Math.abs(clampedX)
  let yAmount = Math.abs(clampedY)
  let center = Math.max(1 - xAmount - yAmount, 0)

  if (xAmount + yAmount > 1) {
    // Independent formula for nearest Euclidean projection onto |x| + |y| = 1.
    xAmount = Math.min(Math.max((xAmount - yAmount + 1) * 0.5, 0), 1)
    yAmount = 1 - xAmount
    center = 0
  }

  return [
    center,
    clampedY > 0 ? yAmount : 0,
    clampedY < 0 ? yAmount : 0,
    clampedX < 0 ? xAmount : 0,
    clampedX > 0 ? xAmount : 0,
  ]
}

describe('ALS authored BlendSpaces', () => {
  it('compiles exactly the nine dumped ALS 4.15 assets and their authored topology kinds', () => {
    expect(extracted.schemaVersion).toBe(1)
    expect(extracted.source).toMatchObject({
      release: 'ALS-Refactored 4.15',
      engineVersion: 'UE5.5',
    })
    expect(Object.keys(extracted.blendSpaces)).toHaveLength(9)

    const topologyKinds = Object.fromEntries(
      Object.entries(extracted.blendSpaces).map(([name, authored]) => [
        name,
        compileBlendSpace(authored).topology.kind,
      ]),
    )
    expect(topologyKinds).toEqual({
      BS_Als_Air_Lean: 'triangles',
      BS_Als_Lean: 'triangles',
      BS_Als_Look: 'segments',
      BS_Als_WalkRun_Backward: 'triangles',
      BS_Als_WalkRun_Forward: 'triangles',
      BS_Als_WalkRun_Left_Backward: 'triangles',
      BS_Als_WalkRun_Left_Forward: 'triangles',
      BS_Als_WalkRun_Right_Backward: 'grid',
      BS_Als_WalkRun_Right_Forward: 'triangles',
    })
  })

  it.each(Object.entries(extracted.blendSpaces))(
    '$0 evaluates every authored sample coordinate as a one-hot weight',
    (_name, authored) => {
      const blendSpace = compileBlendSpace(authored)
      const evaluator = createBlendSpaceEvaluator(blendSpace)
      for (
        let expectedSampleIndex = 0;
        expectedSampleIndex < authored.samples.length;
        expectedSampleIndex++
      ) {
        const sample = authored.samples[expectedSampleIndex]
        const weights = denseWeights(
          evaluateBlendSpace(
            evaluator,
            sample.sampleValue.X,
            sample.sampleValue.Y,
          ),
          authored.samples.length,
        )
        const expected = authored.samples.map(
          (_unused, index) => Number(index === expectedSampleIndex),
        )
        expectWeightsClose(weights, expected)
      }
    },
  )

  it.each([
    -200,
    -90,
    -45,
    0,
    22.5,
    90,
    200,
  ])('matches BS_Als_Look segment weights at pitch %s', (pitch) => {
    const authored = extracted.blendSpaces.BS_Als_Look
    const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
    expectWeightsClose(
      denseWeights(evaluateBlendSpace(evaluator, pitch), authored.samples.length),
      expectedLookWeights(pitch),
    )
  })

  it.each([
    [-2, 0],
    [-0.75, -0.25],
    [-0.2, 0.3],
    [0, 0],
    [0.25, 0.25],
    [0.8, 0.4],
    [0, 2],
  ])('matches both authored Lean triangulations at (%s, %s)', (x, y) => {
    for (const name of ['BS_Als_Air_Lean', 'BS_Als_Lean'] as const) {
      const authored = extracted.blendSpaces[name]
      const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
      expectWeightsClose(
        denseWeights(evaluateBlendSpace(evaluator, x, y), authored.samples.length),
        expectedLeanWeights(x, y),
      )
    }
  })

  it.each([
    [-1, 2],
    [0, 0],
    [0.25, 0.25],
    [0.8, 0.4],
    [0.5, 0.5],
    [1, 1],
    [2, -1],
  ])('matches every ordinary WalkRun triangle space at (%s, %s)', (x, y) => {
    for (
      const name of [
        'BS_Als_WalkRun_Backward',
        'BS_Als_WalkRun_Forward',
        'BS_Als_WalkRun_Left_Backward',
        'BS_Als_WalkRun_Left_Forward',
        'BS_Als_WalkRun_Right_Forward',
      ] as const
    ) {
      const authored = extracted.blendSpaces[name]
      const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
      expectWeightsClose(
        denseWeights(evaluateBlendSpace(evaluator, x, y), authored.samples.length),
        expectedWalkRunTriangleWeights(x, y),
      )
    }
  })

  it.each([
    [-1, 2],
    [0, 0],
    [0.25, 0.25],
    [0.8, 0.4],
    [0.5, 0.5],
    [1, 1],
    [2, -1],
  ])('matches RightBackward authored GridSamples at (%s, %s)', (x, y) => {
    const authored = extracted.blendSpaces.BS_Als_WalkRun_Right_Backward
    const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
    expectWeightsClose(
      denseWeights(evaluateBlendSpace(evaluator, x, y), authored.samples.length),
      expectedWalkRunGridWeights(x, y),
    )
  })

  it('does not silently replace RightBackward GridSamples with triangle interpolation', () => {
    const authored = extracted.blendSpaces.BS_Als_WalkRun_Right_Backward
    const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
    const weights = denseWeights(
      evaluateBlendSpace(evaluator, 0.25, 0.25),
      authored.samples.length,
    )
    expectWeightsClose(weights, [0.1875, 0.5625, 0.0625, 0.1875])
    expect(weights).not.toEqual(expectedWalkRunTriangleWeights(0.25, 0.25))
  })

  it('reuses one stable, UE weight-ordered output buffer', () => {
    const authored = extracted.blendSpaces.BS_Als_WalkRun_Right_Backward
    const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
    const result = evaluateBlendSpace(evaluator, 0.25, 0.25)
    const indices = result.sampleIndices
    const weights = result.weights
    expect(Array.from(indices.slice(0, result.count))).toEqual([1, 0, 3, 2])
    expect(Array.from(weights.slice(0, result.count))).toEqual([
      0.5625,
      0.1875,
      0.1875,
      0.0625,
    ])

    const next = evaluateBlendSpace(evaluator, 1, 0)
    expect(next).toBe(result)
    expect(next.sampleIndices).toBe(indices)
    expect(next.weights).toBe(weights)
    expect(next.count).toBe(1)
    expect(next.sampleIndices[0]).toBe(0)
    expect(next.weights[0]).toBe(1)
  })
})
