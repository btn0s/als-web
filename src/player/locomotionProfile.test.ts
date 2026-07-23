import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
  buildLocomotionProfile,
  resolveGaitSpeeds,
} from './locomotionProfile'

function clip(name: string, duration: number) {
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack(
      'root.position',
      [0, duration],
      [0, 0, 0, 0, 0, 0],
    ),
  ])
}

describe('ALS locomotion profile', () => {
  it('exposes the exact ALS authored gait speeds', () => {
    expect(ALS_AUTHORED_GAIT_SPEEDS).toEqual({
      standing: { walk: 1.75, run: 3.75, sprint: 6.5 },
      crouching: { walk: 1.5, run: 2.0 },
    })
  })

  it('derives each loaded gait stride from its authored speed and clip duration', () => {
    const profile = buildLocomotionProfile([
      clip('A_Als_Idle', 2),
      clip('A_Als_Walk_Forward', 1.133),
      clip('A_Als_Run_Forward', 0.8),
      clip('A_Als_Sprint', 0.6),
      clip('A_Als_Crouch_Idle', 2),
      clip('A_Als_Crouch_Walk_Forward', 1.133),
    ])

    expect(profile).toEqual({
      idle: { duration: 2, stride: 0, speed: 0 },
      walk: { duration: 1.133, stride: 1.98275, speed: 1.75 },
      jog: { duration: 0.8, stride: 3, speed: 3.75 },
      sprint: { duration: 0.6, stride: 3.9, speed: 6.5 },
      crouchIdle: { duration: 2, stride: 0, speed: 0 },
      crouchWalk: { duration: 1.133, stride: 1.6995, speed: 1.5 },
    })
  })

  it('keeps pace tuning and the walk-before-jog ordering contract', () => {
    const profile = buildLocomotionProfile([
      clip('A_Als_Walk_Forward', 1.133),
      clip('A_Als_Run_Forward', 0.8),
      clip('A_Als_Crouch_Walk_Forward', 1.133),
    ])

    expect(resolveGaitSpeeds(profile, { normal: 1, slow: 0.5, jog: 1 }, false)).toEqual({
      walk: 1.75,
      jog: 3.75,
      crouchWalk: 1.5,
    })
    expect(resolveGaitSpeeds(profile, { normal: 3, slow: 0.5, jog: 0.1 }, false)).toEqual({
      walk: 5.25,
      jog: 5.5125,
      crouchWalk: 4.5,
    })
  })
})
