# Loading, Suspense and actor lifetime

Put `Character`, `AlsCamera` and remote actors inside the Rapier `Physics` world; wrap loading components with Suspense. `Character` has its own load/error state; remote uses `useSuspenseAlsCharacterGltf()`. [Standalone mount](../../../src/app/App.tsx), [asset hook](../../../src/app/AlsCharacterGltf.hooks.ts).

Create a buffer or player with `useMemo`, then subscribe to Relay in `useEffect` after commit. Push packets in the effect callback and unsubscribe in cleanup; reset or replace the buffer on respawn/clock epoch. A subscription created during React render can be consumed by an abandoned Suspense render, losing the spawn. [Blacksite committed subscription](../../../../../packages/subject/src/MultiplayerSubject.tsx), [buffer lifecycle](../../../src/als/AlsSnapshotBuffer.ts). A remote needs one buffer and one `AlsRemoteActor`, keyed by stable actor ID; [ghost example](../../../src/app/AlsGhostDemo.tsx) shows key replacement on clock reset.

In generated Vite apps, set `optimizeDeps.entries=['index.html']` and include `@react-three/rapier > @dimforge/rapier3d-compat`. This keeps Rapier's shape constructors and queries in one module instance; `rawshape_ball` errors in camera traces can otherwise abort later frame subscribers. The Blacksite `btn0s/blacksite-remote-locomotion` branch applies this in `templates/monorepo/vite.config.mjs`.
