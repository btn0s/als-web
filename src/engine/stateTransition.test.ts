/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { AlphaBlendOption } from './alphaBlend'
import {
  compileWeightBlendProfile,
} from './blendProfile'
import type {
  CompiledWeightBlendProfile,
  WeightBlendProfile,
} from './blendProfile'
import { createRigDefinition } from './rig'
import {
  advanceStateTransition,
  createStateTransitionClock,
  resetStateTransitionClock,
  startStateTransition,
} from './stateTransition'

interface ExtractedSkeletonProfiles {
  readonly profiles: {
    readonly MoveDirectionChange: WeightBlendProfile
  }
}

interface ExtractedTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly BlendMode: `EAlphaBlendOption::${AlphaBlendOption}`
  readonly BlendProfile: {
    readonly ObjectName: string
  } | null
}

interface ExtractedAbpGraph {
  readonly assets: {
    readonly AB_Als_Standing: {
      readonly stateMachines: readonly {
        readonly MachineName: string
        readonly Transitions: readonly ExtractedTransition[]
      }[]
    }
  }
}

const extractedProfiles = JSON.parse(readFileSync(
  new URL('../../scripts/extract-als/skeleton-profiles.json', import.meta.url),
  'utf8',
)) as ExtractedSkeletonProfiles

