import { createRigDefinition } from '../engine/rig'
import { precompileClipSamplers } from '../engine/clipSampler'
import { ALS_VIRTUAL_BONES } from '../als/Utility/AlsVirtualBones'
import type { AnimationClip } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { applyCharacterMaterialOverrides } from '../als/characterMaterials'

export const ALS_CHARACTER_URL = '/assets/skm-als.glb'

export interface AlsCharacterGltfLoadOptions {
  signal?: AbortSignal
  /** Download fraction in [0, 1]; absent content-length leaves progress indeterminate. */
  onProgress?: (progress: number) => void
}

/** Uses three's loader: three-stdlib drops the authored animation extras. */
export async function loadAlsCharacterGltf(
  url = ALS_CHARACTER_URL,
  { signal, onProgress }: AlsCharacterGltfLoadOptions = {},
): Promise<GLTF> {
  signal?.throwIfAborted()
  const response = await fetch(url, { signal })
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error(`Character request failed (${response.status})`)
  }

  let buffer: ArrayBuffer
  const totalBytes = Number(response.headers.get('content-length')) || 0
  if (response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    try {
      while (true) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        receivedBytes += value.byteLength
        if (totalBytes > 0) onProgress?.(Math.min(1, receivedBytes / totalBytes))
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    buffer = bytes.buffer
  } else {
    buffer = await response.arrayBuffer()
  }
  signal?.throwIfAborted()
  const magic = [0x67, 0x6c, 0x54, 0x46]
  if (buffer.byteLength < 12 || !magic.every((byte, i) => new Uint8Array(buffer)[i] === byte)) {
    throw new Error('Character response was not a GLB')
  }
  const resourcePath = new URL('.', response.url || new URL(url, globalThis.location?.href).href).href
  const gltf = await new GLTFLoader().parseAsync(buffer, resourcePath)
  // Parsing is not cancellable, but an aborted request must never publish its result.
  signal?.throwIfAborted()
  applyCharacterMaterialOverrides(gltf.scene)
  return gltf
}

const cachedLoads = new Map<string, Promise<GLTF>>()

/** N actors share one download/parse. Rejections stay cached for the error boundary. */
export function preloadAlsCharacterGltf(url = ALS_CHARACTER_URL, options: AlsCharacterGltfLoadOptions = {}): Promise<GLTF> {
  let pending = cachedLoads.get(url)
  if (!pending) {
    pending = loadAlsCharacterGltf(url, { onProgress: options.onProgress }).catch(error => { cachedLoads.delete(url); throw error })
    cachedLoads.set(url, pending)
  }
  return pending
}

/** Clear before resetting a Suspense error boundary to retry; mounted assets remain valid. */
export function clearAlsCharacterGltf(url = ALS_CHARACTER_URL): void {
  cachedLoads.delete(url)
}

export async function prewarmAlsCharacter(extraClips: readonly AnimationClip[] = []): Promise<GLTF> {
  const gltf = await preloadAlsCharacterGltf()
  const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
  precompileClipSamplers([...gltf.animations, ...extraClips], rig)
  return gltf
}
