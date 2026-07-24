import { describe, expect, it, vi } from 'vitest'
import {
  createCameraShakePatternUpdateResult,
  createWaveOscillatorCameraShakePatternDefaults,
  FWAVE_OSCILLATOR_DEFAULTS,
  initializeWaveOscillator,
  SIMPLE_CAMERA_SHAKE_PATTERN_DEFAULTS,
  updateWaveOscillator,
  WAVE_OSCILLATOR_CAMERA_SHAKE_PATTERN_DEFAULTS,
  WaveOscillatorCameraShakePattern,
} from './WaveOscillatorCameraShakePattern'

function zeroRandom() {
  return 0
}

describe('VERIFIED UE 5.5 FWaveOscillator', () => {
  it('freezes every constructor default used by absent asset properties', () => {
    expect(FWAVE_OSCILLATOR_DEFAULTS).toEqual({
      Amplitude: 1,
      Frequency: 1,
      InitialOffsetType: 'Random',
    })
    expect(SIMPLE_CAMERA_SHAKE_PATTERN_DEFAULTS).toEqual({
      Duration: 1,
      BlendInTime: 0.2,
      BlendOutTime: 0.2,
    })
    expect(WAVE_OSCILLATOR_CAMERA_SHAKE_PATTERN_DEFAULTS).toEqual({
      Duration: 1,
      BlendInTime: 0.2,
      BlendOutTime: 0.2,
      LocationAmplitudeMultiplier: 1,
      LocationFrequencyMultiplier: 1,
      X: FWAVE_OSCILLATOR_DEFAULTS,
      Y: FWAVE_OSCILLATOR_DEFAULTS,
      Z: FWAVE_OSCILLATOR_DEFAULTS,
      RotationAmplitudeMultiplier: 0,
      RotationFrequencyMultiplier: 1,
      Pitch: FWAVE_OSCILLATOR_DEFAULTS,
      Yaw: FWAVE_OSCILLATOR_DEFAULTS,
      Roll: FWAVE_OSCILLATOR_DEFAULTS,
      FOV: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Random',
      },
    })

    const first = createWaveOscillatorCameraShakePatternDefaults()
    const second = createWaveOscillatorCameraShakePatternDefaults()
    expect(first).not.toBe(second)
    expect(first.X).not.toBe(second.X)
    expect(first.Pitch).not.toBe(second.Pitch)
    expect(first.FOV).not.toBe(second.FOV)
  })

  it('initializes Random over [0, 2π) and Zero at phase zero', () => {
    const randomSource = vi.fn(() => 0.25)
    expect(
      initializeWaveOscillator(
        {
          Amplitude: 2,
          Frequency: 3,
          InitialOffsetType: 'Random',
        },
        randomSource,
      ),
    ).toEqual({
      InitialOffset: Math.PI / 2,
      Value: 2,
    })
    expect(randomSource).toHaveBeenCalledOnce()

    expect(
      initializeWaveOscillator(
        {
          Amplitude: 2,
          Frequency: 3,
          InitialOffsetType: 'Zero',
        },
        randomSource,
      ),
    ).toEqual({
      InitialOffset: 0,
      Value: 0,
    })
    expect(randomSource).toHaveBeenCalledOnce()
  })

  it('advances cycles per second by 2π and skips phase work at zero amplitude', () => {
    expect(
      updateWaveOscillator(
        {
          Amplitude: 2,
          Frequency: 0.5,
          InitialOffsetType: 'Zero',
        },
        0.5,
        3,
        2,
        0,
      ),
    ).toEqual({
      CurrentOffset: Math.PI,
      Value: expect.closeTo(0, 14),
    })

    expect(
      updateWaveOscillator(
        {
          Amplitude: 0,
          Frequency: 100,
          InitialOffsetType: 'Random',
        },
        1,
        1,
        1,
        1.25,
      ),
    ).toEqual({
      CurrentOffset: 1.25,
      Value: 0,
    })
  })
})

