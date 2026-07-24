import {
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
} from '@react-three/postprocessing'
import { useThree } from '@react-three/fiber'
import {
  CuboidCollider,
  RigidBody,
} from '@react-three/rapier'
import { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import {
  BlendFunction,
  Effect,
  ToneMappingMode,
} from 'postprocessing'
import {
  createUniformUnrealSkyLightEnvironmentTexture,
} from '../../../engine/unrealSkyLight'
import {
  UNREAL_VIGNETTE_FRAGMENT_SHADER,
} from '../../../engine/unrealVignette'
import {
  M_ALS_GRID_FRAGMENT_SHADER,
  M_ALS_GRID_PARAMETERS,
  M_ALS_GRID_VERTEX_SHADER,
} from '../Environment/Materials/M_Als_Grid'
import { M_ALS_SKY_SPHERE_COLOR } from '../Environment/Materials/M_Als_SkySphere'
import {
  L_ALS_GRID_CONTENT,
  unrealCentimetersToMeters,
} from './L_Als_Grid.content'

const FLOOR_HALF_EXTENT_X = unrealCentimetersToMeters(
  L_ALS_GRID_CONTENT.floor.boundsExtentCm.X,
)
const FLOOR_HALF_EXTENT_Z = unrealCentimetersToMeters(
  L_ALS_GRID_CONTENT.floor.boundsExtentCm.Y,
)
const FLOOR_COLLIDER_HALF_HEIGHT = 0.05
const WEB_SKYLIGHT_AO_RADIUS = 0.35
const WEB_SKYLIGHT_AO_DISTANCE_FALLOFF = 0.75
const WEB_SKYLIGHT_AO_INTENSITY = 0.7

// /Engine/BasicShapes/Sphere is one metre in diameter. The authored actor scale
// is 1000, producing the 500 metre sky radius used by L_Als_Grid.
const SKY_SPHERE_RADIUS =
  0.5 * L_ALS_GRID_CONTENT.skySphere.RelativeScale3D.X

export function L_Als_GridFloor() {
  const uniforms = useMemo(
    () => ({
      CellWidth: { value: M_ALS_GRID_PARAMETERS.CellWidth },
      FadeOffset: { value: M_ALS_GRID_PARAMETERS.FadeOffset },
      FadeLength: { value: M_ALS_GRID_PARAMETERS.FadeLength },
      FadeExponent: { value: M_ALS_GRID_PARAMETERS.FadeExponent },
      LineWidthExponent: { value: M_ALS_GRID_PARAMETERS.LineWidthExponent },
      LineWidthMultiplier: {
        value: M_ALS_GRID_PARAMETERS.LineWidthMultiplier,
      },
    }),
    [],
  )

  return (
    <mesh
      name={L_ALS_GRID_CONTENT.floor.actorLabel}
      castShadow={L_ALS_GRID_CONTENT.floor.CastShadow}
      receiveShadow={false}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[
        FLOOR_HALF_EXTENT_X * 2,
        FLOOR_HALF_EXTENT_Z * 2,
      ]} />
      <shaderMaterial
        name={L_ALS_GRID_CONTENT.floor.material}
        uniforms={uniforms}
        vertexShader={M_ALS_GRID_VERTEX_SHADER}
        fragmentShader={M_ALS_GRID_FRAGMENT_SHADER}
        side={THREE.DoubleSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

interface LAlsGridFloorCollisionProps {
  /**
   * Rapier owns locomotion integration in this port, so its zero-friction
   * controller seam remains explicit instead of pretending it was authored by ALS.
   */
  readonly friction?: number
}

export function L_Als_GridFloorCollision({
  friction = 0,
}: LAlsGridFloorCollisionProps) {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[
          FLOOR_HALF_EXTENT_X,
          FLOOR_COLLIDER_HALF_HEIGHT,
          FLOOR_HALF_EXTENT_Z,
        ]}
        position={[0, -FLOOR_COLLIDER_HALF_HEIGHT, 0]}
        friction={friction}
      />
    </RigidBody>
  )
}

export function L_Als_GridSkySphere() {
  const color = useMemo(
    () => new THREE.Color().setRGB(...M_ALS_SKY_SPHERE_COLOR),
    [],
  )

  return (
    <mesh
      name={L_ALS_GRID_CONTENT.skySphere.actorLabel}
      castShadow={L_ALS_GRID_CONTENT.skySphere.CastShadow}
    >
      <sphereGeometry args={[SKY_SPHERE_RADIUS, 32, 16]} />
      <meshBasicMaterial
        name={L_ALS_GRID_CONTENT.skySphere.material}
        color={color}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function L_Als_GridSkyLight() {
  const scene = useThree((state) => state.scene)
  const environment = useMemo(
    () => createUniformUnrealSkyLightEnvironmentTexture({
      name: L_ALS_GRID_CONTENT.skyLight.Cubemap,
      upperHemisphereColor:
        L_ALS_GRID_CONTENT.skyLight.cubemapSource.ColorMin,
      lowerHemisphereIsBlack:
        L_ALS_GRID_CONTENT.skyLight.bLowerHemisphereIsBlack,
      lowerHemisphereColor:
        L_ALS_GRID_CONTENT.skyLight.LowerHemisphereColor,
    }),
    [],
  )

  useLayoutEffect(() => {
    const previousEnvironment = scene.environment
    const previousIntensity = scene.environmentIntensity
    scene.environment = environment
    scene.environmentIntensity = L_ALS_GRID_CONTENT.skyLight.Intensity
    return () => {
      if (scene.environment === environment) {
        scene.environment = previousEnvironment
        scene.environmentIntensity = previousIntensity
      }
      environment.dispose()
    }
  }, [environment, scene])

  return null
}

function L_Als_GridVignette({ intensity }: { readonly intensity: number }) {
  const { width, height } = useThree((state) => state.size)
  const effect = useMemo(
    () => new Effect(
      'L_Als_Grid.Vignette',
      UNREAL_VIGNETTE_FRAGMENT_SHADER,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map([
          ['intensity', new THREE.Uniform(intensity)],
          ['inverseAspectRatio', new THREE.Uniform(height / width)],
        ]),
      },
    ),
    [height, intensity, width],
  )

  useLayoutEffect(() => () => effect.dispose(), [effect])

  return <primitive object={effect} dispose={null} />
}

export function L_Als_GridPostProcess() {
  const settings = L_ALS_GRID_CONTENT.postProcess.settings
  return (
    <EffectComposer multisampling={0}>
      {/*
       * Unreal's specified-cubemap SkyLight gets its local/contact shadowing from the engine's
       * ambient-occlusion stage. N8AO is the WebGL runtime adapter for that missing renderer pass.
       */}
      <N8AO
        aoRadius={WEB_SKYLIGHT_AO_RADIUS}
        distanceFalloff={WEB_SKYLIGHT_AO_DISTANCE_FALLOFF}
        intensity={WEB_SKYLIGHT_AO_INTENSITY}
        quality="performance"
        halfRes
        depthAwareUpsampling
      />
      <L_Als_GridVignette intensity={settings.VignetteIntensity} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  )
}

export function L_Als_Grid() {
  return (
    <>
      <L_Als_GridSkySphere />
      <L_Als_GridSkyLight />
      <L_Als_GridFloor />
      <L_Als_GridPostProcess />
    </>
  )
}
