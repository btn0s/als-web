import { readFileSync } from 'node:fs'
import { beforeAll, expect, it, vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createAlsAnimationInstance, type AlsAnimationInstanceControls } from './AlsAnimationInstance'

beforeAll(() => vi.stubGlobal('window', {}))
const controls: AlsAnimationInstanceControls = {
  gait: 'Running', moving: false, movingSmooth: false, stance: 'Standing',
  rotationMode: 'ViewDirection', overlayMode: 'Default', speed: 0, direction: 0,
  relativeAccelerationAmount: { x: 0, y: 0 }, rotateInPlace: false, viewYawAngle: 0, viewYawSpeed: 0,
  locomotionAction: 'GettingUp',
}
async function load() {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  return { gltf, animation: createAlsAnimationInstance(gltf) }
}
it.each(['AM_Als_GetUp_Front', 'AM_Als_GetUp_Back'])('plays %s, publishes its pose and ends GettingUp at the authored marker', async name => {
  const { animation, gltf } = await load()
  const pelvis = gltf.scene.getObjectByName('pelvis')!
  expect(animation.getUpMontage.Montage_Play(name)).toBe(1.5)
  animation.refresh(0, controls)
  const start = pelvis.quaternion.clone()
  animation.refresh(.25, controls)
  expect(animation.getUpMontage.takeNotifyEvents().map(e => e.notifyEventType)).toEqual(['Begin'])
  expect(pelvis.quaternion.angleTo(start)).toBeGreaterThan(.01)
  expect(animation.rollingMontage.ConsumeExtractedRootMotion().valid).toBe(false)
  // 1.16656661 / 1.2 = 0.97213884 seconds: just before and after that marker.
  animation.refresh(.72, controls)
  expect(animation.getUpMontage.takeNotifyEvents()).toEqual([])
  animation.refresh(.004, controls)
  expect(animation.getUpMontage.takeNotifyEvents().map(e => e.notifyEventType)).toEqual(['End'])
})
it('tears down an interrupted GettingUp notify exactly once', async () => {
  const { animation } = await load()
  animation.getUpMontage.Montage_Play('AM_Als_GetUp_Front')
  animation.refresh(.1, controls)
  expect(animation.getUpMontage.takeNotifyEvents()).toHaveLength(1)
  animation.StopMontages(.2)
  animation.refresh(.21, controls)
  expect(animation.getUpMontage.takeNotifyEvents().map(e => e.notifyEventType)).toEqual(['End'])
  animation.refresh(.1, controls)
  expect(animation.getUpMontage.takeNotifyEvents()).toEqual([])
})
