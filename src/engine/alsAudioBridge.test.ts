import { describe, expect, it, vi } from 'vitest'
import {
  ALS_FOOTSTEP_ATTENUATION_FALLOFF_DISTANCE_METRES,
  ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES,
  ALS_FOOTSTEP_AUDIO_MAX_DISTANCE_METRES,
  ALS_FOOTSTEP_NO_REPEATS,
  ALS_FOOTSTEP_WAVE_ASSETS,
  AlsFootstepAudioRuntime,
  AlsFootstepWaveSelector,
  evaluateAlsFootstepAttenuationGain,
  selectAlsFootstepWave,
} from './alsAudioBridge'
import type {
  AlsFootstepAudioFetch,
} from './alsAudioBridge'

class FakeAudioParam {
  value = 0
  readonly writes: { value: number; time: number }[] = []

  setValueAtTime(value: number, time: number): this {
    this.value = value
    this.writes.push({ value, time })
    return this
  }
}

class FakeAudioNode {
  readonly connections: unknown[] = []
  disconnected = false

  connect(destination: unknown): unknown {
    this.connections.push(destination)
    return destination
  }

  disconnect(): void {
    this.disconnected = true
    this.connections.length = 0
  }
}

class FakeBufferSource extends FakeAudioNode {
  buffer: AudioBuffer | null = null
  loop = false
  readonly playbackRate = new FakeAudioParam()
  onended: (() => void) | null = null
  startCount = 0
  stopCount = 0

  start(): void {
    this.startCount++
  }

  stop(): void {
    this.stopCount++
  }

  finish(): void {
    this.onended?.()
  }
}

class FakePanner extends FakeAudioNode {
  panningModel: PanningModelType = 'equalpower'
  distanceModel: DistanceModelType = 'inverse'
  refDistance = 1
  maxDistance = 10_000
  rolloffFactor = 1
  readonly positionX = new FakeAudioParam()
  readonly positionY = new FakeAudioParam()
  readonly positionZ = new FakeAudioParam()
}

class FakeGain extends FakeAudioNode {
  readonly gain = new FakeAudioParam()
}

function fakeAudioListener(): AudioListener {
  return {
    positionX: new FakeAudioParam(),
    positionY: new FakeAudioParam(),
    positionZ: new FakeAudioParam(),
    forwardX: new FakeAudioParam(),
    forwardY: new FakeAudioParam(),
    forwardZ: new FakeAudioParam(),
    upX: new FakeAudioParam(),
    upY: new FakeAudioParam(),
    upZ: new FakeAudioParam(),
  } as unknown as AudioListener
}

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 12.5
  readonly listener = fakeAudioListener()
  readonly destination = new FakeAudioNode()
  readonly sources: FakeBufferSource[] = []
  readonly panners: FakePanner[] = []
  readonly gains: FakeGain[] = []
  readonly decodedBuffers: AudioBuffer[] = []
  resumeCount = 0
  closeCount = 0

  async resume(): Promise<void> {
    this.resumeCount++
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.closeCount++
    this.state = 'closed'
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
    const buffer = Object.freeze({
      duration: 0.75,
      numberOfChannels: 1,
      sampleRate: 48_000,
    }) as unknown as AudioBuffer
    this.decodedBuffers.push(buffer)
    return buffer
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }

  createPanner(): PannerNode {
    const panner = new FakePanner()
    this.panners.push(panner)
    return panner as unknown as PannerNode
  }

  createGain(): GainNode {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain as unknown as GainNode
  }
}

class TrackingEventTarget extends EventTarget {
  private readonly listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >()

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options)
    if (callback === null) return
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(callback)
    this.listeners.set(type, listeners)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options)
    if (callback === null) return
    this.listeners.get(type)?.delete(callback)
  }

  get ActiveListenerCount(): number {
    let count = 0
    for (const listeners of this.listeners.values()) {
      count += listeners.size
    }
    return count
  }
}

function createFetch(fetchedUrls: string[]): AlsFootstepAudioFetch {
  return async (input) => {
    fetchedUrls.push(String(input))
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(16),
    }
  }
}

