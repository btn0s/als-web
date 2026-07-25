import {
  CuboidCollider,
  RigidBody,
} from '@react-three/rapier'

type Vector3Tuple = readonly [number, number, number]

export interface AlsMantlingObstacle {
  readonly name: string
  readonly position: Vector3Tuple
  readonly size: Vector3Tuple
  readonly color: string
  readonly traversal: 'Low' | 'High' | 'Jump'
}

/**
 * ORIGINAL traversal fixtures. ALS's authored L_Als_Grid contains no mantle
 * obstacles, so these remain an app-level playtest layer rather than becoming
 * part of the extracted reference level.
 *
 * Every top sits inside CS_Als_Default's authored GroundedTrace ledge range
 * (0.5–2.25 m). The 1 m block exercises Low mantling, the 1.5 m block exercises
 * High mantling (>1.25 m), and the separated short platforms provide a clear
 * run-and-jump lane.
 */
export const ALS_MANTLING_OBSTACLE_COURSE =
  [
    {
      name: 'ORIGINAL_AlsLowMantlePlatform',
      position: [3, 0.5, 0],
      size: [1.5, 1, 3],
      color: '#747b85',
      traversal: 'Low',
    },
    {
      name: 'ORIGINAL_AlsHighMantlePlatform',
      position: [7, 0.75, 0],
      size: [2.5, 1.5, 3],
      color: '#626a75',
      traversal: 'High',
    },
    {
      name: 'ORIGINAL_AlsJumpTakeoffPlatform',
      position: [3, 0.3, -5],
      size: [3, 0.6, 3],
      color: '#7e858e',
      traversal: 'Jump',
    },
    {
      name: 'ORIGINAL_AlsJumpLandingPlatform',
      position: [7, 0.45, -5],
      size: [3, 0.9, 3],
      color: '#6c747e',
      traversal: 'Jump',
    },
  ] as const satisfies readonly AlsMantlingObstacle[]

export function getAlsMantlingObstacleHalfExtents(
  obstacle: Readonly<AlsMantlingObstacle>,
): [number, number, number] {
  return [
    obstacle.size[0] * 0.5,
    obstacle.size[1] * 0.5,
    obstacle.size[2] * 0.5,
  ]
}

export function AlsMantlingObstacleCourse() {
  return (
    <>
      {ALS_MANTLING_OBSTACLE_COURSE.map((obstacle) => (
        <RigidBody
          key={obstacle.name}
          name={obstacle.name}
          type="fixed"
          colliders={false}
          position={obstacle.position}
        >
          <CuboidCollider
            args={getAlsMantlingObstacleHalfExtents(obstacle)}
            friction={0}
          />
          <mesh castShadow receiveShadow>
            <boxGeometry args={obstacle.size} />
            <meshStandardMaterial
              color={obstacle.color}
              roughness={0.82}
              metalness={0.04}
            />
          </mesh>
        </RigidBody>
      ))}
    </>
  )
}
