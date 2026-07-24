#!/usr/bin/env node

// Read-only skin-attribution inspector for any uncompressed GLB supported by
// @gltf-transform/core.
//
// Usage:
//   node inspect-skin-glb.mjs <file.glb> [--json]

import { NodeIO } from '@gltf-transform/core';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';

const REPORT_SCHEMA_VERSION = 1;
const WEIGHT_EPSILON = 1e-4;
const MAX_FAILURE_SAMPLES = 8;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const FLOAT = 5126;

const compactNumber = (value) => {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Infinity';
  if (value === -Infinity) return '-Infinity';
  return Number(value.toPrecision(12));
};

const jointRecord = (joint, jointIndex) => ({
  jointIndex,
  jointName: joint.getName() || null,
});

const formatJoint = ({ jointIndex, jointName }) =>
  `${jointIndex}:${jointName ?? '(unnamed)'}`;

const formatJointList = (joints, limit = 12) => {
  if (joints.length === 0) return '(none)';
  const visible = joints.slice(0, limit).map(formatJoint).join(', ');
  return joints.length > limit
    ? `${visible}, … (+${joints.length - limit} more)`
    : visible;
};

const locationFor = (skinIndex, nodeIndex, primitiveIndex) => ({
  skinIndex,
  nodeIndex,
  primitiveIndex,
});

const makeError = (code, message, location = {}) => ({
  code,
  ...location,
  message,
});

const collectSkinSets = (primitive) => {
  const jointsBySet = new Map();
  const weightsBySet = new Map();

  for (const semantic of primitive.listSemantics()) {
    let match = /^JOINTS_(\d+)$/.exec(semantic);
    if (match) {
      jointsBySet.set(Number(match[1]), primitive.getAttribute(semantic));
      continue;
    }
    match = /^WEIGHTS_(\d+)$/.exec(semantic);
    if (match) weightsBySet.set(Number(match[1]), primitive.getAttribute(semantic));
  }

  return [...new Set([...jointsBySet.keys(), ...weightsBySet.keys()])]
    .sort((a, b) => a - b)
    .map((setIndex) => ({
      setIndex,
      joints: jointsBySet.get(setIndex) ?? null,
      weights: weightsBySet.get(setIndex) ?? null,
    }));
};

