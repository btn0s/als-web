# Public entry points

Import package subpaths from [`package.json`](../../package.json); deep source imports below are for implementation tracing.

| Need | Package subpath | Implementation |
| --- | --- | --- |
| Local mesh and capsule | `als-ue5-r3f/app/Character` | [Character.tsx](../../src/app/Character.tsx) |
| Mutable player command | `als-ue5-r3f/app/AlsPlayer` | [AlsPlayer.ts](../../src/app/AlsPlayer.ts) |
| Camera | `als-ue5-r3f/app/AlsCamera` | [AlsCamera.tsx](../../src/app/AlsCamera.tsx) |
| Semantic input type | `als-ue5-r3f/als/AlsCharacter.hooks` | [AlsCharacter.hooks.ts](../../src/als/AlsCharacter.hooks.ts) |
| Frame priorities | `als-ue5-r3f/engine/alsFramePipeline` | [alsFramePipeline.ts](../../src/engine/alsFramePipeline.ts) |
| Remote actor | `als-ue5-r3f/app/AlsRemoteActor` | [AlsRemoteActor.tsx](../../src/app/AlsRemoteActor.tsx) |
| Snapshot and buffer | `als-ue5-r3f/als/AlsCharacterSnapshot`, `als-ue5-r3f/als/AlsSnapshotBuffer` | [snapshot](../../src/als/AlsCharacterSnapshot.ts), [buffer](../../src/als/AlsSnapshotBuffer.ts) |
| Recorder | `als-ue5-r3f/als/AlsCharacterRecorder` | [AlsCharacterRecorder.ts](../../src/als/AlsCharacterRecorder.ts) |
| Custom overlays and upper-body slots | `als-ue5-r3f/als/AnimGraph/consumerOverlayStates`, `als-ue5-r3f/als/AnimGraph/consumerUpperBodySlot` | [overlays](../../src/als/AnimGraph/consumerOverlayStates.ts), [slots](../../src/als/AnimGraph/consumerUpperBodySlot.ts) |
| Asset load | `als-ue5-r3f/app/AlsCharacterGltf.hooks` | [hook](../../src/app/AlsCharacterGltf.hooks.ts) |

The pure `AlsRemoteCharacter` driver, coordinate helpers, action internals and graph evaluators are implementation files. The package exports are the consumer boundary. [Executable example and drift test](../../src/guide/consumerRecipes.test.ts).
