# ALS mesh FPP arms viewmodel

For a Blacksite game with a TPP ALS body and FPP camera, import `ArmsViewmodel` and `createArmsState` from `@blacksite/subject-fpp/arms`. Create state once, mount `<ArmsViewmodel state={arms} visible={view === 'first-person'} />` under Suspense, and hide the TPP body in FPP. [Compiled multiplayer example](../../../../../packages/subject/src/MultiplayerSubject.tsx), [arms package entry](../../../../../packages/subject-fpp/src/ArmsViewmodel.tsx), [runtime test](../../../../../packages/subject-fpp/src/arms/runtime.test.ts).

Update `arms.weapon`, `arms.aiming`, `arms.speed` (three.js m/s) and `arms.sprinting` from the player's actual frame. Increment `arms.fireSequence` and `arms.reloadSequence` on accepted weapon events; this viewmodel does not decide hits. The mesh is cut from ALS's rig and uses its skeleton. [Arms runtime](../../../../../packages/subject-fpp/src/arms/runtime.ts).

The owned-pack slot is `/assets/arms.json`; [manifest](../../../../../packages/subject-fpp/src/arms/manifest.ts) validates it and `preloadArmsAssets()` loads it. Supply licensed local pack files through the game's asset pipeline; keep pack data out of ALS code. [Pack example](../../../../../site/public/assets/arms.json).
