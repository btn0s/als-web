const TWO_PI = 2 * Math.PI

/**
 * VERIFIED against the UE 5.5 EngineCameras implementation used by ALS Refactored 4.15:
 * `EngineCameras/Private/Shakes/WaveOscillatorCameraShakePattern.cpp`,
 * `EngineCameras/Public/Shakes/WaveOscillatorCameraShakePattern.h`, and
 * `Engine/Private/Camera/CameraShakeBase.cpp`.
 */

/**
 * `EInitialWaveOscillatorOffsetType` from EngineCameras.
 *
 * Unreal's default is Random. A random offset is a phase in [0, 2π); Zero starts at phase zero.
 */
export type InitialWaveOscillatorOffsetType = 'Random' | 'Zero'

export interface FWaveOscillator {
  readonly Amplitude: number
  readonly Frequency: number
  readonly InitialOffsetType: InitialWaveOscillatorOffsetType
}

export interface FVector3f {
  x: number
  y: number
  z: number
}

export interface FRotator3f {
  pitch: number
  yaw: number
  roll: number
}

/**
 * Fully resolved `UWaveOscillatorCameraShakePattern` settings.
 *
 * Field names intentionally follow the EngineCameras class. Location values remain in Unreal
 * units (centimetres), rotation values are degrees, and Frequency is cycles per second.
 */
export interface WaveOscillatorCameraShakePatternSettings {
  readonly Duration: number
  readonly BlendInTime: number
  readonly BlendOutTime: number
  readonly LocationAmplitudeMultiplier: number
  readonly LocationFrequencyMultiplier: number
  readonly X: Readonly<FWaveOscillator>
  readonly Y: Readonly<FWaveOscillator>
  readonly Z: Readonly<FWaveOscillator>
  readonly RotationAmplitudeMultiplier: number
  readonly RotationFrequencyMultiplier: number
  readonly Pitch: Readonly<FWaveOscillator>
  readonly Yaw: Readonly<FWaveOscillator>
  readonly Roll: Readonly<FWaveOscillator>
  readonly FOV: Readonly<FWaveOscillator>
}

export interface FCameraShakePatternUpdateResult {
  readonly Location: FVector3f
  readonly Rotation: FRotator3f
  FOV: number
}

export interface FCameraShakePatternStartParams {
  readonly bIsRestarting?: boolean
}

/** `FMath::FRand()`-compatible source returning a value in [0, 1). */
export type CameraShakeRandomSource = () => number

export const FWAVE_OSCILLATOR_DEFAULTS:
Readonly<FWaveOscillator> = Object.freeze({
  Amplitude: 1,
  Frequency: 1,
  InitialOffsetType: 'Random',
})

/**
 * UE 5.5 `USimpleCameraShakePattern` constructor defaults.
 *
 * Duration <= 0 means infinite; non-positive blend times disable their respective blend.
 */
export const SIMPLE_CAMERA_SHAKE_PATTERN_DEFAULTS = Object.freeze({
  Duration: 1,
  BlendInTime: 0.2,
  BlendOutTime: 0.2,
})

/**
 * UE 5.5 `UWaveOscillatorCameraShakePattern` constructor defaults after its constructor body.
 *
 * The C++ constructor changes RotationAmplitudeMultiplier from its field initializer to zero and
 * changes FOV.Amplitude to zero. All location oscillators remain active by default.
 */
export const WAVE_OSCILLATOR_CAMERA_SHAKE_PATTERN_DEFAULTS:
Readonly<WaveOscillatorCameraShakePatternSettings> = Object.freeze({
  ...SIMPLE_CAMERA_SHAKE_PATTERN_DEFAULTS,
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
  FOV: Object.freeze({
    ...FWAVE_OSCILLATOR_DEFAULTS,
    Amplitude: 0,
  }),
})

function copyOscillator(
  oscillator: Readonly<FWaveOscillator>,
): FWaveOscillator {
  return { ...oscillator }
}

