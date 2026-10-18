import footstepAudioContentSource
  from '../../scripts/extract-als/footstep-audio.json?raw'
import type {
  AlsFootstepSoundRequest,
  AlsFootstepSoundSink,
  EAlsFootstepSoundType,
} from '../als/Notifies/AlsAnimNotify_FootstepEffects'

const UNREAL_CENTIMETRES_PER_METRE = 100
// ORIGINAL browser safety policy: native ALS never waits for an autoplay permission gate. Keep
// that web-only backlog bounded and discard its oldest locked-time request deterministically.
const DEFAULT_MAXIMUM_PENDING_REQUEST_COUNT = 32

interface ExtractedWaveAsset {
  readonly ObjectPath: string
}

interface ExtractedFootstepAudioContent {
  readonly metaSound: {
    readonly maxDistance: number
    readonly waveArrays: {
      readonly StepWaves: readonly ExtractedWaveAsset[]
      readonly WalkWaves: readonly ExtractedWaveAsset[]
      readonly LandWaves: readonly ExtractedWaveAsset[]
    }
    readonly defaults: {
      readonly minPitchShift: number
      readonly maxPitchShift: number
      readonly minVolume: number
      readonly maxVolume: number
      readonly noRepeats: number
    }
  }
  readonly attenuation: {
    readonly settings: {
      readonly DistanceAlgorithm: string
      readonly FalloffDistance: number
    }
  }
}

