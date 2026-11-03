# Remote and replicated character

Prefer `Character onSnapshot={send} snapshotRateHz={20}`. The recorder captures the actual ALS pose state after animation; [ghost example](../../../src/app/AlsGhostDemo.tsx) is compiled and [recorder tests](../../../src/als/AlsCharacterRecorder.test.ts) pin the packet. Push received `AlsCharacterSnapshot` packets into one `AlsSnapshotBuffer` per remote, created at committed mount, then render `<AlsRemoteActor snapshots={buffer} now={clock} />` inside the same Physics world. `now()` and `snapshot.t` must use the same millisecond clock domain. The default interpolation delay is 125 ms and extrapolation cap 100 ms; reset buffer on respawn/clock epoch. [Buffer](../../../src/als/AlsSnapshotBuffer.ts), [buffer tests](../../../src/als/AlsSnapshotBuffer.test.ts), [remote actor](../../../src/app/AlsRemoteActor.tsx).

Snapshot `pos` is the Rapier capsule anchor in three.js metres; `vel` is three.js m/s. Angles are ALS degrees. Preserve `gait`, `stance`, `rotationMode`, `locomotionMode`, `actorYaw`, `viewYaw`, `viewPitch`, `aiming`, `action`, `actionSeq`, overlay and the optional `animation` intent (`hasInput`, `inputYaw`, `targetYaw`, `relativeAcceleration`, montage positions). The [snapshot type](../../../src/als/AlsCharacterSnapshot.ts) is the wire reference. ALS converts raw speed to cm/s inside [animation](../../../src/als/AlsAnimationInstance.ts); Relay must forward m/s. A game protocol using feet positions subtracts `ALS_STANDING_CAPSULE_HALF_HEIGHT` (0.9 m) when encoding and adds it on receipt, even during crouch. The mesh root offset is separate (-0.92 m). Blacksite's adapter in `packages/subject/src/remote-snapshot.ts` does this: `createPawnMoveMessage(snapshot, intent, seq)` preserves recorder gait, stance, body yaw, rotation mode and animation intent; `toAlsRemoteSnapshot(state)` restores them and converts feet to anchor.

`AlsRemoteCharacter` applies a snapshot to animation controls; `AlsRemoteActor` wraps it with mesh, kinematic capsule, action edges and interpolation. Use `onAction` for game presentation and `onUnsupportedState` for ragdoll/get-up states that require a cosmetic ragdoll trigger. Keep authoritative movement in your game sim. `AlsCharacterRecorder` + `AlsSnapshotBuffer` + `AlsRemoteActor` also implement local recorder/ghost playback in [AlsGhostDemo](../../../src/app/AlsGhostDemo.tsx). [Remote driver test](../../../src/als/AlsRemoteCharacter.test.ts).

## A different skinned character

Pass a cached target GLB scene through `renderCharacter`. `AlsRetargetedCharacter` clones its
skeleton, retargets the published ALS pose (including cosmetic ragdolls), and owns cleanup.
It detects bind facing from `clavicle_l` / `clavicle_r`, preserves inserted UE5 bones, and
calibrates the common humanoid chains. The source and target keep their own proportions and
bind transforms; target geometry and materials remain shared with the cached asset.

```tsx
import { AlsRetargetedCharacter } from 'als-ue5-r3f/app/AlsRetargetedCharacter'

<AlsRemoteActor snapshots={snapshots} collisionGroups={0}
  renderCharacter={source => <AlsRetargetedCharacter source={source} target={targetGltf.scene} />}
/>
```

The component's render-function `children` receives the cloned `target`, `translationScale`,
`diagnostics`, and display `object` for consumer-owned props and effects. `meshLayers` is a camera
layer bitmask; shadow-only consumers must also enable that layer on their shadow camera.
`createRetargetedCharacter` from `app/retargetedCharacter` exposes the same lifecycle to imperative
consumers: mount its `object` beside the source, call `update()` after pose publication, then
`dispose()` on teardown. It restores source visibility and frees cloned skeleton resources,
without disposing cached geometry or materials. Source bind data must come from the immutable
ALS asset, before animations or attachments modify its skeleton.
