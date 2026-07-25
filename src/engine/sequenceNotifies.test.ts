/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS,
} from '../als/AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import {
  compileSequenceNotifies,
  gatherSequenceNotifies,
  gatherSequenceNotifiesFromDeltaPositions,
  UE_SEQUENCE_NOTIFY_DEFAULTS,
} from './sequenceNotifies'
import type {
  ClipWithSequenceNotifyExtras,
  CompiledSequenceNotify,
  SequenceNotifyTickContext,
  SerializedSequenceNotify,
} from './sequenceNotifies'

const leader: SequenceNotifyTickContext = {
  bAllowLooping: false,
  bSrcIsLeader: true,
  InstanceWeight: 1,
}

function clip(
  notifies: readonly SerializedSequenceNotify[],
  duration = 1,
): ClipWithSequenceNotifyExtras {
  return {
    name: 'Sequence',
    duration,
    userData: { notifies },
  }
}

function gather(
  source: ClipWithSequenceNotifyExtras,
  StartTime: number,
  DeltaTime: number,
  context: Partial<SequenceNotifyTickContext> = {},
) {
  const output: CompiledSequenceNotify[] = []
  const appended = gatherSequenceNotifies(
    compileSequenceNotifies(source),
    StartTime,
    DeltaTime,
    { ...leader, ...context },
    output,
  )
  expect(appended).toBe(output.length)
  return output
}

