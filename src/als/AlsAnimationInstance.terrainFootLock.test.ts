import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAlsAnimationInstance, type AlsAnimationInstanceControls } from './AlsAnimationInstance'

beforeAll(() => {
  Object.assign(globalThis, { window: globalThis })
})

async function loadGltf() {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  )
}

const controls: AlsAnimationInstanceControls = {
  gait: 'Walking', moving: false, movingSmooth: false, stance: 'Standing',
  rotationMode: 'VelocityDirection', overlayMode: 'Default', speed: 0, direction: 0,
  relativeAccelerationAmount: { x: 0, y: 0 }, rotateInPlace: false,
  viewYawAngle: 0, viewYawSpeed: 0, actorYawAngle: 0, locomotionMode: 'Grounded',
}

describe('terrain contact through the shipped ALS graph', () => {
  it.each([
    ['Walking', 1.75, 'flat'],
    ['Running', 3.75, 'flat'],
    ['Sprinting', 6.5, 'flat'],
    ['Walking', 1.75, 'stairs'],
    ['Walking', 1.75, 'slope'],
  ] as const)(
    'retains both stance feet through idle, %s at %s m/s over %s, and stopping', async (gait, topSpeed, terrain) => {
    const gltf = await loadGltf()
    const inverse = new THREE.Matrix4()
    const groundHeight = (x: number) => terrain === 'stairs'
      ? Math.floor(Math.max(0, x) / 0.35) * 0.16
      : terrain === 'slope' ? x * 0.25 : 0
    const hit = {
      impactPoint: new THREE.Vector3(),
      impactNormal: new THREE.Vector3(terrain === 'slope' ? -0.25 : 0, 1, 0).normalize(),
    }
    const instance = createAlsAnimationInstance({
      ...gltf,
      terrainFootLock: true,
      controlRigFootTrace: (request) => {
        hit.impactPoint.copy(request.start).applyMatrix4(gltf.scene.matrixWorld)
        hit.impactPoint.y = groundHeight(hit.impactPoint.x)
        hit.impactPoint.applyMatrix4(inverse.copy(gltf.scene.matrixWorld).invert())
        return hit
      },
    })
    const feet = ['foot_l', 'foot_r'].map(name => gltf.scene.getObjectByName(name)!)
    const previous = [new THREE.Vector3(), new THREE.Vector3()]
    const previousPlanted = [false, false]
    const speeds: number[] = []
    const gaps: number[] = []
    const contactHeight = [0, 0]
    for (let frame = 0; frame < 300; frame++) {
      const moving = frame >= 60 && frame < 240
      const speed = moving ? topSpeed : 0
      gltf.scene.position.x += speed / 60
      gltf.scene.position.y = groundHeight(gltf.scene.position.x)
      instance.refresh(1 / 60, {
        ...controls, gait, moving, movingSmooth: moving, hasInput: moving, speed,
        location: { ...gltf.scene.position },
      })
      gltf.scene.updateWorldMatrix(true, true)
      const curves = instance.inspectPose('final').curves
      const phase = curves.get('FootPlanted') ?? 0
      for (let side = 0; side < 2; side++) {
        const lock = curves.get(side === 0 ? 'FootLeftLock' : 'FootRightLock') ?? 0
        const planted = phase * (side === 0 ? -1 : 1) >= 0.75 || lock >= 0.99
        const current = feet[side].getWorldPosition(new THREE.Vector3())
        if (frame === 30) contactHeight[side] = current.y - groundHeight(current.x)
        if (frame > 30 && planted) gaps.push(Math.abs(current.y - groundHeight(current.x) - contactHeight[side]))
        if (frame > 30 && planted && previousPlanted[side]) {
          speeds.push(Math.hypot(current.x - previous[side].x, current.z - previous[side].z) * 60)
        }
        previous[side].copy(current)
        previousPlanted[side] = planted
      }
    }
    expect(speeds.length).toBeGreaterThan(100)
    expect(speeds.sort((a, b) => a - b)[Math.floor(speeds.length * 0.95)]).toBeLessThan(0.04)
    expect(gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)]).toBeLessThan(0.04)
  })
})
