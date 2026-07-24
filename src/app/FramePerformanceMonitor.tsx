import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { WebGLRenderer } from 'three'
import {
  FRAME_PERFORMANCE_PUBLISH_INTERVAL_MS,
  FramePerformanceCapture,
  type FramePerformanceRendererInfo,
  type FramePerformanceReport,
  FramePerformanceTracker,
} from '../engine/framePerformance'

interface FramePerformanceDevWindow extends Window {
  __alsPerformance?: FramePerformanceReport
  __captureAlsPerformance?: (
    seconds: number,
  ) => Promise<FramePerformanceReport>
}

interface RendererWithOptionalInfo {
  info?: {
    render?: FramePerformanceRendererInfo
  }
}

function getRendererInfo(
  renderer: WebGLRenderer,
): FramePerformanceRendererInfo | null {
  return (renderer as RendererWithOptionalInfo).info?.render ?? null
}

export function FramePerformanceMonitor() {
  const rollingTracker = useMemo(() => new FramePerformanceTracker(), [])
  const capture = useMemo(() => new FramePerformanceCapture(), [])
  const publishElapsedMs = useRef(0)
  const ignoreNextFrame = useRef(true)

  useEffect(() => {
    const devWindow = window as FramePerformanceDevWindow
    const captureHook = (seconds: number) => capture.start(seconds)

    devWindow.__alsPerformance = rollingTracker.createReport()
    devWindow.__captureAlsPerformance = captureHook

    const resetForVisibilityGap = () => {
      rollingTracker.reset()
      capture.resetForVisibilityGap()
      publishElapsedMs.current = 0
      ignoreNextFrame.current = true
      devWindow.__alsPerformance = rollingTracker.createReport()
    }

    document.addEventListener('visibilitychange', resetForVisibilityGap)

    return () => {
      document.removeEventListener('visibilitychange', resetForVisibilityGap)
      capture.cancel()
      if (devWindow.__captureAlsPerformance === captureHook) {
        delete devWindow.__captureAlsPerformance
        delete devWindow.__alsPerformance
      }
    }
  }, [capture, rollingTracker])

  useFrame((state, deltaSeconds) => {
    if (document.visibilityState !== 'visible') {
      return
    }

    if (ignoreNextFrame.current) {
      ignoreNextFrame.current = false
      return
    }

    const frameTimeMs = deltaSeconds * 1_000
    if (!rollingTracker.recordFrame(frameTimeMs)) {
      return
    }

    const rendererInfo = getRendererInfo(state.gl)
    capture.recordFrame(frameTimeMs, rendererInfo)
    publishElapsedMs.current += frameTimeMs

    if (publishElapsedMs.current < FRAME_PERFORMANCE_PUBLISH_INTERVAL_MS) {
      return
    }

    publishElapsedMs.current = 0
    const devWindow = window as FramePerformanceDevWindow
    devWindow.__alsPerformance = rollingTracker.createReport(rendererInfo)
  })

  return null
}