/** Creates a mutable, non-aliased copy of the resolved UE constructor defaults. */
export function createWaveOscillatorCameraShakePatternDefaults():
WaveOscillatorCameraShakePatternSettings {
  const defaults = WAVE_OSCILLATOR_CAMERA_SHAKE_PATTERN_DEFAULTS
  return {
    ...defaults,
    X: copyOscillator(defaults.X),
    Y: copyOscillator(defaults.Y),
    Z: copyOscillator(defaults.Z),
    Pitch: copyOscillator(defaults.Pitch),
    Yaw: copyOscillator(defaults.Yaw),
    Roll: copyOscillator(defaults.Roll),
    FOV: copyOscillator(defaults.FOV),
  }
}

export function createCameraShakePatternUpdateResult():
FCameraShakePatternUpdateResult {
  return {
    Location: { x: 0, y: 0, z: 0 },
    Rotation: { pitch: 0, yaw: 0, roll: 0 },
    FOV: 0,
  }
}

export interface InitializedWaveOscillator {
  readonly InitialOffset: number
  readonly Value: number
}

/** Exact `FWaveOscillator::Initialize()`. */
export function initializeWaveOscillator(
  oscillator: Readonly<FWaveOscillator>,
  randomSource: CameraShakeRandomSource,
): InitializedWaveOscillator {
  const initialOffset = oscillator.InitialOffsetType === 'Random'
    ? randomSource() * TWO_PI
    : 0
  return {
    InitialOffset: initialOffset,
    Value: oscillator.Amplitude * Math.sin(initialOffset),
  }
}

export interface UpdatedWaveOscillator {
  readonly CurrentOffset: number
  readonly Value: number
}

/** Exact `FWaveOscillator::Update()`. */
export function updateWaveOscillator(
  oscillator: Readonly<FWaveOscillator>,
  deltaTime: number,
  amplitudeMultiplier: number,
  frequencyMultiplier: number,
  currentOffset: number,
): UpdatedWaveOscillator {
  const totalAmplitude = oscillator.Amplitude * amplitudeMultiplier
  if (totalAmplitude !== 0) {
    const nextOffset = currentOffset
      + deltaTime * oscillator.Frequency * frequencyMultiplier * TWO_PI
    return {
      CurrentOffset: nextOffset,
      Value: totalAmplitude * Math.sin(nextOffset),
    }
  }
  return {
    CurrentOffset: currentOffset,
    Value: 0,
  }
}

interface CameraShakeState {
  elapsedTime: number
  currentBlendInTime: number
  currentBlendOutTime: number
  isBlendingIn: boolean
  isBlendingOut: boolean
  isPlaying: boolean
  hasBlendIn: boolean
  hasBlendOut: boolean
  duration: number
  blendIn: number
  blendOut: number
}

function createCameraShakeState(): CameraShakeState {
  return {
    elapsedTime: 0,
    currentBlendInTime: 0,
    currentBlendOutTime: 0,
    isBlendingIn: false,
    isBlendingOut: false,
    isPlaying: false,
    hasBlendIn: false,
    hasBlendOut: false,
    duration: 0,
    blendIn: 0,
    blendOut: 0,
  }
}

function startCameraShakeState(
  state: CameraShakeState,
  settings: Readonly<WaveOscillatorCameraShakePatternSettings>,
) {
  const previous = { ...state }

  state.duration = settings.Duration
  state.blendIn = settings.BlendInTime
  state.blendOut = settings.BlendOutTime
  state.hasBlendIn = state.blendIn > 0
  state.hasBlendOut = state.blendOut > 0
  state.elapsedTime = 0
  state.currentBlendInTime = 0
  state.currentBlendOutTime = 0
  state.isBlendingIn = state.hasBlendIn
  state.isBlendingOut = false
  state.isPlaying = true

  if (previous.isPlaying) {
    if (
      state.hasBlendIn
      && previous.hasBlendOut
      && previous.isBlendingOut
    ) {
      state.currentBlendInTime = state.blendIn * (
        1 - previous.currentBlendOutTime / previous.blendOut
      )
    } else if (state.hasBlendIn && !previous.hasBlendOut) {
      state.isBlendingIn = false
    }
  }
}