function footstepRequest(
  overrides: {
    SoundType?: 'Step' | 'WalkRun' | 'Land'
    Location?: { x: number; y: number; z: number }
    VolumeMultiplier?: number
    PitchMultiplier?: number
  } = {},
) {
  return {
    SoundType: overrides.SoundType ?? 'Step',
    SpawnMode: 'SpawnAtTraceHitLocation' as const,
    FootBone: 'Left' as const,
    Location: overrides.Location ?? { x: 1, y: 2, z: 3 },
    VolumeMultiplier: overrides.VolumeMultiplier ?? 1,
    PitchMultiplier: overrides.PitchMultiplier ?? 1,
  }
}

describe('ALS footstep MetaSound wave selection', () => {
  it('uses the exact authored Step, WalkRun, and Land wave arrays', () => {
    expect(ALS_FOOTSTEP_WAVE_ASSETS).toEqual({
      Step: [
        'S_Als_Footstep_Concrete_Step_01',
        'S_Als_Footstep_Concrete_Step_02',
        'S_Als_Footstep_Concrete_Step_03',
      ],
      WalkRun: [
        'S_Als_Footstep_Concrete_Walk_01',
        'S_Als_Footstep_Concrete_Walk_02',
        'S_Als_Footstep_Concrete_Walk_03',
        'S_Als_Footstep_Concrete_Walk_04',
        'S_Als_Footstep_Concrete_Walk_05',
      ],
      Land: [
        'S_Als_Footstep_Concrete_Step_01',
        'S_Als_Footstep_Concrete_Step_02',
      ],
    })
    expect(ALS_FOOTSTEP_NO_REPEATS).toBe(1)
  })

  it('uniformly removes the previous wave from the next random bucket', () => {
    const waves = [
      selectAlsFootstepWave('Step', null, () => 0),
      selectAlsFootstepWave(
        'Step',
        'S_Als_Footstep_Concrete_Step_01',
        () => 0,
      ),
      selectAlsFootstepWave(
        'Step',
        'S_Als_Footstep_Concrete_Step_02',
        () => 1,
      ),
    ]

    expect(waves).toEqual([
      'S_Als_Footstep_Concrete_Step_01',
      'S_Als_Footstep_Concrete_Step_02',
      'S_Als_Footstep_Concrete_Step_03',
    ])
  })

  it('keeps independent no-repeat history for each MetaSound branch', () => {
    const randomSamples = [0, 0, 0, 0]
    const selector = new AlsFootstepWaveSelector(
      () => randomSamples.shift() ?? 0,
    )

    expect(selector.Select('Step')).toBe(
      'S_Als_Footstep_Concrete_Step_01',
    )
    expect(selector.Select('Land')).toBe(
      'S_Als_Footstep_Concrete_Step_01',
    )
    expect(selector.Select('Step')).toBe(
      'S_Als_Footstep_Concrete_Step_02',
    )
    expect(selector.Select('Land')).toBe(
      'S_Als_Footstep_Concrete_Step_02',
    )
  })
})

describe('ALS footstep attenuation adapter', () => {
  it('derives the exact authored radii in repository metres', () => {
    expect(ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES).toBe(4)
    expect(ALS_FOOTSTEP_ATTENUATION_FALLOFF_DISTANCE_METRES).toBe(20)
    expect(ALS_FOOTSTEP_AUDIO_MAX_DISTANCE_METRES).toBe(24)
  })

  it('is full gain inside the inner radius and silent at max distance', () => {
    expect(evaluateAlsFootstepAttenuationGain(-1)).toBe(1)
    expect(evaluateAlsFootstepAttenuationGain(4)).toBe(1)
    expect(evaluateAlsFootstepAttenuationGain(14)).toBeCloseTo(
      -0.5 * Math.log10(0.5),
      12,
    )
    expect(evaluateAlsFootstepAttenuationGain(23)).toBeGreaterThan(0)
    expect(evaluateAlsFootstepAttenuationGain(24)).toBe(0)
    expect(evaluateAlsFootstepAttenuationGain(100)).toBe(0)
  })
})

