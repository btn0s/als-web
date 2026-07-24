export interface AuthoredBlendSpaceAxis {
  readonly index: number
  readonly serialized: {
    readonly DisplayName?: string
    readonly Min?: number
    readonly Max?: number
    readonly GridNum?: number
  }
}

export interface AuthoredBlendSpaceSample {
  readonly animation: {
    readonly name: string
    readonly objectPath?: string
  }
  readonly sampleValue: {
    readonly X: number
    readonly Y: number
    readonly Z: number
  }
  readonly rateScale: number
}

interface NumberedFields {
  readonly [key: string]: unknown
}

export interface AuthoredBlendSpace {
  readonly className: 'BlendSpace' | 'BlendSpace1D'
  readonly axes: readonly AuthoredBlendSpaceAxis[]
  readonly samples: readonly AuthoredBlendSpaceSample[]
  readonly topology: {
    readonly interpolateUsingGrid: boolean
    readonly blendSpaceData: {
      readonly Segments?: readonly NumberedFields[]
      readonly Triangles?: readonly NumberedFields[]
    } | null
    readonly gridSamples: readonly NumberedFields[]
  }
}

export type BlendSpaceTopology = 'segments' | 'triangles' | 'grid'

interface CompiledSegments {
  readonly kind: 'segments'
  readonly sampleIndices: Int32Array
  readonly vertices: Float64Array
}

interface CompiledTriangles {
  readonly kind: 'triangles'
  readonly sampleIndices: Int32Array
  readonly vertices: Float64Array
  readonly neighbours: Int32Array
}

interface CompiledGrid {
  readonly kind: 'grid'
  readonly sizeX: number
  readonly sizeY: number
  readonly sampleIndices: Int32Array
  readonly weights: Float64Array
}

type CompiledTopology = CompiledSegments | CompiledTriangles | CompiledGrid

export interface CompiledBlendSpace {
  readonly dimensions: 1 | 2
  readonly samples: readonly AuthoredBlendSpaceSample[]
  readonly minX: number
  readonly minY: number
  readonly inverseRangeX: number
  readonly inverseRangeY: number
  readonly topology: CompiledTopology
}

export interface BlendSpaceSampleWeights {
  /**
   * Paired with `weights` for indices below `count`. Entries are always ordered by authored
   * sample index, making the result stable when a point crosses an authored triangle boundary.
   */
  readonly sampleIndices: Int32Array
  readonly weights: Float64Array
  count: number
}

export interface BlendSpaceEvaluator {
  readonly blendSpace: CompiledBlendSpace
  /**
   * Reused by every evaluation. Consumers must read it before evaluating this instance again.
   */
  readonly result: BlendSpaceSampleWeights
}

const GEOMETRY_EPSILON = 1e-10

function numberedNumber(
  fields: NumberedFields,
  baseName: string,
  index: number,
) {
  const value = fields[index === 0 ? baseName : `${baseName}[${index}]`]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`BlendSpace topology has no finite ${baseName}[${index}]`)
  }
  return value
}

function numberedObject(
  fields: NumberedFields,
  baseName: string,
  index: number,
) {
  const value = fields[index === 0 ? baseName : `${baseName}[${index}]`]
  if (!value || typeof value !== 'object') {
    throw new Error(`BlendSpace topology has no ${baseName}[${index}]`)
  }
  return value as NumberedFields
}

function checkedSampleIndex(value: number, sampleCount: number) {
  if (!Number.isInteger(value) || value < 0 || value >= sampleCount) {
    throw new Error(`BlendSpace sample index ${value} is outside 0..${sampleCount - 1}`)
  }
  return value
}

