import type { AlsStance } from '../als/Settings/AlsMovementSettings'

interface RapierStanceCapsule {
  setEnabled(enabled: boolean): void
}

/**
 * Selects the prebuilt standing or crouching collision shape at the Rapier boundary.
 *
 * Rapier can retain a standing contact manifold when an awake collider's capsule half-height and
 * local translation are mutated in place. Keeping both exact shapes alive and switching their
 * enabled state makes the contact-pair change explicit while preserving the capsule base.
 */
export function setRapierAlsStanceCapsules(
  standingCapsule: RapierStanceCapsule | null,
  crouchingCapsule: RapierStanceCapsule | null,
  stance: AlsStance,
): void {
  standingCapsule?.setEnabled(stance === 'Standing')
  crouchingCapsule?.setEnabled(stance === 'Crouching')
}
