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

export interface AuthoredBlendSpaceInterpolationParameter {
  readonly index: number
  readonly serialized: {
    readonly InterpolationTime?: number
    readonly InterpolationType?:
      | 'BSIT_Linear'
      | 'BSIT_Cubic'
      | 'BSIT_EaseInOut'
      | 'BSIT_Exponential'
      | 'BSIT_SpringDamper'
    readonly DampingRatio?: number
    readonly MaxSpeed?: number
  }
}

interface NumberedFields {
  readonly [key: string]: unknown
}

export interface AuthoredBlendSpace {
  readonly className: 'BlendSpace' | 'BlendSpace1D'
  readonly loop?: boolean
  /** Serialized UBlendSpace::AnimLength; maximum sample duration, not the dynamic player length. */
  readonly animLengthSeconds?: number
  /** Authored sample whose marker table represents this BlendSpace to an outer sync group. */
  readonly sampleIndexWithMarkers?: number | null
  readonly axes: readonly AuthoredBlendSpaceAxis[]
  readonly interpolationParameters?:
    readonly AuthoredBlendSpaceInterpolationParameter[]
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
  readonly edgeNormals: Float64Array
  readonly neighbours: Int32Array
  readonly adjacentPerimeterTriangles: Int32Array
  readonly adjacentPerimeterVertices: Int32Array
}

interface CompiledGrid {
  readonly kind: 'grid'
  readonly sizeX: number
  readonly sizeY: number
  readonly sampleIndices: Int32Array
  readonly weights: Float64Array
}

type CompiledTopology = CompiledSegments | CompiledTriangles | CompiledGrid

export interface CompiledBlendSpaceAxisInterpolation {
  readonly interpolationTime: number
  readonly interpolationType: 'none' | 'cubic'
}

export interface CompiledBlendSpace {
  readonly dimensions: 1 | 2
  readonly samples: readonly AuthoredBlendSpaceSample[]
  readonly minX: number
  readonly minY: number
  readonly inverseRangeX: number
  readonly inverseRangeY: number
  readonly axisInterpolation:
    readonly CompiledBlendSpaceAxisInterpolation[]
  readonly topology: CompiledTopology
}

export interface BlendSpaceSampleWeights {
  /** Paired with `weights` for indices below `count`, in descending UE sample-weight order. */
  readonly sampleIndices: Int32Array
  readonly weights: Float64Array
  count: number
}

export interface BlendSpaceEvaluator {
  readonly blendSpace: CompiledBlendSpace
  /** Mutable UE FBlendFilter state owned by this player, never by the compiled asset. */
  readonly axisFilters: readonly BlendSpaceAxisFilterState[]
  /** Authored-axis units after filtering and before topology clamping. */
  readonly filteredInput: Float64Array
  /** UE's FAnimNode_BlendSpacePlayer::CachedTriangulationIndex. */
  cachedTriangulationIndex: number
  /**
   * Reused by every evaluation. Consumers must read it before evaluating this instance again.
   */
  readonly result: BlendSpaceSampleWeights
}

const GEOMETRY_EPSILON = 1e-10
const UE_KINDA_SMALL_NUMBER = 1e-4
export const BLEND_SPACE_ZERO_ANIMWEIGHT_THRESH = 1e-5

export interface BlendSpaceAxisFilterState {
  readonly interpolation: CompiledBlendSpaceAxisInterpolation
  readonly values: Float64Array
  readonly times: Float64Array
  start: number
  count: number
  currentTime: number
  lastOutput: number
}

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

