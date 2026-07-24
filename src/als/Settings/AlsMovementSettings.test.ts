import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
  ALS_GAITS,
  ALS_MOVEMENT_SETTINGS,
  ALS_STANCES,
  buildLocomotionProfile,
  resolveDesiredGaitSpeed,
  resolveGaitSpeeds,
  sampleGroundedMovementParameters,
} from './AlsMovementSettings'

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
  it('resolves desired gait to the authored standing speed and crouching cap', () => {
    expect(ALS_GAITS).toEqual(['Walking', 'Running', 'Sprinting'])
    expect(ALS_STANCES).toEqual(['Standing', 'Crouching'])
    expect(resolveDesiredGaitSpeed('Walking', 'Standing')).toBe(1.75)
    expect(resolveDesiredGaitSpeed('Running', 'Standing')).toBe(3.75)
    expect(resolveDesiredGaitSpeed('Sprinting', 'Standing')).toBe(6.5)
    expect(resolveDesiredGaitSpeed('Walking', 'Crouching')).toBe(1.5)
    expect(resolveDesiredGaitSpeed('Running', 'Crouching')).toBe(2)
    expect(resolveDesiredGaitSpeed('Sprinting', 'Crouching')).toBe(2)
  })

  it('exposes the exact ALS authored gait speeds', () => {
    expect(ALS_AUTHORED_GAIT_SPEEDS).toEqual({
      standing: { walk: 1.75, run: 3.75, sprint: 6.5 },
      crouching: { walk: 1.5, run: 2.0 },
    })
  })

  it('uses the authored Aiming walk speed from MS_Als_Normal', () => {
    expect(resolveDesiredGaitSpeed('Walking', 'Standing', 'Aiming')).toBe(1.65)
  })

  it('derives each loaded gait stride from its authored speed and clip duration', () => {
    const profile = buildLocomotionProfile([
      clip('A_Als_Idle', 2),
      clip('A_Als_Walk_Forward', 1.133),
      clip('A_Als_Run_Forward', 0.8),
      clip('A_Als_Sprint', 0.6),
      clip('A_Als_Crouch_Pose', 2),
      clip('A_Als_Crouch_Walk_Forward', 1.133),
    ])

    expect(profile).toEqual({
      idle: { duration: 2, stride: 0, speed: 0 },
      walk: { duration: 1.133, stride: 1.98275, speed: 1.75 },
      run: { duration: 0.8, stride: 3, speed: 3.75 },
      sprint: { duration: 0.6, stride: 3.9, speed: 6.5 },
      crouchIdle: { duration: 2, stride: 0, speed: 0 },
      crouchWalk: { duration: 1.133, stride: 1.6995, speed: 1.5 },
    })
  })

  it('keeps pace tuning and the walk-before-run ordering contract', () => {
    const profile = buildLocomotionProfile([
      clip('A_Als_Walk_Forward', 1.133),
      clip('A_Als_Run_Forward', 0.8),
      clip('A_Als_Crouch_Walk_Forward', 1.133),
    ])

    expect(resolveGaitSpeeds(profile, { normal: 1, slow: 0.5, run: 1 }, false)).toEqual({
      walk: 1.75,
      run: 3.75,
      sprint: 0,
      crouchWalk: 1.5,
      crouchRun: 2,
    })
    expect(resolveGaitSpeeds(profile, { normal: 3, slow: 0.5, run: 0.1 }, false)).toEqual({
      walk: 5.25,
      run: 5.5125,
      sprint: 0,
      crouchWalk: 4.5,
      crouchRun: 2,
    })
  })
})

describe('MS_Als_Normal movement curves', () => {
  it('selects the authored curve families by rotation mode and stance', () => {
    expect(ALS_MOVEMENT_SETTINGS.VelocityDirection.Standing).toMatchObject({
      movementCurve: 'normal',
      rotationCurve: 'responsive',
    })
    expect(ALS_MOVEMENT_SETTINGS.ViewDirection.Standing).toMatchObject({
      movementCurve: 'normal',
      rotationCurve: 'normal',
    })
    expect(ALS_MOVEMENT_SETTINGS.ViewDirection.Crouching).toMatchObject({
      movementCurve: 'responsive',
      rotationCurve: 'normal',
    })
  })

  it('matches authored Normal curve anchors with cm-to-m conversion', () => {
    const settings = ALS_MOVEMENT_SETTINGS.ViewDirection.Standing
    expect(sampleGroundedMovementParameters(settings, 1)).toEqual({
      maxAcceleration: 20,
      brakingDeceleration: 15,
      groundFriction: 5,
      rotationInterpolationSpeed: 4,
    })
    expect(sampleGroundedMovementParameters(settings, 3)).toEqual({
      maxAcceleration: 7.5,
      brakingDeceleration: 5,
      groundFriction: 0.5,
      rotationInterpolationSpeed: 20,
    })
  })

  it('matches authored Responsive curve anchors', () => {
    const settings = ALS_MOVEMENT_SETTINGS.ViewDirection.Crouching
    expect(sampleGroundedMovementParameters(settings, 1)).toEqual({
      maxAcceleration: 25,
      brakingDeceleration: 20,
      groundFriction: 10,
      rotationInterpolationSpeed: 4,
    })
    expect(sampleGroundedMovementParameters(settings, 3)).toEqual({
      maxAcceleration: 5,
      brakingDeceleration: 8,
      groundFriction: 5,
      rotationInterpolationSpeed: 20,
    })
  })

  it('preserves the authored cubic movement-curve segment', () => {
    const parameters = sampleGroundedMovementParameters(
      ALS_MOVEMENT_SETTINGS.ViewDirection.Standing,
      2.5,
    )
    expect(parameters.maxAcceleration).toBeCloseTo(9.197035, 6)
    expect(parameters.brakingDeceleration).toBeCloseTo(8.75, 6)
    expect(parameters.groundFriction).toBeCloseTo(2.25, 6)
  })
})
