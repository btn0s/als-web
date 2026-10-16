# Symptoms and rules

| Symptom | Rule | Open |
| --- | --- | --- |
| Legs cycle roughly 2.5× too fast, or a runner is tagged Walking | Send semantic `desiredGait` and let ALS select authored speeds. `desiredSpeed` is m/s only for a deliberate override. | [Input boundary](../guide/overview.md#input-contract), [local recipe](recipes/local.md) |
| Camera seesaws or arms jitter while moving the mouse | Keep one control-rotation owner. With Subject, pass `controlRotationSource` to `AlsCamera` and `inputEnabled={false}` to `Character`. | [Camera recipe](recipes/camera.md) |
| Camera or held object lags one frame; collision and pose disagree | Run Physics at `ALS_FRAME_PRIORITY.Physics`, then pose and camera; resolve attachment bone transforms after the final camera. | [Frame order](overview.md#frame-order), [weapon recipe](recipes/weapon.md) |
| Remote player glides or animates at the wrong speed | Forward the recorded semantic locomotion and animation intent; snapshots are metres/m/s and graph converts to cm/s internally. Preserve capsule-anchor position and separate view yaw/pitch. | [Remote recipe](recipes/remote.md) |
| Spawn vanishes after loading or a remote buffer never receives packets | Create subscriptions after React commit (effect or external store), retain one buffer per actor, and clean up on unmount. A Suspense render may be abandoned. | [Lifecycle recipe](recipes/lifecycle.md) |
| `rawshape_ball` errors stop camera or arms updates while ALS animation time advances | Resolve one Rapier module instance in the generated Vite app; include `@react-three/rapier > @dimforge/rapier3d-compat` in `optimizeDeps.include`. | [Lifecycle recipe](recipes/lifecycle.md) |
