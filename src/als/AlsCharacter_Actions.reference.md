# Ragdoll source and content audit

Source: ALS Refactored 4.15, commit `b3cbf4305358606746f47778f1c2753cd8e3a35a`.
(The authoritative commit is recorded by `git rev-parse 4.15^{commit}` in the extraction checkout.)
In this release ragdoll functions live in `Source/ALS/Private/AlsCharacter_Actions.cpp`,
not a separate `AlsCharacter_Ragdolling.cpp`. The TS mirror is `AlsCharacter_Actions.ts`.

Audit baseline: als-web `63b5362`. These are baseline deviations, not claims about visual symptoms.

| Status | Boundary | Evidence |
| --- | --- | --- |
| VERIFIED | Mass/inertia | `rapierAlsPhysicsAsset.compileBody` substituted volume × 1000 kg/m³ for every unavailable mass. `physics-asset.json` explicitly records effectiveMassKg as unavailable; no native COM, inertia, damping or material defaults were supplied. |
| VERIFIED | Constraints/drives | `rapierAlsRagdoll` used spherical joints plus `angularLimitError` XYZ Euler clamping, arbitrary correction gains and mass-weighted angular-velocity edits. This does not implement the asset's swing cone, twist, motor modes, inverse inertia, projection or soft-limit semantics. |
| VERIFIED | Start velocity | `alsRagdollRuntime.StartRagdolling` zeroed SpeedLimitFrameTimeRemaining whenever an impulse was provided. Native `StartRagdollingImplementation` / `RefreshRagdolling` retain the eight-frame limiter when bLimitInitialRagdollSpeed is enabled. |
| VERIFIED | Death policy | Vendor `keepRagdoll` suppressed StopRagdolling. Native ALS has no death retention mode and no automatic get-up timer; consumer input policy belongs downstream. |
| VERIFIED | Physics asset bodies | Root (authored PhysicsType_Kinematic) was omitted entirely. It is a non-simulated body, not an absent body. |
| VERIFIED | Attachment | DetachMeshKeepWorld, RestoreMeshWorldTransformFromActorBaseOffsets, AttachMeshToCapsuleKeepWorld were no-ops. Native start detaches KeepWorld and stop restores actor/base-offset transform before reattachment. |
| VERIFIED | Snapshot | Baseline copied its previous evaluator buffer and read pelvis from the physics body; native SnapshotFinalRagdollPose captures the rendered skeleton, reads its pelvis socket, then rewrites snapshot pelvis relative to the restored mesh component. Baseline restored against the old component basis. |
| VERIFIED | Get-up | Runtime Montage_Play returned zero, so neither authored montage nor GettingUp action/input lifetime ran. Native stop selects front/back using pelvis roll and starts a montage on a grounded exit. |
| VERIFIED | Frame order | Hook refreshed after physics at MeshBase + .1 with real delta. AAlsCharacter::Tick refreshes ragdoll before skeletal physics; world-time dilation must apply. |
| VERIFIED | Joint animation targets | SetUpdateJointsFromAnimation and initial UpdateRBJointMotors were no-ops. Native enables and updates motors before simulation. |
| VERIFIED | Input | Local ragdoll early return prevented native Jump-to-StopRagdolling. |
| VERIFIED | Query filters | Ground sweep ignored owner/sensors but did not carry the movement collision group's responses. |
| VERIFIED | Animation state | Flail speed formula was equivalent (metres/s ÷ 10), but production bypassed FAlsRagdollingAnimationState. Native RefreshRagdollingOnGameThread only updates FlailPlayRate during Ragdolling. Zero rate freezes the flail player; ALS has no extra stationary-freeze threshold. |
| VERIFIED | Native scaffolding | Existing pure Start/Refresh/Stop, target pull, ground sphere sweep and front/back selection mirror the C++ policy. Defects above are primarily in the live engine adapters. |
| HYPOTHESIS | Reported appearance | Constraint/mass/attachment deviations can explain non-native motion, but no visual comparison establishes each deviation's contribution. Validate with the user's ALS/web comparison after these boundaries are corrected. |

