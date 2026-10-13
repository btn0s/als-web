import type { AnimationClip } from 'three'

// Structural interfaces support both three and drei's installed three-stdlib loader.
interface AnimationExtrasParser {
  json: { animations?: { extras?: unknown }[] }
}
interface AnimationExtrasPlugin {
  name: string
  afterRoot: (gltf: { animations: AnimationClip[] }) => null
}
interface AnimationExtrasLoader {
  register: (factory: (parser: AnimationExtrasParser) => AnimationExtrasPlugin) => unknown
}

/** Matches three GLTFLoader's assignExtrasToUserData semantics, including shallow assignment. */
export function alsGltfAnimationExtrasPlugin(parser: AnimationExtrasParser): AnimationExtrasPlugin {
  return {
    name: 'ALS_animation_extras',
    afterRoot(gltf) {
      for (const [i, clip] of gltf.animations.entries()) {
        const extras = parser.json.animations?.[i]?.extras
        if (extras === undefined) continue
        if (typeof extras === 'object') {
          Object.assign(clip.userData, extras)
        } else {
          console.warn('THREE.GLTFLoader: Ignoring primitive type .extras, ' + extras)
        }
      }
      return null
    },
  }
}

/** useGLTF(url, draco, meshopt, extendAlsGltfLoader). */
export function extendAlsGltfLoader(loader: AnimationExtrasLoader): void {
  loader.register(alsGltfAnimationExtrasPlugin)
}
