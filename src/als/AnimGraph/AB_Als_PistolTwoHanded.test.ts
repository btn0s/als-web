import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from '../../engine/clipSampler'
import { createRigDefinition } from '../../engine/rig'
import {
  createAlsPistolRuntime, refreshAlsPistolRuntime, evaluateAlsPistolGraph,
  resetAlsPistolRuntime, type AlsPistolFullInput, type AlsPistolFullSources,
} from './AB_Als_PistolTwoHanded'
import { createAlsPistolOneHandedRuntime } from './AB_Als_PistolOneHanded'

function fixture(oneHanded = false) {
  const root = new THREE.Bone()
  root.name = 'root'
  const rig = createRigDefinition(root)
  const source = (name: string, base = 0, slope = 100) => ({
    sampler: compileClipSampler(new THREE.AnimationClip(name, 1, [
      new THREE.VectorKeyframeTrack('root.position', [0, 1], [base, 0, 0, base + slope, 0, 0]),
    ]), rig),
    curves: { GraphCurve: (time: number) => time * 10 },
  })
  const sources: AlsPistolFullSources = {
    poses: source('poses'),
    idle: { ...source('idle', 0, 0), time: 0, loop: true },
    idleReference: source('idleReference', 0, 0),
    aim: source('aim', 100), aimCrouch: source('aimCrouch', 300),
    aimReference: source('aimReference', 200),
  }
  const runtime = oneHanded ? createAlsPistolOneHandedRuntime(rig) : createAlsPistolRuntime(rig)
  const input: AlsPistolFullInput = {
    relevant: true, deltaTime: 0, standingAmount: 1, crouchingAmount: 0,
    gaitWalkingAmount: 0, gaitSprintingAmount: 0, rotationMode: 'ViewDirection',
    locomotionMode: 'Grounded', gait: 'Walking', transitionsAllowed: true,
    moving: false, pitchAmount: 0.5,
  }
  function update(overrides: Partial<AlsPistolFullInput> = {}) {
    Object.assign(input, overrides)
    refreshAlsPistolRuntime(runtime, input)
    return evaluateAlsPistolGraph(runtime, input, sources)
  }
  return { runtime, input, update }
}

describe.each([false, true])('Pistol state/action graph (one handed=%s)', (oneHanded) => {
  it('samples authored relaxed poses, normalizes stance, and keeps the sprint branch distinct', () => {
    const { update } = fixture(oneHanded)
    expect(update().pose.positions[0]).toBeCloseTo(0)
    expect(update({ gaitWalkingAmount: 1 }).pose.positions[0]).toBeCloseTo(5)
    expect(update({ gaitSprintingAmount: 1 }).pose.positions[0]).toBeCloseTo(oneHanded ? 5 : 8.3333, 4)
    expect(update({ standingAmount: 0, crouchingAmount: 1 }).pose.positions[0]).toBeCloseTo(oneHanded ? 21.6667 : 25, 4)
    expect(update({ standingAmount: 2, crouchingAmount: 1, gaitWalkingAmount: 0 }).pose.positions[0]).toBeCloseTo((oneHanded ? 21.6667 : 25) / 2, 4)
    expect(update({ standingAmount: 0, crouchingAmount: 0 }).pose.positions[0]).toBe(0)
  })

  it('skips first-update transitions, chains Relaxed/Ready/Aiming and retains custom aim curves', () => {
    const { runtime, update } = fixture(oneHanded)
    expect(update({ rotationMode: 'Aiming' }).state).toBe('Relaxed')
    expect(update({ deltaTime: 0.1 }).state).toBe('Aiming')
    expect(runtime.transitionsTakenThisFrame).toBe(2)
    expect(runtime.lifecycleEvents.map((event) => event.name)).toEqual(['RelaxedToReady'])
    expect(runtime.pistolStates.activeTransitions.at(-1)?.alpha).toBeGreaterThan(0.25)
    update({ deltaTime: 1 })
    update({ rotationMode: 'ViewDirection', deltaTime: 0.25 })
    expect(runtime.pistolStates.activeTransitions.at(-1)?.alpha).toBeCloseTo(0.05478, 5)
  })

  it('waits three seconds in Ready for both idle and moving exits; InAir has priority', () => {
    for (const moving of [false, true]) {
      const { runtime, update } = fixture(oneHanded)
      update({ rotationMode: 'Aiming' }); update(); update({ deltaTime: 1 })
      update({ rotationMode: 'ViewDirection', moving, deltaTime: 2.9 })
      expect(update({ deltaTime: 0 }).state).toBe('Ready')
      update({ deltaTime: 0.11 })
      expect(update({ deltaTime: 0 }).state).toBe('Relaxed')
      expect(runtime.lifecycleEvents[0]?.name).toBe('ReadyToRelaxed')
    }
    const { runtime, update } = fixture(oneHanded)
    update({ rotationMode: 'Aiming' }); update(); update({ deltaTime: 1 })
    expect(update({ rotationMode: 'ViewDirection', locomotionMode: 'InAir', deltaTime: 0 }).state).toBe('Relaxed')
    expect(runtime.pistolStates.activeTransitions.at(-1)?.crossfadeDuration).toBe(0.2)
  })

  it('uses Walking for the base pose and the actual curve-free reference frames for pitch aim', () => {
    const { runtime, update } = fixture(oneHanded)
    update({ rotationMode: 'Aiming' }); update(); update({ deltaTime: 1 })
    const standingBase = oneHanded ? 15 : 18.3333
    const referenceTime = (oneHanded ? 5 : 6) / 30
    expect(runtime.statePoses.Aiming.pose.positions[0]).toBeCloseTo(standingBase + 150 - (200 + 100 * referenceTime), 3)
    update({ gaitWalkingAmount: 1 })
    expect(runtime.statePoses.Aiming.pose.positions[0]).toBeCloseTo(standingBase + 3.3334 + 150 - (200 + 100 * referenceTime), 3)
    update({ standingAmount: 0, crouchingAmount: 1 })
    expect(runtime.statePoses.Aiming.pose.positions[0]).toBeCloseTo((oneHanded ? 28.3333 : 31.6667) + 350 - (200 + 100 * (oneHanded ? 9 : 10) / 30), 3)
  })

  it('applies action child times and only the authored right arm override', () => {
    const { runtime, update } = fixture(oneHanded)
    const rolling = update({ locomotionAction: 'Rolling', deltaTime: 0.3 })
    expect(rolling.actionChild).toBe(3)
    expect(rolling.pose.positions[0]).toBeCloseTo(oneHanded ? 11.6667 : 8.3333, 4)
    expect(rolling.curves.get('LayerArmRight')).toBe(3)
    expect(rolling.curves.has('LayerArmLeft')).toBe(false)
    expect(rolling.curves.has('LayerArmRightAdditive')).toBe(false)
    const getUp = update({ locomotionAction: 'GettingUp', deltaTime: 0 })
    expect(getUp.pose.positions[0]).toBeCloseTo(25)
    expect(runtime.gameplayTagsBlend.activeTransitions).toHaveLength(0)
    expect(update({ locomotionAction: 'Mantling', deltaTime: 0.3 }).pose.positions[0]).toBeCloseTo(11.6667, 4)
    resetAlsPistolRuntime(runtime)
    expect(update({ locomotionAction: null, rotationMode: 'Aiming' }).state).toBe('Relaxed')
  })
})