function checkedOptionalIndex(
  value: number,
  count: number,
  label: string,
) {
  if (!Number.isInteger(value) || value < -1 || value >= count) {
    throw new Error(`${label} ${value} is outside -1..${count - 1}`)
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
  const edgeNormals = new Float64Array(triangles.length * 6)
  const neighbours = new Int32Array(triangles.length * 3)
  const adjacentPerimeterTriangles = new Int32Array(triangles.length * 6)
  const adjacentPerimeterVertices = new Int32Array(triangles.length * 6)

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
      if (!edge || typeof edge !== 'object') {
        throw new Error(`BlendSpace triangle ${triangleIndex} has no EdgeInfo[${vertexIndex}]`)
      }
      const edgeFields = edge as NumberedFields
      const normal = numberedObject(edgeFields, 'Normal', 0)
      edgeNormals[vertexOffset] = numberedNumber(normal, 'X', 0)
      edgeNormals[vertexOffset + 1] = numberedNumber(normal, 'Y', 0)
      neighbours[sampleOffset] = checkedOptionalIndex(
        numberedNumber(edgeFields, 'NeighbourTriangleIndex', 0),
        triangles.length,
        `BlendSpace neighbour triangle at ${triangleIndex}:${vertexIndex}`,
      )
      for (let direction = 0; direction < 2; direction++) {
        const perimeterOffset = triangleIndex * 6 + vertexIndex * 2 + direction
        adjacentPerimeterTriangles[perimeterOffset] = checkedOptionalIndex(
          numberedNumber(edgeFields, 'AdjacentPerimeterTriangleIndices', direction),
          triangles.length,
          `BlendSpace adjacent perimeter triangle at ${triangleIndex}:${vertexIndex}:${direction}`,
        )
        adjacentPerimeterVertices[perimeterOffset] = checkedOptionalIndex(
          numberedNumber(edgeFields, 'AdjacentPerimeterVertexIndices', direction),
          3,
          `BlendSpace adjacent perimeter vertex at ${triangleIndex}:${vertexIndex}:${direction}`,
        )
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
    const sampleOffset = triangleIndex * 3
    const isUeSinglePoint = (
      triangles.length === 1
      && sampleIndices[sampleOffset] === sampleIndices[sampleOffset + 1]
    )
    const isUeTwoPointLine = (
      triangles.length === 1
      && sampleIndices[sampleOffset + 1] === sampleIndices[sampleOffset + 2]
      && (
        (bx - ax) * (bx - ax) + (by - ay) * (by - ay)
        > GEOMETRY_EPSILON
      )
    )
    if (
      Math.abs(twiceArea) <= GEOMETRY_EPSILON
      && !isUeSinglePoint
      && !isUeTwoPointLine
    ) {
      throw new Error(`BlendSpace triangle ${triangleIndex} has zero area`)
    }
  }
  return {
    kind: 'triangles',
    sampleIndices,
    vertices,
    edgeNormals,
    neighbours,
    adjacentPerimeterTriangles,
    adjacentPerimeterVertices,
  }
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

function compileAxisInterpolation(
  authored: AuthoredBlendSpace,
  dimensions: 1 | 2,
): readonly CompiledBlendSpaceAxisInterpolation[] {
  const result: CompiledBlendSpaceAxisInterpolation[] = Array.from(
    { length: dimensions },
    () => ({ interpolationTime: 0, interpolationType: 'none' }),
  )
  const seen = new Set<number>()
  for (const parameter of authored.interpolationParameters ?? []) {
    if (
      !Number.isInteger(parameter.index)
      || parameter.index < 0
      || parameter.index >= dimensions
    ) {
      throw new Error(
        `BlendSpace interpolation axis ${parameter.index} is outside 0..${dimensions - 1}`,
      )
    }
    if (seen.has(parameter.index)) {
      throw new Error(
        `BlendSpace interpolation axis ${parameter.index} is duplicated`,
      )
    }
    seen.add(parameter.index)
    const interpolationTime = parameter.serialized.InterpolationTime ?? 0
    if (!Number.isFinite(interpolationTime) || interpolationTime < 0) {
      throw new Error(
        `BlendSpace interpolation axis ${parameter.index} has invalid time`,
      )
    }
    if (interpolationTime === 0) continue
    const interpolationType =
      parameter.serialized.InterpolationType ?? 'BSIT_Linear'
    if (interpolationType !== 'BSIT_Cubic') {
      throw new Error(
        `BlendSpace interpolation axis ${parameter.index} uses unsupported `
        + interpolationType,
      )
    }
    result[parameter.index] = {
      interpolationTime,
      interpolationType: 'cubic',
    }
  }
  return result
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
  const axisInterpolation = compileAxisInterpolation(authored, dimensions)
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
    axisInterpolation,
    topology,
  }
}

export function createBlendSpaceEvaluator(
  blendSpace: CompiledBlendSpace,
): BlendSpaceEvaluator {
  const axisFilters = blendSpace.axisInterpolation.map((interpolation) => {
    const capacity = interpolation.interpolationType === 'cubic'
      ? Math.ceil(
          interpolation.interpolationTime / UE_KINDA_SMALL_NUMBER,
        ) + 2
      : 0
    return {
      interpolation,
      values: new Float64Array(capacity),
      times: new Float64Array(capacity),
      start: 0,
      count: 0,
      currentTime: 0,
      lastOutput: 0,
    }
  })
  return {
    blendSpace,
    axisFilters,
    filteredInput: new Float64Array(blendSpace.dimensions),
    cachedTriangulationIndex: -1,
    result: {
      sampleIndices: new Int32Array(blendSpace.samples.length),
      weights: new Float64Array(blendSpace.samples.length),
      count: 0,
    },
  }
}

export function resetBlendSpaceEvaluator(evaluator: BlendSpaceEvaluator) {
  evaluator.filteredInput.fill(0)
  evaluator.cachedTriangulationIndex = -1
  evaluator.result.count = 0
  for (const filter of evaluator.axisFilters) {
    filter.start = 0
    filter.count = 0
    filter.currentTime = 0
    filter.lastOutput = 0
  }
}

function updateBlendSpaceAxisFilter(
  filter: BlendSpaceAxisFilterState,
  input: number,
  deltaTime: number,
) {
  if (filter.interpolation.interpolationType === 'none') {
    filter.lastOutput = input
    return input
  }

  filter.currentTime += deltaTime
  const capacity = filter.values.length
  if (filter.count === capacity) {
    // The preallocated bound assumes every accepted delta is strictly above KINDA_SMALL_NUMBER.
    // Retaining the newest history is still deterministic if floating-point accumulation reaches
    // that theoretical bound by one sample.
    filter.start = (filter.start + 1) % capacity
    filter.count--
  }
  const insertionIndex = (filter.start + filter.count) % capacity
  filter.values[insertionIndex] = input
  filter.times[insertionIndex] = filter.currentTime
  filter.count++

  const interpolationTime = filter.interpolation.interpolationTime
  while (
    filter.count > 0
    && filter.currentTime - filter.times[filter.start] > interpolationTime
  ) {
    filter.start = (filter.start + 1) % capacity
    filter.count--
  }

  let weightedValue = 0
  let totalWeight = 0
  for (let sample = 0; sample < filter.count; sample++) {
    const index = (filter.start + sample) % capacity
    const age = filter.currentTime - filter.times[index]
    const normalizedAge = Math.min(Math.max(age / interpolationTime, 0), 1)
    const weight = 1 - normalizedAge ** 3
    weightedValue += filter.values[index] * weight
    totalWeight += weight
  }
  filter.lastOutput = weightedValue / totalWeight
  return filter.lastOutput
}

/**
 * Advances this player's authored per-axis filters, then evaluates the existing immutable
 * topology. Filter time advances only when the owning player is relevant and calls this function.
 */
export function updateBlendSpaceEvaluator(
  evaluator: BlendSpaceEvaluator,
  x: number,
  y: number,
  deltaTime: number,
): BlendSpaceSampleWeights {
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(deltaTime)
    || deltaTime < 0
  ) {
    throw new Error(
      'BlendSpace update inputs must be finite and deltaTime must be non-negative',
    )
  }
  if (deltaTime > UE_KINDA_SMALL_NUMBER) {
    evaluator.filteredInput[0] = updateBlendSpaceAxisFilter(
      evaluator.axisFilters[0],
      x,
      deltaTime,
    )
    if (evaluator.blendSpace.dimensions === 2) {
      evaluator.filteredInput[1] = updateBlendSpaceAxisFilter(
        evaluator.axisFilters[1],
        y,
        deltaTime,
      )
    }
  }
  return evaluateBlendSpace(
    evaluator,
    evaluator.filteredInput[0],
    evaluator.filteredInput[1] ?? 0,
  )
}