interface AudioBufferResponse {
  readonly ok: boolean
  readonly status: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type AlsFootstepAudioFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<AudioBufferResponse>

export interface AlsAudioListenerTransform {
  readonly Location: Readonly<{ x: number; y: number; z: number }>
  readonly Forward: Readonly<{ x: number; y: number; z: number }>
  readonly Up: Readonly<{ x: number; y: number; z: number }>
}

export interface AlsFootstepAudioRuntimeError {
  readonly Phase:
    | 'CreateAudioContext'
    | 'ResumeAudioContext'
    | 'FetchWave'
    | 'DecodeWave'
    | 'PlayWave'
  readonly WaveAssetName?: string
  readonly Cause: unknown
}

export interface AlsFootstepAudioRuntimeOptions {
  readonly RandomSource?: () => number
  readonly AudioContextFactory?: () => AudioContext | null
  readonly Fetch?: AlsFootstepAudioFetch
  readonly AssetBaseUrl?: string
  readonly MaximumPendingRequestCount?: number
  readonly AutoInstallUserGestureUnlock?: boolean
  readonly OnError?: (error: AlsFootstepAudioRuntimeError) => void
  readonly OnPlay?: (soundType: EAlsFootstepSoundType, waveAssetName: string) => void
}

interface PendingFootstepSound {
  readonly Request: Readonly<AlsFootstepSoundRequest>
  readonly WaveAssetName: string
}

interface ActiveFootstepSound {
  readonly Source: AudioBufferSourceNode
  readonly Panner: PannerNode
  readonly Gain: GainNode
  readonly Location: Readonly<{ x: number; y: number; z: number }>
  readonly VolumeMultiplier: number
}

type AudioListenerWithLegacyMethods = AudioListener & {
  setPosition?: (x: number, y: number, z: number) => void
  setOrientation?: (
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    upX: number,
    upY: number,
    upZ: number,
  ) => void
}

type PannerNodeWithLegacyMethods = PannerNode & {
  setPosition?: (x: number, y: number, z: number) => void
}

const extractedContent = JSON.parse(
  footstepAudioContentSource,
) as ExtractedFootstepAudioContent

function getWaveAssetName(wave: ExtractedWaveAsset): string {
  const separatorIndex = wave.ObjectPath.lastIndexOf('/')
  const assetName = wave.ObjectPath.slice(separatorIndex + 1)
  if (assetName.length === 0) {
    throw new Error(`Invalid ALS footstep wave path: ${wave.ObjectPath}`)
  }
  return assetName
}

function freezeWaveSet(
  waves: readonly ExtractedWaveAsset[],
): readonly string[] {
  return Object.freeze(waves.map(getWaveAssetName))
}

export const ALS_FOOTSTEP_WAVE_ASSETS:
Readonly<Record<EAlsFootstepSoundType, readonly string[]>> =
Object.freeze({
  Step: freezeWaveSet(extractedContent.metaSound.waveArrays.StepWaves),
  WalkRun: freezeWaveSet(extractedContent.metaSound.waveArrays.WalkWaves),
  Land: freezeWaveSet(extractedContent.metaSound.waveArrays.LandWaves),
})

export const ALS_FOOTSTEP_NO_REPEATS =
  extractedContent.metaSound.defaults.noRepeats

export const ALS_FOOTSTEP_AUDIO_MAX_DISTANCE_METRES =
  extractedContent.metaSound.maxDistance / UNREAL_CENTIMETRES_PER_METRE

export const ALS_FOOTSTEP_ATTENUATION_FALLOFF_DISTANCE_METRES =
  extractedContent.attenuation.settings.FalloffDistance
  / UNREAL_CENTIMETRES_PER_METRE

/**
 * `FSoundAttenuationSettings::AttenuationShapeExtents.X` is omitted from the serialized asset
 * because it retains UE's class default. MetaSound's serialized maximum distance is the exact
 * inner radius plus falloff, so the inner radius remains content-derived without duplicating the
 * engine default.
 */
export const ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES =
  ALS_FOOTSTEP_AUDIO_MAX_DISTANCE_METRES
  - ALS_FOOTSTEP_ATTENUATION_FALLOFF_DISTANCE_METRES

if (
  extractedContent.attenuation.settings.DistanceAlgorithm
  !== 'EAttenuationDistanceModel::Logarithmic'
) {
  throw new Error('ALS footstep attenuation is no longer Logarithmic')
}
if (ALS_FOOTSTEP_NO_REPEATS !== 1) {
  throw new Error('ALS footstep MetaSound no-repeat policy is no longer 1')
}
if (
  extractedContent.metaSound.defaults.minPitchShift !== 0
  || extractedContent.metaSound.defaults.maxPitchShift !== 0
  || extractedContent.metaSound.defaults.minVolume !== 1
  || extractedContent.metaSound.defaults.maxVolume !== 1
) {
  throw new Error('ALS footstep MetaSound gain or pitch defaults changed')
}
if (
  ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES < 0
  || Object.values(ALS_FOOTSTEP_WAVE_ASSETS).some(
    (waves) => waves.length <= ALS_FOOTSTEP_NO_REPEATS,
  )
) {
  throw new Error('ALS footstep audio content has invalid distance or wave data')
}

function clampRandomSample(sample: number): number {
  if (!Number.isFinite(sample) || sample <= 0) return 0
  if (sample >= 1) return 1 - Number.EPSILON
  return sample
}

/**
 * MetaSound `Random Get` with uniform weights and `No Repeats = 1`.
 *
 * MS_Als_Footstep has one MSP_Als_Footstep node per sound type, so each wave array owns its own
 * one-item history. Selection happens when a notify is enqueued, before asynchronous decoding,
 * which keeps the authored random stream independent of network completion order.
 */
export function selectAlsFootstepWave(
  SoundType: EAlsFootstepSoundType,
  PreviousWaveAssetName: string | null,
  RandomSource: () => number,
): string {
  const waves = ALS_FOOTSTEP_WAVE_ASSETS[SoundType]
  const previousIndex = PreviousWaveAssetName === null
    ? -1
    : waves.indexOf(PreviousWaveAssetName)
  const selectableWaveCount = waves.length - (previousIndex >= 0 ? 1 : 0)
  let selectedIndex = Math.floor(
    clampRandomSample(RandomSource()) * selectableWaveCount,
  )
  if (previousIndex >= 0 && selectedIndex >= previousIndex) {
    selectedIndex++
  }
  return waves[selectedIndex]!
}

export class AlsFootstepWaveSelector {
  private readonly RandomSource: () => number
  private readonly previousWaveAssetNames:
  Record<EAlsFootstepSoundType, string | null> = {
    Step: null,
    WalkRun: null,
    Land: null,
  }

  constructor(
    RandomSource: () => number = Math.random,
  ) {
    this.RandomSource = RandomSource
  }

