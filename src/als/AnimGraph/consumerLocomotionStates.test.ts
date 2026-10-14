import { describe, expect, it } from 'vitest'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { createRigDefinition } from '../../engine/rig'
import { createMutableUePoseNode } from '../../engine/uePoseGraph'
import type { AlsAnimationInstanceControls } from '../AlsAnimationInstance'
import { createConsumerLocomotionStates, type ConsumerLocomotionSample } from './consumerLocomotionStates'

function fixture() {
  const scene = new Group()
  const root = new Bone()
  root.name = 'root'
  const foot = new Bone()
  foot.name = 'foot_l'
  root.add(foot)
  scene.add(root)
  const rig = createRigDefinition(scene)
  const standing = createMutableUePoseNode(rig.boneCount)
  const crouching = createMutableUePoseNode(rig.boneCount)
  const controls: AlsAnimationInstanceControls = {
    gait: 'Walking', moving: true, movingSmooth: true, stance: 'Crouching', rotationMode: 'VelocityDirection', overlayMode: 'Default', speed: 1,
    direction: 0, relativeAccelerationAmount: { x: 0, y: 0 }, rotateInPlace: false, viewYawAngle: 0, viewYawSpeed: 0,
  }
  const walk = new AnimationClip('walk', 2, [new VectorKeyframeTrack('foot_l.position', [0, 2], [0, 0, 0, 4, 0, 0])])
  const jog = new AnimationClip('jog', 0.8, [new VectorKeyframeTrack('foot_l.position', [0, 0.8], [0, 0, 0, 8, 0, 0])])
  return { rig, standing, crouching, controls, walk, jog, footOffset: rig.boneNames.indexOf('foot_l') * 3 }
}

