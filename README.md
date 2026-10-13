# ALS Refactored for React Three Fiber

A standalone web port of [ALS Refactored](https://github.com/Sixze/ALS-Refactored), built on React Three Fiber and Rapier with the native `SK_Als` skeleton.

This repository is a reference implementation and forkable template for ALS-grade locomotion on the web. It is still in active parity work: [ROADMAP.md](./ROADMAP.md) is the authoritative status, and [AGENTS.md](./AGENTS.md) defines the source-of-truth and contribution rules.

## Run locally

Requirements: Node.js 24+ and pnpm 11.15.1.

```sh
pnpm install
pnpm dev
```

Click the scene to lock the pointer.

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Tap / hold `Shift` | Roll / Sprint |
| Left `Alt` | Toggle Walking / Running |
| Left `Ctrl` | Toggle Standing / Crouching |
| `Space` | Jump / mantle |
| Right mouse | Aim |
| `1` | Toggle VelocityDirection / ViewDirection |
| `2` | Toggle first / third person |
| `C` | Switch shoulder |
| Hold `Q` + wheel | Select overlay mode in slow motion; release to apply |

## Loading the character

`skm-als.glb` carries authored curves, notifies, sync markers, interpolation, root motion,
and additive settings in animation extras. Always use the exported ALS loader; never load
this asset with plain drei `useGLTF`, whose three-stdlib loader drops those extras.
The package's current name is `als-ue5-r3f` (adjust imports to your fork's package name).

For a local character, `Character` already uses the progress/retry hook:

```tsx
import { useAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf.hooks'

const { gltf, status, progress, retry } = useAlsCharacterGltf() // default /assets/skm-als.glb
```

Outside React, use `loadAlsCharacterGltf(url?, { signal, onProgress })`. Progress is a
0–1 download fraction when content-length is available. Abort also prevents publication
if parsing has already started. This direct loader does not cache requests.

Remote characters and NPCs under `<Suspense>` share one download/parse per URL:

```tsx
import { useMemo } from 'react'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { useSuspenseAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf.hooks'

function Actor() {
  const asset = useSuspenseAlsCharacterGltf()
  const gltf = useMemo(() => ({ ...asset, scene: clone(asset.scene) }), [asset])
  // Give gltf to this actor's animation instance; each actor owns its skeleton.
  return <primitive object={gltf.scene} dispose={null} />
}
```

`preloadAlsCharacterGltf(url?)` warms that same cache. For a failed cached load, call
`clearAlsCharacterGltf(url?)` before resetting your error boundary to retry. Both functions
are exported from `als-ue5-r3f/app/AlsCharacterGltf`. Keep the cached scene immutable;
clone with `SkeletonUtils.clone` for each actor and share its read-only animation clips.

Existing drei consumers can preserve extras with the exported loader extension:

```tsx
import { useGLTF } from '@react-three/drei'
import { extendAlsGltfLoader } from 'als-ue5-r3f/engine/gltfAnimationExtras'

const gltf = useGLTF('/assets/skm-als.glb', true, true, extendAlsGltfLoader)
```

Configure the extension on the first load (including any `useGLTF.preload`); drei caches by
URL, so clear a previously plain-loaded entry with `useGLTF.clear(url)` before reloading.
The lower-level `alsGltfAnimationExtrasPlugin` is also exported for `loader.register(...)`.

Downstream games can rebind or disable the two debug toggles: pass `toggleRotationModeKey` to `Character` and `toggleViewModeKey` to `AlsCamera` (a `KeyboardEvent.code`, or `null` to disable). `aimPointerButtons` on `Character` sets which `PointerEvent.button` values hold aim (default `[2]`). For example, a trackpad layout can pass `[0, 2]` so one click aims and fires.

## Verify

```sh
pnpm check
pnpm lint
pnpm e2e
```

`pnpm check` runs the pure-module test suite and production build. The Playwright smoke owns its local Vite server and runs serially.

## Scope and licensing

Gameplay systems beyond ALS locomotion belong in downstream forks. ALS-derived assets under `public/assets/` retain the upstream MIT notice in [`LICENSE-ALS-Refactored.md`](./public/assets/LICENSE-ALS-Refactored.md). A license for this port's original source code must be selected before public distribution.

`Character` and `AlsCamera` accept `gamepadBindings`, a partial map of W3C standard button indices (or `null` to disable an action). Defaults remain jump 0, sprint 1, ragdoll 2, walk 5, crouch 10, aim 4, rotationMode 14, shoulderSwap 11 and viewMode 15. For a shooter, pass `{ jump: 0, sprint: 10, crouch: 1, aim: 6, ragdoll: null, walk: null, rotationMode: null, shoulderSwap: 11, viewMode: null }` to both. `gamepadEnabled={false}` suppresses pad movement, look and actions during menus; `gamepadIndex` selects a connected pad, otherwise the first connected pad is used. Stick deadzones and authored look response are unchanged.

`gamepadBindings.roll` separates roll from sprint (omitting it inherits the sprint binding). `Character.gamepadRollBehavior` defaults to `"tap"`, preserving ALS's authored release-triggered roll. Consumers can opt into `"doubleTap"`: both presses toggle crouch normally when bound to the crouch button; two released short taps must start within the authored 0.3-second tap window, and rolling starts on the second release. ALS forces crouch during the roll and restores desired stance afterward. This double-tap recognizer is a consumer extension; IMC_Als itself uses Pressed crouch and a single 0.3-second Tap roll. Keyboard input remains unchanged.

`AlsCamera.modifyGamepadLook` optionally transforms the authored, deadzoned gamepad look deltas (degrees per frame) before control rotation is refreshed. It receives the pad, current control yaw/pitch, delta time and yaw/pitch deltas, and returns modified deltas. Keyboard and pointer deltas are added independently; no modifier runs without an enabled pad. Downstream aim assistance can use this seam without changing the camera transform or ALS look response defaults.