  Select(SoundType: EAlsFootstepSoundType): string {
    const selectedWaveAssetName = selectAlsFootstepWave(
      SoundType,
      this.previousWaveAssetNames[SoundType],
      this.RandomSource,
    )
    this.previousWaveAssetNames[SoundType] = selectedWaveAssetName
    return selectedWaveAssetName
  }

  Reset(): void {
    this.previousWaveAssetNames.Step = null
    this.previousWaveAssetNames.WalkRun = null
    this.previousWaveAssetNames.Land = null
  }
}

/**
 * ORIGINAL engine adapter for UE's `EAttenuationDistanceModel::Logarithmic`.
 *
 * ALS content pins the model and its radii, but the engine's curve evaluator is not serialized
 * into SA_Als_Footstep and is not present in the ALS source tree. Web Audio has no logarithmic
 * distance model. This normalized logarithmic approximation is isolated here until an
 * independently verified UE engine-source oracle can replace it; it is intentionally not
 * presented as 1:1 ALS parity.
 */
export function evaluateAlsFootstepAttenuationGain(
  DistanceMetres: number,
): number {
  if (DistanceMetres <= ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES) {
    return 1
  }
  if (DistanceMetres >= ALS_FOOTSTEP_AUDIO_MAX_DISTANCE_METRES) {
    return 0
  }

  const normalizedDistance = (
    DistanceMetres - ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES
  ) / ALS_FOOTSTEP_ATTENUATION_FALLOFF_DISTANCE_METRES
  return Math.min(
    1,
    Math.max(0, -0.5 * Math.log10(normalizedDistance)),
  )
}

function getDefaultAssetBaseUrl(): string {
  const viteBaseUrl = import.meta.env.BASE_URL || '/'
  const normalizedViteBaseUrl = viteBaseUrl.endsWith('/')
    ? viteBaseUrl
    : `${viteBaseUrl}/`
  return `${normalizedViteBaseUrl}assets/audio/footsteps/`
}

function normalizeAssetBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function createDefaultAudioContext(): AudioContext | null {
  if (typeof globalThis === 'undefined') return null
  const browserGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextConstructor = browserGlobal.AudioContext
    ?? browserGlobal.webkitAudioContext
  return AudioContextConstructor === undefined
    ? null
    : new AudioContextConstructor()
}

function createDefaultFetch(): AlsFootstepAudioFetch | null {
  if (typeof globalThis.fetch !== 'function') return null
  return (input, init) => globalThis.fetch(input, init)
}

function cloneRequest(
  request: Readonly<AlsFootstepSoundRequest>,
): Readonly<AlsFootstepSoundRequest> {
  const Location = Object.freeze({
    x: request.Location.x,
    y: request.Location.y,
    z: request.Location.z,
  })
  return Object.freeze({
    SoundType: request.SoundType,
    Location,
    VolumeMultiplier: request.VolumeMultiplier,
    PitchMultiplier: request.PitchMultiplier,
    SpawnMode: request.SpawnMode,
    FootBone: request.FootBone,
  })
}

function setAudioParamValue(
  parameter: AudioParam,
  value: number,
  currentTime: number,
): void {
  parameter.setValueAtTime(value, currentTime)
}

function setListenerTransform(
  listener: AudioListener,
  transform: Readonly<AlsAudioListenerTransform>,
  currentTime: number,
): void {
  const legacyListener = listener as AudioListenerWithLegacyMethods
  if (
    listener.positionX !== undefined
    && listener.positionY !== undefined
    && listener.positionZ !== undefined
  ) {
    setAudioParamValue(listener.positionX, transform.Location.x, currentTime)
    setAudioParamValue(listener.positionY, transform.Location.y, currentTime)
    setAudioParamValue(listener.positionZ, transform.Location.z, currentTime)
  } else {
    legacyListener.setPosition?.(
      transform.Location.x,
      transform.Location.y,
      transform.Location.z,
    )
  }

  if (
    listener.forwardX !== undefined
    && listener.forwardY !== undefined
    && listener.forwardZ !== undefined
    && listener.upX !== undefined
    && listener.upY !== undefined
    && listener.upZ !== undefined
  ) {
    setAudioParamValue(listener.forwardX, transform.Forward.x, currentTime)
    setAudioParamValue(listener.forwardY, transform.Forward.y, currentTime)
    setAudioParamValue(listener.forwardZ, transform.Forward.z, currentTime)
    setAudioParamValue(listener.upX, transform.Up.x, currentTime)
    setAudioParamValue(listener.upY, transform.Up.y, currentTime)
    setAudioParamValue(listener.upZ, transform.Up.z, currentTime)
  } else {
    legacyListener.setOrientation?.(
      transform.Forward.x,
      transform.Forward.y,
      transform.Forward.z,
      transform.Up.x,
      transform.Up.y,
      transform.Up.z,
    )
  }
}

function setPannerLocation(
  panner: PannerNode,
  location: Readonly<{ x: number; y: number; z: number }>,
  currentTime: number,
): void {
  const legacyPanner = panner as PannerNodeWithLegacyMethods
  if (
    panner.positionX !== undefined
    && panner.positionY !== undefined
    && panner.positionZ !== undefined
  ) {
    setAudioParamValue(panner.positionX, location.x, currentTime)
    setAudioParamValue(panner.positionY, location.y, currentTime)
    setAudioParamValue(panner.positionZ, location.z, currentTime)
  } else {
    legacyPanner.setPosition?.(location.x, location.y, location.z)
  }
}

function getDistance(
  first: Readonly<{ x: number; y: number; z: number }>,
  second: Readonly<{ x: number; y: number; z: number }>,
): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  )
}

