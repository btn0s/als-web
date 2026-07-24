/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
  evaluateBlendSpace,
} from '../../engine/blendSpace'
import type {
  AuthoredBlendSpace,
  BlendSpaceSampleWeights,
} from '../../engine/blendSpace'

interface ExtractedBlendSpaces {
  readonly source: {
    readonly release: string
    readonly engineVersion: string
  }
  readonly blendSpaces: Readonly<Record<string, AuthoredBlendSpace>>
}

interface OracleSample {
  readonly sampleIndex: number
  readonly weight: number
}

interface OracleEvaluation {
  readonly samples: readonly OracleSample[]
  readonly cachedTriangulationIndex: number
}

type SerializedFields = Readonly<Record<string, unknown>>

const UE_KINDA_SMALL_NUMBER = 1e-4
const ZERO_ANIMWEIGHT_THRESH = 1e-5

const extracted = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/blend-spaces.json', import.meta.url),
  'utf8',
)) as ExtractedBlendSpaces

function fields(value: unknown, label: string) {
  if (!value || typeof value !== 'object') {
    throw new Error(`Oracle expected ${label}`)
  }
  return value as SerializedFields
}

function indexed(fieldsValue: SerializedFields, name: string, index: number) {
  return fieldsValue[index === 0 ? name : `${name}[${index}]`]
}

function numberField(
  fieldsValue: SerializedFields,
  name: string,
  index = 0,
) {
  const value = indexed(fieldsValue, name, index)
  if (typeof value !== 'number') {
    throw new Error(`Oracle expected ${name}[${index}]`)
  }
  return value
}

function triangleVertex(
  triangle: SerializedFields,
  vertexIndex: number,
) {
  const vertex = fields(
    indexed(triangle, 'Vertices', vertexIndex),
    `Vertices[${vertexIndex}]`,
  )
  return {
    x: numberField(vertex, 'X'),
    y: numberField(vertex, 'Y'),
  }
}

function triangleEdge(
  triangle: SerializedFields,
  edgeIndex: number,
) {
  return fields(
    indexed(triangle, 'EdgeInfo', edgeIndex),
    `EdgeInfo[${edgeIndex}]`,
  )
}

function sampleIndex(
  triangle: SerializedFields,
  vertexIndex: number,
) {
  return numberField(triangle, 'SampleIndices', vertexIndex)
}

function normalizeInput(
  authored: AuthoredBlendSpace,
  value: number,
  axisIndex: number,
) {
  const axis = authored.axes[axisIndex].serialized
  const min = axis.Min ?? 0
  const max = axis.Max
  if (typeof max !== 'number') throw new Error('Oracle axis has no maximum')
  return Math.min(Math.max((value - min) / (max - min), 0), 1)
}

function finalizeNonGridSamples(rawSamples: readonly OracleSample[]) {
  // UBlendSpace::GetSamplesFromBlendInput first applies the strict threshold, then combines,
  // sorts descending, drops anything below the threshold, and normalizes.
  const samples: { sampleIndex: number; weight: number }[] = []
  for (const rawSample of rawSamples) {
    if (!(rawSample.weight > ZERO_ANIMWEIGHT_THRESH)) continue
    const existing = samples.find(
      (sample) => sample.sampleIndex === rawSample.sampleIndex,
    )
    if (existing) {
      existing.weight += rawSample.weight
    } else {
      samples.push({ ...rawSample })
    }
  }
  samples.sort((left, right) => right.weight - left.weight)
  const retained = samples.filter(
    (sample) => sample.weight >= ZERO_ANIMWEIGHT_THRESH,
  )
  const totalWeight = retained.reduce(
    (total, sample) => total + sample.weight,
    0,
  )
  return retained.map((sample) => ({
    sampleIndex: sample.sampleIndex,
    weight: sample.weight / totalWeight,
  }))
}

