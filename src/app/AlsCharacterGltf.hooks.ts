import { use, useCallback, useEffect, useState } from 'react'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { ALS_CHARACTER_URL, loadAlsCharacterGltf, preloadAlsCharacterGltf } from './AlsCharacterGltf'

export function useAlsCharacterGltf(url = ALS_CHARACTER_URL) {
  const [gltf, setGltf] = useState<GLTF>()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [progress, setProgress] = useState<number>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setStatus('loading')
      setProgress(undefined)
      try {
        const loadedGltf = await loadAlsCharacterGltf(url, {
          signal: controller.signal,
          onProgress: setProgress,
        })
        if (!controller.signal.aborted) {
          setGltf(loadedGltf)
        }
      } catch (error) {
        if (
          !controller.signal.aborted
          && !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          console.debug('[Character] GLB unavailable; showing retry state')
          setStatus('error')
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [attempt, url])

  const retry = useCallback(() => {
    setGltf(undefined)
    setAttempt((value) => value + 1)
  }, [])

  return { gltf, status, progress, retry }
}

/** Shared immutable asset; clone its skeleton/scene for each actor before animating. */
export function useSuspenseAlsCharacterGltf(url = ALS_CHARACTER_URL): GLTF {
  return use(preloadAlsCharacterGltf(url))
}
