import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createAlsFeetState,
} from '../als/State/AlsFeetState'
import {
  createAlsMovementBaseState,
} from '../als/State/AlsMovementBaseState'
import { createPoseApplicator } from './applyPose'
import {
  createAlsFeetPoseBridge,
  initializeAlsFeetThighAxesFromRig,
} from './alsFeetPoseBridge'
import { createRigDefinition } from './rig'

function bone(
  name: string,
  parent: THREE.Object3D,
  position: readonly [number, number, number],
) {
  const result = new THREE.Bone()
  result.name = name
  result.position.fromArray(position)
  parent.add(result)
  return result
}

function createTestSkeleton() {
  const component = new THREE.Object3D()
  const root = bone('root', component, [0, 0, 0])
  const pelvis = bone('pelvis', root, [0, 1, 0])
  const thighLeft = bone('thigh_l', pelvis, [0, -0.1, 0.2])
  const calfLeft = bone('calf_l', thighLeft, [0, -0.4, 0])
  bone('foot_l', calfLeft, [0, -0.4, 0])
  const thighRight = bone('thigh_r', pelvis, [0, -0.1, -0.2])
  const calfRight = bone('calf_r', thighRight, [0, -0.4, 0])
  bone('foot_r', calfRight, [0, -0.4, 0])
  const footLeftIk = bone('ik_foot_l', root, [1, 2, 3])
  const footRightIk = bone('ik_foot_r', root, [-1, 2, -3])
  return {
    component,
    pelvis,
    footLeftIk,
    footRightIk,
  }
}

const refreshInput = {
  deltaTime: 1 / 60,
  pendingUpdate: false,
  timeSinceTeleported: Number.POSITIVE_INFINITY,
  baseChanged: false,
  movementBase: createAlsMovementBaseState(),
  movingSmooth: false,
  grounded: true,
  disableFootLock: false,
  footLockAngleLimit: 90,
  footPlantedCurveAmount: 0,
  feetCrossingCurveAmount: 0,
  footLeftIkCurveAmount: 0,
  footRightIkCurveAmount: 0,
  footLeftLockCurveAmount: 0,
  footRightLockCurveAmount: 0,
} as const

describe('ALS published feet pose bridge', () => {
  it('initializes both thigh axes from the exact reference hierarchy locals', () => {
    const { component } = createTestSkeleton()
    const rig = createRigDefinition(component)
    const state = createAlsFeetState()

    initializeAlsFeetThighAxesFromRig(state, rig)

    expect(state.left.thighAxis.x).toBeCloseTo(0, 12)
    expect(state.left.thighAxis.y).toBeCloseTo(
      0.2 / Math.hypot(0.1, 0.2),
      6,
    )
    expect(state.left.thighAxis.z).toBeCloseTo(
      -0.1 / Math.hypot(0.1, 0.2),
      6,
    )
    expect(state.right.thighAxis.y).toBeCloseTo(
      -0.2 / Math.hypot(0.1, 0.2),
      6,
    )
  })

  it('keeps capture and refresh separate across the ALS frame boundary', () => {
    const {
      component,
      footLeftIk,
      footRightIk,
    } = createTestSkeleton()
    component.position.set(7, 11, -5)
    component.rotation.set(0.1, -0.4, 0.2)
    component.scale.set(1.5, 0.75, 2)
    const rig = createRigDefinition(component)
    const applicator = createPoseApplicator(component, rig)
    const bridge = createAlsFeetPoseBridge(
      rig,
      applicator,
      component,
    )
    const state = createAlsFeetState()

    bridge.capturePublishedPose(state)
    footLeftIk.position.set(4, 5, 6)
    footRightIk.position.set(-4, 5, -6)
    const first = bridge.refresh(state, refreshInput)

    expect(first.left.position.x).toBeCloseTo(1, 12)
    expect(first.left.position.y).toBeCloseTo(2, 12)
    expect(first.left.position.z).toBeCloseTo(3, 12)
    expect(first.right.position.x).toBeCloseTo(-1, 12)
    expect(first.right.position.y).toBeCloseTo(2, 12)
    expect(first.right.position.z).toBeCloseTo(-3, 12)

    bridge.capturePublishedPose(state)
    const second = bridge.refresh(state, refreshInput)
    expect(second).toBe(first)
    expect(second.left.position.x).toBeCloseTo(4, 5)
    expect(second.left.position.y).toBeCloseTo(5, 5)
    expect(second.left.position.z).toBeCloseTo(6, 5)
    expect(second.right.position.x).toBeCloseTo(-4, 5)
    expect(second.right.position.y).toBeCloseTo(5, 5)
    expect(second.right.position.z).toBeCloseTo(-6, 5)
  })

  it('rejects worker refresh before the game-thread pose snapshot', () => {
    const { component } = createTestSkeleton()
    const rig = createRigDefinition(component)
    const bridge = createAlsFeetPoseBridge(
      rig,
      createPoseApplicator(component, rig),
      component,
    )

    expect(() => bridge.refresh(createAlsFeetState(), refreshInput))
      .toThrow(/published-pose capture/)
  })
})
