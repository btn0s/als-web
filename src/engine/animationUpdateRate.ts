/**
 * USkinnedMeshComponent update rate optimization (FAnimUpdateRateParameters): a mesh evaluates
 * its animation graph every `interval` frames from its significance, carrying the skipped time
 * into the next evaluation so notifies and montage clocks cross each frame exactly once. Local
 * and remote characters share this one mechanism; actions pass `critical` to evaluate every frame.
 */
export interface AlsAnimationLod {
  distance?: number
  /** The camera can see the mesh itself. */
  visible?: boolean
  /** Hidden from the camera but casting a shadow it can see (bOwnerNoSee with bCastHiddenShadow). */
  shadow?: boolean
  focused?: boolean
  minInterval?: number
  maxInterval?: number
}

export function selectAlsAnimationInterval(significance: AlsAnimationLod): number {
  if (significance.focused) return 1
  const distance = significance.distance ?? 0
  const interval = significance.visible === false ? significance.shadow ? 3 : 8
    : distance < 12 ? 1 : distance < 20 ? 2 : distance < 34 ? 3 : 4
  const minimum = Math.max(1, Math.floor(significance.minInterval ?? 1))
  const maximum = Math.max(1, Math.floor(significance.maxInterval ?? 8))
  return Math.max(1, Math.min(Math.max(minimum, interval), maximum))
}

export type AlsAnimationLodSource = AlsAnimationLod | (() => AlsAnimationLod)

export function resolveAlsAnimationLod(source: AlsAnimationLodSource | undefined): AlsAnimationLod | undefined {
  return typeof source === 'function' ? source() : source
}

let nextPhase = 0

export class AlsAnimationUpdateRate {
  private frame = 0
  private pending = 0
  private started = false
  constructor(readonly phase = nextPhase++) {}

  next(delta: number, significance?: AlsAnimationLod, critical = false): number | null {
    this.pending += Math.max(0, delta)
    const interval = significance && !critical ? selectAlsAnimationInterval(significance) : 1
    const evaluate = !this.started || interval === 1 || (this.frame + this.phase) % interval === 0
    this.frame++
    if (!evaluate) return null
    this.started = true
    const elapsed = this.pending
    this.pending = 0
    return elapsed
  }

  reset() {
    this.pending = 0
    this.started = false
  }
}
