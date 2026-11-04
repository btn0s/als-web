import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import { Matrix4 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { expect, it } from 'vitest'
import { createAlsCharacterAnimationControls } from '../../als/AlsCharacter.hooks'
import fixture from '../fixtures/als-golden-poses.json'
import { serializeAnimationAssets } from './animationMessages'
import type { AnimationFrame, AnimationResult } from './animationMessages'

it('publishes the exact CPU golden poses and curves through a real worker', async () => {
  const bytes = readFileSync(new URL('../../../public/assets/skm-als.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const assets = serializeAnimationAssets(gltf.scene, gltf.animations)
  if (process.env.ALS_WORKER_MEMORY === '1') console.log('[ALS keyframe bytes per worker]', assets.clips.reduce((total, clip) =>
    total + clip.tracks.reduce((sum, track) => sum + track.times.byteLength + track.values.byteLength, 0), 0))
  const worker = new Worker(new URL('../../../scripts/animation-worker-test-host.mjs', import.meta.url), { execArgv: [] })
  try {
    await once(worker, 'message')
    worker.postMessage({ kind: 'create', id: 1, assetKey: assets.key, assets })
    const controls = createAlsCharacterAnimationControls()
    Object.assign(controls, { speed: 3.75, velocity: { x: 3.75, y: 0, z: 0 }, gait: 'Running', moving: true, movingSmooth: true, hasInput: true, overlayMode: 'Rifle' })
    let recycled: ArrayBuffer | undefined, sequence = 0
    const evaluate = async () => {
      const input: AnimationFrame = { id: 1, sequence: sequence++, delta: 1 / 60, evaluate: true, controls,
        commands: [], montage: null, matrixWorld: new Matrix4().toArray(), feet: {}, prediction: null,
        ragdoll: { active: false, velocity: { x: 0, y: 0, z: 0 } }, buffer: recycled }
      const received = once(worker, 'message')
      worker.postMessage({ kind: 'frame', frame: input }, recycled ? [recycled] : [])
      const [message] = await received as [AnimationResult | { kind: 'error'; message: string }]
      if (message.kind === 'error') throw new Error(message.message)
      recycled = message.data.buffer as ArrayBuffer
      return message
    }
    for (let frame = 0; frame < 240; frame++) await evaluate()
    const hash = createHash('sha256')
    for (let frame = 0; frame < 960; frame++) {
      const phase = Math.floor(frame / 60) % 8
      Object.assign(controls, { moving: phase !== 0, movingSmooth: phase !== 0, hasInput: phase !== 0,
        speed: phase === 0 ? 0 : phase === 2 ? 6.5 : 3.75,
        rotationMode: phase === 5 ? 'Aiming' : 'ViewDirection',
        overlayMode: phase === 6 ? 'PistolTwoHanded' : phase === 7 ? 'PistolOneHanded' : 'Rifle',
        viewYawAngle: Math.sin(frame / 45) * 30, viewPitchAngle: Math.cos(frame / 30) * 20,
        gait: phase === 2 ? 'Sprinting' : 'Running', stance: phase === 3 ? 'Crouching' : 'Standing',
        locomotionMode: phase === 4 ? 'InAir' : 'Grounded',
        velocity: { x: phase === 0 ? 0 : phase === 2 ? 6.5 : 3.75, y: 0, z: phase === 4 ? -3 : 0 }, direction: Math.sin(frame / 30) * 120 })
      const result = await evaluate()
      hash.update(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength))
      hash.update(JSON.stringify(result.curves.sort(([a], [b]) => a.localeCompare(b))))
    }
    expect(hash.digest('hex')).toBe(fixture.scenarioSha256)
  } finally { const exited = once(worker, 'exit'); worker.postMessage({ kind: 'shutdown' }); await exited }
}, 60000)
