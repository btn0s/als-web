import { describe, expect, it } from 'vitest'
import type { CompiledWeightBlendProfile } from './blendProfile'
import {
  advanceStateMachineTransitionStack,
  createStateMachineTransitionStack,
  getStateMachineStateWeight,
  resetStateMachineTransitionStack,
  startStateMachineStandardTransition,
  writeStateMachineStateWeights,
} from './stateMachineTransitionStack'

const uniformProfile: CompiledWeightBlendProfile = {
  mode: 'WeightFactor',
  blendScales: new Float32Array([1, 1, 1]),
}

const weightedProfile: CompiledWeightBlendProfile = {
  mode: 'WeightFactor',
  blendScales: new Float32Array([1, 2, 0.5]),
}

function startLinear(
  stack: ReturnType<typeof createStateMachineTransitionStack<string>>,
  from: string,
  to: string,
  duration: number,
) {
  return startStateMachineStandardTransition(stack, {
    from,
    to,
    duration,
    blendOption: 'Linear',
    blendProfile: null,
  })
}

function expectStateWeights(
  stack: ReturnType<typeof createStateMachineTransitionStack<string>>,
  expected: Readonly<Record<string, number>>,
) {
  for (const [state, weight] of Object.entries(expected)) {
    expect(getStateMachineStateWeight(stack, state)).toBeCloseTo(weight, 7)
  }
}

