/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  compileAuthoredRootMotion,
  extractAuthoredRootMotionDelta,
} from './rootMotion'
import type { CompiledAuthoredRootMotion } from './rootMotion'
import {
  advanceSlotMontageClock,
  advanceSlotMontageGroup,
  createSlotMontageClock,
  playSlotAnimationAsDynamicMontage,
} from './slotMontage'
import type { SlotMontageRequest, SlotMontageSample } from './slotMontage'
import {
  accumulateSlotMontageRootMotion,
  extractSlotMontageRootMotionDelta,
} from './slotMontageRootMotion'
import type { SlotMontageRootMotionBinding } from './slotMontageRootMotion'

const UE_MONTAGE_END_OFFSET = 0.00005

let roll: CompiledAuthoredRootMotion
let mantle: CompiledAuthoredRootMotion

function loadAlsAnimations() {
  const bytes = readFileSync(
    new URL('../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new Promise<THREE.AnimationClip[]>((resolve, reject) => {
    new GLTFLoader().parse(data, '', (gltf) => resolve(gltf.animations), reject)
  })
}

function request(
  rootMotion: CompiledAuthoredRootMotion,
  overrides: Partial<SlotMontageRequest> = {},
): SlotMontageRequest {
  return {
    clipKey: rootMotion.clipName,
    clipDuration: rootMotion.duration,
    slotName: 'DefaultSlot',
    groupName: 'DefaultGroup',
    blendInDuration: 0.2,
    blendOutDuration: 0.2,
    playRate: 1,
    loopCount: 1,
    blendOutTriggerTime: 0,
    startTime: 0,
    bEnableRootMotion: rootMotion.bEnableRootMotion,
    ...overrides,
  }
}

function bind(
  sample: SlotMontageSample,
  rootMotion: CompiledAuthoredRootMotion,
): SlotMontageRootMotionBinding {
  return { sample, rootMotion }
}

function expectTranslationClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 7,
) {
  for (let component = 0; component < 3; component++) {
    expect(actual[component]).toBeCloseTo(expected[component], digits)
  }
}

