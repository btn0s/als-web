export interface CharacterMovementVelocity {
  x: number
  y: number
  z: number
}

/**
 * `UCharacterMovementComponent::ConstrainAnimRootMotionVelocity()`.
 *
 * Falling keeps CharacterMovement's physics Z velocity so horizontal montage
 * root motion cannot cancel gravity at an edge. Other movement modes accept
 * the complete animation-derived velocity.
 */
export function constrainAnimRootMotionVelocity(
  rootMotionVelocity: Readonly<CharacterMovementVelocity>,
  currentVelocity: Readonly<CharacterMovementVelocity>,
  bIsFalling: boolean,
  out: CharacterMovementVelocity = { x: 0, y: 0, z: 0 },
): CharacterMovementVelocity {
  out.x = rootMotionVelocity.x
  out.y = rootMotionVelocity.y
  out.z = bIsFalling
    ? currentVelocity.z
    : rootMotionVelocity.z
  return out
}