function compileSegments(
  segments: readonly NumberedFields[],
  sampleCount: number,
): CompiledSegments {
  if (segments.length === 0) throw new Error('BlendSpace1D has no authored segments')
  const sampleIndices = new Int32Array(segments.length * 2)
  const vertices = new Float64Array(segments.length * 2)
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]
    for (let vertexIndex = 0; vertexIndex < 2; vertexIndex++) {
      const offset = segmentIndex * 2 + vertexIndex
      sampleIndices[offset] = checkedSampleIndex(
        numberedNumber(segment, 'SampleIndices', vertexIndex),
        sampleCount,
      )
      vertices[offset] = numberedNumber(segment, 'Vertices', vertexIndex)
    }
    if (vertices[segmentIndex * 2] === vertices[segmentIndex * 2 + 1]) {
      throw new Error(`BlendSpace1D segment ${segmentIndex} has zero length`)
    }
  }
  return { kind: 'segments', sampleIndices, vertices }
}

function compileTriangles(
  triangles: readonly NumberedFields[],
  sampleCount: number,
): CompiledTriangles {
  if (triangles.length === 0) throw new Error('BlendSpace has no authored triangles')
  const sampleIndices = new Int32Array(triangles.length * 3)
  const vertices = new Float64Array(triangles.length * 6)
  const neighbours = new Int32Array(triangles.length * 3)
  neighbours.fill(-1)

  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
    const triangle = triangles[triangleIndex]
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const sampleOffset = triangleIndex * 3 + vertexIndex
      const vertexOffset = triangleIndex * 6 + vertexIndex * 2
      sampleIndices[sampleOffset] = checkedSampleIndex(
        numberedNumber(triangle, 'SampleIndices', vertexIndex),
        sampleCount,
      )
      const vertex = numberedObject(triangle, 'Vertices', vertexIndex)
      vertices[vertexOffset] = numberedNumber(vertex, 'X', 0)
      vertices[vertexOffset + 1] = numberedNumber(vertex, 'Y', 0)

      const edgeKey = vertexIndex === 0 ? 'EdgeInfo' : `EdgeInfo[${vertexIndex}]`
      const edge = triangle[edgeKey]
      if (edge && typeof edge === 'object') {
        const neighbour = (edge as NumberedFields).NeighbourTriangleIndex
        if (typeof neighbour === 'number' && Number.isInteger(neighbour)) {
          neighbours[sampleOffset] = neighbour
        }
      }
    }

    const offset = triangleIndex * 6
    const ax = vertices[offset]
    const ay = vertices[offset + 1]
    const bx = vertices[offset + 2]
    const by = vertices[offset + 3]
    const cx = vertices[offset + 4]
    const cy = vertices[offset + 5]
    const twiceArea = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(twiceArea) <= GEOMETRY_EPSILON) {
      throw new Error(`BlendSpace triangle ${triangleIndex} has zero area`)
    }
  }
  return { kind: 'triangles', sampleIndices, vertices, neighbours }
}

function compileGrid(
  authored: AuthoredBlendSpace,
  sampleCount: number,
): CompiledGrid {
  const gridX = authored.axes[0].serialized.GridNum
  const gridY = authored.axes[1].serialized.GridNum
  if (
    typeof gridX !== 'number'
    || typeof gridY !== 'number'
    || !Number.isInteger(gridX)
    || !Number.isInteger(gridY)
    || gridX < 1
    || gridY < 1
  ) {
    throw new Error('Grid BlendSpace requires positive integer GridNum values')
  }

  const sizeX = gridX + 1
  const sizeY = gridY + 1
  const expectedGridSamples = sizeX * sizeY
  if (authored.topology.gridSamples.length !== expectedGridSamples) {
    throw new Error(
      `Grid BlendSpace has ${authored.topology.gridSamples.length} grid samples, `
      + `expected ${expectedGridSamples}`,
    )
  }

  // Every serialized FEditorElement in ALS 4.15 carries exactly three index/weight slots.
  const sampleIndices = new Int32Array(expectedGridSamples * 3)
  const weights = new Float64Array(expectedGridSamples * 3)
  for (let gridIndex = 0; gridIndex < expectedGridSamples; gridIndex++) {
    const gridSample = authored.topology.gridSamples[gridIndex]
    for (let slot = 0; slot < 3; slot++) {
      const offset = gridIndex * 3 + slot
      sampleIndices[offset] = checkedSampleIndex(
        numberedNumber(gridSample, 'Indices', slot),
        sampleCount,
      )
      weights[offset] = numberedNumber(gridSample, 'Weights', slot)
    }
  }

  return { kind: 'grid', sizeX, sizeY, sampleIndices, weights }
}

