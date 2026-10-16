# Using ALS from a game

ALS Refactored's split is the useful mental model: **Character** owns desired state and action policy; **CharacterMovement** owns capsule, floor, velocity and authored gait speeds; **AnimInstance** derives pose, curves, slots and Control Rig; **Camera** reads the final pose and owns the view. A game sends intent and owns combat, transport and authority. [Character](../../src/als/AlsCharacter.ts), [movement](../../src/als/AlsCharacterMovementComponent.ts), [animation](../../src/als/AlsAnimationInstance.ts), [camera](../../src/app/AlsCamera.tsx).

## Frame order

Set `<Physics updatePriority={ALS_FRAME_PRIORITY.Physics}>`. The explicit [priorities](../../src/engine/alsFramePipeline.ts) are ControlRotation → Character → **Physics** → MeshBase → Animation → PosePublication → Replication → AnimNotifyDispatch → Camera. Evaluate attachments against published bones after Camera. `Character` consumes preceding animation curves once per game frame; the fixed physics step owns motion. A pose or camera call before physics reads stale state. [Stage test](../../src/engine/alsFramePipeline.test.ts).

## Units and axes

Authored ALS movement settings, source vectors, root motion and animation speeds use Unreal centimetres and cm/s, degrees, +X forward, +Y right, +Z up. Rapier, three.js positions and velocities, `AlsCharacterCodeInput.desiredSpeed`, and `AlsCharacterSnapshot.pos`/`.vel` use **metres and m/s**, with three.js +Y up and +Z horizontal. Snapshot angles remain **ALS degrees**. The movement bridge converts at its boundary; [animation](../../src/als/AlsAnimationInstance.ts) multiplies raw m/s speed by 100 for graph inputs. Do not multiply Relay velocities by 100. [Coordinate helpers](../../src/engine/unrealCoordinateSpace.ts) swap Unreal `(x,y,z)` with three `(x,z,y)`; `unrealYawDegreesToThreeRadians` handles yaw sign. [Unit tests](../../src/engine/unrealCoordinateSpace.test.ts). The snapshot position is the Rapier capsule anchor, not feet or mesh root; see [remote recipe](recipes/remote.md).

## Input contract

Return `AlsCharacterCodeInput` from `Character.inputSource`; set `inputEnabled={false}` when another controller owns browser input. [Type](../../src/als/AlsCharacter.hooks.ts), [consumer example](../../src/app/AlsPlayer.ts), [Blacksite Subject bridge](../../../../packages/subject/src/controller.ts).

| Field | Type / default if omitted | Effect |
| --- | --- | --- |
| `active` | boolean / true | False cancels pending jump edges and suppresses a new external jump while physics continues. |
| `jumpSequence` | integer monotonically incremented per press / no external jump | Changed sequence requests one jump at the next physics step. Initial value is baselined on mount; keep it stable across ordinary frames. |
| `movementDirection` | `{x,z}` world horizontal, magnitude ≤1 / browser keys or zero with `inputEnabled=false` | Desired planar direction; camera-relative conversion is skipped when supplied. |
| `desiredGait` | `Walking | Running | Sprinting` / current control (`Running` initially) | Selects semantic gait; ALS selects authored speed and constraints. |
| `desiredStance` | `Standing | Crouching` / current control (`Standing` initially) | Capsule and stance transition. |
| `desiredRotationMode` | `VelocityDirection | ViewDirection | Aiming` / current control (`ViewDirection` initially) | Facing policy; aiming also follows `aiming`. |
| `viewYawAngle`, `viewPitchAngle` | ALS degrees / current view | Camera-facing and aim offsets. |
| `aiming` | boolean / false per input sample | Desired aiming flag. |
| `overlayMode` | built-in or registered string / current mode (`Default` initially) | Linked overlay graph and held object. |
| `desiredSpeed` | m/s / ALS authored gait speed | Explicit movement speed override for special games; use with `desiredGait`, not as a gait selector. |

Character's keyboard/gamepad controls are a separate adapter; [local recipe](recipes/local.md) shows the controlled path. For a coded player send all desired state every sample so controller ownership is obvious. `desiredSpeed` changes a stance's forward/backward speed override, while gait still chooses Walking/Running/Sprinting. [Hook implementation](../../src/als/AlsCharacter.hooks.ts).

## Authority

Local `Character` handles motion and actions. `AlsRemoteActor` and `AlsRemoteCharacter` render received snapshots and do not run local movement policy; they are presentation only. ALS camera and arms viewmodel are also presentation. Game simulation or Relay decides authoritative position, hits, inventory and action acceptance. [Remote driver](../../src/als/AlsRemoteCharacter.ts), [remote actor](../../src/app/AlsRemoteActor.tsx).
