export const FRAME_PERFORMANCE_PUBLISH_INTERVAL_MS = 1_000
export const FRAME_PERFORMANCE_ROLLING_CAPACITY = 600
export const FRAME_PERFORMANCE_CAPTURE_CAPACITY = 60_000
export const FRAME_PERFORMANCE_MAX_CAPTURE_SECONDS = 60

const SIXTY_HZ_FRAME_BUDGET_MS = 16.667
const THIRTY_HZ_FRAME_BUDGET_MS = 33.333

export interface FramePerformanceRendererInfo {
  calls: number
  triangles: number
  lines: number
  points: number
}

export interface FramePerformanceBudgetMisses {
  count: number
  ratio: number
}

export interface FramePerformanceReport {
  sampleDurationMs: number
  frameCount: number
  fps: number
  frameTimeMs: {
    mean: number
    p50: number
    p95: number
    p99: number
    max: number
  }
  framesOver16_667Ms: FramePerformanceBudgetMisses
  framesOver33_333Ms: FramePerformanceBudgetMisses
  renderer: FramePerformanceRendererInfo | null
}

function validateCapacity(capacity: number) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError('Frame-performance capacity must be a positive integer.')
  }
}

function percentile(sortedSamples: Float64Array, percentileValue: number) {
  if (sortedSamples.length === 0) {
    return 0
  }

  const index = Math.ceil(percentileValue * sortedSamples.length) - 1
  return sortedSamples[Math.max(0, index)]
}

function snapshotRendererInfo(
  rendererInfo: FramePerformanceRendererInfo | null | undefined,
): FramePerformanceRendererInfo | null {
  if (
    rendererInfo == null
    || !Number.isFinite(rendererInfo.calls)
    || !Number.isFinite(rendererInfo.triangles)
    || !Number.isFinite(rendererInfo.lines)
    || !Number.isFinite(rendererInfo.points)
  ) {
    return null
  }

  return {
    calls: rendererInfo.calls,
    triangles: rendererInfo.triangles,
    lines: rendererInfo.lines,
    points: rendererInfo.points,
  }
}

/**
 * Fixed-storage frame sampler. Recording a frame only mutates the ring; report
 * allocation and exact percentile sorting happen at the publication boundary.
 */
export class FramePerformanceTracker {
  private readonly samples: Float64Array
  private writeIndex = 0
  private sampleCount = 0

  constructor(capacity = FRAME_PERFORMANCE_ROLLING_CAPACITY) {
    validateCapacity(capacity)
    this.samples = new Float64Array(capacity)
  }

  get capacity() {
    return this.samples.length
  }

  get frameCount() {
    return this.sampleCount
  }

  get isFull() {
    return this.sampleCount === this.samples.length
  }

  recordFrame(frameTimeMs: number) {
    if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) {
      return false
    }

    this.samples[this.writeIndex] = frameTimeMs
    this.writeIndex = (this.writeIndex + 1) % this.samples.length
    this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length)
    return true
  }

  reset() {
    this.writeIndex = 0
    this.sampleCount = 0
  }

  createReport(
    rendererInfo?: FramePerformanceRendererInfo | null,
  ): FramePerformanceReport {
    const sortedSamples = new Float64Array(this.sampleCount)
    sortedSamples.set(this.samples.subarray(0, this.sampleCount))

    let sampleDurationMs = 0
    let over16_667MsCount = 0
    let over33_333MsCount = 0

    for (const sample of sortedSamples) {
      sampleDurationMs += sample
      if (sample > SIXTY_HZ_FRAME_BUDGET_MS) {
        over16_667MsCount += 1
      }
      if (sample > THIRTY_HZ_FRAME_BUDGET_MS) {
        over33_333MsCount += 1
      }
    }

    sortedSamples.sort()

    const frameCount = sortedSamples.length
    const ratioDivisor = frameCount > 0 ? frameCount : 1

    return {
      sampleDurationMs,
      frameCount,
      fps: sampleDurationMs > 0
        ? frameCount * 1_000 / sampleDurationMs
        : 0,
      frameTimeMs: {
        mean: frameCount > 0 ? sampleDurationMs / frameCount : 0,
        p50: percentile(sortedSamples, 0.5),
        p95: percentile(sortedSamples, 0.95),
        p99: percentile(sortedSamples, 0.99),
        max: frameCount > 0 ? sortedSamples[frameCount - 1] : 0,
      },
      framesOver16_667Ms: {
        count: over16_667MsCount,
        ratio: over16_667MsCount / ratioDivisor,
      },
      framesOver33_333Ms: {
        count: over33_333MsCount,
        ratio: over33_333MsCount / ratioDivisor,
      },
      renderer: snapshotRendererInfo(rendererInfo),
    }
  }
}

