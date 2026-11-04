import { createAnimationWorkerRuntime } from './animationWorkerRuntime'
import type { AnimationRequest, AnimationReply } from './animationMessages'
const runtime = createAnimationWorkerRuntime()
self.onmessage = (event: MessageEvent<AnimationRequest>) => {
  try {
    const result = runtime.handle(event.data)
    if (result) self.postMessage(result, { transfer: [result.data.buffer as ArrayBuffer] })
  } catch (error) {
    const id = event.data.kind === 'frame' ? event.data.frame.id : event.data.id
    self.postMessage({ kind: 'error', id, message: error instanceof Error ? error.stack ?? error.message : String(error) } satisfies AnimationReply)
  }
}