function addWeight(
  result: BlendSpaceSampleWeights,
  sampleIndex: number,
  weight: number,
) {
  if (weight <= 0) return

  for (let index = 0; index < result.count; index++) {
    if (result.sampleIndices[index] === sampleIndex) {
      result.weights[index] += weight
      return
    }
  }

  result.sampleIndices[result.count] = sampleIndex
  result.weights[result.count] = weight
  result.count++
}

function finishWeights(
  result: BlendSpaceSampleWeights,
  includeThresholdEquality: boolean,
) {
  let retainedCount = 0
  for (let index = 0; index < result.count; index++) {
    const weight = result.weights[index]
    const isRelevant = includeThresholdEquality
      ? weight >= BLEND_SPACE_ZERO_ANIMWEIGHT_THRESH
      : weight > BLEND_SPACE_ZERO_ANIMWEIGHT_THRESH
    if (!isRelevant) continue
    result.sampleIndices[retainedCount] = result.sampleIndices[index]
    result.weights[retainedCount] = weight
    retainedCount++
  }
  result.count = retainedCount

  // UBlendSpace::GetSamplesFromBlendInput sorts largest-to-smallest before normalization.
  for (let index = 1; index < result.count; index++) {
    const sampleIndex = result.sampleIndices[index]
    const weight = result.weights[index]
    let insertionIndex = index
    while (
      insertionIndex > 0
      && result.weights[insertionIndex - 1] < weight
    ) {
      result.sampleIndices[insertionIndex] = result.sampleIndices[insertionIndex - 1]
      result.weights[insertionIndex] = result.weights[insertionIndex - 1]
      insertionIndex--
    }
    result.sampleIndices[insertionIndex] = sampleIndex
    result.weights[insertionIndex] = weight
  }

  let totalWeight = 0
  for (let index = 0; index < result.count; index++) {
    totalWeight += result.weights[index]
  }
  if (!(totalWeight > 0)) throw new Error('BlendSpace evaluation produced no samples')
  for (let index = 0; index < result.count; index++) {
    result.weights[index] /= totalWeight
  }
}

