import * as THREE from 'three'

type LinearRgb = readonly [red: number, green: number, blue: number]

export interface CharacterMaterialParams {
  readonly color: LinearRgb
  readonly roughness: number
  readonly metalness: number
  readonly emissive?: LinearRgb
  readonly emissiveIntensity?: number
}

const ALS_BODY_MATERIAL = {
  // MI_Als_Character.Color is an FLinearColor. Keep these values in linear working space.
  // StandardMaterial's dielectric F0 is 0.04, matching UE's authored Specular 0.5 (0.08 × 0.5).
  color: [0.2, 0.2, 1] as const,
  roughness: 1,
  metalness: 0,
} satisfies CharacterMaterialParams

export const CHARACTER_MATERIAL_PARAMS = {
  Pelvis_MAT: ALS_BODY_MATERIAL,
  Torso_MAT: ALS_BODY_MATERIAL,
  Head_MAT: ALS_BODY_MATERIAL,
  Shoulder_L_MAT: ALS_BODY_MATERIAL,
  Shoulder_R_MAT: ALS_BODY_MATERIAL,
  UpperArm_L_MAT: ALS_BODY_MATERIAL,
  UpperArm_R_MAT: ALS_BODY_MATERIAL,
  LowerArm_L_MAT: ALS_BODY_MATERIAL,
  LowerArm_R_MAT: ALS_BODY_MATERIAL,
  Hand_L_MAT: ALS_BODY_MATERIAL,
  Hand_R_MAT: ALS_BODY_MATERIAL,
  UpperLeg_MAT: ALS_BODY_MATERIAL,
  LowerLeg_MAT: ALS_BODY_MATERIAL,
  Feet_MAT: ALS_BODY_MATERIAL,
  Eyes_MAT: {
    // Eyes_MAT references M_Als_Main directly, whose Color parameter default is linear white.
    color: [1, 1, 1],
    roughness: 1,
    metalness: 0,
    emissive: [1, 1, 1],
    emissiveIntensity: 0.18,
  },
} as const satisfies Record<string, CharacterMaterialParams>

function linearColor([red, green, blue]: LinearRgb) {
  return new THREE.Color().setRGB(red, green, blue)
}

function createMaterial(name: string, params: CharacterMaterialParams) {
  return new THREE.MeshStandardMaterial({
    name,
    color: linearColor(params.color),
    roughness: params.roughness,
    metalness: params.metalness,
    emissive: params.emissive ? linearColor(params.emissive) : new THREE.Color(0, 0, 0),
    emissiveIntensity: params.emissiveIntensity ?? 0,
  })
}

/**
 * Replaces neutral GLB materials at the named-slot seam. The source GLB deliberately stays
 * presentation-agnostic; future character props can extend the table without changing traversal.
 */
export function applyCharacterMaterialOverrides(root: THREE.Object3D) {
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  for (const [name, params] of Object.entries(CHARACTER_MATERIAL_PARAMS)) {
    materials.set(name, createMaterial(name, params))
  }

  const replaceMaterial = (material: THREE.Material) => materials.get(material.name) ?? material

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) {
      return
    }

    object.material = Array.isArray(object.material)
      ? object.material.map(replaceMaterial)
      : replaceMaterial(object.material)
    object.castShadow = true
    object.receiveShadow = true
  })

  return materials
}