function oracleSegments(
  authored: AuthoredBlendSpace,
  x: number,
  cachedSegmentIndex: number,
): OracleEvaluation {
  const topology = fields(authored.topology.blendSpaceData, 'BlendSpaceData')
  const segments = topology.Segments as readonly SerializedFields[]
  const normalizedX = normalizeInput(authored, x, 0)

  if (
    segments.length === 1
    && numberField(segments[0], 'SampleIndices', 0)
    === numberField(segments[0], 'SampleIndices', 1)
  ) {
    return {
      samples: [{
        sampleIndex: numberField(segments[0], 'SampleIndices', 0),
        weight: 1,
      }],
      cachedTriangulationIndex: cachedSegmentIndex,
    }
  }

  let segmentIndex = cachedSegmentIndex
  if (segmentIndex < 0 || segmentIndex >= segments.length) {
    segmentIndex = Math.floor(segments.length / 2)
  }
  for (let attempt = 0; attempt < segments.length; attempt++) {
    const segment = segments[segmentIndex]
    const start = numberField(segment, 'Vertices', 0)
    const end = numberField(segment, 'Vertices', 1)
    if (normalizedX < start) {
      if (segmentIndex > 0) {
        segmentIndex--
      } else {
        return {
          samples: [{
            sampleIndex: numberField(segment, 'SampleIndices', 0),
            weight: 1,
          }],
          cachedTriangulationIndex: segmentIndex,
        }
      }
    } else if (normalizedX > end) {
      if (segmentIndex < segments.length - 1) {
        segmentIndex++
      } else {
        return {
          samples: [{
            sampleIndex: numberField(segment, 'SampleIndices', 1),
            weight: 1,
          }],
          cachedTriangulationIndex: segmentIndex,
        }
      }
    } else {
      const alpha = Math.min(
        Math.max((normalizedX - start) / (end - start), 0),
        1,
      )
      return {
        samples: finalizeNonGridSamples([
          {
            sampleIndex: numberField(segment, 'SampleIndices', 0),
            weight: 1 - alpha,
          },
          {
            sampleIndex: numberField(segment, 'SampleIndices', 1),
            weight: alpha,
          },
        ]),
        cachedTriangulationIndex: segmentIndex,
      }
    }
  }
  throw new Error('Oracle could not find BlendSpace segment')
}

