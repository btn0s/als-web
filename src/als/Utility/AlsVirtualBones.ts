import type { VirtualBoneDefinition } from '../../engine/rig'

/**
 * SK_Als virtual-bone compact-pose order.
 *
 * Source and target names are serialized in Content/ALS/Character/SK_Als.uasset. Unreal appends
 * these after the 68 physical reference bones; each generated local transform is
 * `inverse(SourceComponent) * TargetComponent`.
 */
export const ALS_VIRTUAL_BONES = [
  {
    name: 'VB foot_root',
    sourceBoneName: 'root',
    targetBoneName: 'root',
  },
  {
    name: 'VB foot_l',
    sourceBoneName: 'VB foot_root',
    targetBoneName: 'foot_l',
  },
  {
    name: 'VB foot_r',
    sourceBoneName: 'VB foot_root',
    targetBoneName: 'foot_r',
  },
  {
    name: 'VB hand_l_to_hand_r',
    sourceBoneName: 'hand_l',
    targetBoneName: 'hand_r',
  },
  {
    name: 'VB hand_r',
    sourceBoneName: 'VB hand_l_to_hand_r',
    targetBoneName: 'hand_r',
  },
  {
    name: 'VB hand_l_to_ik_hand_gun',
    sourceBoneName: 'hand_l',
    targetBoneName: 'ik_hand_gun',
  },
  {
    name: 'VB ik_hand_r',
    sourceBoneName: 'VB hand_l_to_ik_hand_gun',
    targetBoneName: 'hand_r',
  },
  {
    name: 'VB hand_r_to_hand_r',
    sourceBoneName: 'hand_r',
    targetBoneName: 'hand_r',
  },
  {
    name: 'VB hand_l',
    sourceBoneName: 'VB hand_r_to_hand_r',
    targetBoneName: 'hand_l',
  },
  {
    name: 'VB hand_r_to_ik_hand_gun',
    sourceBoneName: 'hand_r',
    targetBoneName: 'ik_hand_gun',
  },
  {
    name: 'VB ik_hand_l',
    sourceBoneName: 'VB hand_r_to_ik_hand_gun',
    targetBoneName: 'hand_l',
  },
] as const satisfies readonly VirtualBoneDefinition[]

