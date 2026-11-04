/** Visibility gates pose evaluation; every visible mesh or shadow evaluates every frame.
 * Unseen characters keep audible graph events current, or carry elapsed time until re-entry.
 * Root-motion actions pass `critical` because gameplay consumes their evaluated pose.
 */
export interface AlsAnimationLod {
  /** The camera can see the mesh itself. Defaults to true when visibility is unknown. */
  visible?: boolean
  /** The camera can see a shadow cast by the mesh, including a hidden first-person body. */
  shadow?: boolean
}

export function selectAlsAnimationInterval(significance: AlsAnimationLod): 0 | 1 {
  return significance.visible === false && !significance.shadow ? 0 : 1
}

export type AlsAnimationLodSource = AlsAnimationLod | (() => AlsAnimationLod)

export function resolveAlsAnimationLod(source: AlsAnimationLodSource | undefined): AlsAnimationLod | undefined {
  return typeof source === 'function' ? source() : source
}

export interface AlsAnimationTick {
  update: boolean
  evaluate: boolean
  delta: number
}

export class AlsAnimationUpdateRate {
  private pending = 0
  private readonly tick: AlsAnimationTick = { update: false, evaluate: false, delta: 0 }
  next(delta: number, significance: AlsAnimationLod | undefined, critical: boolean, heard: boolean): AlsAnimationTick {
    const interval = significance && !critical ? selectAlsAnimationInterval(significance) : 1
    // Visibility is checked every frame: the first visible frame evaluates immediately.
    const evaluate = interval === 1
    this.pending += Math.max(0, delta)
    const tick = this.tick
    tick.evaluate = evaluate
    tick.update = evaluate || heard
    tick.delta = 0
    if (!tick.update) return tick
    tick.delta = this.pending
    this.pending = 0
    return tick
  }

  reset() {
    this.pending = 0
  }
}
