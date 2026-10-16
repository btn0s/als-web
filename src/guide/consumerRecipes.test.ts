import { describe, expect, it } from 'vitest'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { createAlsPlayer } from '../app/AlsPlayer'
import type { AlsCharacterInputSource } from '../als/AlsCharacter.hooks'
import { createConsumerOverlayStates, type ConsumerOverlayStates } from '../als/AnimGraph/consumerOverlayStates'
import { AlsRemoteCharacter } from '../als/AlsRemoteCharacter'
import { AlsSnapshotBuffer } from '../als/AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from '../als/AlsCharacterSnapshot'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { createRigDefinition } from '../engine/rig'

const createGuideInput = (walking: boolean, crouching: boolean, yaw: number): AlsCharacterInputSource => () => ({
  active: true,
  jumpSequence: 1,
  movementDirection: { x: Math.cos(yaw * Math.PI / 180), z: Math.sin(yaw * Math.PI / 180) },
  desiredGait: walking ? 'Walking' : 'Running',
  desiredStance: crouching ? 'Crouching' : 'Standing',
  desiredRotationMode: 'ViewDirection',
  viewYawAngle: yaw,
  viewPitchAngle: 12,
  aiming: true,
  overlayMode: 'CarryBox',
})

const carryBox: ConsumerOverlayStates = {
  clips: [],
  states: [{ mode: 'CarryBox', template: 'Rifle', sources: {
    poses: 'CarryBox_Poses', aim: 'CarryBox_Aim', aimCrouch: 'CarryBox_AimCrouch',
    aimReference: 'CarryBox_AimReference', runArms: 'CarryBox_Run',
    sprintArms: 'CarryBox_Sprint', sprintImpulseArms: 'CarryBox_SprintImpulse',
    idle: 'CarryBox_Idle', idleReference: 'CarryBox_IdleReference',
  } }],
}

const remoteSnapshot: AlsCharacterSnapshot = {
  t: 1000, pos: [1, 0.9, 2], vel: [2, 0, 0], actorYaw: 30,
  viewYaw: 60, viewPitch: 12, gait: 'running', stance: 'standing',
  rotationMode: 'viewDirection', locomotionMode: 'grounded', action: 'none',
  actionSeq: 0, overlay: 'rifle', aiming: true, seq: 1,
  animation: { hasInput: true, inputYaw: 45, targetYaw: 30,
    relativeAcceleration: { x: 0.5, y: 0 } },
}

describe('consumer guide API recipes', () => {
  it('keeps gait, stance, aim and look semantic', () => {
    const input = createGuideInput(true, true, 90)()
    expect(input.desiredGait).toBe('Walking')
    expect(input.desiredStance).toBe('Crouching')
    expect(input.viewYawAngle).toBe(90)
    expect(input.jumpSequence).toBe(1)
    expect(input.desiredSpeed).toBeUndefined()
    expect(createAlsPlayer().command.view).toBe('ThirdPerson')
  })

  it('routes remote look and animation intent without a unit conversion at the wire', () => {
    const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 0 })
    expect(buffer.push(remoteSnapshot)).toBe(true)
    const frame = buffer.sample(1000)!
    const remote = new AlsRemoteCharacter()
    remote.apply(frame.state)
    expect(remote.character.viewYawAngle).toBe(60)
    expect(remote.character.gait).toBe('Running')
    expect(remote.character.locomotionState.hasInput).toBe(true)
    expect(remote.character.locomotionState.inputYawAngle).toBe(45)
    expect(remote.character.locomotionState.velocity.x).toBe(2)
  })

  it('registers a distinct overlay and preserves the frame stage sequence', () => {
    const root = new Bone()
    root.name = 'root'
    const scene = new Group()
    scene.add(root)
    const sources = carryBox.states[0]!.sources
    const clips = Object.values(sources).map(name => new AnimationClip(name, 1, [
      new VectorKeyframeTrack('root.position', [0], [0, 0, 0]),
    ]))
    const states = createConsumerOverlayStates(createRigDefinition(scene), [], { ...carryBox, clips })
    expect(states.has('CarryBox')).toBe(true)
    expect(ALS_FRAME_PRIORITY.Physics).toBeLessThan(ALS_FRAME_PRIORITY.Animation)
    expect(ALS_FRAME_PRIORITY.Animation).toBeLessThan(ALS_FRAME_PRIORITY.Camera)
  })
})