const inspectPrimitive = ({
  primitive,
  primitiveIndex,
  skinIndex,
  nodeIndex,
  materialIndices,
  joints,
}) => {
  const location = locationFor(skinIndex, nodeIndex, primitiveIndex);
  const errors = [];
  const sets = collectSkinSets(primitive);
  const position = primitive.getAttribute('POSITION');
  const firstSkinAccessor = sets
    .flatMap(({ joints: jointAccessor, weights }) => [jointAccessor, weights])
    .find(Boolean);
  const vertexCount = position?.getCount() ?? firstSkinAccessor?.getCount() ?? 0;
  const material = primitive.getMaterial();
  const materialIndex = material ? (materialIndices.get(material) ?? null) : null;

  if (sets.length === 0) {
    errors.push(makeError(
      'MISSING_SKIN_ATTRIBUTES',
      'Primitive has no JOINTS_n / WEIGHTS_n skin attributes.',
      location,
    ));
  } else if (sets.some(({ setIndex }, arrayIndex) => setIndex !== arrayIndex)) {
    errors.push(makeError(
      'NON_CONTIGUOUS_SKIN_ATTRIBUTE_SETS',
      `Skin attribute sets are [${sets.map(({ setIndex }) => setIndex).join(', ')}], ` +
        'expected contiguous sets beginning at 0.',
      location,
    ));
  }

  for (const set of sets) {
    if (!set.joints || !set.weights) {
      errors.push(makeError(
        'MISSING_SKIN_ATTRIBUTE_PAIR',
        `Skin attribute set ${set.setIndex} is missing ` +
          `${set.joints ? `WEIGHTS_${set.setIndex}` : `JOINTS_${set.setIndex}`}.`,
        location,
      ));
      continue;
    }

    if (set.joints.getType() !== 'VEC4') {
      errors.push(makeError(
        'INVALID_JOINTS_TYPE',
        `JOINTS_${set.setIndex} has type ${set.joints.getType()}, expected VEC4.`,
        location,
      ));
    }
    if (set.weights.getType() !== 'VEC4') {
      errors.push(makeError(
        'INVALID_WEIGHTS_TYPE',
        `WEIGHTS_${set.setIndex} has type ${set.weights.getType()}, expected VEC4.`,
        location,
      ));
    }
    if (![UNSIGNED_BYTE, UNSIGNED_SHORT].includes(set.joints.getComponentType())) {
      errors.push(makeError(
        'INVALID_JOINTS_COMPONENT_TYPE',
        `JOINTS_${set.setIndex} has component type ${set.joints.getComponentType()}, ` +
          'expected UNSIGNED_BYTE or UNSIGNED_SHORT.',
        location,
      ));
    }
    if (set.joints.getNormalized()) {
      errors.push(makeError(
        'INVALID_JOINTS_NORMALIZATION',
        `JOINTS_${set.setIndex} must not be normalized.`,
        location,
      ));
    }

    const weightComponentType = set.weights.getComponentType();
    const validWeightEncoding = weightComponentType === FLOAT ||
      ([UNSIGNED_BYTE, UNSIGNED_SHORT].includes(weightComponentType) &&
        set.weights.getNormalized());
    if (!validWeightEncoding) {
      errors.push(makeError(
        'INVALID_WEIGHTS_COMPONENT_TYPE',
        `WEIGHTS_${set.setIndex} has unsupported component type/normalization ` +
          `${weightComponentType}/${set.weights.getNormalized()}.`,
        location,
      ));
    }

    if (set.joints.getCount() !== set.weights.getCount()) {
      errors.push(makeError(
        'SKIN_ATTRIBUTE_COUNT_MISMATCH',
        `JOINTS_${set.setIndex} has ${set.joints.getCount()} vertices while ` +
          `WEIGHTS_${set.setIndex} has ${set.weights.getCount()}.`,
        location,
      ));
    }
    if (set.joints.getCount() !== vertexCount || set.weights.getCount() !== vertexCount) {
      errors.push(makeError(
        'SKIN_VERTEX_COUNT_MISMATCH',
        `Skin attribute set ${set.setIndex} has ${set.joints.getCount()}/` +
          `${set.weights.getCount()} joint/weight vertices while the primitive has ` +
          `${vertexCount}.`,
        location,
      ));
    }
  }

  const completeSets = sets.filter(({ joints: jointAccessor, weights }) =>
    jointAccessor && weights);
  const inspectedVertexCount = completeSets.length === 0
    ? 0
    : Math.min(
      vertexCount,
      ...completeSets.flatMap(({ joints: jointAccessor, weights }) => [
        jointAccessor.getCount(),
        weights.getCount(),
      ]),
    );
  const histogram = new Map();
  const usedJointIndices = new Set();
  const invalidJointReferenceSamples = [];
  const invalidWeightSamples = [];
  const weightSumFailureSamples = [];
  let rigidVertexCount = 0;
  let invalidJointReferenceCount = 0;
  let invalidWeightCount = 0;
  let weightSumFailureCount = 0;

  for (let vertexIndex = 0; vertexIndex < inspectedVertexCount; vertexIndex++) {
    let positiveInfluenceCount = 0;
    let weightSum = 0;
    let vertexHasInvalidJoint = false;
    let vertexHasInvalidWeight = false;

    for (const set of completeSets) {
      const vertexJoints = set.joints.getElement(vertexIndex, []);
      const vertexWeights = set.weights.getElement(vertexIndex, []);
      const componentCount = Math.min(vertexJoints.length, vertexWeights.length);

      for (let influenceIndex = 0; influenceIndex < componentCount; influenceIndex++) {
        const jointIndex = vertexJoints[influenceIndex];
        const weight = vertexWeights[influenceIndex];
        const validJoint = Number.isInteger(jointIndex) &&
          jointIndex >= 0 &&
          jointIndex < joints.length;
        const validWeight = Number.isFinite(weight) && weight >= 0 && weight <= 1;

        if (!validJoint) {
          invalidJointReferenceCount++;
          vertexHasInvalidJoint = true;
          if (invalidJointReferenceSamples.length < MAX_FAILURE_SAMPLES) {
            invalidJointReferenceSamples.push({
              vertexIndex,
              setIndex: set.setIndex,
              influenceIndex,
              jointIndex: compactNumber(jointIndex),
              weight: compactNumber(weight),
            });
          }
        }
        if (!validWeight) {
          invalidWeightCount++;
          vertexHasInvalidWeight = true;
          if (invalidWeightSamples.length < MAX_FAILURE_SAMPLES) {
            invalidWeightSamples.push({
              vertexIndex,
              setIndex: set.setIndex,
              influenceIndex,
              weight: compactNumber(weight),
            });
          }
        }

        weightSum += weight;
        if (!(weight > 0)) continue;
        positiveInfluenceCount++;
        if (!validJoint) continue;

        usedJointIndices.add(jointIndex);
        const entry = histogram.get(jointIndex) ?? {
          jointIndex,
          jointName: joints[jointIndex].getName() || null,
          positiveInfluenceCount: 0,
          positiveWeightSum: 0,
        };
        entry.positiveInfluenceCount++;
        entry.positiveWeightSum += weight;
        histogram.set(jointIndex, entry);
      }
    }

    const weightSumPasses = Number.isFinite(weightSum) &&
      Math.abs(weightSum - 1) <= WEIGHT_EPSILON;
    if (!weightSumPasses) {
      weightSumFailureCount++;
      if (weightSumFailureSamples.length < MAX_FAILURE_SAMPLES) {
        weightSumFailureSamples.push({
          vertexIndex,
          weightSum: compactNumber(weightSum),
        });
      }
    }

    if (
      positiveInfluenceCount === 1 &&
      weightSumPasses &&
      !vertexHasInvalidJoint &&
      !vertexHasInvalidWeight
    ) {
      rigidVertexCount++;
    }
  }

  if (invalidJointReferenceCount > 0) {
    errors.push(makeError(
      'INVALID_JOINT_REFERENCES',
      `${invalidJointReferenceCount} joint references are outside this skin's ` +
        `${joints.length}-joint palette.`,
      location,
    ));
  }
  if (invalidWeightCount > 0) {
    errors.push(makeError(
      'INVALID_SKIN_WEIGHTS',
      `${invalidWeightCount} skin weights are non-finite or outside [0, 1].`,
      location,
    ));
  }
  if (weightSumFailureCount > 0) {
    errors.push(makeError(
      'SKIN_WEIGHT_SUM_FAILURES',
      `${weightSumFailureCount} vertices have skin weights that do not sum to 1 ` +
        `(tolerance ${WEIGHT_EPSILON}).`,
      location,
    ));
  }

  const positiveWeightJointHistogram = [...histogram.values()]
    .sort((a, b) => a.jointIndex - b.jointIndex)
    .map((entry) => ({
      ...entry,
      positiveWeightSum: compactNumber(entry.positiveWeightSum),
    }));
  const unusedSkinJoints = joints
    .map(jointRecord)
    .filter(({ jointIndex }) => !usedJointIndices.has(jointIndex));

  return {
    primitiveIndex,
    materialIndex,
    materialName: material?.getName() || null,
    vertexCount,
    inspectedVertexCount,
    influenceSetCount: sets.length,
    rigidVertexCount,
    nonRigidVertexCount: inspectedVertexCount - rigidVertexCount,
    positiveWeightJointHistogram,
    usedSkinJointCount: usedJointIndices.size,
    unusedSkinJoints,
    invalidJointReferenceCount,
    invalidJointReferenceSamples,
    invalidWeightCount,
    invalidWeightSamples,
    weightSumFailureCount,
    weightSumFailureSamples,
    errors,
  };
};