describe('ALS browser footstep audio bridge', () => {
  it('unlocks one context and drains immutable pending requests once', async () => {
    const context = new FakeAudioContext()
    const fetchedUrls: string[] = []
    const mutableLocation = { x: 1, y: 2, z: 3 }
    const runtime = new AlsFootstepAudioRuntime({
      RandomSource: () => 0,
      AudioContextFactory: () => context as unknown as AudioContext,
      Fetch: createFetch(fetchedUrls),
      AssetBaseUrl: '/footsteps',
      AutoInstallUserGestureUnlock: false,
    })

    runtime.PlayFootstepSound(footstepRequest({
      Location: mutableLocation,
      VolumeMultiplier: 0.5,
      PitchMultiplier: 0.8,
    }))
    runtime.PlayFootstepSound(footstepRequest({
      Location: { x: 2, y: 0, z: 0 },
    }))
    mutableLocation.x = 99
    expect(runtime.PendingRequestCount).toBe(2)
    expect(context.sources).toHaveLength(0)

    const firstUnlock = runtime.Unlock()
    expect(runtime.Unlock()).toBe(firstUnlock)
    expect(await firstUnlock).toBe(true)
    expect(context.resumeCount).toBe(1)
    expect(fetchedUrls).toHaveLength(8)
    expect(new Set(fetchedUrls).size).toBe(8)
    expect(fetchedUrls).toContain(
      '/footsteps/S_Als_Footstep_Concrete_Step_01.wav',
    )
    expect(context.sources).toHaveLength(2)
    expect(runtime.PendingRequestCount).toBe(0)
    expect(context.panners[0]!.positionX.value).toBe(1)
    expect(context.panners[0]!.positionY.value).toBe(2)
    expect(context.panners[0]!.positionZ.value).toBe(3)
    expect(context.panners[0]).toMatchObject({
      panningModel: 'equalpower',
      distanceModel: 'linear',
      refDistance: 4,
      maxDistance: 24,
      rolloffFactor: 0,
    })
    expect(context.sources[0]!.playbackRate.value).toBe(0.8)
    expect(context.gains[0]!.gain.value).toBe(0.5)

    expect(await runtime.Unlock()).toBe(true)
    expect(context.resumeCount).toBe(1)
    expect(fetchedUrls).toHaveLength(8)
    expect(context.sources).toHaveLength(2)

    context.sources[0]!.finish()
    context.sources[1]!.finish()
    expect(runtime.ActiveSourceCount).toBe(0)
    expect(context.sources.every((source) => source.disconnected)).toBe(true)
    expect(context.panners.every((panner) => panner.disconnected)).toBe(true)
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true)

    await runtime.Dispose()
    expect(context.closeCount).toBe(1)
  })

  it('updates the listener and active logarithmic gain without moving the source', async () => {
    const context = new FakeAudioContext()
    const runtime = new AlsFootstepAudioRuntime({
      RandomSource: () => 0,
      AudioContextFactory: () => context as unknown as AudioContext,
      Fetch: createFetch([]),
      AutoInstallUserGestureUnlock: false,
    })
    runtime.PlayFootstepSound(footstepRequest({
      Location: { x: 14, y: 0, z: 0 },
      VolumeMultiplier: 2,
    }))
    await runtime.Unlock()

    const expectedInitialGain =
      2 * evaluateAlsFootstepAttenuationGain(14)
    expect(context.gains[0]!.gain.value).toBeCloseTo(
      expectedInitialGain,
      12,
    )
    expect(context.panners[0]!.positionX.value).toBe(14)

    runtime.SetListenerTransform({
      Location: { x: 10, y: 0, z: 0 },
      Forward: { x: 1, y: 0, z: 0 },
      Up: { x: 0, y: 1, z: 0 },
    })
    const listener = context.listener as unknown as {
      positionX: FakeAudioParam
      forwardX: FakeAudioParam
      upY: FakeAudioParam
    }
    expect(listener.positionX.value).toBe(10)
    expect(listener.forwardX.value).toBe(1)
    expect(listener.upY.value).toBe(1)
    expect(context.gains[0]!.gain.value).toBe(2)
    expect(context.panners[0]!.positionX.value).toBe(14)

    await runtime.Dispose()
  })

  it('bounds the pre-unlock FIFO with a deterministic oldest-drop policy', async () => {
    const context = new FakeAudioContext()
    const runtime = new AlsFootstepAudioRuntime({
      RandomSource: () => 0,
      AudioContextFactory: () => context as unknown as AudioContext,
      Fetch: createFetch([]),
      MaximumPendingRequestCount: 2,
      AutoInstallUserGestureUnlock: false,
    })
    runtime.PlayFootstepSound(footstepRequest({
      Location: { x: 1, y: 0, z: 0 },
    }))
    runtime.PlayFootstepSound(footstepRequest({
      Location: { x: 2, y: 0, z: 0 },
    }))
    runtime.PlayFootstepSound(footstepRequest({
      Location: { x: 3, y: 0, z: 0 },
    }))
    expect(runtime.PendingRequestCount).toBe(2)

    await runtime.Unlock()
    expect(context.panners.map((panner) => panner.positionX.value)).toEqual([
      2,
      3,
    ])
    await runtime.Dispose()
  })

  it('removes first-gesture and source handlers during lifecycle cleanup', async () => {
    const context = new FakeAudioContext()
    const target = new TrackingEventTarget()
    const runtime = new AlsFootstepAudioRuntime({
      AudioContextFactory: () => context as unknown as AudioContext,
      Fetch: createFetch([]),
      AutoInstallUserGestureUnlock: false,
    })
    expect(runtime.InstallUserGestureUnlock(target)).toBe(true)
    expect(runtime.InstallUserGestureUnlock(target)).toBe(false)
    expect(target.ActiveListenerCount).toBe(3)

    runtime.PlayFootstepSound(footstepRequest())
    target.dispatchEvent(new Event('pointerdown'))
    expect(target.ActiveListenerCount).toBe(0)
    await vi.waitFor(() => {
      expect(runtime.IsUnlocked).toBe(true)
      expect(context.sources).toHaveLength(1)
    })

    const source = context.sources[0]!
    expect(source.onended).not.toBeNull()
    await runtime.Dispose()
    expect(source.onended).toBeNull()
    expect(source.stopCount).toBe(1)
    expect(source.disconnected).toBe(true)
    expect(target.ActiveListenerCount).toBe(0)
  })

  it('is a safe no-op when AudioContext is unavailable', async () => {
    const runtime = new AlsFootstepAudioRuntime({
      AudioContextFactory: () => null,
      AutoInstallUserGestureUnlock: false,
    })
    runtime.PlayFootstepSound(footstepRequest())
    expect(await runtime.Unlock()).toBe(false)
    expect(runtime.PendingRequestCount).toBe(1)
    await runtime.Dispose()
    expect(runtime.PendingRequestCount).toBe(0)
  })
})

