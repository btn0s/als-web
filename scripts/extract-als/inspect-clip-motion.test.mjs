import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inspectClipMotion } from './inspect-clip-motion.mjs'

const ALS_GLB = fileURLToPath(
  new URL('../../public/assets/skm-als.glb', import.meta.url),
)

test('A_Als_Idle proves authored upper-spine motion and closes its loop', async () => {
  const report = await inspectClipMotion({
    filePath: ALS_GLB,
    clipName: 'A_Als_Idle',
    bones: ['spine_03'],
    samples: 120,
  })
  const spine = report.bones.spine_03

  assert.equal(report.trackCount, 136)
  assert.equal(spine.trackCount, 2)
  assert.ok(spine.localRotationAmplitudeDegrees > 2)
  assert.ok(spine.worldPositionRelativeToRootMeters.z.amplitude > 0.03)
  assert.ok(spine.loopClosure.localRotationErrorDegrees < 1e-5)
  assert.ok(spine.loopClosure.relativeWorldPositionErrorMeters < 1e-5)
})

test('A_Als_Run_Forward proves opposing foot phase in forward and up axes', async () => {
  const report = await inspectClipMotion({
    filePath: ALS_GLB,
    clipName: 'A_Als_Run_Forward',
    pair: ['foot_l', 'foot_r'],
    samples: 120,
  })
  const leftFoot = report.bones.foot_l
  const rightFoot = report.bones.foot_r
  const correlation = report.pair.relativeWorldPositionPearsonCorrelation

  // The raw extracted GLB uses three.js Y-up and its unmounted mesh faces +Z.
  assert.ok(leftFoot.worldPositionRelativeToRootMeters.y.amplitude > 0.35)
  assert.ok(rightFoot.worldPositionRelativeToRootMeters.y.amplitude > 0.35)
  assert.ok(leftFoot.worldPositionRelativeToRootMeters.z.amplitude > 0.8)
  assert.ok(rightFoot.worldPositionRelativeToRootMeters.z.amplitude > 0.8)
  assert.ok(correlation.y < -0.75)
  assert.ok(correlation.z < -0.95)
  assert.ok(leftFoot.loopClosure.relativeWorldPositionErrorMeters < 1e-5)
  assert.ok(rightFoot.loopClosure.relativeWorldPositionErrorMeters < 1e-5)
})
