import { NodeIO } from '@gltf-transform/core';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const assemblePath = join(here, 'assemble-glb.mjs');

const bones = [
  {
    name: 'root',
    parent: -1,
    t: [0, 0, 0],
    r: [0, 0, 0, 1],
    s: [1, 1, 1],
  },
  {
    name: 'pelvis',
    parent: 0,
    t: [0, 0, 100],
    r: [0, 0, 0, 1],
    s: [1, 1, 1],
  },
];

const makeClip = (name, interpolation) => ({
  name,
  interpolation,
  additiveType: 'AAT_None',
  refPoseSeq: '',
  refFrameIndex: 0,
  bEnableRootMotion: false,
  bForceRootLock: false,
  RootMotionRootLock: 'RefPose',
  fps: 30,
  numberOfKeys: 2,
  tracks: bones.map((bone) => ({
    bone: bone.name,
    pos: [bone.t, bone.t],
    rot: [bone.r, bone.r],
    scale: [bone.s, bone.s],
  })),
  curves: [],
  syncMarkers: [],
  notifies: [],
});

const makeDump = (clips) => ({
  skeleton: {
    name: 'FixtureSkeleton',
    bones,
  },
  material: {
    source: 'FixtureMaterial',
    baseColor: [0.5, 0.5, 0.5, 1],
  },
  anims: clips,
});

test('preserves Linear and Step metadata on every emitted transform sampler', async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'als-interpolation-'),
  );
  const dumpPath = join(temporaryDirectory, 'dump.json');
  const glbPath = join(temporaryDirectory, 'fixture.glb');
  try {
    await writeFile(
      dumpPath,
      JSON.stringify(makeDump([
        makeClip('LinearClip', 'Linear'),
        makeClip('StepClip', 'Step'),
      ])));
    await execFileAsync(process.execPath, [
      assemblePath,
      dumpPath,
      glbPath,
    ]);

    const document = await new NodeIO().read(glbPath);
    const animations = new Map(
      document.getRoot().listAnimations().map((animation) => [
        animation.getName(),
        animation,
      ]));
    for (const [name, metadata, samplerInterpolation] of [
      ['LinearClip', 'Linear', 'LINEAR'],
      ['StepClip', 'Step', 'STEP'],
    ]) {
      const animation = animations.get(name);
      assert.ok(animation);
      assert.equal(animation.getExtras().interpolation, metadata);
      assert.equal(animation.listSamplers().length, bones.length * 2);
      assert.deepEqual(
        [...new Set(animation.listSamplers().map(
          (sampler) => sampler.getInterpolation()))],
        [samplerInterpolation],
      );
    }
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
});

test('rejects interpolation modes outside Unreal sequence semantics', async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'als-interpolation-'),
  );
  const dumpPath = join(temporaryDirectory, 'dump.json');
  const glbPath = join(temporaryDirectory, 'fixture.glb');
  try {
    await writeFile(
      dumpPath,
      JSON.stringify(makeDump([
        makeClip('CubicClip', 'Cubic'),
      ])));
    await assert.rejects(
      execFileAsync(process.execPath, [
        assemblePath,
        dumpPath,
        glbPath,
      ]),
      (error) => {
        assert.match(
          error.stderr,
          /unsupported interpolation metadata: "Cubic"/,
        );
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
});
