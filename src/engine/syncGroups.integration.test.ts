import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from './clipSampler'
import { createPoseEvaluator, evaluatePose } from './evaluator'
import { createRigDefinition } from './rig'
import {
  advanceSyncGroup,
  createSyncGroup,
} from './syncGroups'
import type { SyncGroupMember } from './syncGroups'

function footCycle(
  name: string,
  duration: number,
  normalizedTimes: number[],
) {
  const times = normalizedTimes.map((time) => time * duration)
  const values = normalizedTimes.flatMap((_, index) => {
    const x = index === 1 ? 1 : 0
    return [x, 0, 0]
  })
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack('foot_l.position', times, values),
  ])
}

describe('Locomotion sync integration', () => {
  it('keeps a sampled foot continuous through the midpoint of a gait crossfade', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const foot = new THREE.Bone()
    foot.name = 'foot_l'
    root.add(foot)
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const walk = compileClipSampler(
      footCycle('walk', 1, [0.1, 0.35, 0.6]),
      rig,
    )
    const run = compileClipSampler(
      footCycle('run', 0.8, [0.2, 0.5, 0.8]),
      rig,
    )
    const walkEntry = { sampler: walk, time: 0, weight: 1 }
    const runEntry = { sampler: run, time: 0, weight: 0 }
    const markers = [
      { name: 'LeftFoot', normalizedTime: 0.1 },
      { name: 'RightFoot', normalizedTime: 0.6 },
    ]
    const walkMember: SyncGroupMember = {
      id: 'walk',
      duration: 1,
      markers,
      time: 0.25,
      weight: 1,
      playRate: 0.5,
    }
    const runMember: SyncGroupMember = {
      id: 'run',
      duration: 0.8,
      markers: [
        { name: 'LeftFoot', normalizedTime: 0.2 },
        { name: 'RightFoot', normalizedTime: 0.8 },
      ],
      time: 0,
      weight: 0,
      playRate: 0.4,
    }
    const group = createSyncGroup('Locomotion', [walkMember, runMember])
    const samples: number[] = []

    for (let frame = 0; frame < 30; frame++) {
      const runWeight = frame / 29
      walkEntry.weight = 1 - runWeight
      runEntry.weight = runWeight
      walkMember.weight = walkEntry.weight
      runMember.weight = runEntry.weight
      advanceSyncGroup(group, 1 / 60)
      walkEntry.time = walkMember.time
      runEntry.time = runMember.time
      const pose = evaluatePose(evaluator, {
        base: [walkEntry, runEntry],
        deltaTime: 1 / 60,
      }).pose
      samples.push(pose.positions[3])
    }

    let maximumDelta = 0
    for (let i = 1; i < samples.length; i++) {
      maximumDelta = Math.max(maximumDelta, Math.abs(samples[i] - samples[i - 1]))
    }
    expect(maximumDelta).toBeLessThan(0.12)
  })
})
