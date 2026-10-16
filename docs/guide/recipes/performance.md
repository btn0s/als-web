# Performance knobs

Start with `Character snapshotRateHz={20}` for network recording; this rate limits packets, not pose evaluation. [Recorder](../../../src/als/AlsCharacterRecorder.ts), [ghost test scene](../../../src/app/AlsGhostDemo.tsx). For distant remotes, set `<AlsRemoteActor footIk={false} ... />` to remove terrain queries while retaining the graph. [Remote actor](../../../src/app/AlsRemoteActor.tsx).

`AlsRemoteActor` has no camera, local input, movement sweeps or audio, but each remote still owns a skinned mesh and evaluator. The current public actor has no animation LOD or update-rate prop. Profile actor count before adding a consumer-side culling policy; if hidden, continue snapshot/action clock consumption. [Cost inventory](../../../src/app/AlsRemoteActor.tsx), [frame monitor](../../../src/app/FramePerformanceMonitor.tsx).