/** Exact managed-duration and linear blend update from `FCameraShakeState::Update()`. */
function updateCameraShakeState(
  state: CameraShakeState,
  deltaTime: number,
): number {
  let blendingWeight = 1

  state.elapsedTime += deltaTime
  if (state.isBlendingIn) {
    state.currentBlendInTime += deltaTime
  }
  if (state.isBlendingOut) {
    state.currentBlendOutTime += deltaTime
  }

  if (state.duration > 0) {
    if (state.elapsedTime < 0 || state.elapsedTime >= state.duration) {
      state.isPlaying = false
      return 0
    }

    const durationRemaining = state.duration - state.elapsedTime
    if (
      state.hasBlendOut
      && !state.isBlendingOut
      && durationRemaining < state.blendOut
    ) {
      state.isBlendingOut = true
      state.currentBlendOutTime = state.blendOut - durationRemaining
    }
  }

  if (state.hasBlendIn && state.isBlendingIn) {
    if (state.currentBlendInTime < state.blendIn) {
      blendingWeight *= state.currentBlendInTime / state.blendIn
    } else {
      state.isBlendingIn = false
      state.currentBlendInTime = state.blendIn
    }
  }

  if (state.hasBlendOut && state.isBlendingOut) {
    if (state.currentBlendOutTime < state.blendOut) {
      blendingWeight *= 1 - state.currentBlendOutTime / state.blendOut
    } else {
      state.isBlendingOut = false
      state.currentBlendOutTime = state.blendOut
      state.isPlaying = false
      return 0
    }
  }

  return blendingWeight
}

function stopCameraShakeState(
  state: CameraShakeState,
  immediately: boolean,
) {
  if (immediately || !state.hasBlendOut) {
    state.isPlaying = false
  } else if (!state.isBlendingOut) {
    state.isBlendingOut = true
    state.currentBlendOutTime = 0
  }
}

function scaleResult(
  result: FCameraShakePatternUpdateResult,
  scale: number,
) {
  result.Location.x *= scale
  result.Location.y *= scale
  result.Location.z *= scale
  result.Rotation.pitch *= scale
  result.Rotation.yaw *= scale
  result.Rotation.roll *= scale
  result.FOV *= scale
}

/**
 * Stateful port of UE 5.5 `UWaveOscillatorCameraShakePattern`.
 *
 * `StartShakePattern()` consumes random phases in X, Y, Z, Pitch, Yaw, Roll, FOV order. A restart
 * preserves those phases, matching single-instance camera-shake restart behavior.
 */
export class WaveOscillatorCameraShakePattern {
  readonly Settings: Readonly<WaveOscillatorCameraShakePatternSettings>

  private readonly randomSource: CameraShakeRandomSource
  private state = createCameraShakeState()

  private initialLocationOffset: FVector3f = { x: 0, y: 0, z: 0 }
  private currentLocationOffset: FVector3f = { x: 0, y: 0, z: 0 }
  private initialRotationOffset: FVector3f = { x: 0, y: 0, z: 0 }
  private currentRotationOffset: FVector3f = { x: 0, y: 0, z: 0 }
  private initialFovOffset = 0
  private currentFovOffset = 0

  constructor(
    settings: Readonly<WaveOscillatorCameraShakePatternSettings>,
    randomSource: CameraShakeRandomSource = Math.random,
  ) {
    this.Settings = settings
    this.randomSource = randomSource
  }