## Authored get-up content

`action-content.json` extracts both AM_Als_GetUp_Front and AM_Als_GetUp_Back:
PostLocomotion / Locomotion, sequence length 1.5 s, RateScale 1.2000000476837158,
zero linear blend-in, 0.30000001192092896 s cubic blend-out, trigger -1.
The GettingUp branching-point end is at 1.1665666103363037 s montage time.
Both sequences have **bEnableRootMotion=false and bForceRootLock=false**.
Do not invent root-motion displacement to complete get-up playback.
AB_Als_Ragdolling blends the final snapshot out over 0.4 s; its ragdoll entry is 0.5 s.

## Extraction boundary

A fresh `dump-physics-asset` from the original 4.15 asset reproduces the checked-in
JSON exactly: 21 bodies, 20 constraints, 49 disabled collision pairs, seven passing
extraction validations. Missing effective masses and inherited defaults cannot be
recovered by repeating that uncooked-property extraction. A native engine export
must record the engine version separately; UE 5.7 results alone do not prove UE 5.5
solver/default equivalence.

## Native runtime evidence and remaining boundaries

`physics-asset-runtime.json` is a headless UE **5.7.4-51494982+++UE5+Release-5.7** export.
The native editor bridge reads FBodyInstance mass-space transform and the complete
FConstraintInstance via reflected JSON (including zeros and inherited defaults).
Python reads initialized body mass/inertia, MassScale, material density/raise-to-power,
damping, iteration counts and independent constraint-library getters. Every live angular
limit agrees with the reflected profile. Pelvis mass is 7.926502227783203 kg, not a guess.

VERIFIED: `PA_Als.uasset` is byte-identical between 4.15 and ue-5.7: 52,745 bytes,
SHA256 `299d44f90d97cfca296cf888df9727c9f3cc9435cc86e11b3525f6f04d45ebb6`.
VERIFIED: lifecycle source differs. ue-5.7 resets body simulation types, adds a stop guard,
and replaces the 4.15 FInterpTo pull with DamperExact. This port retains the **4.15** policy.

VERIFIED corrections: native masses/COM/inertia replace density estimates; all asset bodies
exist, including the kinematic root and its free joint; constraints use resolved connector
frames and swing/twist rows; impulse start retains the native startup limiter; consumer
input configuration replaces vendor death retention; mesh world inheritance is detached;
rendered skeleton snapshots rebase the pelvis after MeshBase; get-up montages and notify
cleanup play; jump can exit ragdoll; refresh uses pre-physics world time; the ground trace
uses movement collision responses; native ragdoll animation state owns flail speed.

The engine row equations are traced to UE 5.7 FPBDJointUtilities and FPBDJointSolver:
GetEllipticalConeAxisErrorLocal, GetLockedRotationAxes, GetSwingAxisAngle,
ApplyRotationConstraintSoftDD, ApplySwingTwistDrives, ApplyPointConstraintDD,
ApplyPointProjection and ApplyTranslateProjection. The engine integration is **original**:
Rapier's public API cannot interleave external rows with its contact solver. Skeletal rows
therefore execute after Rapier integration, with native body position iteration counts.

VERIFIED remaining parity gaps: Rapier contact ordering/material combination, native island
iteration scheduling and hard-limit velocity passes, body inertia conditioning and sleep
islands are not Chaos's implementation. The active PA_Als profiles have no parent domination,
angular projection, restitution or force caps; unsupported general-purpose constraint modes
outside this asset are not advertised. UE 5.7's joint mass-conditioning ratio defaults are
zero, but per-body inertia conditioning remains an engine gap. These boundaries keep ragdoll
physics partial-live even though ALS lifecycle, pose graph and get-up playback are live.
HYPOTHESIS: UE 5.7 native mass/defaults match the engine version originally used by 4.15.
Identical assets establish content parity only; a 5.5 native export would check that hypothesis.
HYPOTHESIS: remaining solver differences are visually acceptable; unit tests establish
conversion, point/frame invariants and lifecycle behavior, not motion/feel equivalence.