describe('UE animation-sequence notifies', () => {
  it('compiles the GLB name/time shape with explicit FAnimNotifyEvent defaults', () => {
    const compiled = compileSequenceNotifies(clip([
      { name: 'Footstep', time: 0.25 },
    ]))

    expect(UE_SEQUENCE_NOTIFY_DEFAULTS).toEqual({
      TriggerTimeOffset: 0,
      EndTriggerTimeOffset: 0,
      Duration: 0,
      TriggerWeightThreshold: 0.00001,
      MontageTickType: 'Queued',
      NotifyTriggerChance: 1,
      NotifyFilterType: 'NoFiltering',
      NotifyFilterLOD: 0,
      bCanBeFilteredViaRequest: true,
      bTriggerOnDedicatedServer: true,
      bTriggerOnFollower: false,
      TrackIndex: 0,
    })
    expect(compiled).toEqual({
      clipName: 'Sequence',
      duration: 1,
      notifies: [{
        NotifyIndex: 0,
        NotifyName: 'Footstep',
        Time: 0.25,
        ...UE_SEQUENCE_NOTIFY_DEFAULTS,
      }],
    })
  })

  it('uses the exact forward-open/backward-closed interval', () => {
    const source = clip([
      { name: 'Zero', time: 0 },
      { name: 'Quarter', time: 0.25 },
      { name: 'Half', time: 0.5 },
      { name: 'End', time: 1 },
    ])

    expect(gather(source, 0, 0.25).map(({ NotifyName }) => NotifyName))
      .toEqual(['Quarter'])
    expect(gather(source, 0.25, 0.25).map(({ NotifyName }) => NotifyName))
      .toEqual(['Half'])
    expect(gather(source, 0.5, 0).map(({ NotifyName }) => NotifyName))
      .toEqual([])
    expect(gather(source, 0.5, 2).map(({ NotifyName }) => NotifyName))
      .toEqual(['End'])
  })

  it('matches UE time-zero/end behavior through a forward loop wrap', () => {
    const source = clip([
      { name: 'Zero', time: 0 },
      { name: 'Quarter', time: 0.25 },
      { name: 'End', time: 1 },
    ])

    // TriggerTimeOffset is absent from the GLB and therefore exactly zero. The reset segment
    // starts at zero, so (Previous, Current] excludes Zero; End belongs to the pre-wrap segment.
    expect(gather(source, 0.75, 0.5, {
      bAllowLooping: true,
    }).map(({ NotifyName }) => NotifyName)).toEqual([
      'End',
      'Quarter',
    ])

    // FAnimationRuntime::AdvanceTime treats equality with EndTime as not looped.
    expect(gather(source, 0.75, 0.25, {
      bAllowLooping: true,
    }).map(({ NotifyName }) => NotifyName)).toEqual(['End'])
    expect(gather(source, 1, 0.25, {
      bAllowLooping: true,
    }).map(({ NotifyName }) => NotifyName)).toEqual(['Quarter'])
  })

  it('retains authored boundary trigger offsets when an exact sidecar enriches the GLB', () => {
    const source = clip([
      {
        name: 'AfterZero',
        time: 0,
        triggerTimeOffset: 0.0001,
      },
      {
        name: 'BeforeEnd',
        time: 1,
        triggerTimeOffset: -0.0001,
      },
    ])

    expect(gather(source, 0, 0.0001).map(({ NotifyName }) => NotifyName))
      .toEqual(['AfterZero'])
    expect(gather(source, 0.9998, 0.0001).map(({ NotifyName }) => NotifyName))
      .toEqual(['BeforeEnd'])
  })

  it('replays point notifies across multiple loops and mirrors UE large-delta budgeting', () => {
    const source = clip([{ name: 'Middle', time: 0.5 }])

    expect(gather(source, 0, 3, {
      bAllowLooping: true,
    }).map(({ NotifyName }) => NotifyName)).toEqual([
      'Middle',
      'Middle',
      'Middle',
    ])

    const veryLarge = gather(source, 0, 1_002, {
      bAllowLooping: true,
    })
    expect(veryLarge).toHaveLength(1_000)
    expect(veryLarge.every(({ NotifyName }) => NotifyName === 'Middle'))
      .toBe(true)
  })

  it('pins UE 5.5 traversal budgeting when a multi-loop tick starts mid-sequence', () => {
    const source = clip([
      { name: 'Quarter', time: 0.25 },
      { name: 'ThreeQuarters', time: 0.75 },
    ])

    // AnimSequenceBase.cpp calculates MaxLoopCount as
    // Clamp(uint32(DesiredDeltaMove / PlayLength), 2, 1000), independent of StartTime.
    // Thus UE harvests 0.5->1 and two full loops, then exhausts its three-iteration budget
    // before the mathematically remaining 0->0.5 segment.
    expect(gather(source, 0.5, 3, {
      bAllowLooping: true,
    }).map(({ NotifyName }) => NotifyName)).toEqual([
      'ThreeQuarters',
      'Quarter',
      'ThreeQuarters',
      'Quarter',
      'ThreeQuarters',
    ])
  })

  it('applies inclusive trigger weight and leader/follower filtering while gathering', () => {
    const source = clip([
      {
        name: 'LeaderOnly',
        time: 0.25,
        triggerWeightThreshold: 0.5,
      },
      {
        name: 'FollowerEnabled',
        time: 0.5,
        triggerWeightThreshold: 0.25,
        triggerOnFollower: true,
      },
    ])

    expect(gather(source, 0, 1, {
      InstanceWeight: 0.499999,
    }).map(({ NotifyName }) => NotifyName)).toEqual(['FollowerEnabled'])
    expect(gather(source, 0, 1, {
      InstanceWeight: 0.5,
    }).map(({ NotifyName }) => NotifyName)).toEqual([
      'LeaderOnly',
      'FollowerEnabled',
    ])
    expect(gather(source, 0, 1, {
      bSrcIsLeader: false,
      InstanceWeight: 1,
    }).map(({ NotifyName }) => NotifyName)).toEqual(['FollowerEnabled'])
  })

  it('splits a synchronized forward wrap from .59 to .07', () => {
    const track = compileSequenceNotifies(clip([
      { name: 'BeforeWrap', time: 0.595 },
      { name: 'AfterWrap', time: 0.06666667 },
    ], 0.6000000238418579))
    const output: CompiledSequenceNotify[] = []

    expect(gatherSequenceNotifiesFromDeltaPositions(
      track,
      0.59,
      0.07,
      { ...leader, bAllowLooping: true },
      output,
    )).toBe(2)
    expect(output.map(({ NotifyName }) => NotifyName)).toEqual([
      'BeforeWrap',
      'AfterWrap',
    ])
  })

  it('enriches an existing raw event without creating a sidecar-only timeline', () => {
    const raw = clip([{ name: 'AlsCameraShake', time: 0.25 }])
    const compiled = compileSequenceNotifies(raw, [{
      name: 'AlsCameraShake',
      time: 0.25000001,
      triggerWeightThreshold: 0.5,
      notifyTriggerChance: 1,
      triggerOnFollower: false,
    }])

    expect(compiled.notifies[0]).toMatchObject({
      Time: 0.25000001,
      TriggerWeightThreshold: 0.5,
      NotifyTriggerChance: 1,
      bTriggerOnFollower: false,
    })
    expect(() => compileSequenceNotifies(raw, [{
      name: 'Missing',
      time: 0.25,
    }])).toThrow('has no raw GLB event')
  })

  it('binds same-name same-time payloads by their authored event index', () => {
    const compiled = compileSequenceNotifies(clip([
      { name: 'BMAnimNotifyFootstep', time: 0.1 },
      { name: 'BMAnimNotifyFootstep', time: 0.1 },
    ]), [
      {
        notifyIndex: 0,
        name: 'BMAnimNotifyFootstep',
        time: 0.1,
        triggerWeightThreshold: 0.25,
      },
      {
        notifyIndex: 1,
        name: 'BMAnimNotifyFootstep',
        time: 0.1,
        triggerWeightThreshold: 0.75,
      },
    ])

    expect(compiled.notifies.map((notify) => ({
      index: notify.NotifyIndex,
      threshold: notify.TriggerWeightThreshold,
    }))).toEqual([
      { index: 0, threshold: 0.25 },
      { index: 1, threshold: 0.75 },
    ])
  })

  it('verifies indexed oracle times through the GLB six-significant-digit contract', () => {
    const compiled = compileSequenceNotifies(clip([
      { name: 'BMAnimNotifyFootstep', time: 1.36667 },
    ], 2), [{
      notifyIndex: 0,
      name: 'BMAnimNotifyFootstep',
      time: 1.3666666746139526,
      triggerWeightThreshold: 0.3,
    }])

    expect(compiled.notifies[0].Time).toBe(1.3666666746139526)
  })

  it('refuses to approximate authored random chance without UE queue state', () => {
    expect(() => compileSequenceNotifies(clip([{
      name: 'Chance',
      time: 0.5,
      notifyTriggerChance: 0.5,
    }]))).toThrow('requires UE\'s seeded random trigger stream')
  })

  it('rejects malformed sidecars and out-of-range traversal', () => {
    expect(() => compileSequenceNotifies({
      name: 'Bad',
      duration: 1,
      userData: { notifies: {} },
    })).toThrow('animation.extras.notifies must be an array')
    expect(() => compileSequenceNotifies(clip([
      { name: 'Late', time: 1.01 },
    ]))).toThrow('invalid name or time')
    expect(() => gatherSequenceNotifies(
      compileSequenceNotifies(clip([])),
      0,
      -0.1,
      leader,
      [],
    )).toThrow('forward traversal only')
  })
})

