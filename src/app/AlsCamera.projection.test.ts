import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ALS_CAMERA_SETTINGS } from '../als/AlsCamera/AlsCameraSettings'
import { ALS_DEFAULT_NEAR_CLIP_PLANE, alsCameraTraceSettings, applyAlsCameraProjection, createAlsCameraProjectionState } from './AlsCamera'

describe('ALS camera projection', () => {
  it('defaults the near clip plane to UE GNearClippingPlane as before', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 400)
    const state = createAlsCameraProjectionState()
    expect(applyAlsCameraProjection(camera, state, 16 / 9, 90, 'MaintainXFOV', ALS_DEFAULT_NEAR_CLIP_PLANE)).toBe(true)
    expect(camera.near).toBe(0.1)
    expect(camera.projectionMatrix.elements[10]).toBeCloseTo(-(400 + 0.1) / (400 - 0.1), 12)
  })

  it('applies a game-chosen near plane and restores it if something else overwrites it', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600)
    const state = createAlsCameraProjectionState()
    applyAlsCameraProjection(camera, state, 16 / 9, 90, 'MaintainXFOV', 0.15)
    expect(camera.near).toBe(0.15)
    expect(applyAlsCameraProjection(camera, state, 16 / 9, 90, 'MaintainXFOV', 0.15)).toBe(false)
    camera.near = 0.1
    expect(applyAlsCameraProjection(camera, state, 16 / 9, 90, 'MaintainXFOV', 0.15)).toBe(true)
    expect(camera.near).toBe(0.15)
  })

  it('leaves the game camera near plane untouched when null, through FOV changes', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.2, 600)
    const state = createAlsCameraProjectionState()
    applyAlsCameraProjection(camera, state, 16 / 9, 90, 'MaintainXFOV', null)
    applyAlsCameraProjection(camera, state, 16 / 9, 95, 'MaintainXFOV', null)
    applyAlsCameraProjection(camera, state, 390 / 844, 95, 'MajorAxisFOV', null)
    expect(camera.near).toBe(0.2)
    expect(camera.fov).toBe(95)
    expect(camera.projectionMatrix.elements[10]).toBeCloseTo(-(600 + 0.2) / (600 - 0.2), 12)
  })

  it('only updates the projection when the FOV, aspect or near plane changes', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400)
    const state = createAlsCameraProjectionState()
    expect(applyAlsCameraProjection(camera, state, 1.5, 90, 'MaintainXFOV', null)).toBe(true)
    expect(applyAlsCameraProjection(camera, state, 1.5, 90, 'MaintainXFOV', null)).toBe(false)
    expect(applyAlsCameraProjection(camera, state, 1.5, 91, 'MaintainXFOV', null)).toBe(true)
    expect(applyAlsCameraProjection(camera, state, 1.5, 91, 'MaintainXFOV', 0.12)).toBe(true)
    expect(camera.near).toBe(0.12)
  })

  it('keeps the authored trace radius while the near-plane corners fit inside it', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 600)
    expect(alsCameraTraceSettings(camera)).toBe(ALS_CAMERA_SETTINGS)
  })

  it('grows the trace radius to the near-plane corners on a far near plane', () => {
    const camera = new THREE.PerspectiveCamera(95, 390 / 844, 0.2, 600)
    const slope = Math.tan(THREE.MathUtils.degToRad(95) / 2)
    const radius = alsCameraTraceSettings(camera).thirdPerson.traceRadius
    expect(radius).toBeCloseTo(0.2 * Math.sqrt(1 + slope ** 2 + (slope * 390 / 844) ** 2), 9)
    expect(radius).toBeGreaterThan(ALS_CAMERA_SETTINGS.thirdPerson.traceRadius)
  })

  it('refreshes the trace settings when the game moves its own near plane', () => {
    const camera = new THREE.PerspectiveCamera(60, 390 / 844, 0.1, 600)
    const state = createAlsCameraProjectionState()
    applyAlsCameraProjection(camera, state, 390 / 844, 95, 'MajorAxisFOV', null)
    const near = state.settings.thirdPerson.traceRadius
    camera.near = 0.2
    expect(applyAlsCameraProjection(camera, state, 390 / 844, 95, 'MajorAxisFOV', null)).toBe(true)
    expect(state.settings.thirdPerson.traceRadius).toBeCloseTo(near * 2, 9)
  })
})