const extractedAbp = JSON.parse(readFileSync(
  new URL('../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as ExtractedAbpGraph

function createMoveDirectionChangeProfile() {
  const root = new THREE.Bone()
  root.name = 'root'
  let parent = root
  for (const entry of extractedProfiles.profiles.MoveDirectionChange.entries) {
    const bone = new THREE.Bone()
    bone.name = entry.bone
    parent.add(bone)
    parent = bone
  }
  const rig = createRigDefinition(root)
  return {
    rig,
    profile: compileWeightBlendProfile(
      rig,
      extractedProfiles.profiles.MoveDirectionChange,
    ),
  }
}

function authoredTransition(from: string, to: string, duration: number) {
  const machine = extractedAbp.assets.AB_Als_Standing.stateMachines.find(
    (candidate) => candidate.MachineName === 'Movement States',
  )
  const transition = machine?.Transitions.find(
    (candidate) =>
      candidate.PreviousStateName === from
      && candidate.NextStateName === to
      && candidate.CrossfadeDuration === duration,
  )
  if (!transition) {
    throw new Error(`Missing authored transition ${from} -> ${to} (${duration})`)
  }
  if (!transition.BlendProfile?.ObjectName.includes('MoveDirectionChange')) {
    throw new Error('Authored transition lost MoveDirectionChange profile')
  }
  return {
    duration: transition.CrossfadeDuration,
    blendOption: transition.BlendMode.replace(
      'EAlphaBlendOption::',
      '',
    ) as AlphaBlendOption,
  }
}

function expectComplementaryMasks(
  from: Float32Array,
  to: Float32Array,
) {
  expect(from).toHaveLength(to.length)
  for (let bone = 0; bone < from.length; bone++) {
    expect(from[bone] + to[bone]).toBeCloseTo(1, 7)
  }
}

describe('VERIFIED UE standard state transition clock', () => {
  const { rig, profile } = createMoveDirectionChangeProfile()
  const rootIndex = rig.boneNames.indexOf('root')
  const footIndex = rig.boneNames.indexOf('foot_l')

  it('starts in an allocation-stable full-weight state', () => {
    const clock = createStateTransitionClock('Move Forward', rig.boneCount)
    const fromPoseMask = clock.fromPoseMask
    const toPoseMask = clock.toPoseMask

    expect(clock).toMatchObject({
      currentState: 'Move Forward',
      fromState: 'Move Forward',
      toState: 'Move Forward',
      active: false,
      linearAlpha: 1,
      blendAlpha: 1,
      fromStateWeight: 0,
      toStateWeight: 1,
    })
    expect([...clock.fromPoseMask]).toEqual(
      Array.from({ length: rig.boneCount }, () => 0),
    )
    expect([...clock.toPoseMask]).toEqual(
      Array.from({ length: rig.boneCount }, () => 1),
    )
    expect(advanceStateTransition(clock, 1)).toBe('steady')
    expect(clock.fromPoseMask).toBe(fromPoseMask)
    expect(clock.toPoseMask).toBe(toPoseMask)
  })

  it('reinitializes in place with retained pose masks', () => {
    const clock = createStateTransitionClock('Move Forward', rig.boneCount)
    const fromPoseMask = clock.fromPoseMask
    const toPoseMask = clock.toPoseMask
    startStateTransition(clock, {
      from: 'Move Forward',
      to: 'Move Backward',
      duration: 0.5,
      blendOption: 'Cubic',
      blendProfile: profile,
    })
    advanceStateTransition(clock, 0.25)

    expect(resetStateTransitionClock(clock, 'Move Left Forward')).toBe(clock)
    expect(clock).toMatchObject({
      currentState: 'Move Left Forward',
      fromState: 'Move Left Forward',
      toState: 'Move Left Forward',
      active: false,
      elapsed: 0,
      linearAlpha: 1,
      blendAlpha: 1,
      fromStateWeight: 0,
      toStateWeight: 1,
      blendOption: 'Linear',
      blendProfile: null,
    })
    expect(clock.fromPoseMask).toBe(fromPoseMask)
    expect(clock.toPoseMask).toBe(toPoseMask)
    expect([...clock.fromPoseMask].every((weight) => weight === 0)).toBe(true)
    expect([...clock.toPoseMask].every((weight) => weight === 1)).toBe(true)
  })

  it('applies Cubic before the authored WeightFactor profile', () => {
    const authored = authoredTransition(
      'Move Forward',
      'Move Right Forward',
      0.7,
    )
    expect(authored).toEqual({ duration: 0.7, blendOption: 'Cubic' })
    const clock = createStateTransitionClock('Move Forward', rig.boneCount)

    expect(startStateTransition(clock, {
      from: 'Move Forward',
      to: 'Move Right Forward',
      ...authored,
      blendProfile: profile,
    })).toBe('started')
    expect(clock.currentState).toBe('Move Right Forward')
    expect(clock.fromStateWeight).toBe(1)
    expect(clock.toStateWeight).toBe(0)

    expect(advanceStateTransition(clock, 0.35)).toBe('transitioning')
    expect(clock.linearAlpha).toBe(0.5)
    expect(clock.blendAlpha).toBe(0.5)
    expect(clock.fromStateWeight).toBe(0.5)
    expect(clock.toStateWeight).toBe(0.5)
    expect(clock.fromPoseMask[rootIndex]).toBe(0.5)
    expect(clock.toPoseMask[rootIndex]).toBe(0.5)
    expect(clock.fromPoseMask[footIndex]).toBeCloseTo(0.2, 7)
    expect(clock.toPoseMask[footIndex]).toBeCloseTo(0.8, 7)
    expectComplementaryMasks(clock.fromPoseMask, clock.toPoseMask)
  })

  it('reaches the exact duration boundary without dropping the target pose', () => {
    const clock = createStateTransitionClock('Move Forward', rig.boneCount)
    const authored = authoredTransition(
      'Move Forward',
      'Move Backward',
      0.5,
    )
    startStateTransition(clock, {
      from: 'Move Forward',
      to: 'Move Backward',
      ...authored,
      blendProfile: profile,
    })

    expect(advanceStateTransition(clock, 0.5)).toBe('completed')
    expect(clock).toMatchObject({
      currentState: 'Move Backward',
      fromState: 'Move Forward',
      toState: 'Move Backward',
      active: false,
      elapsed: 0.5,
      linearAlpha: 1,
      blendAlpha: 1,
      fromStateWeight: 0,
      toStateWeight: 1,
    })
    expect(clock.fromPoseMask[rootIndex]).toBe(0)
    expect(clock.toPoseMask[rootIndex]).toBe(1)
    expect(clock.fromPoseMask[footIndex]).toBeLessThan(0.00001)
    expect(clock.toPoseMask[footIndex]).toBeGreaterThan(0.99999)
  })

  it('clamps a large delta on the authored QuadraticInOut transition', () => {
    const authored = authoredTransition(
      'Move Right Forward',
      'Move Right Backward',
      0.75,
    )
    expect(authored).toEqual({
      duration: 0.75,
      blendOption: 'QuadraticInOut',
    })
    const clock = createStateTransitionClock(
      'Move Right Forward',
      rig.boneCount,
    )
    const fromPoseMask = clock.fromPoseMask
    const toPoseMask = clock.toPoseMask
    startStateTransition(clock, {
      from: 'Move Right Forward',
      to: 'Move Right Backward',
      ...authored,
      blendProfile: profile,
    })

    expect(advanceStateTransition(clock, 0.1875)).toBe('transitioning')
    expect(clock.linearAlpha).toBe(0.25)
    expect(clock.blendAlpha).toBe(0.125)
    expect(clock.toPoseMask[footIndex]).toBeCloseTo(4 / 11, 7)
    expect(advanceStateTransition(clock, 100)).toBe('completed')
    expect(clock.elapsed).toBe(0.75)
    expect(clock.linearAlpha).toBe(1)
    expect(clock.blendAlpha).toBe(1)
    expect(clock.fromPoseMask).toBe(fromPoseMask)
    expect(clock.toPoseMask).toBe(toPoseMask)
  })

  it('resolves a zero-duration transition synchronously', () => {
    const clock = createStateTransitionClock('From', rig.boneCount)
    expect(startStateTransition(clock, {
      from: 'From',
      to: 'To',
      duration: 0,
      blendOption: 'Linear',
      blendProfile: profile,
    })).toBe('completed')
    expect(clock).toMatchObject({
      currentState: 'To',
      active: false,
      elapsed: 0,
      linearAlpha: 1,
      blendAlpha: 1,
      fromStateWeight: 0,
      toStateWeight: 1,
    })
    expectComplementaryMasks(clock.fromPoseMask, clock.toPoseMask)
  })

  it('reports the bounded active-interruption limitation without mutation', () => {
    const clock = createStateTransitionClock('Move Forward', rig.boneCount)
    const forward = authoredTransition(
      'Move Forward',
      'Move Right Forward',
      0.7,
    )
    startStateTransition(clock, {
      from: 'Move Forward',
      to: 'Move Right Forward',
      ...forward,
      blendProfile: profile,
    })
    advanceStateTransition(clock, 0.35)
    const before = {
      elapsed: clock.elapsed,
      fromState: clock.fromState,
      toState: clock.toState,
      blendAlpha: clock.blendAlpha,
      fromMask: [...clock.fromPoseMask],
      toMask: [...clock.toPoseMask],
    }

    expect(startStateTransition(clock, {
      from: 'Move Right Forward',
      to: 'Move Forward',
      duration: 0.7,
      blendOption: 'Cubic',
      blendProfile: profile,
    })).toBe('blockedActiveTransition')
    expect({
      elapsed: clock.elapsed,
      fromState: clock.fromState,
      toState: clock.toState,
      blendAlpha: clock.blendAlpha,
      fromMask: [...clock.fromPoseMask],
      toMask: [...clock.toPoseMask],
    }).toEqual(before)

    advanceStateTransition(clock, 0.35)
    expect(startStateTransition(clock, {
      from: 'Move Right Forward',
      to: 'Move Forward',
      duration: 0.7,
      blendOption: 'Cubic',
      blendProfile: profile,
    })).toBe('started')
  })

  it('rejects invalid clocks, requests, profiles, and deltas', () => {
    expect(() => createStateTransitionClock('Move Forward', 0))
      .toThrow('bone count must be a positive integer')
    const clock = createStateTransitionClock('Move Forward', rig.boneCount)
    const incompatibleProfile: CompiledWeightBlendProfile = {
      mode: 'WeightFactor',
      blendScales: new Float32Array(rig.boneCount - 1),
    }

    expect(() => startStateTransition(clock, {
      from: 'Move Forward',
      to: 'Move Backward',
      duration: Number.NaN,
      blendOption: 'Cubic',
      blendProfile: profile,
    })).toThrow('duration must be finite and non-negative')
    expect(() => startStateTransition(clock, {
      from: 'Move Forward',
      to: 'Move Backward',
      duration: 0.5,
      blendOption: 'Cubic',
      blendProfile: incompatibleProfile,
    })).toThrow('incompatible bone count')
    expect(() => startStateTransition(clock, {
      from: 'Move Backward',
      to: 'Move Forward',
      duration: 0.5,
      blendOption: 'Cubic',
      blendProfile: profile,
    })).toThrow('source does not match the current state')
    expect(() => advanceStateTransition(clock, -0.01))
      .toThrow('delta time must be finite and non-negative')
  })
})