describe('shipped ALS camera-shake sequence notifies', () => {
  let animations: THREE.AnimationClip[]

  beforeAll(async () => {
    const bytes = readFileSync(
      new URL('../../public/assets/skm-als.glb', import.meta.url),
    )
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    animations = await new Promise<THREE.AnimationClip[]>((resolve, reject) => {
      new GLTFLoader().parse(
        data,
        '',
        (gltf) => resolve(gltf.animations),
        reject,
      )
    })
  })

  it('compiles all six authored events from the real GLB and camera-content oracle', () => {
    const compiledCameraEvents: CompiledSequenceNotify[] = []
    for (const sequenceName of [
      'A_Als_Sprint',
      'A_Als_Sprint_Acceleration',
      'A_Als_Roll',
    ]) {
      const animation = animations.find(
        ({ name }) => name === sequenceName,
      )
      expect(animation, sequenceName).toBeDefined()
      if (!animation) continue

      const authoredEvents = ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS.filter(
        ({ Sequence }) => Sequence === sequenceName,
      )
      const compiled = compileSequenceNotifies(
        animation,
        authoredEvents.map((authored) => ({
          name: authored.NotifyName,
          time: authored.Time,
          triggerWeightThreshold: authored.TriggerWeightThreshold,
          notifyTriggerChance: authored.NotifyTriggerChance,
          triggerOnFollower: authored.bTriggerOnFollower,
          triggerOnDedicatedServer: authored.bTriggerOnDedicatedServer,
        })),
      )
      compiledCameraEvents.push(
        ...compiled.notifies.filter(
          ({ NotifyName }) => NotifyName === 'AlsCameraShake',
        ),
      )
    }

    expect(compiledCameraEvents).toHaveLength(6)
    expect(compiledCameraEvents.map((notify) => ({
      name: notify.NotifyName,
      time: notify.Time,
      chance: notify.NotifyTriggerChance,
      follower: notify.bTriggerOnFollower,
      threshold: notify.TriggerWeightThreshold,
      dedicatedServer: notify.bTriggerOnDedicatedServer,
    }))).toEqual(
      ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS.map((authored) => ({
        name: authored.NotifyName,
        time: expect.closeTo(authored.Time, 5),
        chance: authored.NotifyTriggerChance,
        follower: authored.bTriggerOnFollower,
        threshold: authored.TriggerWeightThreshold,
        dedicatedServer: authored.bTriggerOnDedicatedServer,
      })),
    )
  })

  it('honors the six authored camera-shake weight thresholds without follower leakage', () => {
    const eventsBySequence = new Map<
      string,
      (typeof ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS)[number][]
    >()
    for (const event of ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS) {
      const events = eventsBySequence.get(event.Sequence)
      if (events) events.push(event)
      else eventsBySequence.set(event.Sequence, [event])
    }
    const triggered: string[] = []

    for (const [sequenceName, authoredEvents] of eventsBySequence) {
      const source = clip(
        authoredEvents.map((authored) => ({
          name: authored.NotifyName,
          time: authored.Time,
          triggerWeightThreshold: authored.TriggerWeightThreshold,
          notifyTriggerChance: authored.NotifyTriggerChance,
          triggerOnFollower: authored.bTriggerOnFollower,
        })),
        authoredEvents[0].SequenceLength,
      )
      const belowThreshold: CompiledSequenceNotify[] = []
      gatherSequenceNotifies(
        compileSequenceNotifies(source),
        0,
        authoredEvents[0].SequenceLength,
        {
          ...leader,
          InstanceWeight: authoredEvents[0].TriggerWeightThreshold
            - Number.EPSILON,
        },
        belowThreshold,
      )
      expect(belowThreshold, `${sequenceName} below threshold`).toEqual([])

      triggered.push(
        ...gather(source, 0, authoredEvents[0].SequenceLength, {
          InstanceWeight: authoredEvents[0].TriggerWeightThreshold,
        }).map(({ NotifyName }) => `${sequenceName}:${NotifyName}`),
      )
      expect(gather(source, 0, authoredEvents[0].SequenceLength, {
        bSrcIsLeader: false,
        InstanceWeight: 1,
      }), `${sequenceName} follower`).toEqual([])
    }

    expect(triggered).toHaveLength(6)
  })
})