describe('retained Slot montage authored root motion', () => {
  beforeAll(async () => {
    const animations = await loadAlsAnimations()
    const compile = (name: string) => {
      const animation = animations.find((candidate) => candidate.name === name)
      if (!animation) throw new Error(`Missing ALS clip "${name}"`)
      const result = compileAuthoredRootMotion(animation)
      if (!result) throw new Error(`${name} has no authored root track`)
      return result
    }
    roll = compile('A_Als_Roll')
    mantle = compile('A_Als_Mantle_High')
  })

  it('VERIFIED — applies instance PlayRate once and ALS montage-only motion at full weight', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request(roll, { playRate: 2 }))
    const sample = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    if (!sample) throw new Error('Roll montage disappeared')

    expect(sample.rootMotionPreviousMontageTime).toBe(0)
    expect(sample.rootMotionMontageTime).toBeCloseTo(0.2, 8)
    expect(sample.sampleTime).toBeCloseTo(0.2, 8)
    expect(sample.weight).toBeCloseTo(0.5, 8)
    expect(sample.extractRootMotionFromMontagesOnly).toBe(true)

    const raw = extractAuthoredRootMotionDelta(roll, 0, 0.2)
    const extracted = extractSlotMontageRootMotionDelta(bind(sample, roll))
    expectTranslationClose(extracted.translation, raw.translation)

    const alsDefault = accumulateSlotMontageRootMotion([bind(sample, roll)])
    expectTranslationClose(alsDefault.translation, raw.translation)

    const everything = accumulateSlotMontageRootMotion(
      [bind(sample, roll)],
      {
        rootMotionMode: 'RootMotionFromEverything',
        slotNodeGlobalWeights: new Map([['DefaultSlot', 0.8]]),
      },
    )
    expectTranslationClose(
      everything.translation,
      Array.from(raw.translation, (component) => component * 0.4),
    )
  })

  it('VERIFIED — preserves Roll motion across forward and reverse authored loop boundaries', () => {
    const forwardClock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(forwardClock, request(roll, {
      blendInDuration: 0,
      loopCount: 2,
      startTime: roll.duration - 0.05,
    }))
    const forward = advanceSlotMontageGroup(
      forwardClock,
      'DefaultGroup',
      0.1,
    )
    if (!forward) throw new Error('Forward Roll montage disappeared')
    const expectedForward = extractAuthoredRootMotionDelta(
      roll,
      roll.duration - 0.05,
      roll.duration + 0.05,
      { loop: true },
    )
    expectTranslationClose(
      extractSlotMontageRootMotionDelta(bind(forward, roll)).translation,
      expectedForward.translation,
    )

    const reverseClock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(reverseClock, request(roll, {
      blendInDuration: 0,
      loopCount: 2,
      playRate: -1,
      startTime: roll.duration + 0.05,
    }))
    const reverse = advanceSlotMontageGroup(
      reverseClock,
      'DefaultGroup',
      0.1,
    )
    if (!reverse) throw new Error('Reverse Roll montage disappeared')
    const expectedReverse = extractAuthoredRootMotionDelta(
      roll,
      roll.duration + 0.05,
      roll.duration - 0.05,
      { loop: true },
    )
    expectTranslationClose(
      extractSlotMontageRootMotionDelta(bind(reverse, roll)).translation,
      expectedReverse.translation,
    )
  })

  it('VERIFIED — extracts the exact endpoint before retaining the terminal pose offset', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request(roll, {
      blendInDuration: 0,
      startTime: roll.duration - 0.05,
    }))
    const terminal = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    if (!terminal) throw new Error('Terminal Roll montage disappeared')

    expect(terminal.rootMotionPreviousMontageTime)
      .toBeCloseTo(roll.duration - 0.05, 8)
    expect(terminal.rootMotionMontageTime).toBeCloseTo(roll.duration, 8)
    expect(terminal.montageTime)
      .toBeCloseTo(roll.duration - UE_MONTAGE_END_OFFSET, 8)
    expect(terminal.extractRootMotionFromMontagesOnly).toBe(true)
    expect(clock.rootMotionMontageInstance).toBeNull()

    const expected = extractAuthoredRootMotionDelta(
      roll,
      roll.duration - 0.05,
      roll.duration,
    )
    expectTranslationClose(
      accumulateSlotMontageRootMotion([bind(terminal, roll)]).translation,
      expected.translation,
    )

    const fadeTail = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    if (!fadeTail) throw new Error('Roll fade tail disappeared')
    expect(fadeTail.extractRootMotionFromMontagesOnly).toBe(false)
    expect(
      accumulateSlotMontageRootMotion([bind(fadeTail, roll)]).valid,
    ).toBe(false)
  })

  it('VERIFIED — hands ownership to a new root montage but blends every retained instance in Everything', () => {
    const clock = createSlotMontageClock()
    const outgoing = playSlotAnimationAsDynamicMontage(clock, request(roll, {
      blendInDuration: 0,
      groupName: 'OutgoingGroup',
      slotName: 'OutgoingSlot',
    }))
    advanceSlotMontageGroup(clock, 'OutgoingGroup', 0.1)

    const incoming = playSlotAnimationAsDynamicMontage(clock, request(roll, {
      blendInDuration: 0.4,
      groupName: 'IncomingGroup',
      slotName: 'IncomingSlot',
    }))
    expect(outgoing.status).toBe('blendingOut')
    expect(outgoing.blendOutReason).toBe('interrupted')
    expect(clock.rootMotionMontageInstance?.instanceId).toBe(incoming.instanceId)

    const samples = advanceSlotMontageClock(clock, 0.1)
    expect(samples.map(({ instanceId }) => instanceId)).toEqual([
      outgoing.instanceId,
      incoming.instanceId,
    ])
    expect(samples.map(({ weight }) => weight)).toEqual([0.75, 0.25])
    expect(samples.map(({ extractRootMotionFromMontagesOnly }) => (
      extractRootMotionFromMontagesOnly
    ))).toEqual([false, true])

    const bindings = samples.map((sample) => bind(sample, roll))
    const incomingRaw = extractAuthoredRootMotionDelta(roll, 0, 0.1)
    const montageOnly = accumulateSlotMontageRootMotion(bindings)
    expectTranslationClose(montageOnly.translation, incomingRaw.translation)

    const outgoingRaw = extractAuthoredRootMotionDelta(roll, 0.1, 0.2)
    const everything = accumulateSlotMontageRootMotion(bindings, {
      rootMotionMode: 'RootMotionFromEverything',
      slotNodeGlobalWeights: new Map([
        ['OutgoingSlot', 1],
        ['IncomingSlot', 1],
      ]),
    })
    expectTranslationClose(
      everything.translation,
      Array.from(
        outgoingRaw.translation,
        (component, index) => (
          component * 0.75 + incomingRaw.translation[index] * 0.25
        ),
      ),
    )
  })

  it('VERIFIED — disabled Mantle and a zero-rate Roll contribute no montage motion', () => {
    const mantleClock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(mantleClock, request(mantle, {
      blendInDuration: 0,
    }))
    const mantleSample = advanceSlotMontageGroup(
      mantleClock,
      'DefaultGroup',
      0.2,
    )
    if (!mantleSample) throw new Error('Mantle montage disappeared')
    expect(mantle.bEnableRootMotion).toBe(false)
    expect(mantleClock.rootMotionMontageInstance).toBeNull()
    expect(
      extractSlotMontageRootMotionDelta(bind(mantleSample, mantle)).valid,
    ).toBe(false)

    const zeroRateClock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(zeroRateClock, request(roll, {
      blendInDuration: 0,
      playRate: 0,
    }))
    const zeroRate = advanceSlotMontageGroup(
      zeroRateClock,
      'DefaultGroup',
      0.2,
    )
    if (!zeroRate) throw new Error('Zero-rate Roll montage disappeared')
    expect(zeroRate.extractRootMotionFromMontagesOnly).toBe(true)
    expect(zeroRate.rootMotionPreviousMontageTime)
      .toBe(zeroRate.rootMotionMontageTime)
    expect(
      extractSlotMontageRootMotionDelta(bind(zeroRate, roll)).valid,
    ).toBe(false)
  })

  it('VERIFIED — rejects stale owner metadata and non-global binding order', () => {
    const clock = createSlotMontageClock()
    const first = playSlotAnimationAsDynamicMontage(clock, request(roll, {
      groupName: 'FirstGroup',
    }))
    const second = playSlotAnimationAsDynamicMontage(clock, request(roll, {
      groupName: 'SecondGroup',
    }))
    advanceSlotMontageClock(clock, 0.05)

    expect(() => accumulateSlotMontageRootMotion([
      bind(second, roll),
      bind(first, roll),
    ])).toThrow(/insertion order/)

    const mismatchedClock = createSlotMontageClock()
    const mismatched = playSlotAnimationAsDynamicMontage(
      mismatchedClock,
      request(roll, { bEnableRootMotion: false }),
    )
    expect(() => extractSlotMontageRootMotionDelta(bind(mismatched, roll)))
      .toThrow(/setting/)
  })
})
