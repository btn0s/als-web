# Local player with input

Create one player command, then feed its semantic state to `Character` at the physics tick. The [Blacksite Subject implementation](../../../../../packages/subject/src/controller.ts) is the compiled example; [controller tests](../../../../../packages/subject/src/controller.test.ts) exercise input. For bare ALS, [AlsPlayer](../../../src/app/AlsPlayer.ts) supplies the mutable command and pose.

```ts
const player = createAlsPlayer({ spawn: [0, 0, 0] })
player.command.forward = 1
player.command.crouch = true
player.command.aim = true
```

`createSubjectInputSource(subject)` maps command forward/right through ALS yaw, and returns `desiredGait: sprint ? 'Sprinting' : 'Running'`, `desiredStance: crouch ? 'Crouching' : 'Standing'`, `desiredRotationMode: 'ViewDirection'`, `viewYawAngle`, `viewPitchAngle`, `aiming`, and `overlayMode`. Mount `<Character inputSource={inputSource} inputEnabled={false} poseSample={player.pose} ... />` inside `<Physics timeStep={1/60} updatePriority={ALS_FRAME_PRIORITY.Physics}>`. The remaining required props and full mount are in [MultiplayerSubject](../../../../../packages/subject/src/MultiplayerSubject.tsx). For walk toggle, return `desiredGait: walking ? 'Walking' : sprint ? 'Sprinting' : 'Running'` with the same stance and direction. [Contract test](../../../src/guide/consumerRecipes.test.ts).