it('decodes every footstep during suspended-context preloading without resuming audio', async () => {
  const context = new FakeAudioContext()
  const fetched: string[] = []
  const runtime = new AlsFootstepAudioRuntime({
    AudioContextFactory: () => context as unknown as AudioContext,
    Fetch: createFetch(fetched),
    AssetBaseUrl: '/footsteps/',
  })
  await runtime.Preload()
  expect(fetched).toHaveLength(8)
  expect(context.decodedBuffers).toHaveLength(8)
  expect(context.resumeCount).toBe(0)
  expect(runtime.IsUnlocked).toBe(false)
  await runtime.Preload()
  expect(fetched).toHaveLength(8)
  await runtime.Dispose()
})

it('can retry a failed loading-screen footstep fetch', async () => {
  const context = new FakeAudioContext()
  const fetched: string[] = []
  let offline = true
  const success = createFetch(fetched)
  const runtime = new AlsFootstepAudioRuntime({
    AudioContextFactory: () => context as unknown as AudioContext,
    AssetBaseUrl: '/footsteps/',
    Fetch: async (input, init) => {
      if (offline) throw new Error('offline')
      return success(input, init)
    },
  })
  await expect(runtime.Preload()).rejects.toThrow('Footstep decode failed')
  offline = false
  await runtime.Preload()
  expect(fetched).toHaveLength(8)
  await runtime.Dispose()
})
