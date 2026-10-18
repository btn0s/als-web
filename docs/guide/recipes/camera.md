# Camera modes and one look owner

`AlsCamera` derives TPP, FPP, aim and shoulder view from the character and pose. In the standalone path, it owns pointer/gamepad look; `toggleViewModeKey='Digit2'` switches FPP/TPP and its shoulder binding swaps sides. [Standalone mount](../../../src/app/App.tsx), [input tests](../../../src/app/AlsCamera.input.test.ts).

When Subject owns look, wire the **same** yaw/pitch into both Character's input source and camera. [Compiled Subject mount](../../../../../packages/subject/src/MultiplayerSubject.tsx):

```tsx
<Character inputEnabled={false} inputSource={inputSource} poseSample={subject.player.pose} {...characterProps} />
<AlsCamera controlRotationSource={controlRotationSource} toggleViewModeKey={null}
  poseSample={subject.player.pose} {...cameraProps} />
```

`controlRotationSource` returns `{yaw,pitch}` in ALS degrees. Use `subject.setView('first-person' | 'third-person')` for FPP/TPP; `cameraMode='fpp' | 'tpp'` locks it, `switchable` lets V toggle. Standalone shoulder swap uses `AlsCamera`'s gamepad binding or its existing `KeyC` binding; see [camera implementation](../../../src/app/AlsCamera.tsx). [Camera source test](../../../src/app/AlsCamera.input.test.ts).

`AlsCamera` writes the near clip plane whenever it updates the projection. The default is UE's 10 cm. Pass `nearClipPlane={0.15}` to choose another value, or `nearClipPlane={null}` to keep the `camera.near` the game set, for example from its quality tier. There is no need to re-set `near` each frame. [Projection tests](../../../src/app/AlsCamera.projection.test.ts).
