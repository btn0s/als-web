import { describe, expect, it, vi } from 'vitest'
import {
  ALS_JUMP_MAX_PLAY_RATE,
  ALS_JUMP_MIN_PLAY_RATE,
  adaptGroundPredictionSweepHit,
  createAlsInAirState,
  jump,
  refreshInAir,
  refreshInAirOnGameThread,
  refreshGroundPrediction,
} from './AlsInAirState'
import type {
  AlsGroundPredictionInput,
  AlsGroundPredictionSweepHitInput,
  AlsGroundPredictionSweepQuery,
} from './AlsInAirState'

interface CppVector {
  X: number
  Y: number
  Z: number
}

interface CppGroundPredictionInput {
  VerticalVelocity: number
  Velocity: CppVector
  Scale: number
  GroundPredictionBlockCurveValue: number
  WalkableFloorAngleCos: number
  Hit: {
    bValidBlockingHit: boolean
    Time: number
    ImpactNormal: CppVector
  } | null
  GroundPredictionAmountCurveValue: (hitTime: number) => number
}

interface CppGroundPredictionResult {
  GroundPredictionAmount: number
  SweepVector: CppVector
  bSweepPerformed: boolean
}

/**
 * Test-only, line-mirroring transliteration of
 * UAlsAnimationInstance::RefreshGroundPrediction(), AlsAnimationInstance.cpp:1028-1100.
 *
 * Inputs and outputs deliberately remain in Unreal's native cm / cm/s domain.
 */
function cppRefreshGroundPrediction(
  input: CppGroundPredictionInput,
): CppGroundPredictionResult {
  const VerticalVelocityThreshold = -200.0

  if (input.VerticalVelocity > VerticalVelocityThreshold) {
    return {
      GroundPredictionAmount: 0.0,
      SweepVector: { X: 0.0, Y: 0.0, Z: 0.0 },
      bSweepPerformed: false,
    }
  }

  const AllowanceAmount = 1.0 - Math.min(
    1.0,
    Math.max(0.0, input.GroundPredictionBlockCurveValue),
  )
  const UE_KINDA_SMALL_NUMBER = 1e-4
  if (AllowanceAmount <= UE_KINDA_SMALL_NUMBER) {
    return {
      GroundPredictionAmount: 0.0,
      SweepVector: { X: 0.0, Y: 0.0, Z: 0.0 },
      bSweepPerformed: false,
    }
  }

  const MinVerticalVelocity = -4000.0
  const MaxVerticalVelocity = -200.0

  const VelocityDirection = {
    X: input.Velocity.X,
    Y: input.Velocity.Y,
    Z: Math.min(
      MaxVerticalVelocity,
      Math.max(MinVerticalVelocity, input.Velocity.Z),
    ),
  }
  const DirectionSizeSquared =
    VelocityDirection.X * VelocityDirection.X
    + VelocityDirection.Y * VelocityDirection.Y
    + VelocityDirection.Z * VelocityDirection.Z
  const UE_SMALL_NUMBER = 1e-8
  if (DirectionSizeSquared > UE_SMALL_NUMBER) {
    const InverseDirectionSize = 1.0 / Math.sqrt(DirectionSizeSquared)
    VelocityDirection.X *= InverseDirectionSize
    VelocityDirection.Y *= InverseDirectionSize
    VelocityDirection.Z *= InverseDirectionSize
  } else {
    VelocityDirection.X = 0.0
    VelocityDirection.Y = 0.0
    VelocityDirection.Z = 0.0
  }

  const MinSweepDistance = 150.0
  const MaxSweepDistance = 2000.0
  const SweepDistanceAlpha = Math.min(1.0, Math.max(
    0.0,
    (input.VerticalVelocity - MaxVerticalVelocity)
      / (MinVerticalVelocity - MaxVerticalVelocity),
  ))
  const SweepDistance = (
    MinSweepDistance
    + (MaxSweepDistance - MinSweepDistance) * SweepDistanceAlpha
  ) * input.Scale
  const SweepVector = {
    X: VelocityDirection.X * SweepDistance,
    Y: VelocityDirection.Y * SweepDistance,
    Z: VelocityDirection.Z * SweepDistance,
  }

  const bGroundValid = input.Hit !== null
    && input.Hit.bValidBlockingHit
    && input.Hit.ImpactNormal.Z >= input.WalkableFloorAngleCos

  return {
    GroundPredictionAmount: bGroundValid
      ? input.GroundPredictionAmountCurveValue(input.Hit!.Time)
        * AllowanceAmount
      : 0.0,
    SweepVector,
    bSweepPerformed: true,
  }
}