export const inspectSkinDocument = (
  document,
  { fileName = null, fileSizeBytes = null } = {},
) => {
  const root = document.getRoot();
  const skins = root.listSkins();
  const nodes = root.listNodes();
  const meshes = root.listMeshes();
  const materials = root.listMaterials();
  const skinIndices = new Map(skins.map((skin, index) => [skin, index]));
  const meshIndices = new Map(meshes.map((mesh, index) => [mesh, index]));
  const materialIndices = new Map(materials.map((material, index) => [material, index]));
  const errors = [];

  if (skins.length === 0) {
    errors.push(makeError(
      'NO_SKINS',
      'Document contains no skins.',
    ));
  }

  const meshNodesBySkin = new Map(skins.map((skin) => [skin, []]));
  let skinnedMeshNodeCount = 0;
  for (const [nodeIndex, node] of nodes.entries()) {
    const skin = node.getSkin();
    if (!skin) continue;
    const skinIndex = skinIndices.get(skin);
    const mesh = node.getMesh();
    if (!mesh) {
      errors.push(makeError(
        'SKINNED_NODE_HAS_NO_MESH',
        `Node ${nodeIndex} references skin ${skinIndex ?? '(unknown)'} but has no mesh.`,
        { skinIndex: skinIndex ?? null, nodeIndex },
      ));
      continue;
    }
    skinnedMeshNodeCount++;
    if (skinIndex === undefined) {
      errors.push(makeError(
        'UNKNOWN_NODE_SKIN',
        `Node ${nodeIndex} references a skin not present in the document root.`,
        { skinIndex: null, nodeIndex },
      ));
      continue;
    }
    meshNodesBySkin.get(skin).push({ node, nodeIndex, mesh });
  }

  if (skins.length > 0 && skinnedMeshNodeCount === 0) {
    errors.push(makeError(
      'NO_SKINNED_MESH_NODES',
      'Document has skins but no mesh node instantiates one.',
    ));
  }

  const skinReports = skins.map((skin, skinIndex) => {
    const joints = skin.listJoints();
    const inverseBindMatrices = skin.getInverseBindMatrices();
    const skinErrors = [];
    if (joints.length === 0) {
      skinErrors.push(makeError(
        'SKIN_HAS_NO_JOINTS',
        `Skin ${skinIndex} has no joints.`,
        { skinIndex },
      ));
    }
    if (
      inverseBindMatrices &&
      (
        inverseBindMatrices.getType() !== 'MAT4' ||
        inverseBindMatrices.getComponentType() !== FLOAT ||
        inverseBindMatrices.getNormalized() ||
        inverseBindMatrices.getCount() !== joints.length
      )
    ) {
      skinErrors.push(makeError(
        'INVALID_INVERSE_BIND_MATRICES',
        `Skin ${skinIndex} inverse bind matrices are ` +
          `${inverseBindMatrices.getType()}/${inverseBindMatrices.getComponentType()}/` +
          `${inverseBindMatrices.getNormalized()}[${inverseBindMatrices.getCount()}], expected ` +
          `MAT4/FLOAT/false[${joints.length}].`,
        { skinIndex },
      ));
    }

    const meshNodes = (meshNodesBySkin.get(skin) ?? []).map(({ node, nodeIndex, mesh }) => {
      if (mesh.listPrimitives().length === 0) {
        skinErrors.push(makeError(
          'SKINNED_MESH_HAS_NO_PRIMITIVES',
          `Skinned mesh node ${nodeIndex} has no primitives.`,
          { skinIndex, nodeIndex },
        ));
      }
      const primitives = mesh.listPrimitives().map((primitive, primitiveIndex) =>
        inspectPrimitive({
          primitive,
          primitiveIndex,
          skinIndex,
          nodeIndex,
          materialIndices,
          joints,
        }));
      for (const primitive of primitives) skinErrors.push(...primitive.errors);
      return {
        nodeIndex,
        nodeName: node.getName() || null,
        meshIndex: meshIndices.get(mesh) ?? null,
        meshName: mesh.getName() || null,
        primitives,
      };
    });

    const usedJointIndices = new Set(
      meshNodes.flatMap(({ primitives }) =>
        primitives.flatMap(({ positiveWeightJointHistogram }) =>
          positiveWeightJointHistogram.map(({ jointIndex }) => jointIndex))),
    );
    const unusedSkinJoints = joints
      .map(jointRecord)
      .filter(({ jointIndex }) => !usedJointIndices.has(jointIndex));
    errors.push(...skinErrors);

    return {
      skinIndex,
      skinName: skin.getName() || null,
      jointCount: joints.length,
      joints: joints.map(jointRecord),
      inverseBindMatrices: inverseBindMatrices
        ? {
            type: inverseBindMatrices.getType(),
            count: inverseBindMatrices.getCount(),
          }
        : null,
      meshNodes,
      usedSkinJointCount: usedJointIndices.size,
      unusedSkinJoints,
    };
  });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    fileName,
    fileSizeBytes,
    valid: errors.length === 0,
    skinCount: skins.length,
    skinnedMeshNodeCount,
    skins: skinReports,
    errors,
  };
};