describe('VERIFIED UE standard-transition stack', () => {
  it('starts steady and resets in place while recycling transition storage', () => {
    const stack = createStateMachineTransitionStack('Idle', 3, 1)
    expect(stack.activeTransitions).toHaveLength(0)
    expectStateWeights(stack, { Idle: 1, Move: 0 })

    startLinear(stack, 'Idle', 'Move', 0.5)
    const transition = stack.activeTransitions[0]
    const previousPoseMask = transition.previousPoseMask
    const nextPoseMask = transition.nextPoseMask
    expect(advanceStateMachineTransitionStack(stack, 0.5)).toBe(1)

    expect(resetStateMachineTransitionStack(stack, 'Stop')).toBe(stack)
    startLinear(stack, 'Stop', 'Idle', 0.5)
    expect(stack.activeTransitions[0]).toBe(transition)
    expect(stack.activeTransitions[0].previousPoseMask).toBe(previousPoseMask)
    expect(stack.activeTransitions[0].nextPoseMask).toBe(nextPoseMask)
  })

  it('interrupts and reverses without a pose-weight discontinuity', () => {
    const stack = createStateMachineTransitionStack('A', 3)
    startLinear(stack, 'A', 'B', 1)
    advanceStateMachineTransitionStack(stack, 0.25)
    expectStateWeights(stack, { A: 0.75, B: 0.25 })

    startLinear(stack, 'B', 'A', 1)
    expect(stack.activeTransitions).toHaveLength(2)
    expect(stack.activeTransitions[0]).toMatchObject({
      previousState: 'A',
      nextState: 'B',
      usesIntermediatePose: false,
    })
    expect(stack.activeTransitions[1]).toMatchObject({
      previousState: 'B',
      nextState: 'A',
      crossfadeDuration: 0.25,
      alpha: 0,
      usesIntermediatePose: true,
    })
    expectStateWeights(stack, { A: 0.75, B: 0.25 })

    advanceStateMachineTransitionStack(stack, 0.125)
    expectStateWeights(stack, { A: 0.8125, B: 0.1875 })
    expect(advanceStateMachineTransitionStack(stack, 0.125)).toBe(2)
    expect(stack.activeTransitions).toHaveLength(0)
    expectStateWeights(stack, { A: 1, B: 0 })
  })

  it('uses UE Cubic shaping and HermiteCubic inverse-duration polynomial', () => {
    const cubic = createStateMachineTransitionStack('A', 3)
    startStateMachineStandardTransition(cubic, {
      from: 'A',
      to: 'B',
      duration: 1,
      blendOption: 'Cubic',
      blendProfile: null,
    })
    advanceStateMachineTransitionStack(cubic, 0.25)
    expect(cubic.activeTransitions[0].alpha).toBeCloseTo(0.15625, 8)

    startStateMachineStandardTransition(cubic, {
      from: 'B',
      to: 'A',
      duration: 1,
      blendOption: 'Cubic',
      blendProfile: null,
    })
    // Cubic is shaped for Alpha, but CalculateInverseAlpha clamps the scaler directly.
    expect(cubic.activeTransitions[1].crossfadeDuration)
      .toBeCloseTo(0.15625, 8)

    const hermite = createStateMachineTransitionStack('A', 3)
    startStateMachineStandardTransition(hermite, {
      from: 'A',
      to: 'B',
      duration: 1,
      blendOption: 'HermiteCubic',
      blendProfile: null,
    })
    advanceStateMachineTransitionStack(hermite, 0.25)
    startStateMachineStandardTransition(hermite, {
      from: 'B',
      to: 'A',
      duration: 1,
      blendOption: 'HermiteCubic',
      blendProfile: null,
    })
    // 4/3*t^3 - 2*t^2 + 5/3*t at t=0.15625.
    expect(hermite.activeTransitions[1].crossfadeDuration)
      .toBeCloseTo(0.2166748046875, 8)
  })

  it('pushes multiple transitions in one frame and evaluates oldest to newest', () => {
    const stack = createStateMachineTransitionStack('A', 3)
    startLinear(stack, 'A', 'B', 1)
    startLinear(stack, 'B', 'C', 2)

    expect(stack.activeTransitions).toHaveLength(2)
    expect(stack.activeTransitions[0].usesIntermediatePose).toBe(false)
    expect(stack.activeTransitions[1].usesIntermediatePose).toBe(true)
    expectStateWeights(stack, { A: 1, B: 0, C: 0 })

    advanceStateMachineTransitionStack(stack, 0.5)
    expect(stack.activeTransitions[0].alpha).toBe(0.5)
    expect(stack.activeTransitions[1].alpha).toBe(0.25)
    expectStateWeights(stack, { A: 0.375, B: 0.375, C: 0.25 })
  })

  it('removes a completed entry and all older entries while newer entries survive', () => {
    const olderFinishes = createStateMachineTransitionStack('A', 3)
    startLinear(olderFinishes, 'A', 'B', 0.25)
    startLinear(olderFinishes, 'B', 'C', 1)

    expect(advanceStateMachineTransitionStack(olderFinishes, 0.25)).toBe(1)
    expect(olderFinishes.activeTransitions).toHaveLength(1)
    expect(olderFinishes.activeTransitions[0]).toMatchObject({
      previousState: 'B',
      nextState: 'C',
      alpha: 0.25,
      usesIntermediatePose: false,
    })
    expectStateWeights(olderFinishes, { A: 0, B: 0.75, C: 0.25 })

    const newerFinishes = createStateMachineTransitionStack('A', 3)
    startLinear(newerFinishes, 'A', 'B', 1)
    startLinear(newerFinishes, 'B', 'C', 0.25)

    expect(advanceStateMachineTransitionStack(newerFinishes, 0.25)).toBe(2)
    expect(newerFinishes.activeTransitions).toHaveLength(0)
    expectStateWeights(newerFinishes, { A: 0, B: 0, C: 1 })
  })

  it('keeps scalar state weights normalized across an interrupted chain', () => {
    const stack = createStateMachineTransitionStack('A', 3)
    const states = ['A', 'B', 'C', 'D'] as const
    const weights = new Float32Array(states.length)

    startLinear(stack, 'A', 'B', 2)
    startLinear(stack, 'B', 'C', 3)
    startLinear(stack, 'C', 'D', 4)
    for (const deltaTime of [0, 0.125, 0.25, 0.5, 0.75]) {
      advanceStateMachineTransitionStack(stack, deltaTime)
      expect(writeStateMachineStateWeights(stack, states, weights))
        .toBe(weights)
      expect([...weights].reduce((sum, weight) => sum + weight, 0))
        .toBeCloseTo(1, 6)
    }
  })

  it('matches UE WeightFactor bone weighting and normalization', () => {
    const stack = createStateMachineTransitionStack('A', 3)
    startStateMachineStandardTransition(stack, {
      from: 'A',
      to: 'B',
      duration: 1,
      blendOption: 'Linear',
      blendProfile: weightedProfile,
    })
    advanceStateMachineTransitionStack(stack, 0.25)

    const transition = stack.activeTransitions[0]
    expect(transition.alpha).toBe(0.25)
    expect([...transition.nextPoseMask]).toEqual([
      0.25,
      expect.closeTo(4 / 7, 7),
      expect.closeTo(1 / 13, 7),
    ])
    expect([...transition.previousPoseMask]).toEqual([
      0.75,
      expect.closeTo(3 / 7, 7),
      expect.closeTo(12 / 13, 7),
    ])
    for (let bone = 0; bone < 3; bone++) {
      expect(
        transition.previousPoseMask[bone]
        + transition.nextPoseMask[bone],
      ).toBeCloseTo(1, 6)
    }

    // State relevance and curve/attribute blending stay on the scalar transition alpha.
    expectStateWeights(stack, { A: 0.75, B: 0.25 })
  })

  it('applies crossfade adjustment before target-weight duration scaling', () => {
    const stack = createStateMachineTransitionStack('A', 3)
    startLinear(stack, 'A', 'B', 1)
    advanceStateMachineTransitionStack(stack, 0.25)
    startStateMachineStandardTransition(stack, {
      from: 'B',
      to: 'A',
      duration: 1,
      crossfadeTimeAdjustment: 0.2,
      blendOption: 'Linear',
      blendProfile: uniformProfile,
    })
    expect(stack.activeTransitions[1].crossfadeDuration).toBeCloseTo(0.2, 8)
  })

  it('takes zero-duration transitions at the update boundary', () => {
    const stack = createStateMachineTransitionStack('A', 3)
    expect(startLinear(stack, 'A', 'B', 0)).toBe('started')
    expect(stack.currentState).toBe('B')
    expect(stack.activeTransitions).toHaveLength(1)
    expect(advanceStateMachineTransitionStack(stack, 0)).toBe(1)
    expectStateWeights(stack, { A: 0, B: 1 })
  })

  it('rejects invalid state, time, capacity, profile, and output inputs', () => {
    expect(() => createStateMachineTransitionStack('A', 0))
      .toThrow('bone count must be a positive integer')
    expect(() => createStateMachineTransitionStack('A', 3, -1))
      .toThrow('preallocated transition count')

    const stack = createStateMachineTransitionStack('A', 3)
    expect(() => startLinear(stack, 'B', 'C', 1))
      .toThrow('source does not match the current state')
    expect(startLinear(stack, 'A', 'A', 1)).toBe('alreadyCurrent')
    expect(() => startLinear(stack, 'A', 'B', Number.NaN))
      .toThrow('duration must be finite')
    expect(() => startStateMachineStandardTransition(stack, {
      from: 'A',
      to: 'B',
      duration: 1,
      crossfadeTimeAdjustment: -0.1,
      blendOption: 'Linear',
      blendProfile: null,
    })).toThrow('time adjustment')
    expect(() => startStateMachineStandardTransition(stack, {
      from: 'A',
      to: 'B',
      duration: 1,
      blendOption: 'Linear',
      blendProfile: {
        mode: 'WeightFactor',
        blendScales: new Float32Array([1, 2]),
      },
    })).toThrow('incompatible bone count')
    expect(() => startStateMachineStandardTransition(stack, {
      from: 'A',
      to: 'B',
      duration: 1,
      blendOption: 'Linear',
      blendProfile: {
        mode: 'WeightFactor',
        blendScales: new Float32Array([1, Number.NaN, 1]),
      },
    })).toThrow('invalid weight factor')
    expect(() => advanceStateMachineTransitionStack(stack, -0.01))
      .toThrow('delta time must be finite')
    expect(() => writeStateMachineStateWeights(
      stack,
      ['A', 'B'],
      new Float32Array(1),
    )).toThrow('incompatible length')
  })
})
