import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { measureGait } from './locomotionProfile';

function rootMotionClip(name: string, times: number[], positions: number[]) {
  return new THREE.AnimationClip(
    name,
    times[times.length - 1],
    [new THREE.VectorKeyframeTrack('root.position', times, positions)],
  );
}

function rootPositions(clip: THREE.AnimationClip) {
  return Array.from(clip.tracks[0].values);
}

describe('measureGait root-motion cleanup', () => {
  it('measures XZ stride and removes a traversal root-Y rise without erasing its local bob', () => {
    const clip = rootMotionClip(
      'ClimbUp_1m',
      [0, 0.25, 1],
      [
        2, 0.25, 3,
        2.5, 0.875, 3.5,
        3, 1.25, 3,
      ],
    );

    const gait = measureGait(clip);

    expect(gait).toEqual({ duration: 1, stride: 1, speed: 1 });
    expect(rootPositions(clip)).toEqual([
      2, 0.25, 3,
      2, 0.625, 3,
      2, 0.25, 3,
    ]);
    // A second consumer must get the cached pre-strip stride without normalizing the track again.
    expect(measureGait(clip)).toEqual(gait);
    expect(rootPositions(clip)).toEqual([
      2, 0.25, 3,
      2, 0.625, 3,
      2, 0.25, 3,
    ]);
  });

  it('keeps the root-Y bob and small closing drift of a locomotion loop', () => {
    const clip = rootMotionClip(
      'Walk_Loop',
      [0, 0.5, 1],
      [
        0, 0.125, 0,
        0, 0.25, 1,
        0, 0.15625, 2,
      ],
    );

    expect(measureGait(clip).stride).toBe(2);
    expect(rootPositions(clip)).toEqual([
      0, 0.125, 0,
      0, 0.25, 0,
      0, 0.15625, 0,
    ]);
  });
});
