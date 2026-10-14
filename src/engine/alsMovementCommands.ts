type MutableVelocity = { x: number; y: number; z: number }

/** Consumer equivalent of an explicit movement-component velocity reset. */
export function applyAlsImmediateMovementStop(
  requested: boolean | undefined,
  actualVelocity: MutableVelocity,
  intendedVelocity: MutableVelocity,
): boolean {
  if (!requested) return false
  actualVelocity.x = 0
  actualVelocity.y = 0
  actualVelocity.z = 0
  intendedVelocity.x = 0
  intendedVelocity.y = 0
  intendedVelocity.z = 0
  return true
}
