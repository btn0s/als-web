/**
 * Stable top-level taxonomy for the tuning panel. New controls belong under one of these roots
 * instead of creating feature-specific top-level groups.
 */
export const LEVA_ROOTS = {
  camera: 'Camera',
  movement: 'Movement',
  animation: 'Animation',
  sandbox: 'Sandbox',
  debug: 'Debug',
} as const