export const formatHumanReport = (report) => {
  const lines = [
    `Skin binding: ${report.fileName ?? '(in-memory document)'}`,
    `${report.skinCount} skin(s), ${report.skinnedMeshNodeCount} skinned mesh node(s)`,
  ];

  for (const skin of report.skins) {
    lines.push(
      '',
      `Skin ${skin.skinIndex} "${skin.skinName ?? '(unnamed)'}": ` +
        `${skin.jointCount} joints, ${skin.meshNodes.length} mesh instance(s)`,
    );
    for (const meshNode of skin.meshNodes) {
      lines.push(
        `  Mesh node ${meshNode.nodeIndex} "${meshNode.nodeName ?? '(unnamed)'}" / ` +
          `mesh ${meshNode.meshIndex ?? '?'} "${meshNode.meshName ?? '(unnamed)'}"`,
      );
      for (const primitive of meshNode.primitives) {
        const histogram = primitive.positiveWeightJointHistogram.length
          ? primitive.positiveWeightJointHistogram
            .map((entry) =>
              `${formatJoint(entry)}=${entry.positiveInfluenceCount} ` +
                `(weight ${entry.positiveWeightSum})`)
            .join(', ')
          : '(none)';
        lines.push(
          `    Primitive ${primitive.primitiveIndex}, material ` +
            `"${primitive.materialName ?? '(unnamed)'}": ${primitive.vertexCount} vertices`,
          `      rigid/non-rigid: ${primitive.rigidVertexCount}/` +
            `${primitive.nonRigidVertexCount}; inspected ${primitive.inspectedVertexCount}`,
          `      positive joint histogram (${primitive.usedSkinJointCount}/` +
            `${skin.jointCount} joints used): ${histogram}`,
          `      unused skin joints (${primitive.unusedSkinJoints.length}): ` +
            formatJointList(primitive.unusedSkinJoints),
          `      invalid refs/weights/sums: ${primitive.invalidJointReferenceCount}/` +
            `${primitive.invalidWeightCount}/${primitive.weightSumFailureCount}`,
        );
      }
    }
    lines.push(
      `  Skin-wide attribution: ${skin.usedSkinJointCount}/${skin.jointCount} joints used`,
      `  Skin-wide unused joints (${skin.unusedSkinJoints.length}): ` +
        formatJointList(skin.unusedSkinJoints),
    );
  }

  lines.push('');
  if (report.valid) {
    lines.push('PASS: skin data is structurally valid.');
  } else {
    lines.push(`FAIL: ${report.errors.length} skin-data error(s):`);
    for (const error of report.errors) {
      lines.push(`  ${error.code}: ${error.message}`);
    }
  }
  return lines.join('\n');
};