describe('consumer linked locomotion', () => {
  it('samples different-duration clips at supplied phase before blending, with authored curve ownership', () => {
    const f = fixture()
    let reported = 0
    const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk, f.jog], states: [{ stance: 'Crouching', blendDuration: 0,
      sample: () => ({ sources: [{ clip: 'walk', time: 1, weight: 0.75, loop: true }, { clip: 'jog', time: 0.4, weight: 0.25, loop: true }], curves: { PoseCrouching: 1 } }),
      onSample: (_, weight) => { reported = weight },
    }] })
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0.4, Crouching: 0.6 })
    expect(f.crouching.pose.positions[f.footOffset]).toBeCloseTo(2.5)
    expect(f.crouching.curves.get('PoseCrouching')).toBe(1)
    expect(f.standing.pose.positions[f.footOffset]).toBe(0)
    expect(reported).toBe(0.6)
  })
  it('blends activation and retirement against the live fallback without a skeleton write', () => {
    const f = fixture()
    let sample: ConsumerLocomotionSample | null = { sources: [{ clip: 'walk', time: 1, weight: 1, loop: true }] }
    let weight = 0
    const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk], states: [{ stance: 'Crouching', blendDuration: 0.2, sample: () => sample, onSample: (_, value) => { weight = value } }] })
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(f.crouching.pose.positions[f.footOffset]).toBeCloseTo(1)
    f.crouching.pose.positions[f.footOffset] = 0
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(weight).toBe(1)
    sample = null
    f.crouching.pose.positions[f.footOffset] = 4
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(f.crouching.pose.positions[f.footOffset]).toBeCloseTo(3)
    expect(weight).toBeCloseTo(0.5)
    f.crouching.pose.positions[f.footOffset] = 4
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(f.crouching.pose.positions[f.footOffset]).toBe(4)
    expect(weight).toBe(0)
  })
  it('rejects incomplete blends instead of silently publishing a bind pose', () => {
    const f = fixture()
    const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk], states: [{ stance: 'Crouching', blendDuration: 0, sample: () => ({ sources: [{ clip: 'walk', time: 0, weight: 0.2, loop: true }] }) }] })
    expect(() => graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })).toThrow('sum to one')
  })
  it('observes source and blended linked poses separately, then clears the source after retirement', () => {
    const f = fixture()
    let active = true
    const observations: { source: number | null; linked: number; weight: number }[] = []
    const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk], states: [{
      stance: 'Crouching', blendDuration: 0.2,
      sample: () => active ? { sources: [{ clip: 'walk', time: 1, weight: 1, loop: true }] } : null,
      onPose: ({ rig, source, linked, effectiveWeight }) => {
        expect(rig.boneNames).toEqual(f.rig.boneNames)
        observations.push({ source: source?.pose.positions[f.footOffset] ?? null, linked: linked.pose.positions[f.footOffset], weight: effectiveWeight })
      },
    }] })
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    active = false
    f.crouching.pose.positions[f.footOffset] = 4
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(observations).toEqual([{ source: 2, linked: 1, weight: 0.5 }, { source: null, linked: 4, weight: 0 }])
  })
  it('owns composed curves only at effective stance weight and releases them with the pose', () => {
    const f = fixture()
    let active = true
    const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk], states: [{
      stance: 'Crouching', blendDuration: 0.2,
      sample: () => active ? { sources: [{ clip: 'walk', time: 1, weight: 1, loop: true }], layeringCurves: { FootLeftIk: 0, LayerLegs: 0 } } : null,
    }] })
    const composed = () => new Map([['FootLeftIk', 1], ['LayerLegs', 1], ['Unowned', 7]])
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0.4, Crouching: 0.6 })
    const partial = composed()
    graph.applyLayeringCurves(partial)
    expect(Object.fromEntries(partial)).toEqual({ FootLeftIk: 0.7, LayerLegs: 0.7, Unowned: 7 })
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    const full = composed()
    graph.applyLayeringCurves(full)
    expect(full.get('FootLeftIk')).toBe(0)
    active = false
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    const retiring = composed()
    graph.applyLayeringCurves(retiring)
    expect(retiring.get('FootLeftIk')).toBe(0.5)
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    const released = composed()
    graph.applyLayeringCurves(released)
    expect(released).toEqual(composed())
  })
  it('combines linked stance curve ownership without registration order bias', () => {
    const f = fixture()
    const evaluate = (stances: readonly ('Standing' | 'Crouching')[]) => {
      const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk], states: stances.map(stance => ({
        stance, blendDuration: 0,
        sample: () => ({ sources: [{ clip: 'walk', time: 0, weight: 1, loop: true }], layeringCurves: { FootLeftIk: stance === 'Standing' ? 0.8 : 0 } }),
      })) })
      graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0.25, Crouching: 0.75 })
      const curves = new Map([['FootLeftIk', 1]])
      graph.applyLayeringCurves(curves)
      return curves.get('FootLeftIk')
    }
    expect(evaluate(['Standing', 'Crouching'])).toBeCloseTo(0.2)
    expect(evaluate(['Crouching', 'Standing'])).toBeCloseTo(0.2)
  })

  it('permits authored moving locks only at full linked stance weight and releases on retirement', () => {
    const f = fixture()
    let active = true
    const graph = createConsumerLocomotionStates(f.rig, { clips: [f.walk], states: [{
      stance: 'Crouching', blendDuration: 0.2, allowMovingFootLock: true,
      sample: () => active ? { sources: [{ clip: 'walk', time: 0, weight: 1, loop: true }] } : null,
    }] })
    expect(graph.allowsMovingFootLock()).toBe(false)
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(graph.allowsMovingFootLock()).toBe(false)
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0.1, Crouching: 0.9 })
    expect(graph.allowsMovingFootLock()).toBe(false)
    graph.evaluate(f.controls, 0.1, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(graph.allowsMovingFootLock()).toBe(true)
    active = false
    graph.evaluate(f.controls, 0.01, f.standing, f.crouching, { Standing: 0, Crouching: 1 })
    expect(graph.allowsMovingFootLock()).toBe(false)
  })

})
