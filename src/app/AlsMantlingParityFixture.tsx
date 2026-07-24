import {
  CuboidCollider,
  RigidBody,
} from '@react-three/rapier'

const FIXTURE_QUERY_PARAMETER = 'alsMantlingFixture'

/**
 * ORIGINAL dev-only proof geometry. ALS's authored L_Als_Grid contains no mantle obstacle, so
 * this stays query-gated and never changes the reference level's normal runtime semantics.
 */
function isAlsMantlingParityFixtureEnabled(
  search: string,
  development: boolean,
): boolean {
  return development
    && new URLSearchParams(search).get(FIXTURE_QUERY_PARAMETER) === '1'
}

export function AlsMantlingParityFixture() {
  if (!isAlsMantlingParityFixtureEnabled(
    window.location.search,
    import.meta.env.DEV,
  )) {
    return null
  }

  return (
    <RigidBody
      name="ORIGINAL_AlsMantlingParityFixture"
      type="fixed"
      colliders={false}
      position={[1, 0.5, 0]}
    >
      <CuboidCollider args={[0.25, 0.5, 1.5]} />
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.5, 1, 3]} />
        <meshStandardMaterial color="#70757d" roughness={0.9} />
      </mesh>
    </RigidBody>
  )
}