function getEventTarget(
  target: EventTarget | null | undefined,
): EventTarget | null {
  if (target !== undefined) return target
  return typeof window === 'undefined' ? null : window
}

/**
 * Browser-owned equivalent of MS_Als_Footstep + SA_Als_Footstep.
 *
 * The runtime owns exactly one lazily created AudioContext. Notify requests are copied and choose
 * their authored wave immediately, then wait in FIFO order for the first browser audio-unlock
 * gesture and decode. A request is removed before playback, so concurrent load completions and
 * repeated `Unlock()` calls cannot duplicate it.
 */
export class AlsFootstepAudioRuntime implements AlsFootstepSoundSink {
  private readonly waveSelector: AlsFootstepWaveSelector
  private readonly AudioContextFactory: () => AudioContext | null
  private readonly Fetch: AlsFootstepAudioFetch | null
  private readonly AssetBaseUrl: string
  private readonly MaximumPendingRequestCount: number
  private readonly OnError:
    ((error: AlsFootstepAudioRuntimeError) => void) | undefined
  private readonly OnPlay:
    ((soundType: EAlsFootstepSoundType, waveAssetName: string) => void) | undefined
  private readonly pendingSounds: PendingFootstepSound[] = []
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly bufferLoads = new Map<
    string,
    Promise<AudioBuffer | null>
  >()
  private readonly failedWaveAssetNames = new Set<string>()
  private readonly activeSounds = new Set<ActiveFootstepSound>()
  private readonly abortController = new AbortController()
  private readonly listenerTransform: {
    Location: { x: number; y: number; z: number }
    Forward: { x: number; y: number; z: number }
    Up: { x: number; y: number; z: number }
  } = {
    Location: { x: 0, y: 0, z: 0 },
    Forward: { x: 0, y: 0, z: -1 },
    Up: { x: 0, y: 1, z: 0 },
  }
  private context: AudioContext | null = null
  private contextCreationAttempted = false
  private unlockPromise: Promise<boolean> | null = null
  private userGestureTarget: EventTarget | null = null
  private userGestureHandler: EventListener | null = null
  private unlocked = false
  private disposed = false

