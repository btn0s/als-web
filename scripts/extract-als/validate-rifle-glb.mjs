// Rifle-specific stage-3 checks. The source is a skeletal mesh authored as
// rigid pieces on SK_Als_Rifle, with no rifle-local animation sequences.
// Usage: node validate-rifle-glb.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core';
import { statSync } from 'node:fs';

const filePath = process.argv[2];
const doc = await new NodeIO().read(filePath);
const root = doc.getRoot();
const skins = root.listSkins();
const joints = skins[0]?.listJoints() ?? [];
const jointNames = joints.map((joint) => joint.getName());
const expectedBones = [
  'root',
  'trigger',
  'magazine',
  'bullets',
  'charging_handle',
  'muzzle',
  'sights',
  'stock',
  'barrel',
];
const expectedBoneSet = new Set(expectedBones);
const meshNodes = root.listNodes().filter((node) => node.getMesh());
const primitives = meshNodes.flatMap((node) => node.getMesh().listPrimitives());
const errors = [];

if (skins.length !== 1) errors.push(`expected one skin, found ${skins.length}`);
if (jointNames.length !== expectedBones.length)
  errors.push(`expected ${expectedBones.length} bones, found ${jointNames.length}`);
for (const bone of expectedBones)
  if (!jointNames.includes(bone)) errors.push(`missing bone: ${bone}`);
for (const bone of jointNames)
  if (!expectedBoneSet.has(bone)) errors.push(`unexpected bone: ${bone}`);
if (new Set(jointNames).size !== jointNames.length) errors.push('duplicate bone names in skin');
if (root.listAnimations().length !== 0)
  errors.push(`expected no rifle-local animations, found ${root.listAnimations().length}`);
if (meshNodes.length !== 1) errors.push(`expected one mesh node, found ${meshNodes.length}`);
if (!meshNodes[0]?.getSkin()) errors.push('rifle mesh node is not skinned');

const boundsMin = [Infinity, Infinity, Infinity];
const boundsMax = [-Infinity, -Infinity, -Infinity];
let vertexCount = 0;
let triangleCount = 0;
let nonRigidVertexCount = 0;
let signedVolume = 0;
for (const [primitiveIndex, primitive] of primitives.entries()) {
  const position = primitive.getAttribute('POSITION');
  const normal = primitive.getAttribute('NORMAL');
  const joints0 = primitive.getAttribute('JOINTS_0');
  const weights0 = primitive.getAttribute('WEIGHTS_0');
  const indices = primitive.getIndices();
  if (!position) errors.push(`primitive ${primitiveIndex} has no POSITION`);
  if (!normal) errors.push(`primitive ${primitiveIndex} has no NORMAL`);
  if (!joints0 || !weights0) errors.push(`primitive ${primitiveIndex} is missing skin attributes`);
  if (!indices) errors.push(`primitive ${primitiveIndex} is not indexed`);
  if (!position || !joints0 || !weights0 || !indices) continue;

  vertexCount += position.getCount();
  triangleCount += indices.getCount() / 3;
  const min = position.getMin([]);
  const max = position.getMax([]);
  for (let axis = 0; axis < 3; axis++) {
    boundsMin[axis] = Math.min(boundsMin[axis], min[axis]);
    boundsMax[axis] = Math.max(boundsMax[axis], max[axis]);
  }

  for (let vertexIndex = 0; vertexIndex < position.getCount(); vertexIndex++) {
    const vertexJoints = joints0.getElement(vertexIndex, []);
    const vertexWeights = weights0.getElement(vertexIndex, []);
    const active = vertexWeights
      .map((weight, index) => ({ weight, joint: vertexJoints[index] }))
      .filter(({ weight }) => weight > 1e-6);
    if (active.length !== 1 || Math.abs(active[0]?.weight - 1) > 1e-6)
      nonRigidVertexCount++;
    for (const { joint } of active)
      if (!Number.isInteger(joint) || joint < 0 || joint >= expectedBones.length)
        errors.push(`primitive ${primitiveIndex} vertex ${vertexIndex} has invalid joint ${joint}`);
  }

  for (let index = 0; index < indices.getCount(); index += 3) {
    const a = position.getElement(indices.getScalar(index), []);
    const b = position.getElement(indices.getScalar(index + 1), []);
    const c = position.getElement(indices.getScalar(index + 2), []);
    signedVolume += (
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
}

const dimensions = boundsMax.map((value, axis) => value - boundsMin[axis]);
const longestAxis = Math.max(...dimensions);
if (vertexCount !== 11754)
  errors.push(`expected 11754 source vertices, found ${vertexCount}`);
if (triangleCount !== 6926)
  errors.push(`expected 6926 source triangles, found ${triangleCount}`);
if (longestAxis < 0.3 || longestAxis > 1.2)
  errors.push(`longest axis ${longestAxis.toFixed(3)}m out of rifle range`);
if (nonRigidVertexCount !== 0)
  errors.push(`${nonRigidVertexCount} vertices are not rigidly skinned`);
if (!(signedVolume > 1e-10))
  errors.push(`signed volume ${signedVolume} is not positive; source-order winding suspect`);

const materials = root.listMaterials();
if (materials.length !== 1) errors.push(`expected one material, found ${materials.length}`);
const baseColor = materials[0]?.getBaseColorFactor() ?? [];
const expectedColor = [1, 0.68, 0.05, 1];
if (expectedColor.some((value, index) => Math.abs(value - baseColor[index]) > 1e-5))
  errors.push(`material color [${baseColor.join(', ')}] does not match MI_Als_Rifle Color`);

console.log(`rifle joints: ${joints.length}/${expectedBones.length} expected (${jointNames.join(', ')})`);
console.log(
  `rifle mesh: ${vertexCount} vertices, ${triangleCount} triangles, ${primitives.length} skinned section, ` +
  `dimensions ${dimensions.map((value) => value.toFixed(3)).join(' x ')}m, longest ${longestAxis.toFixed(3)}m`);
console.log(
  `rifle skinning: rigid (${nonRigidVertexCount} non-rigid vertices), animations: ${root.listAnimations().length}`);
console.log(
  `rifle material: MI_Als_Rifle Color=[${baseColor.map((value) => value.toFixed(2)).join(', ')}]`);
console.log(`rifle winding: source order, signed volume ${signedVolume.toExponential(3)}`);
console.log(`rifle file size: ${statSync(filePath).size} bytes`);
if (errors.length) {
  console.error(`FAIL:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('Rifle GLB validation passed');
