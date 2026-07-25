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
    child.rotation.z = Math.PI / 2
    capture.recordFrame(1 / 60, { stance: 'Crouching', transitionFrame: 1 })
    child.position.x = 0
    child.rotation.z = 0
    capture.recordFrame(1 / 60, { stance: 'Crouching', transitionFrame: 2 })

    const report = await reportPromise
    expect(report.boneCount).toBe(2)
    expect(report.frameCount).toBe(3)
    expect(report.tracedBones).toEqual(['root', 'child'])
    expect(report.frames[0].metadata).toEqual({ stance: 'Standing' })
    expect(report.frames[0].rootWorldPosition).toEqual([0, 0, 0])
    expect(report.frames[1].bones.child.worldPosition).toEqual([0.25, 1, 0])
    expect(report.frames[1].skinnedMeshBounds).toBeNull()
    expect(report.deltas[0]).toMatchObject({
      fromFrame: 0,
      toFrame: 1,
      translationMeters: { bone: 'child', value: 0.25 },
    })
    expect(report.deltas[1].rotationDegrees.bone).toBe('child')
    expect(report.deltas[1].rotationDegrees.value).toBeCloseTo(90)
    expect(report.diagnostics.poseDetours[0]).toMatchObject({
      frame: 1,
      translationMeters: { bone: 'child', value: 0.25 },
      rotationDegrees: { bone: 'child' },
    })
    expect(report.diagnostics.groundedContact).toBeNull()
    expect(report.diagnostics.rollingContact).toBeNull()
    expect(report.diagnostics.rollingRootMotion).toBeNull()
    expect(report.diagnostics.turnInPlace).toBeNull()
    expect(report.diagnostics.transformJitter).toEqual({
      rawCharacterPosition: null,
      renderedRootWorldPosition: expect.objectContaining({
        residual: [0, 0, 0],
        magnitude: 0,
        frame: 1,
      }),
      cameraWorldPosition: null,
    })
  })

  it('uses elapsed edge time for raw and rendered transform jitter', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const reportPromise = capture.start(3)

    capture.recordFrame(0, {
      characterPositionX: 0,
      characterPositionY: 0,
      characterPositionZ: 0,
      cameraPositionX: 0,
      cameraPositionY: 0,
      cameraPositionZ: 0,
    })
    root.position.set(2, 2, 2)
    capture.recordFrame(0.1, {
      characterPositionX: 2,
      characterPositionY: 2,
      characterPositionZ: 2,
      cameraPositionX: 2,
      cameraPositionY: 2,
      cameraPositionZ: 2,
    })
    root.position.set(10, 10, 10)
    capture.recordFrame(0.4, {
      characterPositionX: 10,
      characterPositionY: 10,
      characterPositionZ: 10,
      cameraPositionX: 10,
      cameraPositionY: 10,
      cameraPositionZ: 10,
    })

    const report = await reportPromise
    expect(report.diagnostics.transformJitter).toEqual({
      rawCharacterPosition: {
        residual: [0, 0, 0], magnitude: 0, frame: 1,
      },
      renderedRootWorldPosition: {
        residual: [0, 0, 0], magnitude: 0, frame: 1,
      },
      cameraWorldPosition: {
        residual: [0, 0, 0], magnitude: 0, frame: 1,
      },
    })
  })

  it('reports the largest signed raw and rendered transform excursions', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const reportPromise = capture.start(3)

    capture.recordFrame(0, {
      characterPositionX: 0,
      characterPositionY: 0,
      characterPositionZ: 0,
      cameraPositionX: 0,
      cameraPositionY: 0,
      cameraPositionZ: 0,
    })
    root.position.set(6, 3, 7)
    capture.recordFrame(0.1, {
      characterPositionX: 7,
      characterPositionY: 3,
      characterPositionZ: 6,
      cameraPositionX: 4,
      cameraPositionY: 7,
      cameraPositionZ: 3,
    })
    root.position.set(10, 10, 10)
    capture.recordFrame(0.1, {
      characterPositionX: 10,
      characterPositionY: 10,
      characterPositionZ: 10,
      cameraPositionX: 10,
      cameraPositionY: 10,
      cameraPositionZ: 10,
    })

    const report = await reportPromise
    expect(report.diagnostics.transformJitter).toEqual({
      rawCharacterPosition: {
        residual: [2, -2, 1], magnitude: 3, frame: 1,
      },
      renderedRootWorldPosition: {
        residual: [1, -2, 2], magnitude: 3, frame: 1,
      },
      cameraWorldPosition: {
        residual: [-1, 2, -2], magnitude: 3, frame: 1,
      },
    })
  })

  it('integrates active TurnInPlace actor yaw from the preceding published curve', async () => {
    const { root, child } = twoBoneScene()
    const capture = new AnimationFrameCapture(root, ['root', 'child'])
    const reportPromise = capture.start(3)

    capture.recordFrame(0, {
      actorYawAngle: 0,
      PublishedRotationYawSpeed: 30,
      TurnInPlaceMontageWeight: 1,
    })
    child.rotation.z = Math.PI / 2
    capture.recordFrame(0.1, {
      actorYawAngle: 3,
      PublishedRotationYawSpeed: 20,
      TurnInPlaceMontageWeight: 1,
    })
    child.rotation.z = 0
    capture.recordFrame(0.1, {
      actorYawAngle: 5,
      PublishedRotationYawSpeed: 0,
      TurnInPlaceMontageWeight: 0,
    })

    const report = await reportPromise
    expect(report.diagnostics.turnInPlace).toEqual({
      edgeCount: 2,
      signedActorYawDegrees: 5,
      signedCurveYawDegrees: 5,
      maximumIntegrationErrorDegrees: 0,
      maximumIntegrationErrorFrame: 1,
      maximumActorStepDegrees: 3,
      maximumActorStepFrame: 1,
      largestPoseRotationDetour: expect.objectContaining({
        frame: 1,
        rotationDegrees: expect.objectContaining({ bone: 'child' }),
      }),
    })
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
