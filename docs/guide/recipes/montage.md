# Fire, reload and equip on upper-body slots

Supply custom clips through `Character.overlayStates`. Keep an action's stable `id` until it finishes; a new ID starts a new montage. [ConsumerUpperBodyMontage type](../../../src/als/AnimGraph/consumerOverlayStates.ts), [slot test](../../../src/als/AnimGraph/consumerUpperBodySlot.test.ts).

```ts
const action = { id: 'reload-17', clip: 'CarryBox_Reload', time: 0, playRate: 1,
  blendIn: 0.1, blendOut: 0.1 }
const registration = { clips, states, sampleMontage: () => action }
```

Advance `time` from your action clock. Return `null` to blend out; changing overlay mode, starting a native action, or starting a new ID interrupts the prior slot. `onMontageSamples` observes active samples. ALS owns spine/head/arm slot regions and montage curves; the consumer does not mask bones. [Runtime](../../../src/als/AnimGraph/consumerUpperBodySlot.ts), [slot tests](../../../src/als/AnimGraph/consumerUpperBodySlot.test.ts). [Blacksite arms action clock](../../../../../packages/subject-fpp/src/arms/runtime.ts) is a separate FPP viewmodel route.
