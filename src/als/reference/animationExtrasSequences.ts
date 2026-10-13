import type { AnimationClip } from 'three'
import sequenceNames from './animationExtrasSequences.json'

// Exact clips.manifest names, checked against the extraction manifest in tests. assemble-glb.mjs
// always writes these fields, even for sequences with no curves, markers, or notifies.
const extractedSequences = new Set(sequenceNames)
const requiredExtras = ['alsCurves', 'syncMarkers', 'notifies', 'interpolation'] as const

export function assertAlsAnimationExtras(clips: readonly AnimationClip[]): void {
  const missing = clips.filter((clip) => extractedSequences.has(clip.name)
    && requiredExtras.some((field) => !Object.hasOwn(clip.userData, field)))
  if (missing.length === 0) return
  throw new Error(
    `ALS clips were loaded without glTF animation extras (${missing.map((clip) => clip.name).join(', ')}). `
    + 'Plain drei useGLTF / three-stdlib GLTFLoader drops animation extras. '
    + 'Use loadAlsCharacterGltf from app/AlsCharacterGltf, the ALS character hooks, '
    + 'or useGLTF(url, draco, meshopt, extendAlsGltfLoader) from engine/gltfAnimationExtras.',
  )
}