  constructor(options: Readonly<AlsFootstepAudioRuntimeOptions> = {}) {
    this.waveSelector = new AlsFootstepWaveSelector(options.RandomSource)
    this.AudioContextFactory =
      options.AudioContextFactory ?? createDefaultAudioContext
    this.Fetch = options.Fetch ?? createDefaultFetch()
    this.AssetBaseUrl = normalizeAssetBaseUrl(
      options.AssetBaseUrl ?? getDefaultAssetBaseUrl(),
    )
    this.MaximumPendingRequestCount = Math.max(
      1,
      Math.floor(
        options.MaximumPendingRequestCount
        ?? DEFAULT_MAXIMUM_PENDING_REQUEST_COUNT,
      ),
    )
    this.OnError = options.OnError
    this.OnPlay = options.OnPlay

    // React may invoke render-time memo factories more than once in development. Listener
    // installation is therefore explicit by default so constructing this engine object remains
    // side-effect free; an app effect can opt in here or call InstallUserGestureUnlock().
    if (options.AutoInstallUserGestureUnlock ?? false) {
      this.InstallUserGestureUnlock()
    }
  }

  get PendingRequestCount(): number {
    return this.pendingSounds.length
  }

  get ActiveSourceCount(): number {
    return this.activeSounds.size
  }

  get IsUnlocked(): boolean {
    return this.unlocked
  }

  PlayFootstepSound(request: Readonly<AlsFootstepSoundRequest>): void {
    if (this.disposed) return

    const pendingSound = Object.freeze({
      Request: cloneRequest(request),
      WaveAssetName: this.waveSelector.Select(request.SoundType),
    })
    this.OnPlay?.(request.SoundType, pendingSound.WaveAssetName)
    if (this.pendingSounds.length >= this.MaximumPendingRequestCount) {
      this.pendingSounds.shift()
    }
    this.pendingSounds.push(pendingSound)

    if (this.unlocked) {
      void this.LoadBuffer(pendingSound.WaveAssetName)
      this.FlushPendingSounds()
    }
  }

  InstallUserGestureUnlock(
    target?: EventTarget | null,
  ): boolean {
    if (this.disposed || this.userGestureHandler !== null) return false
    const resolvedTarget = getEventTarget(target)
    if (resolvedTarget === null) return false

    const handler: EventListener = () => {
      this.RemoveUserGestureUnlock()
      void this.Unlock()
    }
    this.userGestureTarget = resolvedTarget
    this.userGestureHandler = handler
    resolvedTarget.addEventListener('pointerdown', handler, true)
    resolvedTarget.addEventListener('keydown', handler, true)
    resolvedTarget.addEventListener('touchstart', handler, true)
    return true
  }

  RemoveUserGestureUnlock(): void {
    if (
      this.userGestureTarget === null
      || this.userGestureHandler === null
    ) {
      return
    }
    this.userGestureTarget.removeEventListener(
      'pointerdown',
      this.userGestureHandler,
      true,
    )
    this.userGestureTarget.removeEventListener(
      'keydown',
      this.userGestureHandler,
      true,
    )
    this.userGestureTarget.removeEventListener(
      'touchstart',
      this.userGestureHandler,
      true,
    )
    this.userGestureTarget = null
    this.userGestureHandler = null
  }

  Unlock(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.unlockPromise !== null) return this.unlockPromise