const VALID_HIT: AlsGroundPredictionSweepHitInput = {
  validBlockingHit: true,
  time: 0.25,
  impactNormal: { x: 0, y: 0, z: 1 },
}

function createInput(
  overrides: Partial<AlsGroundPredictionInput> = {},
): AlsGroundPredictionInput {
  return {
    location: { x: 2, y: -3, z: 5 },
    velocity: { x: 0, y: 0, z: -2 },
    scale: 1,
    capsuleRadius: 0.3,
    capsuleHalfHeight: 0.9,
    walkableFloorAngleCos: 0.7,
    groundPredictionBlockCurveValue: 0,
    groundPredictionAmountCurve: (hitTime) => 1 - hitTime,
    sweepCapsule: () => VALID_HIT,
    ...overrides,
  }
}

describe('FAlsInAirState parity', () => {
  it('initializes every field from the ALS state header', () => {
    expect(createAlsInAirState()).toEqual({
      verticalVelocity: 0,
      jumpRequested: false,
      jumped: false,
      jumpPlayRate: 1,
      groundPredictionAmount: 1,
    })
  })
})

describe('ALS jump and RefreshInAir lifecycle', () => {
  it('latches a requested jump once and consumes the request every game-thread frame', () => {
    const state = createAlsInAirState()

    jump(state)
    expect(state.jumpRequested).toBe(true)
    refreshInAirOnGameThread(state, false)
    expect(state.jumpRequested).toBe(false)
    expect(state.jumped).toBe(true)

    refreshInAirOnGameThread(state, false)
    expect(state.jumped).toBe(true)
    refreshInAir(state, { speed: 3, verticalVelocity: 4.2 })
    expect(state.jumped).toBe(false)
    expect(state.jumpPlayRate).toBeCloseTo(1.35, 15)
    expect(state.verticalVelocity).toBe(4.2)

    refreshInAir(state, { speed: 6, verticalVelocity: -1.25 })
    expect(state.jumpPlayRate).toBeCloseTo(1.35, 15)
    expect(state.verticalVelocity).toBe(-1.25)
  })

  it('drops both old and newly requested jump latches during a pending update', () => {
    const state = createAlsInAirState()
    state.jumped = true
    jump(state)

    refreshInAirOnGameThread(state, true)

    expect(state.jumpRequested).toBe(false)
    expect(state.jumped).toBe(false)
  })

  it.each([
    [-3, ALS_JUMP_MIN_PLAY_RATE],
    [0, ALS_JUMP_MIN_PLAY_RATE],
    [3, 1.35],
    [6, ALS_JUMP_MAX_PLAY_RATE],
    [12, ALS_JUMP_MAX_PLAY_RATE],
  ])('maps %s m/s to the exact clamped jump play rate %s', (
    speed,
    expectedPlayRate,
  ) => {
    const state = createAlsInAirState()
    state.jumped = true

    refreshInAir(state, { speed, verticalVelocity: -2 })

    expect(state.jumpPlayRate).toBeCloseTo(expectedPlayRate, 15)
    expect(state.verticalVelocity).toBe(-2)
  })
})

