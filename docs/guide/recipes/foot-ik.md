# Ground and foot IK

Mount local `Character` inside Rapier `Physics`; its control-rig foot trace queries the scene after movement and before pose publication. Put floors in the same world as the capsule. [Character trace setup](../../../src/app/Character.tsx), [trace adapter](../../../src/engine/rapierAlsControlRigFootTrace.ts), [Control Rig](../../../src/als/AnimGraph/CR_Als.ts).

Remote `<AlsRemoteActor snapshots={buffer} footIk={nearby} />` keeps the authored graph but can skip terrain traces for distant actors. `footIk` defaults true; change it by distance without recreating the actor. [Remote actor](../../../src/app/AlsRemoteActor.tsx), [foot trace tests](../../../src/engine/rapierAlsControlRigFootTrace.test.ts). Floor slope/contact policy belongs to CharacterMovement, not the foot trace.
