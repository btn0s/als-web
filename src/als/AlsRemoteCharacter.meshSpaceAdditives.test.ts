/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createAlsAnimationInstance } from './AlsAnimationInstance'
import { AlsRemoteCharacter } from './AlsRemoteCharacter'
import type { AlsCharacterSnapshot } from './AlsCharacterSnapshot'

it('replays a remote rifle actor jumping while turning', async () => {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const animation = createAlsAnimationInstance({ scene: gltf.scene, animations: gltf.animations, publishDiagnostics: false,
    groundPredictionSweep: () => null })
  const remote = new AlsRemoteCharacter()
  const history: AlsCharacterSnapshot[] = JSON.parse(readFileSync(new URL('./fixtures/remote-inAir.json', import.meta.url), 'utf8'))
  let previous = 0
  for (const state of history) {
    const result = remote.apply(state)
    if (result.jumped) animation.jump()
    const dt = (state.t - previous) / 1000
    expect(() => animation.refresh(dt || 0.008, remote.controls), `snapshot ${state.seq}`).not.toThrow()
    previous = state.t
  }
})