function barycentricSamples(
  triangle: SerializedFields,
  x: number,
  y: number,
) {
  const a = triangleVertex(triangle, 0)
  const b = triangleVertex(triangle, 1)
  const c = triangleVertex(triangle, 2)
  const denominator = (
    (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
  )
  const weightA = (
    (b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)
  ) / denominator
  const weightB = (
    (c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)
  ) / denominator
  return [
    { sampleIndex: sampleIndex(triangle, 0), weight: weightA },
    { sampleIndex: sampleIndex(triangle, 1), weight: weightB },
    {
      sampleIndex: sampleIndex(triangle, 2),
      weight: 1 - weightA - weightB,
    },
  ]
}

function oracleTriangles(
  authored: AuthoredBlendSpace,
  x: number,
  y: number,
  cachedTriangleIndex: number,
): OracleEvaluation {
  const topology = fields(authored.topology.blendSpaceData, 'BlendSpaceData')
  const triangles = topology.Triangles as readonly SerializedFields[]
  const pointX = normalizeInput(authored, x, 0)
  const pointY = normalizeInput(authored, y, 1)
  let triangleIndex = cachedTriangleIndex
  if (triangleIndex < 0 || triangleIndex >= triangles.length) {
    triangleIndex = Math.floor(triangles.length / 2)
  }

  for (let attempt = 0; attempt < triangles.length; attempt++) {
    let largestDistance = UE_KINDA_SMALL_NUMBER
    let largestEdgeIndex = -1
    const triangle = triangles[triangleIndex]
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const corner = triangleVertex(triangle, edgeIndex)
      const edge = triangleEdge(triangle, edgeIndex)
      const normal = fields(edge.Normal, 'Normal')
      const distance = (
        (pointX - corner.x) * numberField(normal, 'X')
        + (pointY - corner.y) * numberField(normal, 'Y')
      )
      if (distance > largestDistance) {
        largestDistance = distance
        largestEdgeIndex = edgeIndex
      }
    }

    if (largestEdgeIndex < 0) {
      return {
        samples: finalizeNonGridSamples(
          barycentricSamples(triangle, pointX, pointY),
        ),
        cachedTriangulationIndex: triangleIndex,
      }
    }

    const outerEdge = triangleEdge(triangle, largestEdgeIndex)
    const neighbour = numberField(outerEdge, 'NeighbourTriangleIndex')
    if (neighbour >= 0) {
      triangleIndex = neighbour
      continue
    }

    let originalDirection = -1
    let startIndex = largestEdgeIndex
    let endIndex = (startIndex + 1) % 3
    let previousTriangleIndex = triangleIndex

    for (
      let perimeterAttempt = 0;
      perimeterAttempt < triangles.length;
      perimeterAttempt++
    ) {
      const perimeterTriangle = triangles[triangleIndex]
      const perimeterEdge = triangleEdge(perimeterTriangle, startIndex)
      const start = triangleVertex(perimeterTriangle, startIndex)
      const end = triangleVertex(perimeterTriangle, endIndex)
      const deltaX = end.x - start.x
      const deltaY = end.y - start.y
      const alpha = (
        deltaX * (pointX - start.x) + deltaY * (pointY - start.y)
      ) / (deltaX * deltaX + deltaY * deltaY)

      if (alpha >= 0 && alpha <= 1) {
        return {
          samples: finalizeNonGridSamples([
            {
              sampleIndex: sampleIndex(perimeterTriangle, startIndex),
              weight: 1 - alpha,
            },
            {
              sampleIndex: sampleIndex(perimeterTriangle, endIndex),
              weight: alpha,
            },
          ]),
          cachedTriangulationIndex: triangleIndex,
        }
      }

      if (originalDirection < 0) {
        originalDirection = alpha > 1 ? 1 : 0
      }
      const direction = alpha > 1 ? 1 : 0
      if (originalDirection !== direction) {
        const endpoint = direction === 0
          ? {
              sampleIndex: sampleIndex(perimeterTriangle, startIndex),
              weight: 1 - alpha,
            }
          : {
              sampleIndex: sampleIndex(perimeterTriangle, endIndex),
              weight: alpha,
            }
        return {
          samples: finalizeNonGridSamples([endpoint]),
          cachedTriangulationIndex: previousTriangleIndex,
        }
      }

      previousTriangleIndex = triangleIndex
      triangleIndex = numberField(
        perimeterEdge,
        'AdjacentPerimeterTriangleIndices',
        direction,
      )
      if (triangleIndex < 0) {
        const endpoint = direction === 0
          ? {
              sampleIndex: sampleIndex(perimeterTriangle, startIndex),
              weight: 1 - alpha,
            }
          : {
              sampleIndex: sampleIndex(perimeterTriangle, endIndex),
              weight: alpha,
            }
        return {
          samples: finalizeNonGridSamples([endpoint]),
          cachedTriangulationIndex: previousTriangleIndex,
        }
      }
      startIndex = numberField(
        perimeterEdge,
        'AdjacentPerimeterVertexIndices',
        direction,
      )
      endIndex = (startIndex + 1) % 3
    }
  }
  throw new Error('Oracle could not find BlendSpace triangle')
}

function denseActual(
  result: BlendSpaceSampleWeights,
  sampleCount: number,
) {
  const dense = new Float64Array(sampleCount)
  for (let index = 0; index < result.count; index++) {
    dense[result.sampleIndices[index]] = result.weights[index]
  }
  return dense
}

