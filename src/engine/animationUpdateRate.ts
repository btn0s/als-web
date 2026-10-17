/**
 * USkinnedMeshComponent update rate optimization (FAnimUpdateRateParameters with UpdateRate 1 and
 * an EvaluationRate): the graph updates every frame, so clocks, state machines and notifies stay
 * on the frame they happen, while the pose is evaluated every `interval` frames from the mesh's
 * significance. The instance carries the skipped time into the next evaluation. Local and remote
 * characters share this one mechanism; actions pass `critical` to evaluate every frame because
 * their root motion comes from the evaluated pose.
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
  private started = false
  readonly phase: number

  constructor(phase = nextPhase++) {
    this.phase = phase
  }

  evaluate(significance?: AlsAnimationLod, critical = false): boolean {
    const interval = significance && !critical ? selectAlsAnimationInterval(significance) : 1
    const evaluate = !this.started || interval === 1 || (this.frame + this.phase) % interval === 0
    this.frame++
    if (evaluate) this.started = true
    return evaluate
  }

  reset() {
    this.started = false
  }
}