function addBarycentricWeights(
  topology: CompiledTriangles,
  triangleIndex: number,
  x: number,
  y: number,
  result: BlendSpaceSampleWeights,
) {
  const vertexOffset = triangleIndex * 6
  const ax = topology.vertices[vertexOffset]
  const ay = topology.vertices[vertexOffset + 1]
  const bx = topology.vertices[vertexOffset + 2]
  const by = topology.vertices[vertexOffset + 3]
  const cx = topology.vertices[vertexOffset + 4]
  const cy = topology.vertices[vertexOffset + 5]
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  const weightA = (
    (by - cy) * (x - cx) + (cx - bx) * (y - cy)
  ) / denominator
  const weightB = (
    (cy - ay) * (x - cx) + (ax - cx) * (y - cy)
  ) / denominator
  const weightC = 1 - weightA - weightB
  const sampleOffset = triangleIndex * 3
  addWeight(result, topology.sampleIndices[sampleOffset], weightA)
  addWeight(result, topology.sampleIndices[sampleOffset + 1], weightB)
  addWeight(result, topology.sampleIndices[sampleOffset + 2], weightC)
}

function evaluateSegments(
  topology: CompiledSegments,
  x: number,
  result: BlendSpaceSampleWeights,
  cachedSegmentIndex: number,
) {
  const segmentCount = topology.vertices.length / 2
  if (
    segmentCount === 1
    && topology.sampleIndices[0] === topology.sampleIndices[1]
  ) {
    addWeight(result, topology.sampleIndices[0], 1)
    return cachedSegmentIndex
  }

  let segmentIndex = cachedSegmentIndex
  if (segmentIndex < 0 || segmentIndex >= segmentCount) {
    segmentIndex = Math.floor(segmentCount / 2)
  }

  for (let attempt = 0; attempt < segmentCount; attempt++) {
    const offset = segmentIndex * 2
    const from = topology.vertices[offset]
    const to = topology.vertices[offset + 1]
    if (x < from) {
      if (segmentIndex > 0) {
        segmentIndex--
      } else {
        addWeight(result, topology.sampleIndices[offset], 1)
        return segmentIndex
      }
    } else if (x > to) {
      if (segmentIndex < segmentCount - 1) {
        segmentIndex++
      } else {
        addWeight(result, topology.sampleIndices[offset + 1], 1)
        return segmentIndex
      }
    } else {
      const alpha = Math.min(Math.max((x - from) / (to - from), 0), 1)
      addWeight(result, topology.sampleIndices[offset], 1 - alpha)
      addWeight(result, topology.sampleIndices[offset + 1], alpha)
      return segmentIndex
    }
  }

  throw new Error('Unable to find BlendSpace segment')
}

