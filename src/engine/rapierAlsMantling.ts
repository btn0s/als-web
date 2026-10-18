import {
  Ball,
  Capsule,
  QueryFilterFlags,
  Ray,
} from '@dimforge/rapier3d-compat'
import type {
  Collider,
  InteractionGroups,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat'
import type {
  AlsCapturedMantlingTarget,
  AlsMantlingCapsuleOverlap,
  AlsMantlingCapsuleSweep,
  AlsMantlingCollisionQuery,
  AlsMantlingSphereSweep,
  AlsMantlingSweepHit,
} from '../als/AlsCharacter_Actions'
import {
  resolveAlsMantlingTargetTransform,
} from '../als/RootMotionSources/AlsRootMotionSource_Mantling'
import type {
  AlsPrimitiveTransform,
  AlsRotator,
  AlsTransform,
} from '../als/RootMotionSources/AlsRootMotionSource_Mantling'
import type {
  AlsQuaternion,
} from '../als/State/AlsFeetState'
import type {
  AlsVector3,
} from '../als/State/AlsLocomotionState'
import {
  threeToUnrealVector,
  unrealToThreeVector,
} from './unrealCoordinateSpace'

export interface RapierAlsMantlingQueryFilter {
  readonly flags?: QueryFilterFlags
  readonly groups?: InteractionGroups
  readonly predicate?: (collider: Collider) => boolean
}

export interface RapierAlsMantlingOptions {
  readonly world: World
  readonly walkableFloorAngleCos: number
  readonly queryFilterForChannel: (
    channel: string,
    responseChannels: readonly string[],
  ) => RapierAlsMantlingQueryFilter
  readonly getOwnerRigidBody?: () => RigidBody | null
  readonly getOwnerColliders?: () => Iterable<Collider>
  /**
   * Rapier has no `ECB_CanStepUp` component response. ORIGINAL adapter policy:
   * omitted callbacks treat the demo's blocking world geometry as step-up
   * enabled. Projects with component policy must supply this callback.
   */
  readonly canCharacterStepUp?: (collider: Collider) => boolean
  /**
   * Optional CharacterMovement walkable-slope override for a primitive.
   * Without it, the inherited WalkableFloorAngle predicate is exact for the
   * ALS demo content, which has no per-component slope override.
   */
  readonly isWalkable?: (
    collider: Collider,
    impactNormal: Readonly<AlsVector3>,
  ) => boolean
  /**
   * Rapier rigid transforms have no scale channel. ORIGINAL adapter policy:
   * the default identity scale is correct when dimensions were baked into
   * collider geometry. Supply this for a separately scaled target component.
   */
  readonly getPrimitiveScale?: (
    collider: Collider,
  ) => Readonly<AlsVector3>
}

export interface RapierAlsMantlingTarget
  extends AlsCapturedMantlingTarget {
  readonly TargetPrimitive: Collider
}

export interface RapierAlsMantlingAdapter {
  readonly Collision: AlsMantlingCollisionQuery
  CaptureTarget(
    TargetPrimitive: unknown,
    TargetLocation: Readonly<AlsVector3>,
    TargetYawAngle: number,
  ): RapierAlsMantlingTarget
  UseRelativeLocation(TargetPrimitive: unknown): boolean
  GetTargetPrimitiveTransform(
    TargetPrimitive: unknown,
  ): AlsPrimitiveTransform
  ResolveTarget(
    TargetPrimitive: unknown,
    TargetRelativeLocation: Readonly<AlsVector3>,
    TargetRelativeRotation: Readonly<AlsRotator>,
  ): AlsTransform
  IsTargetValid(TargetPrimitive: unknown): boolean
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const
const IDENTITY_SCALE = { x: 1, y: 1, z: 1 } as const
const UE_SMALL_NUMBER = 1e-8
const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI

function normalizeAxisDegrees(value: number): number {
  let normalized = value % 360
  if (normalized < 0) normalized += 360
  if (normalized > 180) normalized -= 360
  return normalized === 0 ? 0 : normalized
}

function normalizedQuaternion(
  value: Readonly<AlsQuaternion>,
): AlsQuaternion {
  const squaredLength = (
    value.x * value.x
    + value.y * value.y
    + value.z * value.z
    + value.w * value.w
  )
  if (!(squaredLength > UE_SMALL_NUMBER) || !Number.isFinite(
    squaredLength,
  )) {
    throw new Error(
      'Rapier mantling target rotation must be finite and non-zero',
    )
  }
  const inverseLength = 1 / Math.sqrt(squaredLength)
  return {
    x: value.x * inverseLength,
    y: value.y * inverseLength,
    z: value.z * inverseLength,
    w: value.w * inverseLength,
  }
}

function multiplyQuaternion(
  left: Readonly<AlsQuaternion>,
  right: Readonly<AlsQuaternion>,
): AlsQuaternion {
  return normalizedQuaternion({
    x: (
      left.w * right.x + left.x * right.w
      + left.y * right.z - left.z * right.y
    ),
    y: (
      left.w * right.y - left.x * right.z
      + left.y * right.w + left.z * right.x
    ),
    z: (
      left.w * right.z + left.x * right.y
      - left.y * right.x + left.z * right.w
    ),
    w: (
      left.w * right.w - left.x * right.x
      - left.y * right.y - left.z * right.z
    ),
  })
}

function inverseQuaternion(
  value: Readonly<AlsQuaternion>,
): AlsQuaternion {
  const squaredLength = (
    value.x * value.x
    + value.y * value.y
    + value.z * value.z
    + value.w * value.w
  )
  if (!(squaredLength > UE_SMALL_NUMBER) || !Number.isFinite(
    squaredLength,
  )) {
    throw new Error(
      'Rapier mantling target rotation must be finite and non-zero',
    )
  }
  return {
    x: -value.x / squaredLength,
    y: -value.y / squaredLength,
    z: -value.z / squaredLength,
    w: value.w / squaredLength,
  }
}

function rotateVector(
  rotation: Readonly<AlsQuaternion>,
  value: Readonly<AlsVector3>,
): AlsVector3 {
  const ix = (
    rotation.w * value.x
    + rotation.y * value.z
    - rotation.z * value.y
  )
  const iy = (
    rotation.w * value.y
    + rotation.z * value.x
    - rotation.x * value.z
  )
  const iz = (
    rotation.w * value.z
    + rotation.x * value.y
    - rotation.y * value.x
  )
  const iw = (
    -rotation.x * value.x
    - rotation.y * value.y
    - rotation.z * value.z
  )
  return {
    x: (
      ix * rotation.w
      + iw * -rotation.x
      + iy * -rotation.z
      - iz * -rotation.y
    ),
    y: (
      iy * rotation.w
      + iw * -rotation.y
      + iz * -rotation.x
      - ix * -rotation.z
    ),
    z: (
      iz * rotation.w
      + iw * -rotation.z
      + ix * -rotation.y
      - iy * -rotation.x
    ),
  }
}

function yawToQuaternion(yawAngle: number): AlsQuaternion {
  const halfYaw = yawAngle * DEGREES_TO_RADIANS * 0.5
  return {
    x: 0,
    y: 0,
    z: Math.sin(halfYaw),
    w: Math.cos(halfYaw),
  }
}

function quaternionToRotator(
  quaternion: Readonly<AlsQuaternion>,
): AlsRotator {
  const value = normalizedQuaternion(quaternion)
  const singularityTest = value.z * value.x - value.w * value.y
  const yawY = 2 * (value.w * value.z + value.x * value.y)
  const yawX = 1 - 2 * (value.y * value.y + value.z * value.z)
  let Pitch: number
  let Yaw: number
  let Roll: number
  if (singularityTest < -0.4999995) {
    Pitch = -90
    Yaw = Math.atan2(yawY, yawX) * RADIANS_TO_DEGREES
    Roll = normalizeAxisDegrees(
      -Yaw
      - 2 * Math.atan2(value.x, value.w) * RADIANS_TO_DEGREES,
    )
  } else if (singularityTest > 0.4999995) {
    Pitch = 90
    Yaw = Math.atan2(yawY, yawX) * RADIANS_TO_DEGREES
    Roll = normalizeAxisDegrees(
      Yaw
      - 2 * Math.atan2(value.x, value.w) * RADIANS_TO_DEGREES,
    )
  } else {
    Pitch = (
      Math.asin(Math.max(-1, Math.min(1, 2 * singularityTest)))
      * RADIANS_TO_DEGREES
    )
    Yaw = Math.atan2(yawY, yawX) * RADIANS_TO_DEGREES
    Roll = Math.atan2(
      -2 * (value.w * value.x + value.y * value.z),
      1 - 2 * (value.x * value.x + value.y * value.y),
    ) * RADIANS_TO_DEGREES
  }
  return { Pitch, Yaw, Roll }
}

function rapierToAlsQuaternion(
  value: Readonly<{ x: number; y: number; z: number; w: number }>,
): AlsQuaternion {
  // The extractor basis C is a reflection. Quaternion pseudovectors
  // transform by det(C)C while the scalar component is unchanged.
  return normalizedQuaternion({
    x: -value.x,
    y: -value.z,
    z: -value.y,
    w: value.w,
  })
}

function asCollider(TargetPrimitive: unknown): Collider {
  if (
    typeof TargetPrimitive !== 'object'
    || TargetPrimitive === null
    || typeof (TargetPrimitive as Collider).isValid !== 'function'
  ) {
    throw new Error('ALS mantling target primitive must be a Rapier collider')
  }
  return TargetPrimitive as Collider
}

function useRelativeLocation(collider: Collider): boolean {
  const body = collider.parent()
  return body !== null && !body.isFixed()
}

function getPrimitiveTransform(
  collider: Collider,
  options: Readonly<RapierAlsMantlingOptions>,
): AlsPrimitiveTransform {
  const Location = threeToUnrealVector(collider.translation())
  const scale = options.getPrimitiveScale?.(collider) ?? IDENTITY_SCALE
  return {
    Location: { x: Location.x, y: Location.y, z: Location.z },
    Rotation: rapierToAlsQuaternion(collider.rotation()),
    Scale3D: { x: scale.x, y: scale.y, z: scale.z },
  }
}

function makeCapsule(HalfHeight: number, Radius: number): Capsule {
  if (
    !Number.isFinite(HalfHeight)
    || !Number.isFinite(Radius)
    || Radius < 0
    || HalfHeight < Radius
  ) {
    throw new Error(
      'ALS mantling capsule requires HalfHeight >= Radius >= 0',
    )
  }
  return new Capsule(HalfHeight - Radius, Radius)
}

/**
 * Rapier bridge for the four collision queries and target-component transforms
 * used by `AAlsCharacter::StartMantling()`.
 */
export function createRapierAlsMantling(
  options: Readonly<RapierAlsMantlingOptions>,
): RapierAlsMantlingAdapter {
  const ownerColliderHandles = new Set<number>()
  let filterPredicate:
    | RapierAlsMantlingQueryFilter['predicate']
    | undefined
  const acceptsCollider = (collider: Collider) => (
    !ownerColliderHandles.has(collider.handle)
    && (filterPredicate?.(collider) ?? true)
  )

  const prepareQuery = (
    query:
      | Readonly<AlsMantlingCapsuleSweep>
      | Readonly<AlsMantlingSphereSweep>
      | Readonly<AlsMantlingCapsuleOverlap>,
  ) => {
    const filter = options.queryFilterForChannel(
      query.TraceChannel,
      query.TraceResponseChannels,
    )
    ownerColliderHandles.clear()
    if (query.bIgnoreOwningActor) {
      const ownerColliders = options.getOwnerColliders?.()
      if (ownerColliders) {
        for (const collider of ownerColliders) {
          ownerColliderHandles.add(collider.handle)
        }
      }
    }
    filterPredicate = filter.predicate
    return {
      flags: (
        (filter.flags ?? 0) | QueryFilterFlags.EXCLUDE_SENSORS
      ),
      groups: filter.groups,
      excludeRigidBody: query.bIgnoreOwningActor
        ? options.getOwnerRigidBody?.() ?? undefined
        : undefined,
    }
  }

  const cast = (
    query:
      | Readonly<AlsMantlingCapsuleSweep>
      | Readonly<AlsMantlingSphereSweep>,
    shape: Capsule | Ball,
  ): AlsMantlingSweepHit | null => {
    const start = unrealToThreeVector(query.Start)
    const end = unrealToThreeVector(query.End)
    const queryContext = prepareQuery(query)
    const hit = options.world.castShape(
      start,
      IDENTITY_ROTATION,
      {
        x: end.x - start.x,
        y: end.y - start.y,
        z: end.z - start.z,
      },
      shape,
      0,
      1,
      true,
      queryContext.flags,
      queryContext.groups,
      undefined,
      queryContext.excludeRigidBody,
      acceptsCollider,
    )
    if (hit === null) return null

    const Location = {
      x: query.Start.x + (
        query.End.x - query.Start.x
      ) * hit.time_of_impact,
      y: query.Start.y + (
        query.End.y - query.Start.y
      ) * hit.time_of_impact,
      z: query.Start.z + (
        query.End.z - query.Start.z
      ) * hit.time_of_impact,
    }
    const ImpactPoint = threeToUnrealVector(hit.witness1)
    let surfaceNormal = hit.normal1
    if (shape instanceof Capsule && Math.abs(end.y - start.y) < 1e-6
      && surfaceNormal.y >= options.walkableFloorAngleCos) {
      const face = hit.collider.castRayAndGetNormal(new Ray(
        { x: start.x, y: hit.witness1.y - 1e-6, z: start.z },
        { x: end.x - start.x, y: 0, z: end.z - start.z },
      ), 1, true)
      if (face) surfaceNormal = face.normal
    }
    const ImpactNormal = threeToUnrealVector(surfaceNormal)
    const initialContact = hit.collider.contactShape(
      shape,
      start,
      IDENTITY_ROTATION,
      0,
    )
    const bStartPenetrating = (
      initialContact !== null && initialContact.distance < 0
    )
    const body = hit.collider.parent()
    const targetVelocity = body?.linvel()
    const TargetPrimitiveVelocity = targetVelocity
      ? threeToUnrealVector(targetVelocity)
      : { x: 0, y: 0, z: 0 }
    const bWalkable = !bStartPenetrating && (
      options.isWalkable?.(hit.collider, ImpactNormal)
      ?? ImpactNormal.z >= options.walkableFloorAngleCos
    )

    return {
      bBlockingHit: true,
      bStartPenetrating,
      Location,
      ImpactPoint: {
        x: ImpactPoint.x,
        y: ImpactPoint.y,
        z: ImpactPoint.z,
      },
      ImpactNormal: {
        x: ImpactNormal.x,
        y: ImpactNormal.y,
        z: ImpactNormal.z,
      },
      TargetPrimitive: hit.collider,
      TargetPrimitiveVelocity: {
        x: TargetPrimitiveVelocity.x,
        y: TargetPrimitiveVelocity.y,
        z: TargetPrimitiveVelocity.z,
      },
      bCanCharacterStepUp:
        options.canCharacterStepUp?.(hit.collider) ?? true,
      bWalkable,
    }
  }

  const Collision: AlsMantlingCollisionQuery = {
    SweepCapsule(query) {
      return cast(
        query,
        makeCapsule(query.HalfHeight, query.Radius),
      )
    },
    SweepSphere(query) {
      return cast(query, new Ball(query.Radius))
    },
    OverlapCapsule(query) {
      const location = unrealToThreeVector(query.Location)
      const queryContext = prepareQuery(query)
      return options.world.intersectionWithShape(
        location,
        IDENTITY_ROTATION,
        makeCapsule(query.HalfHeight, query.Radius),
        queryContext.flags,
        queryContext.groups,
        undefined,
        queryContext.excludeRigidBody,
        acceptsCollider,
      ) !== null
    },
  }

  const adapter: RapierAlsMantlingAdapter = {
    Collision,
    CaptureTarget(
      TargetPrimitive,
      TargetLocation,
      TargetYawAngle,
    ) {
      const collider = asCollider(TargetPrimitive)
      const targetRotation = yawToQuaternion(TargetYawAngle)
      if (!useRelativeLocation(collider)) {
        return {
          TargetPrimitive: collider,
          TargetRelativeLocation: {
            x: TargetLocation.x,
            y: TargetLocation.y,
            z: TargetLocation.z,
          },
          TargetRelativeRotation: quaternionToRotator(targetRotation),
        }
      }

      const primitive = getPrimitiveTransform(collider, options)
      const inverseTargetRotation = inverseQuaternion(targetRotation)
      // Exact FTransform direction from ALS:
      // Primitive.GetRelativeTransform(Target), not Target relative Primitive.
      const relativeLocation = rotateVector(inverseTargetRotation, {
        x: primitive.Location.x - TargetLocation.x,
        y: primitive.Location.y - TargetLocation.y,
        z: primitive.Location.z - TargetLocation.z,
      })
      const relativeRotation = multiplyQuaternion(
        inverseTargetRotation,
        primitive.Rotation,
      )
      return {
        TargetPrimitive: collider,
        TargetRelativeLocation: relativeLocation,
        TargetRelativeRotation: quaternionToRotator(relativeRotation),
      }
    },
    UseRelativeLocation(TargetPrimitive) {
      return useRelativeLocation(asCollider(TargetPrimitive))
    },
    GetTargetPrimitiveTransform(TargetPrimitive) {
      return getPrimitiveTransform(
        asCollider(TargetPrimitive),
        options,
      )
    },
    ResolveTarget(
      TargetPrimitive,
      TargetRelativeLocation,
      TargetRelativeRotation,
    ) {
      const collider = asCollider(TargetPrimitive)
      const bUseRelativeLocation = useRelativeLocation(collider)
      return resolveAlsMantlingTargetTransform({
        bUseRelativeLocation,
        TargetPrimitiveTransform: bUseRelativeLocation
          ? getPrimitiveTransform(collider, options)
          : undefined,
        TargetRelativeLocation,
        TargetRelativeRotation,
      })
    },
    IsTargetValid(TargetPrimitive) {
      return (
        typeof TargetPrimitive === 'object'
        && TargetPrimitive !== null
        && typeof (TargetPrimitive as Collider).isValid === 'function'
        && (TargetPrimitive as Collider).isValid()
      )
    },
  }
  return adapter
}