function compileAxis(axis: AuthoredBlendSpaceAxis, label: string) {
  // Min is omitted by CUE4Parse when it has FBlendParameter's serialized default of zero.
  const min = axis.serialized.Min ?? 0
  const max = axis.serialized.Max
  if (
    typeof max !== 'number'
    || !Number.isFinite(min)
    || !Number.isFinite(max)
    || max <= min
  ) {
    throw new Error(`${label} BlendSpace axis must have a finite positive range`)
  }
  return { min, inverseRange: 1 / (max - min) }
}

/**
 * Compiles the serialized topology emitted by `dump-blend-spaces`; it never regenerates a
 * triangulation or infers neighbours from sample positions.
 */
export function compileBlendSpace(
  authored: AuthoredBlendSpace,
): CompiledBlendSpace {
  const dimensions = authored.className === 'BlendSpace1D' ? 1 : 2
  if (authored.axes.length !== dimensions) {
    throw new Error(
      `${authored.className} has ${authored.axes.length} axes, expected ${dimensions}`,
    )
  }
  if (authored.samples.length === 0) throw new Error('BlendSpace has no authored samples')

  const x = compileAxis(authored.axes[0], 'X')
  const y = dimensions === 2
    ? compileAxis(authored.axes[1], 'Y')
    : { min: 0, inverseRange: 0 }
  let topology: CompiledTopology
  if (authored.topology.interpolateUsingGrid) {
    if (dimensions !== 2) throw new Error('Grid interpolation requires a 2D BlendSpace')
    topology = compileGrid(authored, authored.samples.length)
  } else if (dimensions === 1) {
    topology = compileSegments(
      authored.topology.blendSpaceData?.Segments ?? [],
      authored.samples.length,
    )
  } else {
    topology = compileTriangles(
      authored.topology.blendSpaceData?.Triangles ?? [],
      authored.samples.length,
    )
  }

  return {
    dimensions,
    samples: authored.samples,
    minX: x.min,
    minY: y.min,
    inverseRangeX: x.inverseRange,
    inverseRangeY: y.inverseRange,
    topology,
  }
}

export function createBlendSpaceEvaluator(
  blendSpace: CompiledBlendSpace,
): BlendSpaceEvaluator {
  return {
    blendSpace,
    result: {
      sampleIndices: new Int32Array(blendSpace.samples.length),
      weights: new Float64Array(blendSpace.samples.length),
      count: 0,
    },
  }
}

function addWeight(
  result: BlendSpaceSampleWeights,
  sampleIndex: number,
  weight: number,
) {
  if (weight <= 0) return

  let outputIndex = 0
  while (
    outputIndex < result.count
    && result.sampleIndices[outputIndex] < sampleIndex
  ) {
    outputIndex++
  }
  if (
    outputIndex < result.count
    && result.sampleIndices[outputIndex] === sampleIndex
  ) {
    result.weights[outputIndex] += weight
    return
  }

  for (let index = result.count; index > outputIndex; index--) {
    result.sampleIndices[index] = result.sampleIndices[index - 1]
    result.weights[index] = result.weights[index - 1]
  }
  result.sampleIndices[outputIndex] = sampleIndex
  result.weights[outputIndex] = weight
  result.count++
}

function finishWeights(result: BlendSpaceSampleWeights) {
  let totalWeight = 0
  for (let index = 0; index < result.count; index++) {
    totalWeight += result.weights[index]
  }
  if (!(totalWeight > 0)) throw new Error('BlendSpace evaluation produced no samples')
  for (let index = 0; index < result.count; index++) {
    result.weights[index] /= totalWeight
  }
}