function evaluateTriangles(
  topology: CompiledTriangles,
  x: number,
  y: number,
  result: BlendSpaceSampleWeights,
  cachedTriangleIndex: number,
) {
  const triangleCount = topology.sampleIndices.length / 3
  if (triangleCount === 1) {
    if (topology.sampleIndices[0] === topology.sampleIndices[1]) {
      addWeight(result, topology.sampleIndices[0], 1)
      return cachedTriangleIndex
    }
    if (topology.sampleIndices[1] === topology.sampleIndices[2]) {
      const startX = topology.vertices[0]
      const startY = topology.vertices[1]
      const deltaX = topology.vertices[2] - startX
      const deltaY = topology.vertices[3] - startY
      const alpha = (
        (x - startX) * deltaX + (y - startY) * deltaY
      ) / (deltaX * deltaX + deltaY * deltaY)
      if (alpha < 0) {
        addWeight(result, topology.sampleIndices[0], 1)
      } else if (alpha > 1) {
        addWeight(result, topology.sampleIndices[1], 1)
      } else {
        addWeight(result, topology.sampleIndices[0], 1 - alpha)
        addWeight(result, topology.sampleIndices[1], alpha)
      }
      return cachedTriangleIndex
    }
  }

  let triangleIndex = cachedTriangleIndex
  if (triangleIndex < 0 || triangleIndex >= triangleCount) {
    triangleIndex = Math.floor(triangleCount / 2)
  }

  for (let attempt = 0; attempt < triangleCount; attempt++) {
    let largestDistance = UE_KINDA_SMALL_NUMBER
    let largestEdgeIndex = -1
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const vertexOffset = triangleIndex * 6 + edgeIndex * 2
      const distance = (
        (x - topology.vertices[vertexOffset]) * topology.edgeNormals[vertexOffset]
        + (y - topology.vertices[vertexOffset + 1])
        * topology.edgeNormals[vertexOffset + 1]
      )
      if (distance > largestDistance) {
        largestDistance = distance
        largestEdgeIndex = edgeIndex
      }
    }

    if (largestEdgeIndex < 0) {
      addBarycentricWeights(topology, triangleIndex, x, y, result)
      return triangleIndex
    }

    const edgeOffset = triangleIndex * 3 + largestEdgeIndex
    if (topology.neighbours[edgeOffset] >= 0) {
      triangleIndex = topology.neighbours[edgeOffset]
      continue
    }

    let originalDirection = -1
    let startIndex = largestEdgeIndex
    let endIndex = (startIndex + 1) % 3
    let previousTriangleIndex = triangleIndex

    for (
      let perimeterAttempt = 0;
      perimeterAttempt < triangleCount;
      perimeterAttempt++
    ) {
      const vertexOffset = triangleIndex * 6
      const startOffset = vertexOffset + startIndex * 2
      const endOffset = vertexOffset + endIndex * 2
      const startX = topology.vertices[startOffset]
      const startY = topology.vertices[startOffset + 1]
      const deltaX = topology.vertices[endOffset] - startX
      const deltaY = topology.vertices[endOffset + 1] - startY
      const alpha = (
        deltaX * (x - startX) + deltaY * (y - startY)
      ) / (deltaX * deltaX + deltaY * deltaY)

      if (alpha >= 0 && alpha <= 1) {
        const sampleOffset = triangleIndex * 3
        addWeight(result, topology.sampleIndices[sampleOffset + startIndex], 1 - alpha)
        addWeight(result, topology.sampleIndices[sampleOffset + endIndex], alpha)
        return triangleIndex
      }

      if (originalDirection < 0) {
        originalDirection = alpha > 1 ? 1 : 0
      }
      const direction = alpha > 1 ? 1 : 0
      const sampleOffset = triangleIndex * 3
      if (originalDirection !== direction) {
        if (direction === 0) {
          addWeight(
            result,
            topology.sampleIndices[sampleOffset + startIndex],
            1 - alpha,
          )
        } else {
          addWeight(
            result,
            topology.sampleIndices[sampleOffset + endIndex],
            alpha,
          )
        }
        return previousTriangleIndex
      }

      previousTriangleIndex = triangleIndex
      const perimeterOffset = (
        triangleIndex * 6 + startIndex * 2 + direction
      )
      triangleIndex = topology.adjacentPerimeterTriangles[perimeterOffset]
      if (triangleIndex < 0) {
        if (direction === 0) {
          addWeight(
            result,
            topology.sampleIndices[sampleOffset + startIndex],
            1 - alpha,
          )
        } else {
          addWeight(
            result,
            topology.sampleIndices[sampleOffset + endIndex],
            alpha,
          )
        }
        return previousTriangleIndex
      }
      startIndex = topology.adjacentPerimeterVertices[perimeterOffset]
      endIndex = (startIndex + 1) % 3
    }
  }

  throw new Error('Unable to find BlendSpace triangle')
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
    case 'segments': {
      evaluator.cachedTriangulationIndex = evaluateSegments(
        blendSpace.topology,
        normalizedX,
        result,
        evaluator.cachedTriangulationIndex,
      )
      break
    }
    case 'triangles': {
      evaluator.cachedTriangulationIndex = evaluateTriangles(
        blendSpace.topology,
        normalizedX,
        normalizedY,
        result,
        evaluator.cachedTriangulationIndex,
      )
      break
    }
    case 'grid':
      evaluateGrid(blendSpace.topology, normalizedX, normalizedY, result)
      break
  }
  finishWeights(result, blendSpace.topology.kind === 'grid')
  return result
}
