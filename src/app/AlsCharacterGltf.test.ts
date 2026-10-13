/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { AnimationClip } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ALS_CHARACTER_URL,
  clearAlsCharacterGltf,
  loadAlsCharacterGltf,
  preloadAlsCharacterGltf,
} from './AlsCharacterGltf'
import { alsGltfAnimationExtrasPlugin, extendAlsGltfLoader } from '../engine/gltfAnimationExtras'
import { createAlsAnimationInstance } from '../als/AlsAnimationInstance'
import { assertAlsAnimationExtras } from '../als/reference/animationExtrasSequences'
import sequenceNames from '../als/reference/animationExtrasSequences.json'

const shipped = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
const data = shipped.buffer.slice(shipped.byteOffset, shipped.byteOffset + shipped.byteLength)
const jsonLength = new DataView(data).getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength))) as {
  animations: { name: string; extras: Record<string, unknown> }[]
}
// Resolve the transitive loader from drei itself, so this tests the consumer's installed version.
const require = createRequire(import.meta.url)
const dreiRequire = createRequire(require.resolve('@react-three/drei'))
const stdlibPath = join(dirname(dreiRequire.resolve('three-stdlib')), 'loaders/GLTFLoader.js')
let StdlibLoader: typeof GLTFLoader

beforeAll(async () => {
  StdlibLoader = (await import(/* @vite-ignore */ stdlibPath)).GLTFLoader
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearAlsCharacterGltf()
  clearAlsCharacterGltf('https://example.test/npc.glb')
})

function mockFetch() {
  const fetch = vi.fn(async () => {
    const response = new Response(data.slice(0), {
      headers: { 'content-length': String(data.byteLength) },
    })
    Object.defineProperty(response, 'url', { value: 'https://example.test/assets/skm-als.glb' })
    return response
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function expectExtras(animations: AnimationClip[]) {
  expect(animations).toHaveLength(json.animations.length)
  for (const [i, animation] of animations.entries()) {
    expect(animation.name).toBe(json.animations[i].name)
    expect(animation.userData).toEqual(json.animations[i].extras)
  }
}

describe('ALS character glTF animation extras', () => {
  it('pins the exact extraction manifest and its guaranteed extras fields', () => {
    const manifest = readFileSync(new URL('../../scripts/extract-als/clips.manifest', import.meta.url), 'utf8')
      .split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split('|')[0])
    expect(sequenceNames).toEqual(manifest)
    expect(json.animations.map(({ name }) => name).sort()).toEqual([...manifest].sort())
    for (const { extras } of json.animations) {
      for (const field of ['alsCurves', 'syncMarkers', 'notifies', 'interpolation']) {
        expect(Object.hasOwn(extras, field)).toBe(true)
      }
    }
  })

  it('preserves all shipped extras through three and the exported progress loader', async () => {
    expectExtras((await new GLTFLoader().parseAsync(data.slice(0), '')).animations)
    const fetch = mockFetch()
    const progress = vi.fn()
    const signal = new AbortController().signal
    const gltf = await loadAlsCharacterGltf(undefined, { signal, onProgress: progress })
    expectExtras(gltf.animations)
    expect(fetch).toHaveBeenCalledWith(ALS_CHARACTER_URL, { signal })
    expect(progress).toHaveBeenLastCalledWith(1)
    expect(() => createAlsAnimationInstance(gltf)).not.toThrow()
  })

  it('reproduces the installed drei loader defect and fails at the instance boundary', async () => {
    const gltf = await new StdlibLoader().parseAsync(data.slice(0), '')
    expect(gltf.animations.every((clip) => Object.keys(clip.userData).length === 0)).toBe(true)
    expect(() => createAlsAnimationInstance(gltf)).toThrow(/loaded without glTF animation extras/)
    expect(() => createAlsAnimationInstance(gltf)).toThrow(/drei useGLTF \/ three-stdlib/)
    expect(() => createAlsAnimationInstance(gltf)).toThrow(/loadAlsCharacterGltf.*extendAlsGltfLoader/)
  })

  it('restores every shipped extra with the installed drei loader extension', async () => {
    const loader = new StdlibLoader()
    extendAlsGltfLoader(loader)
    const gltf = await loader.parseAsync(data.slice(0), '')
    expectExtras(gltf.animations)
    expect(() => createAlsAnimationInstance(gltf)).not.toThrow()
  })

  it('shallow assigns extras without losing existing userData and skips absent extras', () => {
    const clips = [new AnimationClip('custom'), new AnimationClip('empty')]
    clips[0].userData = { retained: true, replaced: 'old' }
    const nested = { authored: true }
    alsGltfAnimationExtrasPlugin({ json: { animations: [{ extras: { nested, replaced: 'new' } }, {}] } })
      .afterRoot({ animations: clips })
    expect(clips[0].userData).toEqual({ retained: true, replaced: 'new', nested })
    expect(clips[0].userData.nested).toBe(nested)
    expect(clips[1].userData).toEqual({})
    expect(() => assertAlsAnimationExtras(clips)).not.toThrow()
    // A prefix alone is not the extraction contract.
    expect(() => assertAlsAnimationExtras([new AnimationClip('A_Als_Custom')])).not.toThrow()
  })

  it('caches the download and parse per URL, and clears for an explicit retry', async () => {
    const fetch = mockFetch()
    const first = preloadAlsCharacterGltf()
    expect(preloadAlsCharacterGltf()).toBe(first)
    const gltf = await first
    expect(await preloadAlsCharacterGltf()).toBe(gltf)
    expect(fetch).toHaveBeenCalledTimes(1)
    await preloadAlsCharacterGltf('https://example.test/npc.glb')
    expect(fetch).toHaveBeenCalledTimes(2)
    clearAlsCharacterGltf()
    expect(await preloadAlsCharacterGltf()).not.toBe(gltf)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('retains a cached rejection until cleared, then retries the load', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    const pending = preloadAlsCharacterGltf()
    await expect(pending).rejects.toThrow('offline')
    expect(preloadAlsCharacterGltf()).toBe(pending)
    clearAlsCharacterGltf()
    mockFetch()
    expectExtras((await preloadAlsCharacterGltf()).animations)
  })

  it('rejects aborted loads before fetching and before publishing a parsed asset', async () => {
    const fetch = mockFetch()
    const controller = new AbortController()
    controller.abort()
    await expect(loadAlsCharacterGltf(undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    const active = new AbortController()
    await expect(loadAlsCharacterGltf(undefined, {
      signal: active.signal,
      onProgress: () => active.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('checks abort again after the non-cancellable parse completes', async () => {
    mockFetch()
    const controller = new AbortController()
    const parse = GLTFLoader.prototype.parseAsync
    vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(async function (this: GLTFLoader, data, path) {
      const gltf = await parse.call(this, data, path)
      controller.abort()
      return gltf
    })
    await expect(loadAlsCharacterGltf(undefined, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([
    [new Response('missing', { status: 404 }), 'Character request failed (404)'],
    [new Response('<html>', { headers: { 'content-type': 'text/html' } }), 'Character request failed (200)'],
    [new Response('invalid'), 'Character response was not a GLB'],
  ])('preserves the retry-worthy response error: %s', async (response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(loadAlsCharacterGltf()).rejects.toThrow(message)
  })
})
