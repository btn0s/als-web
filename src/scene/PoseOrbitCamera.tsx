import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ElementRef, MutableRefObject } from 'react'
import * as THREE from 'three'
import { LEVA_ROOTS } from './levaRoots'
import type { CharacterPoseSample } from './poseCameraState'

const POSE_HEIGHT_DAMPING = 7

interface PoseOrbitCameraProps {
  characterSize: THREE.Vector3
  poseSample: MutableRefObject<CharacterPoseSample>
}

/**
 * OrbitControls with a pose-driven target, using ALS's exact pivot formula
 * (AlsCameraComponent::GetThirdPersonPivotLocation): the pivot is the MIDPOINT of the root bone
 * and the head bone, sampled from the animated skeleton — crouch/crawl/get-up reframe themselves
 * with no calibration and no per-stance offsets. The damp below is our stand-in for ALS's
 * LocationLag curves; M3's aim/crouch framing shifts become a state→offset table (the web
 * equivalent of ALS's camera-rig curves: PivotOffset/CameraOffset/FovOffset), not a camera ABP.
 *
 * Reticle-true zoom from the sibling camera is deferred until this repo has an aiming/reticle
 * system (M3); there is no meaningful optical anchor to preserve yet.
 */
export function PoseOrbitCamera({ characterSize, poseSample }: PoseOrbitCameraProps) {
  const { camera, size: viewportSize } = useThree()
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const { poseFollow } = useControls(
    LEVA_ROOTS.camera,
    {
      poseFollow: {
        value: POSE_HEIGHT_DAMPING,
        min: 1,
        max: 20,
        step: 0.5,
        label: 'pose follow',
      },
    },
    { order: 0 },
  )
  const scratch = useMemo(
    () => ({
      desiredTarget: new THREE.Vector3(),
      targetDelta: new THREE.Vector3(),
      fallbackTarget: new THREE.Vector3(),
      viewDirection: new THREE.Vector3(0.75, 0.35, 1).normalize(),
    }),
    [],
  )

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      return
    }

    const verticalFov = THREE.MathUtils.degToRad(camera.fov)
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * viewportSize.width / viewportSize.height)
    const limitingFov = Math.min(verticalFov, horizontalFov)
    const boundingRadius = characterSize.length() / 2
    const distance = boundingRadius / Math.sin(limitingFov / 2) * 1.15
    const target = scratch.fallbackTarget.set(0, characterSize.y / 2, 0)

    camera.position.copy(target).addScaledVector(scratch.viewDirection, distance)
    camera.near = Math.max(distance / 1000, 0.001)
    camera.far = Math.max(distance * 100, 100)
    camera.updateProjectionMatrix()
    camera.lookAt(target)
    controls.current?.target.copy(target)
    controls.current?.update()
  }, [
    camera,
    characterSize,
    poseSample,
    scratch,
    viewportSize.height,
    viewportSize.width,
  ])

  useFrame((_, rawDelta) => {
    const orbit = controls.current
    if (!orbit) {
      return
    }

    const sample = poseSample.current
    const desired = scratch.desiredTarget
    if (sample.ready) {
      // ALS pivot: midpoint(root, head) — root is the grounded anchor here.
      desired.addVectors(sample.ground, sample.head).multiplyScalar(0.5)
    } else {
      desired.set(0, characterSize.y / 2, 0)
    }
    const delta = Math.min(rawDelta, 1 / 30)
    const lag = 1 - Math.exp(-poseFollow * delta)

    // Translate camera and target together. This follows the live pose without disturbing the
    // orbit the user chose (azimuth, elevation, and zoom remain exactly the OrbitControls values).
    scratch.targetDelta.subVectors(desired, orbit.target).multiplyScalar(lag)
    orbit.target.add(scratch.targetDelta)
    camera.position.add(scratch.targetDelta)
    orbit.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, characterSize.y / 2, 0]}
      minDistance={Math.max(characterSize.length() * 0.2, 0.1)}
      maxDistance={Math.max(characterSize.length() * 8, 10)}
    />
  )
}