  StartShakePattern(params: Readonly<FCameraShakePatternStartParams> = {}) {
    startCameraShakeState(this.state, this.Settings)

    if (!params.bIsRestarting) {
      this.initialLocationOffset.x = initializeWaveOscillator(
        this.Settings.X,
        this.randomSource,
      ).InitialOffset
      this.initialLocationOffset.y = initializeWaveOscillator(
        this.Settings.Y,
        this.randomSource,
      ).InitialOffset
      this.initialLocationOffset.z = initializeWaveOscillator(
        this.Settings.Z,
        this.randomSource,
      ).InitialOffset
      this.currentLocationOffset = { ...this.initialLocationOffset }

      this.initialRotationOffset.x = initializeWaveOscillator(
        this.Settings.Pitch,
        this.randomSource,
      ).InitialOffset
      this.initialRotationOffset.y = initializeWaveOscillator(
        this.Settings.Yaw,
        this.randomSource,
      ).InitialOffset
      this.initialRotationOffset.z = initializeWaveOscillator(
        this.Settings.Roll,
        this.randomSource,
      ).InitialOffset
      this.currentRotationOffset = { ...this.initialRotationOffset }

      this.initialFovOffset = initializeWaveOscillator(
        this.Settings.FOV,
        this.randomSource,
      ).InitialOffset
      this.currentFovOffset = this.initialFovOffset
    }
  }

  UpdateShakePattern(
    deltaTime: number,
    outResult: FCameraShakePatternUpdateResult,
  ): FCameraShakePatternUpdateResult {
    const x = updateWaveOscillator(
      this.Settings.X,
      deltaTime,
      this.Settings.LocationAmplitudeMultiplier,
      this.Settings.LocationFrequencyMultiplier,
      this.currentLocationOffset.x,
    )
    const y = updateWaveOscillator(
      this.Settings.Y,
      deltaTime,
      this.Settings.LocationAmplitudeMultiplier,
      this.Settings.LocationFrequencyMultiplier,
      this.currentLocationOffset.y,
    )
    const z = updateWaveOscillator(
      this.Settings.Z,
      deltaTime,
      this.Settings.LocationAmplitudeMultiplier,
      this.Settings.LocationFrequencyMultiplier,
      this.currentLocationOffset.z,
    )
    this.currentLocationOffset.x = x.CurrentOffset
    this.currentLocationOffset.y = y.CurrentOffset
    this.currentLocationOffset.z = z.CurrentOffset
    outResult.Location.x = x.Value
    outResult.Location.y = y.Value
    outResult.Location.z = z.Value

    const pitch = updateWaveOscillator(
      this.Settings.Pitch,
      deltaTime,
      this.Settings.RotationAmplitudeMultiplier,
      this.Settings.RotationFrequencyMultiplier,
      this.currentRotationOffset.x,
    )
    const yaw = updateWaveOscillator(
      this.Settings.Yaw,
      deltaTime,
      this.Settings.RotationAmplitudeMultiplier,
      this.Settings.RotationFrequencyMultiplier,
      this.currentRotationOffset.y,
    )
    const roll = updateWaveOscillator(
      this.Settings.Roll,
      deltaTime,
      this.Settings.RotationAmplitudeMultiplier,
      this.Settings.RotationFrequencyMultiplier,
      this.currentRotationOffset.z,
    )
    this.currentRotationOffset.x = pitch.CurrentOffset
    this.currentRotationOffset.y = yaw.CurrentOffset
    this.currentRotationOffset.z = roll.CurrentOffset
    outResult.Rotation.pitch = pitch.Value
    outResult.Rotation.yaw = yaw.Value
    outResult.Rotation.roll = roll.Value

    const fov = updateWaveOscillator(
      this.Settings.FOV,
      deltaTime,
      1,
      1,
      this.currentFovOffset,
    )
    this.currentFovOffset = fov.CurrentOffset
    outResult.FOV = fov.Value

    scaleResult(
      outResult,
      updateCameraShakeState(this.state, deltaTime),
    )
    return outResult
  }

  IsFinished() {
    return !this.state.isPlaying
  }

  StopShakePattern(bImmediately = true) {
    stopCameraShakeState(this.state, bImmediately)
  }

  TeardownShakePattern() {
    this.state = createCameraShakeState()
  }
}