function barycentric(
  topology: CompiledTriangles,
  triangleIndex: number,
  x: number,
  y: number,
  result: BlendSpaceSampleWeights,
  clampWeights: boolean,
) {
  const vertexOffset = triangleIndex * 6
  const ax = topology.vertices[vertexOffset]
  const ay = topology.vertices[vertexOffset + 1]
  const bx = topology.vertices[vertexOffset + 2]
  const by = topology.vertices[vertexOffset + 3]
  const cx = topology.vertices[vertexOffset + 4]
  const cy = topology.vertices[vertexOffset + 5]
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  let weightA = (
    (by - cy) * (x - cx) + (cx - bx) * (y - cy)
  ) / denominator
  let weightB = (
    (cy - ay) * (x - cx) + (ax - cx) * (y - cy)
  ) / denominator
  let weightC = 1 - weightA - weightB

  if (clampWeights) {
    weightA = Math.max(0, weightA)
    weightB = Math.max(0, weightB)
    weightC = Math.max(0, weightC)
  }
  const sampleOffset = triangleIndex * 3
  addWeight(result, topology.sampleIndices[sampleOffset], weightA)
  addWeight(result, topology.sampleIndices[sampleOffset + 1], weightB)
  addWeight(result, topology.sampleIndices[sampleOffset + 2], weightC)
}

function evaluateSegments(
  topology: CompiledSegments,
  x: number,
  result: BlendSpaceSampleWeights,
) {
  let bestSegment = -1
  let bestPosition = 0
  let bestDistance = Number.POSITIVE_INFINITY
  const segmentCount = topology.vertices.length / 2
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const offset = segmentIndex * 2
    const from = topology.vertices[offset]
    const to = topology.vertices[offset + 1]
    const low = Math.min(from, to)
    const high = Math.max(from, to)
    const position = Math.min(Math.max(x, low), high)
    const distance = Math.abs(x - position)
    if (distance < bestDistance) {
      bestDistance = distance
      bestSegment = segmentIndex
      bestPosition = position
    }
  }

  const offset = bestSegment * 2
  const from = topology.vertices[offset]
  const to = topology.vertices[offset + 1]
  const alpha = (bestPosition - from) / (to - from)
  addWeight(result, topology.sampleIndices[offset], 1 - alpha)
  addWeight(result, topology.sampleIndices[offset + 1], alpha)
}

function evaluateTriangles(
  topology: CompiledTriangles,
  x: number,
  y: number,
  result: BlendSpaceSampleWeights,
) {
  const triangleCount = topology.sampleIndices.length / 3
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const offset = triangleIndex * 6
    const ax = topology.vertices[offset]
    const ay = topology.vertices[offset + 1]
    const bx = topology.vertices[offset + 2]
    const by = topology.vertices[offset + 3]
    const cx = topology.vertices[offset + 4]
    const cy = topology.vertices[offset + 5]
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    const weightA = (
      (by - cy) * (x - cx) + (cx - bx) * (y - cy)
    ) / denominator
    const weightB = (
      (cy - ay) * (x - cx) + (ax - cx) * (y - cy)
    ) / denominator
    const weightC = 1 - weightA - weightB
    if (
      weightA >= -GEOMETRY_EPSILON
      && weightB >= -GEOMETRY_EPSILON
      && weightC >= -GEOMETRY_EPSILON
    ) {
      barycentric(topology, triangleIndex, x, y, result, true)
      return
    }
  }

  /*
   * HYPOTHESIS — UE5.5's perimeter traversal implementation is not present in this repository.
   * The authored EdgeInfo does prove which triangle edges are perimeter edges. Projecting onto
   * the nearest such edge is the geometrically canonical clamping operation, but this outside-
   * convex-hull branch still needs a differential run against UE before it can be called VERIFIED.
   */
  let bestTriangle = -1
  let bestX = 0
  let bestY = 0
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      if (topology.neighbours[triangleIndex * 3 + edgeIndex] >= 0) continue
      const vertexOffset = triangleIndex * 6 + edgeIndex * 2
      const nextVertexOffset = triangleIndex * 6 + ((edgeIndex + 1) % 3) * 2
      const ax = topology.vertices[vertexOffset]
      const ay = topology.vertices[vertexOffset + 1]
      const bx = topology.vertices[nextVertexOffset]
      const by = topology.vertices[nextVertexOffset + 1]
      const dx = bx - ax
      const dy = by - ay
      const alpha = Math.min(
        Math.max(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0),
        1,
      )
      const closestX = ax + dx * alpha
      const closestY = ay + dy * alpha
      const distanceX = x - closestX
      const distanceY = y - closestY
      const distanceSquared = distanceX * distanceX + distanceY * distanceY
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestTriangle = triangleIndex
        bestX = closestX
        bestY = closestY
      }
    }
  }
  if (bestTriangle < 0) throw new Error('BlendSpace has no authored perimeter edge')
  barycentric(topology, bestTriangle, bestX, bestY, result, true)
}

