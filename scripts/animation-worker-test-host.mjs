// Node worker host for the browser worker's exact evaluator/transport contract.
import { parentPort } from 'node:worker_threads'
import { createServer } from 'vite'
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const { createAnimationWorkerRuntime } = await vite.ssrLoadModule('/src/engine/worker/animationWorkerRuntime.ts')
const runtime = createAnimationWorkerRuntime()
const baselineMemory = process.memoryUsage()
parentPort.on('message', async message => {
  if (message.kind === 'shutdown') { await vite.close(); parentPort.close(); return }
  try {
    const result = runtime.handle(message)
    if (message.kind === 'create' && process.env.ALS_WORKER_MEMORY === '1') {
      const memory = process.memoryUsage()
      console.log('[ALS worker memory]', JSON.stringify({ actorAndClipsArrayBuffers: memory.arrayBuffers - baselineMemory.arrayBuffers,
        actorAndClipsHeap: memory.heapUsed - baselineMemory.heapUsed }))
    }
    if (result) parentPort.postMessage(result, [result.data.buffer])
  } catch (error) { parentPort.postMessage({ kind: 'error', message: error.stack ?? String(error) }) }
})
parentPort.postMessage({ kind: 'ready' })
