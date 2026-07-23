import { describe, expect, it, vi } from 'vitest';
import { createActionSequence } from './actionSequence';

describe('createActionSequence', () => {
  it('is inactive with 0 progress before start, and ignores update()', () => {
    const seq = createActionSequence({ duration: 1 });
    expect(seq.active).toBe(false);
    expect(seq.progress).toBe(0);
    seq.update(0.5);
    expect(seq.progress).toBe(0); // no-op while inactive
  });

  it('ramps progress 0..1 over the duration and completes once', () => {
    const onComplete = vi.fn();
    const seq = createActionSequence({ duration: 1, onComplete });
    seq.start();
    seq.update(0.25);
    expect(seq.progress).toBeCloseTo(0.25);
    expect(seq.active).toBe(true);
    seq.update(0.5);
    expect(seq.progress).toBeCloseTo(0.75);
    seq.update(0.5); // crosses the end
    expect(seq.progress).toBe(1);
    expect(seq.active).toBe(false);
    expect(onComplete).toHaveBeenCalledTimes(1);
    seq.update(1); // inactive now — no further completes
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('fires cues once when the playhead reaches them, and onComplete at 1', () => {
    const order: string[] = [];
    const seq = createActionSequence({
      duration: 1,
      // deliberately out of order to prove they fire by `at`, not array order
      cues: [
        { at: 0.75, fire: () => order.push('c') },
        { at: 0.25, fire: () => order.push('a') },
        { at: 0.5, fire: () => order.push('b') },
      ],
      onComplete: () => order.push('done'),
    });
    seq.start();
    seq.update(0.6); // crosses 0.25 and 0.5 in one frame -> a then b
    expect(order).toEqual(['a', 'b']);
    seq.update(0.6); // crosses 0.75 and reaches 1 -> c then done
    expect(order).toEqual(['a', 'b', 'c', 'done']);
    // no double-fire on further updates
    seq.start();
    seq.update(2);
    expect(order.filter((x) => x === 'a')).toHaveLength(2); // fresh run re-fires
  });

  it('cancel() aborts: fires onCancel, stops, and suppresses remaining cues/onComplete', () => {
    const onCancel = vi.fn();
    const onComplete = vi.fn();
    const cue = vi.fn();
    const seq = createActionSequence({ duration: 1, cues: [{ at: 0.9, fire: cue }], onCancel, onComplete });
    seq.start();
    seq.update(0.5);
    seq.cancel();
    expect(seq.active).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    seq.update(1); // inactive
    expect(cue).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    seq.cancel(); // cancelling when already inactive is a no-op
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('resolves a function duration at each start (picks up live-tuned values)', () => {
    let dur = 1;
    const seq = createActionSequence({ duration: () => dur });
    seq.start();
    seq.update(0.5);
    expect(seq.progress).toBeCloseTo(0.5);
    dur = 2; // retuned between runs
    seq.start();
    seq.update(0.5);
    expect(seq.progress).toBeCloseTo(0.25); // 0.5 / 2
  });

  it('completes instantly on the first update when duration <= 0', () => {
    const onComplete = vi.fn();
    const cue = vi.fn();
    const seq = createActionSequence({ duration: 0, cues: [{ at: 1, fire: cue }], onComplete });
    seq.start();
    seq.update(0.016);
    expect(seq.progress).toBe(1);
    expect(cue).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
