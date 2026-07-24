import { describe, expect, it } from 'vitest'
import {
  FramePerformanceCapture,
  FramePerformanceTracker,
  validateFramePerformanceCaptureSeconds,
} from './framePerformance'

describe('FramePerformanceTracker', () => {
  it('reports exact statistics and nearest-rank percentiles', () => {
    const tracker = new FramePerformanceTracker(100)
    for (let frameTimeMs = 1; frameTimeMs <= 100; frameTimeMs += 1) {
      tracker.recordFrame(frameTimeMs)
    }

    const report = tracker.createReport({
      calls: 12,
      triangles: 34,
      lines: 56,
      points: 78,
    })

    expect(report.sampleDurationMs).toBe(5_050)
    expect(report.frameCount).toBe(100)
    expect(report.fps).toBeCloseTo(100_000 / 5_050)
    expect(report.frameTimeMs).toEqual({
      mean: 50.5,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
    })
    expect(report.framesOver16_667Ms).toEqual({
      count: 84,
      ratio: 0.84,
    })
    expect(report.framesOver33_333Ms).toEqual({
      count: 67,
      ratio: 0.67,
    })
    expect(report.renderer).toEqual({
      calls: 12,
      triangles: 34,
      lines: 56,
      points: 78,
    })
  })

  it('keeps only the newest samples when the ring wraps', () => {
    const tracker = new FramePerformanceTracker(4)
    for (const frameTimeMs of [10, 20, 30, 40, 50]) {
      tracker.recordFrame(frameTimeMs)
    }

    const report = tracker.createReport()

    expect(report.frameCount).toBe(4)
    expect(report.sampleDurationMs).toBe(140)
    expect(report.frameTimeMs).toEqual({
      mean: 35,
      p50: 30,
      p95: 50,
      p99: 50,
      max: 50,
    })
  })

  it('ignores invalid deltas and treats budget thresholds as strictly over', () => {
    const tracker = new FramePerformanceTracker(4)

    expect(tracker.recordFrame(0)).toBe(false)
    expect(tracker.recordFrame(Number.NaN)).toBe(false)
    tracker.recordFrame(16.667)
    tracker.recordFrame(16.668)
    tracker.recordFrame(33.333)
    tracker.recordFrame(33.334)

    const report = tracker.createReport()
    expect(report.framesOver16_667Ms).toEqual({ count: 3, ratio: 0.75 })
    expect(report.framesOver33_333Ms).toEqual({ count: 1, ratio: 0.25 })
  })
})

describe('FramePerformanceCapture', () => {
  it('validates capture duration and rejects concurrent captures clearly', async () => {
    expect(() => validateFramePerformanceCaptureSeconds(0)).toThrow(
      'Capture duration must be a finite number greater than 0',
    )
    expect(() => validateFramePerformanceCaptureSeconds(Number.NaN)).toThrow(
      'Capture duration must be a finite number greater than 0',
    )
    expect(() => validateFramePerformanceCaptureSeconds(61)).toThrow(
      'at most 60 seconds',
    )

    const capture = new FramePerformanceCapture(10)
    const first = capture.start(0.03)

    await expect(capture.start(1)).rejects.toThrow(
      'A frame-performance capture is already in progress.',
    )

    capture.recordFrame(10)
    capture.recordFrame(10)
    capture.recordFrame(10)

    await expect(first).resolves.toMatchObject({
      sampleDurationMs: 30,
      frameCount: 3,
    })
  })

  it('restarts an active capture after a visibility gap', async () => {
    const capture = new FramePerformanceCapture(10)
    const result = capture.start(0.03)

    capture.recordFrame(20)
    capture.resetForVisibilityGap()
    capture.recordFrame(10)
    capture.recordFrame(10)
    capture.recordFrame(10)

    await expect(result).resolves.toMatchObject({
      sampleDurationMs: 30,
      frameCount: 3,
    })
  })
})