function addGridSample(
  topology: CompiledGrid,
  gridIndex: number,
  blendWeight: number,
  result: BlendSpaceSampleWeights,
) {
  if (blendWeight <= 0) return
  const offset = gridIndex * 3
  for (let slot = 0; slot < 3; slot++) {
    addWeight(
      result,
      topology.sampleIndices[offset + slot],
      topology.weights[offset + slot] * blendWeight,
    )
  }
}

function evaluateGrid(
  topology: CompiledGrid,
  x: number,
  y: number,
  result: BlendSpaceSampleWeights,
) {
  const cellsX = topology.sizeX - 1
  const cellsY = topology.sizeY - 1
  const scaledX = x * cellsX
  const scaledY = y * cellsY
  const cellX = Math.min(Math.floor(scaledX), cellsX - 1)
  const cellY = Math.min(Math.floor(scaledY), cellsY - 1)
  const alphaX = scaledX - cellX
  const alphaY = scaledY - cellY
  const lowerLeft = cellX + cellY * topology.sizeX
  const lowerRight = lowerLeft + 1
  const upperLeft = lowerLeft + topology.sizeX
  const upperRight = upperLeft + 1

  addGridSample(topology, lowerLeft, (1 - alphaX) * (1 - alphaY), result)
  addGridSample(topology, lowerRight, alphaX * (1 - alphaY), result)
  addGridSample(topology, upperLeft, (1 - alphaX) * alphaY, result)
  addGridSample(topology, upperRight, alphaX * alphaY, result)
}

/**
 * Evaluates one clamped BlendSpace input without allocating. Serialized topology coordinates are
 * normalized, while callers provide authored axis units (degrees for Look, ALS amounts elsewhere).
 */
export function evaluateBlendSpace(
  evaluator: BlendSpaceEvaluator,
  x: number,
  y = 0,
): BlendSpaceSampleWeights {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('BlendSpace input must be finite')
  }
  const { blendSpace, result } = evaluator
  result.count = 0
  const normalizedX = Math.min(
    Math.max((x - blendSpace.minX) * blendSpace.inverseRangeX, 0),
    1,
  )
  const normalizedY = blendSpace.dimensions === 2
    ? Math.min(Math.max((y - blendSpace.minY) * blendSpace.inverseRangeY, 0), 1)
    : 0

  switch (blendSpace.topology.kind) {
    case 'segments':
      evaluateSegments(blendSpace.topology, normalizedX, result)
      break
    case 'triangles':
      evaluateTriangles(blendSpace.topology, normalizedX, normalizedY, result)
      break
    case 'grid':
      evaluateGrid(blendSpace.topology, normalizedX, normalizedY, result)
      break
  }
  finishWeights(result)
  return result
}