describe('ALS RefreshGroundPrediction', () => {
  it('early-outs strictly above -200 cm/s without sweeping or sampling a curve', () => {
    const sweepCapsule = vi.fn(() => VALID_HIT)
    const groundPredictionAmountCurve = vi.fn(() => 1)
    const state = createAlsInAirState()
    state.groundPredictionAmount = 0.75
    state.verticalVelocity = -2 + 1e-9

    expect(refreshGroundPrediction(state, createInput({
      sweepCapsule,
      groundPredictionAmountCurve,
    }))).toEqual({
      groundPredictionAmount: 0,
      sweepVector: { x: 0, y: 0, z: 0 },
    })
    expect(state.groundPredictionAmount).toBe(0)
    expect(sweepCapsule).not.toHaveBeenCalled()
    expect(groundPredictionAmountCurve).not.toHaveBeenCalled()

    state.verticalVelocity = -2
    refreshGroundPrediction(state, createInput({
      sweepCapsule,
      groundPredictionAmountCurve,
    }))
    expect(sweepCapsule).toHaveBeenCalledOnce()
    expect(groundPredictionAmountCurve).toHaveBeenCalledOnce()
  })

  it('clamps GroundPredictionBlock before applying the exact allowance early-out', () => {
    const state = createAlsInAirState()
    state.verticalVelocity = -10
    const sweepCapsule = vi.fn(() => VALID_HIT)

    refreshGroundPrediction(state, createInput({
      groundPredictionBlockCurveValue: 2,
      sweepCapsule,
    }))
    refreshGroundPrediction(state, createInput({
      groundPredictionBlockCurveValue: 1 - 0.5e-4,
      sweepCapsule,
    }))
    expect(sweepCapsule).not.toHaveBeenCalled()

    const negativeBlockResult = refreshGroundPrediction(state, createInput({
      groundPredictionBlockCurveValue: -2,
      sweepCapsule,
      groundPredictionAmountCurve: () => 0.75,
    }))
    expect(negativeBlockResult.groundPredictionAmount).toBe(0.75)

    const partialBlockResult = refreshGroundPrediction(state, createInput({
      groundPredictionBlockCurveValue: 0.4,
      sweepCapsule,
      groundPredictionAmountCurve: () => 0.75,
    }))
    expect(partialBlockResult.groundPredictionAmount).toBeCloseTo(0.45, 15)
    expect(sweepCapsule).toHaveBeenCalledTimes(2)
  })

  it('maps fall speed to 150..2000 cm and keeps the injected query in metres', () => {
    const queries: AlsGroundPredictionSweepQuery[] = []
    const sweepCapsule = (query: Readonly<AlsGroundPredictionSweepQuery>) => {
      queries.push({
        start: { ...query.start },
        end: { ...query.end },
        capsuleRadius: query.capsuleRadius,
        capsuleHalfHeight: query.capsuleHalfHeight,
      })
      return VALID_HIT
    }
    const state = createAlsInAirState()

    state.verticalVelocity = -2
    expect(refreshGroundPrediction(state, createInput({
      location: { x: 2, y: -3, z: 5 },
      velocity: { x: 0, y: 0, z: 10 },
      scale: 2,
      capsuleRadius: 0.42,
      capsuleHalfHeight: 1.1,
      sweepCapsule,
    })).sweepVector).toEqual({ x: 0, y: 0, z: -3 })
    expect(queries[0]).toEqual({
      start: { x: 2, y: -3, z: 5 },
      end: { x: 2, y: -3, z: 2 },
      capsuleRadius: 0.42,
      capsuleHalfHeight: 1.1,
    })

    state.verticalVelocity = -40
    expect(refreshGroundPrediction(state, createInput({
      location: { x: 0, y: 0, z: 30 },
      velocity: { x: 0, y: 0, z: -100 },
      sweepCapsule,
    })).sweepVector).toEqual({ x: 0, y: 0, z: -20 })

    state.verticalVelocity = -100
    expect(refreshGroundPrediction(state, createInput({
      velocity: { x: 0, y: 0, z: -100 },
      sweepCapsule,
    })).sweepVector).toEqual({ x: 0, y: 0, z: -20 })
  })

  it('clamps only velocity Z for direction while distance follows cached vertical velocity', () => {
    const state = createAlsInAirState()
    state.verticalVelocity = -21

    const result = refreshGroundPrediction(state, createInput({
      velocity: { x: 3, y: 4, z: 10 },
    }))
    const directionLength = Math.sqrt(3 * 3 + 4 * 4 + 2 * 2)
    const sweepDistance = 10.75
    expect(result.sweepVector.x).toBeCloseTo(
      3 / directionLength * sweepDistance,
      12,
    )
    expect(result.sweepVector.y).toBeCloseTo(
      4 / directionLength * sweepDistance,
      12,
    )
    expect(result.sweepVector.z).toBeCloseTo(
      -2 / directionLength * sweepDistance,
      12,
    )
  })

  it('adapts validity and accepts a surface exactly at the walkable cosine', () => {
    const threshold = 0.7
    expect(adaptGroundPredictionSweepHit(null, threshold)).toEqual({
      groundValid: false,
      hitTime: 1,
    })
    expect(adaptGroundPredictionSweepHit({
      validBlockingHit: false,
      time: 0.2,
      impactNormal: { x: 0, y: 0, z: 1 },
    }, threshold)).toEqual({
      groundValid: false,
      hitTime: 0.2,
    })
    expect(adaptGroundPredictionSweepHit({
      validBlockingHit: true,
      time: 1.25,
      impactNormal: { x: 0, y: 0, z: threshold - 1e-9 },
    }, threshold)).toEqual({
      groundValid: false,
      hitTime: 1.25,
    })
    expect(adaptGroundPredictionSweepHit({
      validBlockingHit: true,
      time: 1.25,
      impactNormal: { x: 0, y: 0, z: threshold },
    }, threshold)).toEqual({
      groundValid: true,
      hitTime: 1.25,
    })
  })

  it('samples authored Hit.Time verbatim only for a walkable valid blocking hit', () => {
    const state = createAlsInAirState()
    state.verticalVelocity = -8
    const curve = vi.fn((time: number) => 1.5 - time)

    const validResult = refreshGroundPrediction(state, createInput({
      groundPredictionBlockCurveValue: 0.25,
      groundPredictionAmountCurve: curve,
      sweepCapsule: () => ({
        validBlockingHit: true,
        time: 1.25,
        impactNormal: { x: 0, y: 0, z: 0.7 },
      }),
    }))
    expect(curve).toHaveBeenCalledWith(1.25)
    expect(validResult.groundPredictionAmount).toBeCloseTo(0.1875, 15)

    curve.mockClear()
    const invalidResult = refreshGroundPrediction(state, createInput({
      groundPredictionAmountCurve: curve,
      sweepCapsule: () => ({
        validBlockingHit: true,
        time: 0.2,
        impactNormal: { x: 0, y: 0, z: 0.699999 },
      }),
    }))
    expect(invalidResult.groundPredictionAmount).toBe(0)
    expect(curve).not.toHaveBeenCalled()
  })

  it('matches a seeded C++-domain oracle across branches, units, and hit results', () => {
    let randomState = 0x51a7c0de
    const random = () => {
      randomState |= 0
      randomState = randomState + 0x6d2b79f5 | 0
      let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState)
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
      return ((value ^ value >>> 14) >>> 0) / 4294967296
    }
    const range = (minimum: number, maximum: number) =>
      minimum + (maximum - minimum) * random()

    for (let index = 0; index < 512; index += 1) {
      const verticalVelocity = range(-55, 5)
      const velocity = {
        x: range(-30, 30),
        y: range(-30, 30),
        z: range(-70, 20),
      }
      const scale = range(0.25, 2.5)
      const groundPredictionBlockCurveValue = range(-0.3, 1.3)
      const walkableFloorAngleCos = range(-0.2, 1)
      const hit = random() < 0.15
        ? null
        : {
            validBlockingHit: random() >= 0.2,
            time: range(-0.1, 1.1),
            impactNormal: {
              x: range(-1, 1),
              y: range(-1, 1),
              z: range(-1, 1),
            },
          }
      const curve = (time: number) => 1.1 - 0.8 * time + 0.125 * time * time
      let capturedQuery: AlsGroundPredictionSweepQuery | null = null

      const state = createAlsInAirState()
      state.verticalVelocity = verticalVelocity
      const actual = refreshGroundPrediction(state, createInput({
        location: { x: range(-10, 10), y: range(-10, 10), z: range(-2, 30) },
        velocity,
        scale,
        capsuleRadius: range(0.1, 1),
        capsuleHalfHeight: range(0.2, 2),
        walkableFloorAngleCos,
        groundPredictionBlockCurveValue,
        groundPredictionAmountCurve: curve,
        sweepCapsule: (query) => {
          capturedQuery = query
          return hit
        },
      }))
      const expected = cppRefreshGroundPrediction({
        VerticalVelocity: verticalVelocity * 100,
        Velocity: {
          X: velocity.x * 100,
          Y: velocity.y * 100,
          Z: velocity.z * 100,
        },
        Scale: scale,
        GroundPredictionBlockCurveValue: groundPredictionBlockCurveValue,
        WalkableFloorAngleCos: walkableFloorAngleCos,
        Hit: hit === null
          ? null
          : {
              bValidBlockingHit: hit.validBlockingHit,
              Time: hit.time,
              ImpactNormal: {
                X: hit.impactNormal.x,
                Y: hit.impactNormal.y,
                Z: hit.impactNormal.z,
              },
            },
        GroundPredictionAmountCurveValue: curve,
      })

      expect(actual.groundPredictionAmount).toBeCloseTo(
        expected.GroundPredictionAmount,
        12,
      )
      expect(actual.sweepVector.x * 100).toBeCloseTo(
        expected.SweepVector.X,
        10,
      )
      expect(actual.sweepVector.y * 100).toBeCloseTo(
        expected.SweepVector.Y,
        10,
      )
      expect(actual.sweepVector.z * 100).toBeCloseTo(
        expected.SweepVector.Z,
        10,
      )
      expect(capturedQuery !== null).toBe(expected.bSweepPerformed)
    }
  })
})