    const unlockPromise = this.UnlockInternal()
    this.unlockPromise = unlockPromise
    const clearUnlockPromise = () => {
      if (this.unlockPromise === unlockPromise) {
        this.unlockPromise = null
      }
    }
    void unlockPromise.then(clearUnlockPromise, clearUnlockPromise)
    return unlockPromise
  }

  SetListenerTransform(
    transform: Readonly<AlsAudioListenerTransform>,
  ): void {
    this.listenerTransform.Location.x = transform.Location.x
    this.listenerTransform.Location.y = transform.Location.y
    this.listenerTransform.Location.z = transform.Location.z
    this.listenerTransform.Forward.x = transform.Forward.x
    this.listenerTransform.Forward.y = transform.Forward.y
    this.listenerTransform.Forward.z = transform.Forward.z
    this.listenerTransform.Up.x = transform.Up.x
    this.listenerTransform.Up.y = transform.Up.y
    this.listenerTransform.Up.z = transform.Up.z

    if (this.context !== null) {
      setListenerTransform(
        this.context.listener,
        this.listenerTransform,
        this.context.currentTime,
      )
    }
    this.RefreshActiveSoundGains()
  }

  async Dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.RemoveUserGestureUnlock()
    this.abortController.abort()
    this.pendingSounds.length = 0
    this.buffers.clear()
    this.bufferLoads.clear()
    this.failedWaveAssetNames.clear()
    this.waveSelector.Reset()

    for (const activeSound of [...this.activeSounds]) {
      activeSound.Source.onended = null
      try {
        activeSound.Source.stop()
      } catch {
        // A source that ended between the snapshot and stop is already silent.
      }
      this.CleanupActiveSound(activeSound)
    }

    const context = this.context
    this.context = null
    this.unlocked = false
    if (context !== null && context.state !== 'closed') {
      try {
        await context.close()
      } catch {
        // The runtime is already fully detached; a browser close failure cannot leak our nodes.
      }
    }
  }

  private async UnlockInternal(): Promise<boolean> {
    const context = this.GetOrCreateContext()
    if (context === null || this.Fetch === null) return false

    if (context.state === 'suspended') {
      try {
        await context.resume()
      } catch (Cause) {
        this.ReportError({ Phase: 'ResumeAudioContext', Cause })
        return false
      }
    }
    if (this.disposed || context.state !== 'running') return false

    this.unlocked = true
    setListenerTransform(
      context.listener,
      this.listenerTransform,
      context.currentTime,
    )

    await Promise.all(
      Object.values(ALS_FOOTSTEP_WAVE_ASSETS)
        .flat()
        .filter((wave, index, waves) => waves.indexOf(wave) === index)
        .map((wave) => this.LoadBuffer(wave)),
    )
    this.FlushPendingSounds()
    return !this.disposed
  }

  async Preload(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!this.GetOrCreateContext()) throw new Error('Audio context unavailable')
    const waves = [...new Set(Object.values(ALS_FOOTSTEP_WAVE_ASSETS).flat())]
    for (const wave of waves) {
      signal?.throwIfAborted()
      this.failedWaveAssetNames.delete(wave)
      if (!await this.LoadBuffer(wave, signal)) throw new Error(`Footstep decode failed: ${wave}`)
    }
    signal?.throwIfAborted()
  }

  private GetOrCreateContext(): AudioContext | null {
    if (this.context !== null) return this.context
    if (this.contextCreationAttempted) return null
    this.contextCreationAttempted = true
    try {
      this.context = this.AudioContextFactory()
    } catch (Cause) {
      this.ReportError({ Phase: 'CreateAudioContext', Cause })
      this.context = null
    }
    return this.context
  }

  private LoadBuffer(
    WaveAssetName: string,
    signal?: AbortSignal,
  ): Promise<AudioBuffer | null> {
    const cachedBuffer = this.buffers.get(WaveAssetName)
    if (cachedBuffer !== undefined) return Promise.resolve(cachedBuffer)
    if (this.failedWaveAssetNames.has(WaveAssetName)) {
      return Promise.resolve(null)
    }
    const existingLoad = this.bufferLoads.get(WaveAssetName)
    if (existingLoad !== undefined) return existingLoad
    if (
      this.context === null
      || this.Fetch === null
      || this.disposed
    ) {
      return Promise.resolve(null)
    }

    const load = this.LoadBufferInternal(WaveAssetName, signal)
    this.bufferLoads.set(WaveAssetName, load)
    const completeLoad = () => {
      this.bufferLoads.delete(WaveAssetName)
      this.FlushPendingSounds()
    }
    void load.then(completeLoad, completeLoad)
    return load
  }

  private async LoadBufferInternal(
    WaveAssetName: string,
    signal?: AbortSignal,
  ): Promise<AudioBuffer | null> {
    let encodedAudio: ArrayBuffer
    try {
      const response = await this.Fetch!(
        `${this.AssetBaseUrl}${WaveAssetName}.wav`,
        { signal: signal ? AbortSignal.any([signal, this.abortController.signal]) : this.abortController.signal },
      )
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      encodedAudio = await response.arrayBuffer()
    } catch (Cause) {
      if (signal?.aborted) throw Cause
      if (!this.disposed) {
        this.failedWaveAssetNames.add(WaveAssetName)
        this.ReportError({
          Phase: 'FetchWave',
          WaveAssetName,
          Cause,
        })
      }
      return null
    }

    try {
      const buffer = await this.context!.decodeAudioData(encodedAudio)
      signal?.throwIfAborted()
      if (this.disposed) return null
      this.buffers.set(WaveAssetName, buffer)
      return buffer
    } catch (Cause) {
      if (signal?.aborted) throw Cause
      if (!this.disposed) {
        this.failedWaveAssetNames.add(WaveAssetName)
        this.ReportError({
          Phase: 'DecodeWave',
          WaveAssetName,
          Cause,
        })
      }
      return null
    }
  }

  private FlushPendingSounds(): void {
    if (
      !this.unlocked
      || this.context === null
      || this.disposed
    ) {
      return
    }

    while (this.pendingSounds.length > 0) {
      const pendingSound = this.pendingSounds[0]!
      const buffer = this.buffers.get(pendingSound.WaveAssetName)
      if (buffer !== undefined) {
        this.pendingSounds.shift()
        this.PlayDecodedSound(pendingSound, buffer)
        continue
      }
      if (this.failedWaveAssetNames.has(pendingSound.WaveAssetName)) {
        this.pendingSounds.shift()
        continue
      }

      void this.LoadBuffer(pendingSound.WaveAssetName)
      return
    }
  }

  private PlayDecodedSound(
    pendingSound: Readonly<PendingFootstepSound>,
    buffer: AudioBuffer,
  ): void {
    const context = this.context
    if (context === null || this.disposed) return

    const source = context.createBufferSource()
    const panner = context.createPanner()
    const gain = context.createGain()
    const activeSound: ActiveFootstepSound = {
      Source: source,
      Panner: panner,
      Gain: gain,
      Location: pendingSound.Request.Location,
      VolumeMultiplier: Math.max(
        0,
        pendingSound.Request.VolumeMultiplier,
      ),
    }

    source.buffer = buffer
    source.loop = false
    setAudioParamValue(
      source.playbackRate,
      Math.max(0, pendingSound.Request.PitchMultiplier),
      context.currentTime,
    )

    // PannerNode supplies browser-native stereo spatialization only. Its distance rolloff is
    // disabled so the isolated ALS logarithmic adapter remains the sole attenuation owner.
    panner.panningModel = 'equalpower'
    panner.distanceModel = 'linear'
    panner.refDistance = ALS_FOOTSTEP_ATTENUATION_INNER_RADIUS_METRES
    panner.maxDistance = ALS_FOOTSTEP_AUDIO_MAX_DISTANCE_METRES
    panner.rolloffFactor = 0
    setPannerLocation(
      panner,
      pendingSound.Request.Location,
      context.currentTime,
    )

    this.RefreshActiveSoundGain(activeSound)
    source.connect(panner)
    panner.connect(gain)
    gain.connect(context.destination)

    const cleanup = () => {
      this.CleanupActiveSound(activeSound)
    }
    source.onended = cleanup
    this.activeSounds.add(activeSound)
    try {
      source.start()
    } catch (Cause) {
      cleanup()
      this.ReportError({
        Phase: 'PlayWave',
        WaveAssetName: pendingSound.WaveAssetName,
        Cause,
      })
    }
  }

  private RefreshActiveSoundGains(): void {
    for (const activeSound of this.activeSounds) {
      this.RefreshActiveSoundGain(activeSound)
    }
  }

  private RefreshActiveSoundGain(
    activeSound: Readonly<ActiveFootstepSound>,
  ): void {
    if (this.context === null) return
    const distance = getDistance(
      activeSound.Location,
      this.listenerTransform.Location,
    )
    setAudioParamValue(
      activeSound.Gain.gain,
      activeSound.VolumeMultiplier
      * evaluateAlsFootstepAttenuationGain(distance),
      this.context.currentTime,
    )
  }

  private CleanupActiveSound(activeSound: ActiveFootstepSound): void {
    if (!this.activeSounds.delete(activeSound)) return
    activeSound.Source.onended = null
    activeSound.Source.disconnect()
    activeSound.Panner.disconnect()
    activeSound.Gain.disconnect()
  }

  private ReportError(error: AlsFootstepAudioRuntimeError): void {
    try {
      this.OnError?.(error)
    } catch {
      // Diagnostics must not make a browser audio failure escape its isolated request.
    }
  }
}
