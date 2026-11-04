// Capture the CPU pose oracle before replacing evaluation with GPU operations.
// node scripts/capture-pose-golden.mjs /tmp/als-golden
import { createServer } from 'vite'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
const [directory = '/tmp/als-golden'] = process.argv.slice(2)
const out = resolve(directory)
await mkdir(out, { recursive: true })
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  globalThis.window = globalThis
  const { createAlsAnimationInstance } = await vite.ssrLoadModule('/src/als/AlsAnimationInstance.ts')
  const { createAlsCharacterAnimationControls } = await vite.ssrLoadModule('/src/als/AlsCharacter.hooks.ts')
  const bytes = await readFile(new URL('../public/assets/skm-als.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const results = []
  for (const publishDiagnostics of [false, true]) {
    const instance = createAlsAnimationInstance({ scene: clone(gltf.scene), animations: gltf.animations, publishDiagnostics, groundPredictionSweep: () => null })
    const controls = createAlsCharacterAnimationControls()
    Object.assign(controls, { speed: 3.75, velocity: { x: 3.75, y: 0, z: 0 }, gait: 'Running', moving: true, movingSmooth: true, hasInput: true, overlayMode: 'Rifle' })
    for (let frame = 0; frame < 240; frame++) instance.refresh(1 / 60, controls)
    const hash = createHash('sha256'), snapshots = []
    // Deterministic scenario capture outside the timed region. Compare pose+curve output hashes
    // between revisions; no timing assertion or benchmark gate.
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
      instance.refresh(1 / 60, controls)
      const { pose, curves } = instance.inspectPose()
      hash.update(new Uint8Array(pose.data.buffer, pose.data.byteOffset, pose.data.byteLength))
      const curveValues = [...curves].sort(([a], [b]) => a.localeCompare(b))
      hash.update(JSON.stringify(curveValues))
      if (frame % 30 === 0 || frame % 60 < 3) snapshots.push({ frame, bones: instance.inspectPose().boneNames, pose: Array.from(pose.data), curves: curveValues })
    }
    await writeFile(resolve(out, `diagnostics-${publishDiagnostics}.json`), JSON.stringify(snapshots))
    results.push({ publishDiagnostics, scenarioSha256: hash.digest('hex') })
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
} finally {
  await vite.close()
}
