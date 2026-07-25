/**
 * UE expresses these as tick groups and prerequisites:
 * controller view precedes AAlsCharacter, character precedes its skeletal mesh, and
 * UAlsCameraComponent ticks PostPhysics after both the owner and animation evaluation.
 *
 * R3F executes lower priorities first. Keeping every stage explicit prevents HMR or component
 * mount order from changing ALS's one-way frame pipeline.
 */
export const ALS_FRAME_PRIORITY = {
  ControlRotation: -4,
  // AAlsCharacter::Tick() consumes the preceding animation curves once per game frame before
  // Super::Tick() enters CharacterMovement / physics.
  Character: -3.5,
  Physics: -3,
  // CharacterMovement updates the capsule before the skeletal mesh. This presentation seam also
  // cancels fixed-step interpolation across base-maintaining crouch teleports.
  MeshBase: -2.5,
  Animation: -2,
  PosePublication: -1,
  AnimNotifyDispatch: -0.5,
  Camera: -0.25,
  // Read-only instrumentation samples the fully composed character and camera frame.
  Diagnostics: 0,
} as const