interface ActiveFramePerformanceCapture {
  tracker: FramePerformanceTracker
  targetDurationMs: number
  sampledDurationMs: number
  resolve: (report: FramePerformanceReport) => void
  reject: (reason: Error) => void
}

export function validateFramePerformanceCaptureSeconds(
  seconds: number,
  maxSeconds = FRAME_PERFORMANCE_MAX_CAPTURE_SECONDS,
) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > maxSeconds) {
    throw new RangeError(
      `Capture duration must be a finite number greater than 0 and at most ${maxSeconds} seconds.`,
    )
  }
}

/**
 * Owns the single clean capture exposed to automation. Visibility resets retain
 * the pending request but discard its pre-gap samples, so a report never spans
 * a suspended-tab delta.
 */
export class FramePerformanceCapture {
  private readonly capacity: number
  private readonly maxSeconds: number
  private activeCapture: ActiveFramePerformanceCapture | null = null

  constructor(
    capacity = FRAME_PERFORMANCE_CAPTURE_CAPACITY,
    maxSeconds = FRAME_PERFORMANCE_MAX_CAPTURE_SECONDS,
  ) {
    validateCapacity(capacity)
    validateFramePerformanceCaptureSeconds(maxSeconds, maxSeconds)
    this.capacity = capacity
    this.maxSeconds = maxSeconds
  }

  get isActive() {
    return this.activeCapture !== null
  }

  start(seconds: number): Promise<FramePerformanceReport> {
    try {
      validateFramePerformanceCaptureSeconds(seconds, this.maxSeconds)
    } catch (error) {
      return Promise.reject(error)
    }

    if (this.activeCapture !== null) {
      return Promise.reject(
        new Error('A frame-performance capture is already in progress.'),
      )
    }

    return new Promise<FramePerformanceReport>((resolve, reject) => {
      this.activeCapture = {
        tracker: new FramePerformanceTracker(this.capacity),
        targetDurationMs: seconds * 1_000,
        sampledDurationMs: 0,
        resolve,
        reject,
      }
    })
  }

  recordFrame(
    frameTimeMs: number,
    rendererInfo?: FramePerformanceRendererInfo | null,
  ) {
    const capture = this.activeCapture
    if (capture === null || !capture.tracker.recordFrame(frameTimeMs)) {
      return
    }

    capture.sampledDurationMs += frameTimeMs

    if (capture.sampledDurationMs >= capture.targetDurationMs) {
      this.activeCapture = null
      capture.resolve(capture.tracker.createReport(rendererInfo))
      return
    }

    if (capture.tracker.isFull) {
      this.activeCapture = null
      capture.reject(
        new Error(
          `Frame-performance capture exceeded its ${this.capacity}-frame bound before reaching the requested duration.`,
        ),
      )
    }
  }

  resetForVisibilityGap() {
    const capture = this.activeCapture
    if (capture === null) {
      return
    }

    capture.tracker.reset()
    capture.sampledDurationMs = 0
  }

  cancel(reason = 'Frame-performance monitor was removed before capture completed.') {
    const capture = this.activeCapture
    if (capture === null) {
      return
    }

    this.activeCapture = null
    capture.reject(new Error(reason))
  }
}
