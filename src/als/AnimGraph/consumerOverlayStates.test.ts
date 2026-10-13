import { describe, expect, it } from 'vitest'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { createRigDefinition } from '../../engine/rig'
import { createConsumerOverlayStates } from './consumerOverlayStates'

const scene = new Group()
const bone = new Bone()
bone.name = 'root'
scene.add(bone)
const rig = createRigDefinition(scene)
const clip = new AnimationClip('pose', 1, [new VectorKeyframeTrack('root.position', [0], [0, 0, 0])])
clip.userData.alsCurves = [{ name: 'LayerArmRight', keys: [[0, 1, 0, 0, 0, 0, 0, 0, 0]] }]
const sources = { idle: 'pose', idleReference: 'pose', poses: 'pose', aim: 'pose', aimCrouch: 'pose', aimReference: 'pose', runArms: 'pose', sprintArms: 'pose', sprintImpulseArms: 'pose' }

describe('consumer linked overlay states', () => {
  it('owns an independent graph for every named mode, including launcher', () => {
    const states = createConsumerOverlayStates(rig, [clip], { clips: [], states: [
      { mode: 'Infima.AR', template: 'Rifle', sources },
      { mode: 'Infima.Launcher', template: 'Rifle', sources },
    ] })
    expect(states.get('Infima.AR')).not.toBe(states.get('Infima.Launcher'))
    expect(states.get('Infima.AR')?.runtime).not.toBe(states.get('Infima.Launcher')?.runtime)
    expect(states.size).toBe(2)
  })
  it('rejects builtin replacement, duplicate registration and missing sequences', () => {
    const make = (mode: string, extra = sources) => ({ mode, template: 'Rifle' as const, sources: extra })
    expect(() => createConsumerOverlayStates(rig, [clip], { clips: [], states: [make('Rifle')] })).toThrow()
    expect(() => createConsumerOverlayStates(rig, [clip], { clips: [], states: [make('Custom'), make('Custom')] })).toThrow()
    expect(() => createConsumerOverlayStates(rig, [clip], { clips: [], states: [make('Custom', { ...sources, aim: 'missing' })] })).toThrow()
  })
})