const usage = () =>
  'usage: node scripts/extract-als/inspect-skin-glb.mjs <file.glb> [--json]';

export const main = async (argv = process.argv.slice(2)) => {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return 0;
  }

  const json = argv.includes('--json');
  const positional = argv.filter((argument) => argument !== '--json');
  if (positional.length !== 1 || argv.some((argument) =>
    argument.startsWith('-') && argument !== '--json')) {
    const message = usage();
    if (json) {
      console.log(JSON.stringify({
        schemaVersion: REPORT_SCHEMA_VERSION,
        valid: false,
        errors: [{ code: 'INVALID_ARGUMENTS', message }],
      }, null, 2));
    } else {
      console.error(message);
    }
    return 2;
  }

  const inputPath = resolve(positional[0]);
  let fileSizeBytes;
  try {
    fileSizeBytes = (await stat(inputPath)).size;
  } catch {
    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      fileName: basename(inputPath),
      fileSizeBytes: null,
      valid: false,
      skinCount: 0,
      skinnedMeshNodeCount: 0,
      skins: [],
      errors: [{
        code: 'FILE_NOT_FOUND',
        message: `Unable to read "${basename(inputPath)}".`,
      }],
    };
    console[json ? 'log' : 'error'](
      json ? JSON.stringify(report, null, 2) : formatHumanReport(report),
    );
    return 1;
  }

  let document;
  try {
    document = await new NodeIO().read(inputPath);
  } catch {
    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      fileName: basename(inputPath),
      fileSizeBytes,
      valid: false,
      skinCount: 0,
      skinnedMeshNodeCount: 0,
      skins: [],
      errors: [{
        code: 'GLB_READ_FAILED',
        message: `"${basename(inputPath)}" is not a readable supported GLB.`,
      }],
    };
    console[json ? 'log' : 'error'](
      json ? JSON.stringify(report, null, 2) : formatHumanReport(report),
    );
    return 1;
  }

  const report = inspectSkinDocument(document, {
    fileName: basename(inputPath),
    fileSizeBytes,
  });
  console.log(json ? JSON.stringify(report, null, 2) : formatHumanReport(report));
  return report.valid ? 0 : 1;
};

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = await main();