function denseOracle(
  samples: readonly OracleSample[],
  sampleCount: number,
) {
  const dense = new Float64Array(sampleCount)
  for (const sample of samples) dense[sample.sampleIndex] = sample.weight
  return dense
}

function authoredAxisValue(
  authored: AuthoredBlendSpace,
  normalizedValue: number,
  axisIndex: number,
) {
  const axis = authored.axes[axisIndex].serialized
  const min = axis.Min ?? 0
  const max = axis.Max
  if (typeof max !== 'number') throw new Error('Authored axis has no maximum')
  return min + normalizedValue * (max - min)
}

describe('UE5.5 FBlendSpaceData equivalence', () => {
  it('matches GetSamples1D cache traversal and weights for ALS Look', () => {
    const authored = extracted.blendSpaces.BS_Als_Look
    const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
    let oracleCache = -1
    for (const pitch of [-180, 90, 89.999, 0, -45, -90, 180, 20, -20]) {
      const expected = oracleSegments(authored, pitch, oracleCache)
      oracleCache = expected.cachedTriangulationIndex
      const actual = evaluateBlendSpace(evaluator, pitch)
      expect(evaluator.cachedTriangulationIndex).toBe(oracleCache)
      expect(Array.from(denseActual(actual, authored.samples.length))).toEqual(
        Array.from(denseOracle(expected.samples, authored.samples.length)),
      )
    }
  })

  it('differentially matches GetSamples2D over every authored ALS triangle graph', () => {
    expect(extracted.source).toMatchObject({
      release: 'ALS-Refactored 4.15',
      engineVersion: 'UE5.5',
    })
    const fixedNormalizedPoints = [
      [-0.25, -0.25],
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0.5, 0.5],
      [0.50005, 0.5],
      [0.25, 0.75],
      [0.75, 0.25],
      [1.25, 0.5],
      [0.5, 1.25],
    ] as const

    for (const [name, authored] of Object.entries(extracted.blendSpaces)) {
      const triangles = authored.topology.blendSpaceData?.Triangles
      if (!triangles) continue
      const evaluator = createBlendSpaceEvaluator(compileBlendSpace(authored))
      let oracleCache = -1
      let randomState = 0x9e3779b9
      const normalizedPoints: [number, number][] = [...fixedNormalizedPoints]
      for (let index = 0; index < 512; index++) {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        const x = randomState / 0x1_0000_0000 * 1.5 - 0.25
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        const y = randomState / 0x1_0000_0000 * 1.5 - 0.25
        normalizedPoints.push([x, y])
      }

      for (const [normalizedX, normalizedY] of normalizedPoints) {
        const x = authoredAxisValue(authored, normalizedX, 0)
        const y = authoredAxisValue(authored, normalizedY, 1)
        const expected = oracleTriangles(authored, x, y, oracleCache)
        oracleCache = expected.cachedTriangulationIndex
        const actual = evaluateBlendSpace(evaluator, x, y)
        if (evaluator.cachedTriangulationIndex !== oracleCache) {
          throw new Error(
            `${name} cache diverged at (${normalizedX}, ${normalizedY}): `
            + `${evaluator.cachedTriangulationIndex} !== ${oracleCache}`,
          )
        }
        const actualDense = denseActual(actual, authored.samples.length)
        const expectedDense = denseOracle(
          expected.samples,
          authored.samples.length,
        )
        for (let sample = 0; sample < authored.samples.length; sample++) {
          const error = Math.abs(actualDense[sample] - expectedDense[sample])
          if (error > 1e-12) {
            throw new Error(
              `${name} sample ${sample} diverged by ${error} at `
              + `(${normalizedX}, ${normalizedY})`,
            )
          }
        }
        for (let sample = 1; sample < actual.count; sample++) {
          expect(actual.weights[sample - 1]).toBeGreaterThanOrEqual(
            actual.weights[sample],
          )
        }
      }
    }
  })
})
