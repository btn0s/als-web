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
    expect(report.diagnostics.transformJitter).toMatchObject({
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
    expect(report.diagnostics.transformJitter).toMatchObject({
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
    expect(
      report.diagnostics.transformJitter.rawCharacterPosition?.autocorrelationPeak,
    ).toBeNull()
  })

  it('reports fixed-step cadence beside the residual timeline', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const reportPromise = capture.start(5)
    const physicsSteps = [10, 11, 11, 13, 14]

    for (let index = 0; index < physicsSteps.length; index++) {
      root.position.x = index
      capture.recordFrame(index === 0 ? 0 : 1 / 60, {
        characterPositionX: index,
        characterPositionY: 0,
        characterPositionZ: 0,
        physicsStepIndex: physicsSteps[index],
        physicsTimeStep: 1 / 60,
      })
    }

    const jitter = (await reportPromise).diagnostics.transformJitter
    expect(jitter.frameCadence).toEqual({
      frameCount: 4,
      durationSeconds: 4 / 60,
      minimumDeltaTime: 1 / 60,
      medianDeltaTime: 1 / 60,
      medianFramesPerSecond: 60,
      maximumDeltaTime: 1 / 60,
      maximumDeltaTimeFrame: 1,
    })
    expect(jitter.physicsCadence).toEqual({
      fixedTimeStepSeconds: 1 / 60,
      edgeCount: 4,
      totalStepCount: 4,
      minimumStepsPerRenderEdge: 0,
      medianStepsPerRenderEdge: 1,
      maximumStepsPerRenderEdge: 2,
      maximumStepsFrame: 3,
      zeroStepEdgeCount: 1,
      singleStepEdgeCount: 2,
      multipleStepEdgeCount: 1,
      resetEdgeCount: 0,
    })
    expect(jitter.rawCharacterPosition?.peakWindow[0]).toMatchObject({
      physicsStepIndex: 11,
      physicsStepsFromPreviousFrame: 1,
      physicsStepsToNextFrame: 0,
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
    expect(report.diagnostics.transformJitter).toMatchObject({
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

  it('captures camera pivot bob independently from a smooth component root', async () => {
    const { root, child } = twoBoneScene()
    child.name = 'head'
    const capture = new AnimationFrameCapture(root)
    const reportPromise = capture.start(3)

    capture.recordFrame(0)
    root.position.x = 5
    child.position.x = 2
    capture.recordFrame(0.1)
    root.position.x = 10
    child.position.x = 0
    capture.recordFrame(0.1)

    const report = await reportPromise
    expect(report.diagnostics.transformJitter.renderedRootWorldPosition)
      .toMatchObject({ residual: [0, 0, 0], magnitude: 0 })
    expect(report.diagnostics.transformJitter.cameraPivotWorldPosition)
      .toMatchObject({ residual: [1, 0, 0], magnitude: 1, frame: 1 })
  })

  it('finds a repeating signed residual period and loop-phase context', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const frameCount = 14
    const reportPromise = capture.start(frameCount)

    for (let index = 0; index < frameCount; index++) {
      root.position.x = index % 2
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: index % 2,
        characterPositionY: 0,
        characterPositionZ: 0,
        runFwd: 1,
        'clipPhase.runFwd': (index % 4) / 4,
        speed: 3.75,
        gait: 'Running',
        moving: true,
        locomotionMode: 'Grounded',
        cameraTraceDistanceRatio: 0.75,
      })
    }

    const report = await reportPromise
    const raw = report.diagnostics.transformJitter.rawCharacterPosition
    expect(raw).toMatchObject({
      dominantAxis: 'X',
      autocorrelationPeak: {
        lagFrames: 2,
        coefficient: 1,
        pairCount: 10,
      },
      loopPhase: {
        clip: 'runFwd',
        contiguousSampleCount: 12,
        completeCycleCount: 2,
        meanWeight: 1,
        minimumWeight: 1,
        cycleToCycleCorrelation: 1,
      },
    })
    expect(raw?.autocorrelationPeak?.periodSeconds).toBeCloseTo(0.2)
    expect(raw?.loopPhase?.observedMedianLoopPeriodSeconds).toBeCloseTo(0.4)
    expect(raw?.loopPhase?.phaseBins[0]).toMatchObject({
      sampleCount: 2,
      signedResidualMean: -1,
    })
    expect(raw?.loopPhase?.phaseBins[2]).toMatchObject({
      sampleCount: 2,
      signedResidualMean: 1,
    })
    const summary = report.diagnostics.transformJitterSummary.paths
      .rawCharacterPosition
    expect(summary).toMatchObject({
      peakResidualMillimeters: [1_000, 0, 0],
      peakMagnitudeMillimeters: 1_000,
      rmsMagnitudeMillimeters: 1_000,
      dominantAxis: 'X',
      loopPhase: {
        clip: 'runFwd',
        completeCycleCount: 2,
        signedResidualMeanMillimetersByPhaseBin:
          [-1_000, null, 1_000, null, -1_000, null, 1_000, null],
        sampleCountByPhaseBin: [2, 0, 2, 0, 2, 0, 2, 0],
      },
    })
    expect(summary).not.toHaveProperty('peakWindow')
    expect(raw?.peakWindow[0]).toMatchObject({
      loop: { clip: 'runFwd', phase: 0.25, weight: 1 },
      speed: 3.75,
      gait: 'Running',
      moving: true,
      locomotionMode: 'Grounded',
      cameraTraceDistanceRatio: 0.75,
    })
  })

  it('uses true per-cycle phase-bin means and represents empty bins as null', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const phases = [
      0.75,
      0, 0.02, 0.04, 0.25, 0.5, 0.75,
      0, 0.02, 0.04, 0.25, 0.5, 0.75,
      0, 0.25, 0.5,
    ]
    const reportPromise = capture.start(phases.length)

    for (let index = 0; index < phases.length; index++) {
      root.position.x = index % 2
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: index % 2,
        characterPositionY: 0,
        characterPositionZ: 0,
        runFwd: 1,
        'clipPhase.runFwd': phases[index],
      })
    }

    const report = await reportPromise
    const bins = report.diagnostics.transformJitter.rawCharacterPosition
      ?.loopPhase?.phaseBins
    expect(bins?.[0]).toMatchObject({
      sampleCount: 3,
      signedResidualMean: 1 / 3,
    })
    expect(bins?.[1]).toMatchObject({
      sampleCount: 0,
      signedResidualMean: null,
    })
  })

  it('keeps loop analysis inside the longest clip-contiguous run and excludes partial cycles', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const reportPromise = capture.start(12)
    for (let index = 0; index < 12; index++) {
      root.position.x = index % 2
      const switched = index === 4
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: index % 2,
        characterPositionY: 0,
        characterPositionZ: 0,
        runFwd: switched ? 0 : 1,
        walkFwd: switched ? 1 : 0,
        'clipPhase.runFwd': (index % 4) / 4,
        'clipPhase.walkFwd': 0,
      })
    }
    const loop = (await reportPromise).diagnostics.transformJitter
      .rawCharacterPosition?.loopPhase
    expect(loop).toMatchObject({
      clip: 'runFwd',
      contiguousSampleCount: 6,
      completeCycleCount: 0,
      cycleToCycleCorrelation: null,
    })
    expect(loop?.phaseBins).toEqual([
      ...Array.from({ length: 8 }, () => expect.objectContaining({
        sampleCount: 0,
        signedResidualMean: null,
      })),
    ])
  })

  it('prefers a shorter repeating loop over a longer one-shot clip run', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const frameCount = 24
    const reportPromise = capture.start(frameCount)
    for (let index = 0; index < frameCount; index++) {
      root.position.x = index % 2
      const running = index >= 14
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: index % 2,
        characterPositionY: 0,
        characterPositionZ: 0,
        'InAirPlayer.landMovementLight': running ? 0 : 1,
        runFwd: running ? 1 : 0,
        'clipPhase.landMovementLight': Math.min(index, 1) * 0.5,
        'clipPhase.runFwd': ((index - 14 + 4) % 4) / 4,
      })
    }

    expect(
      (await reportPromise).diagnostics.transformJitter
        .rawCharacterPosition?.loopPhase,
    ).toMatchObject({
      clip: 'runFwd',
      contiguousSampleCount: 9,
      completeCycleCount: 1,
    })
  })

  it('breaks equally useful loop-run ties by clip name then occurrence', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const frameCount = 18
    const reportPromise = capture.start(frameCount)
    for (let index = 0; index < frameCount; index++) {
      root.position.x = index % 2
      const alpha = index < 9
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: index % 2,
        characterPositionY: 0,
        characterPositionZ: 0,
        alpha: alpha ? 1 : 0,
        beta: alpha ? 0 : 1,
        'clipPhase.alpha': (index % 4) / 4,
        'clipPhase.beta': (index % 4) / 4,
      })
    }

    expect(
      (await reportPromise).diagnostics.transformJitter
        .rawCharacterPosition?.loopPhase,
    ).toMatchObject({ clip: 'alpha', completeCycleCount: 1 })
  })

  it('resolves the InAir player weight paired with a clip phase', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const reportPromise = capture.start(10)
    for (let index = 0; index < 10; index++) {
      root.position.x = index % 2
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: index % 2,
        characterPositionY: 0,
        characterPositionZ: 0,
        'InAirPlayer.inAirFall': 1,
        'clipPhase.inAirFall': (index % 4) / 4,
      })
    }
    expect(
      (await reportPromise).diagnostics.transformJitter
        .rawCharacterPosition?.loopPhase,
    ).toMatchObject({
      clip: 'inAirFall',
      contiguousSampleCount: 8,
      completeCycleCount: 1,
      meanWeight: 1,
    })
  })

  it('searches autocorrelation lags beyond sixty frames', async () => {
    const { root } = twoBoneScene()
    const capture = new AnimationFrameCapture(root)
    const frameCount = 128
    const reportPromise = capture.start(frameCount)
    for (let index = 0; index < frameCount; index++) {
      const value = Math.cos(2 * Math.PI * index / 62)
      root.position.x = value
      capture.recordFrame(index === 0 ? 0 : 0.1, {
        characterPositionX: value,
        characterPositionY: 0,
        characterPositionZ: 0,
      })
    }
    const peak = (await reportPromise).diagnostics.transformJitter
      .rawCharacterPosition?.autocorrelationPeak
    expect(peak?.lagFrames).toBe(62)
    expect(peak?.coefficient).toBeCloseTo(1)
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
    expect(() => capture.start(1)).toThrow('2-480 frames')
    const first = capture.start(2)
    await expect(capture.start(2)).rejects.toThrow('already in progress')
    capture.cancel('test cancellation')
    await expect(first).rejects.toThrow('test cancellation')
  })
})
