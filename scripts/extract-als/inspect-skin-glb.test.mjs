import { Document, NodeIO } from '@gltf-transform/core';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  formatHumanReport,
  inspectSkinDocument,
} from './inspect-skin-glb.mjs';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, 'inspect-skin-glb.mjs');

const identityMatrices = (count) => new Float32Array(
  Array.from({ length: count }, () => [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]).flat(),
);

const createFixture = ({
  jointArray = new Uint16Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]),
  weightArray = new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]),
} = {}) => {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene('Scene');
  const left = document.createNode('left');
  const right = document.createNode('right');
  left.addChild(right);
  scene.addChild(left);

  const skin = document.createSkin('FixtureSkin')
    .setSkeleton(left)
    .addJoint(left)
    .addJoint(right)
    .setInverseBindMatrices(document.createAccessor()
      .setType('MAT4')
      .setArray(identityMatrices(2))
      .setBuffer(buffer));
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]))
      .setBuffer(buffer))
    .setAttribute('JOINTS_0', document.createAccessor()
      .setType('VEC4')
      .setArray(jointArray)
      .setBuffer(buffer))
    .setAttribute('WEIGHTS_0', document.createAccessor()
      .setType('VEC4')
      .setArray(weightArray)
      .setBuffer(buffer))
    .setMaterial(document.createMaterial('Body'));
  const mesh = document.createMesh('FixtureMesh').addPrimitive(primitive);
  scene.addChild(document.createNode('FixtureMeshNode').setMesh(mesh).setSkin(skin));
  return document;
};

test('reports a valid all-left rigid binding without treating the unused joint as invalid', () => {
  const report = inspectSkinDocument(createFixture(), {
    fileName: 'fixture.glb',
    fileSizeBytes: 123,
  });
  const primitive = report.skins[0].meshNodes[0].primitives[0];

  assert.equal(report.valid, true);
  assert.equal(primitive.rigidVertexCount, 3);
  assert.equal(primitive.nonRigidVertexCount, 0);
  assert.deepEqual(primitive.positiveWeightJointHistogram, [{
    jointIndex: 0,
    jointName: 'left',
    positiveInfluenceCount: 3,
    positiveWeightSum: 3,
  }]);
  assert.deepEqual(primitive.unusedSkinJoints, [{
    jointIndex: 1,
    jointName: 'right',
  }]);
  assert.match(
    formatHumanReport(report),
    /positive joint histogram \(1\/2 joints used\): 0:left=3/,
  );
  assert.match(formatHumanReport(report), /unused skin joints \(1\): 1:right/);
  assert.equal(JSON.stringify(report), JSON.stringify(
    inspectSkinDocument(createFixture(), {
      fileName: 'fixture.glb',
      fileSizeBytes: 123,
    }),
  ));
});

test('fails malformed joint references and skin-weight sums with bounded samples', () => {
  const report = inspectSkinDocument(createFixture({
    jointArray: new Uint16Array([
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
    weightArray: new Float32Array([
      1, 0, 0, 0,
      0.5, 0, 0, 0,
      1.1, -0.1, 0, 0,
    ]),
  }));
  const primitive = report.skins[0].meshNodes[0].primitives[0];

  assert.equal(report.valid, false);
  assert.equal(primitive.invalidJointReferenceCount, 1);
  assert.equal(primitive.invalidWeightCount, 2);
  assert.equal(primitive.weightSumFailureCount, 1);
  assert.deepEqual(
    report.errors.map(({ code }) => code),
    [
      'INVALID_JOINT_REFERENCES',
      'INVALID_SKIN_WEIGHTS',
      'SKIN_WEIGHT_SUM_FAILURES',
    ],
  );
});

test('CLI reads a generated GLB and emits deterministic machine-readable JSON', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'als-skin-inspector-'));
  const fixturePath = join(temporaryDirectory, 'fixture.glb');
  const invalidFixturePath = join(temporaryDirectory, 'invalid.glb');
  try {
    await new NodeIO().write(fixturePath, createFixture());
    await new NodeIO().write(invalidFixturePath, createFixture({
      jointArray: new Uint16Array([
        2, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }));
    const first = await execFileAsync(process.execPath, [cliPath, fixturePath, '--json']);
    const second = await execFileAsync(process.execPath, [cliPath, fixturePath, '--json']);
    const report = JSON.parse(first.stdout);

    assert.equal(first.stdout, second.stdout);
    assert.equal(report.valid, true);
    assert.equal(report.fileName, 'fixture.glb');
    assert.equal(
      report.skins[0].meshNodes[0].primitives[0]
        .positiveWeightJointHistogram[0].jointName,
      'left',
    );
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath, invalidFixturePath, '--json']),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).valid, false);
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
