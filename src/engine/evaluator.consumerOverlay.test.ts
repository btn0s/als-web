/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createAlsAnimationInstance, type AlsAnimationInstanceControls } from '../als/AlsAnimationInstance'
import type { ConsumerOverlayState } from '../als/AnimGraph/consumerOverlayStates'

const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
const load = () => new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')

describe.each(['Rifle', 'PistolTwoHanded'] as const)('consumer %s linked layer', template => {
  it('retains native action curves and the native rolling montage through registration', async () => {
    vi.stubGlobal('window', {})
    try {
      const stock = await load()
      const custom = await load()
      const sources: ConsumerOverlayState['sources'] = {
        poses: `A_Als_${template}_Poses`, aim: `A_Als_${template}_Aim`, aimCrouch: `A_Als_${template}_Aim_Crouch`,
        aimReference: `A_Als_${template}_Poses_NoCurves`, runArms: 'A_Als_Rifle_Run_Arms',
        sprintArms: 'A_Als_Rifle_Sprint_Arms', sprintImpulseArms: 'A_Als_Rifle_Sprint_Impulse_Arms',
      }
      const native = createAlsAnimationInstance({ ...stock, publishDiagnostics: false })
      const registered = createAlsAnimationInstance({ ...custom, publishDiagnostics: false,
        overlayStates: { clips: [], states: [{ mode: 'Custom', template, sources }] } })
      const controls: AlsAnimationInstanceControls = {
        gait: 'Walking', moving: false, movingSmooth: false, stance: 'Standing', rotationMode: 'Aiming',
        overlayMode: template, speed: 0, direction: 0, relativeAccelerationAmount: { x: 0, y: 0 },
        rotateInPlace: false, viewYawAngle: 0, viewYawSpeed: 0,
      }
      for (const action of [null, 'Rolling', 'Mantling', 'GettingUp', 'Ragdolling', null] as const) {
        if (action === 'Rolling') {
          expect(registered.rollingMontage.Montage_Play('AM_Als_Roll', 1.3)).toBeGreaterThan(0)
          native.rollingMontage.Montage_Play('AM_Als_Roll', 1.3)
        }
        for (let frame = 0; frame < 25; frame++) {
          native.refresh(1 / 60, { ...controls, locomotionAction: action })
          registered.refresh(1 / 60, { ...controls, overlayMode: 'Custom', locomotionAction: action })
          for (const curve of ['LayerArmLeft', 'LayerArmRight', 'LayerSpine', 'LayerPelvis', 'LayerLegs', 'HandLeftIk', 'AllowAiming']) {
            expect(registered.getCurveValue(curve), `${action}:${curve}`).toBeCloseTo(native.getCurveValue(curve), 5)
          }
          for (const name of ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r']) {
            const a = stock.scene.getObjectByName(name)!
            const b = custom.scene.getObjectByName(name)!
            expect(a.position.distanceTo(b.position), `${action}:${name}`).toBeLessThan(1e-5)
            expect(a.quaternion.angleTo(b.quaternion), `${action}:${name}`).toBeLessThan(0.002)
          }
          expect(registered.getRollingSnapshot()).toEqual(native.getRollingSnapshot())
        }
      }
    } finally { vi.unstubAllGlobals() }
  })
})
