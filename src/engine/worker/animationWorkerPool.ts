import type { AnimationAssets, AnimationFrame, AnimationReply, AnimationRequest, AnimationResult } from './animationMessages'

type Slot = { worker: Worker; assets: Set<string>; actors: number }
let nextId = 1
let slots: Slot[] = []
const listeners = new Map<number, (result: AnimationResult) => void>()
/** Two execution lanes; actors stay on their lane so their graph/pose history never migrates. */
export function connectAnimationWorker(assets: AnimationAssets, receive: (result: AnimationResult) => void) {
  if (!slots.length) {
    slots = Array.from({ length: Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) }, () => {
      const worker = new Worker(new URL('./animation.worker.ts', import.meta.url), { type: 'module', name: 'ALS pose evaluation' })
      worker.onmessage = (event: MessageEvent<AnimationReply>) => {
        if (event.data.kind === 'error') { console.error('[ALS animation worker]', event.data.message); return }
        listeners.get(event.data.id)?.(event.data)
      }
      worker.onerror = error => console.error('[ALS animation worker]', error.message)
      return { worker, assets: new Set<string>(), actors: 0 }
    })
  }
  const slot = slots.reduce((a, b) => a.actors <= b.actors ? a : b)
  const id = nextId++; slot.actors++; listeners.set(id, receive)
  const message: AnimationRequest = { kind: 'create', id, assetKey: assets.key,
    assets: slot.assets.has(assets.key) ? undefined : assets }
  slot.worker.postMessage(message); slot.assets.add(assets.key)
  return {
    submit(frame: Omit<AnimationFrame, 'id'>) {
      const message: AnimationRequest = { kind: 'frame', frame: { ...frame, id } }
      slot.worker.postMessage(message, frame.buffer ? [frame.buffer] : [])
    },
    dispose() {
      listeners.delete(id); slot.actors--
      slot.worker.postMessage({ kind: 'dispose', id } satisfies AnimationRequest)
      if (slots.every(slot => slot.actors === 0)) { for (const slot of slots) slot.worker.terminate(); slots = [] }
    },
  }
}