describe('VERIFIED UE 5.5 UWaveOscillatorCameraShakePattern', () => {
  it('consumes seven phases in engine order and preserves them on restart', () => {
    const randomSource = vi.fn(zeroRandom)
    const pattern = new WaveOscillatorCameraShakePattern(
      createWaveOscillatorCameraShakePatternDefaults(),
      randomSource,
    )

    pattern.StartShakePattern()
    expect(randomSource).toHaveBeenCalledTimes(7)

    pattern.StartShakePattern({ bIsRestarting: true })
    expect(randomSource).toHaveBeenCalledTimes(7)
  })

  it('updates oscillators before applying exact linear blend-in/out state', () => {
    const settings = createWaveOscillatorCameraShakePatternDefaults()
    const pattern = new WaveOscillatorCameraShakePattern({
      ...settings,
      Duration: 0.2,
      BlendInTime: 0.1,
      BlendOutTime: 0.1,
      RotationAmplitudeMultiplier: 1,
      Pitch: {
        ...settings.Pitch,
        Amplitude: 0.1,
        Frequency: 0.1,
      },
      Yaw: {
        ...settings.Yaw,
        Amplitude: 0.1,
        Frequency: 0.1,
      },
      Roll: {
        ...settings.Roll,
        Amplitude: 0.1,
        Frequency: 0.1,
      },
    }, zeroRandom)
    const result = createCameraShakePatternUpdateResult()
    pattern.StartShakePattern()

    expect(pattern.UpdateShakePattern(0.05, result)).toBe(result)
    const locationAt005 = Math.sin(0.05 * 2 * Math.PI) * 0.5
    const rotationAt005 =
      0.1 * Math.sin(0.05 * 0.1 * 2 * Math.PI) * 0.5
    expect(result.Location).toEqual({
      x: expect.closeTo(locationAt005, 12),
      y: expect.closeTo(locationAt005, 12),
      z: expect.closeTo(locationAt005, 12),
    })
    expect(result.Rotation).toEqual({
      pitch: expect.closeTo(rotationAt005, 12),
      yaw: expect.closeTo(rotationAt005, 12),
      roll: expect.closeTo(rotationAt005, 12),
    })
    expect(result.FOV).toBe(0)
    expect(pattern.IsFinished()).toBe(false)

    pattern.UpdateShakePattern(0.05, result)
    expect(result.Location.x).toBeCloseTo(
      Math.sin(0.1 * 2 * Math.PI),
      12,
    )

    pattern.UpdateShakePattern(0.05, result)
    expect(result.Location.x).toBeCloseTo(
      Math.sin(0.15 * 2 * Math.PI) * 0.5,
      12,
    )

    pattern.UpdateShakePattern(0.05, result)
    expect(result).toEqual({
      Location: { x: 0, y: 0, z: 0 },
      Rotation: { pitch: 0, yaw: 0, roll: 0 },
      FOV: 0,
    })
    expect(pattern.IsFinished()).toBe(true)
  })

  it('treats non-positive duration as infinite and honors graceful blend-out', () => {
    const settings = createWaveOscillatorCameraShakePatternDefaults()
    const pattern = new WaveOscillatorCameraShakePattern({
      ...settings,
      Duration: 0,
      BlendInTime: 0,
      BlendOutTime: 0.1,
    }, zeroRandom)
    const result = createCameraShakePatternUpdateResult()
    pattern.StartShakePattern()

    pattern.UpdateShakePattern(10, result)
    expect(pattern.IsFinished()).toBe(false)

    pattern.StopShakePattern(false)
    pattern.UpdateShakePattern(0.05, result)
    expect(result.Location.x).toBeCloseTo(
      Math.sin(10.05 * 2 * Math.PI) * 0.5,
      12,
    )
    expect(pattern.IsFinished()).toBe(false)

    pattern.UpdateShakePattern(0.05, result)
    expect(pattern.IsFinished()).toBe(true)
  })
})
