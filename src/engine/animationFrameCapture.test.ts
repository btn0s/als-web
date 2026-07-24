import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AnimationFrameCapture } from './animationFrameCapture'

function twoBoneScene() {
  const root = new THREE.Bone()
  root.name = 'root'
  const child = new THREE.Bone()
  child.name = 'child'
  child.position.y = 1
  root.add(child)
  return { root, child }
}

describe('AnimationFrameCapture', () => {
  it('keeps a bounded baseline-to-frame report and identifies the popping bone', async () => {
    const { root, child } = twoBoneScene()
    const capture = new AnimationFrameCapture(root, ['root', 'child'])
    const reportPromise = capture.start(3)

    capture.recordFrame(0, { stance: 'Standing' })
    child.position.x = 0.25
    capture.recordFrame(1 / 60, { stance: 'Crouching', transitionFrame: 1 })
    child.rotation.z = Math.PI / 2
    capture.recordFrame(1 / 60, { stance: 'Crouching', transitionFrame: 2 })

    const report = await reportPromise
    expect(report.boneCount).toBe(2)
    expect(report.frameCount).toBe(3)
    expect(report.tracedBones).toEqual(['root', 'child'])
    expect(report.frames[0].metadata).toEqual({ stance: 'Standing' })
    expect(report.frames[1].bones.child.worldPosition).toEqual([0.25, 1, 0])
    expect(report.deltas[0]).toMatchObject({
      fromFrame: 0,
      toFrame: 1,
      translationMeters: { bone: 'child', value: 0.25 },
    })
    expect(report.deltas[1].rotationDegrees.bone).toBe('child')
    expect(report.deltas[1].rotationDegrees.value).toBeCloseTo(90)
  })

  it('validates the bound, rejects overlap, and cancels pending work', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    expect(() => capture.start(1)).toThrow('2-240 frames')
    const first = capture.start(2)
    await expect(capture.start(2)).rejects.toThrow('already in progress')
    capture.cancel('test cancellation')
    await expect(first).rejects.toThrow('test cancellation')
  })
})
