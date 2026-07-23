import { describe, expect, it, vi } from 'vitest';
import { createActionArbiter } from './actionArbiter';
import type { ActionRecord } from './actionArbiter';

type Kind = 'mantle' | 'hang' | 'wall-kick';

const record = (
  kind: Kind,
  overrides: Partial<ActionRecord<Kind>> = {},
): ActionRecord<Kind> => ({
  kind,
  clip: null,
  duration: 1,
  bodyMotion: 'none',
  interrupt: 'interruptible',
  ...overrides,
});

describe('createActionArbiter', () => {
  it('accepts one owner, runs enter, and exposes ActionSequence progress', () => {
    const onEnter = vi.fn();
    const arbiter = createActionArbiter<Kind>();

    expect(arbiter.request(record('mantle', { clip: 'StepUp', onEnter }))).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(arbiter.active?.kind).toBe('mantle');
    expect(arbiter.active?.clip).toBe('StepUp');

    const updated = arbiter.update(0.25);
    expect(updated?.progress).toBeCloseTo(0.25);
    expect(arbiter.progress).toBeCloseTo(0.25);
  });

  it('rejects a request while the current owner is uninterruptible', () => {
    const currentExit = vi.fn();
    const deniedEnter = vi.fn();
    const arbiter = createActionArbiter<Kind>();
    arbiter.request(record('mantle', { interrupt: 'uninterruptible', onExit: currentExit }));

    expect(arbiter.request(record('hang', { onEnter: deniedEnter }))).toBe(false);
    expect(arbiter.active?.kind).toBe('mantle');
    expect(currentExit).not.toHaveBeenCalled();
    expect(deniedEnter).not.toHaveBeenCalled();
  });

  it('interrupts an interruptible owner and cleans it before entering the replacement', () => {
    const order: string[] = [];
    const arbiter = createActionArbiter<Kind>();
    arbiter.request(record('wall-kick', { onExit: (reason) => order.push(`exit:${reason}`) }));

    expect(arbiter.request(record('hang', { onEnter: () => order.push('enter:hang') }))).toBe(true);
    expect(order).toEqual(['exit:interrupted', 'enter:hang']);
    expect(arbiter.active?.kind).toBe('hang');
  });

  it('does not orphan an action synchronously requested by interrupted-owner cleanup', () => {
    const arbiter = createActionArbiter<Kind>();
    const fallbackExit = vi.fn();
    arbiter.request(record('wall-kick', {
      onExit: () => {
        arbiter.request(record('hang', {
          interrupt: 'uninterruptible',
          onExit: fallbackExit,
        }));
      },
    }));

    expect(arbiter.request(record('mantle'))).toBe(false);
    expect(arbiter.active?.kind).toBe('hang');
    expect(fallbackExit).not.toHaveBeenCalled();
  });

  it.each([
    ['natural completion', (arbiter: ReturnType<typeof createActionArbiter<Kind>>) => arbiter.update(2), 'completed'],
    ['explicit completion', (arbiter: ReturnType<typeof createActionArbiter<Kind>>) => arbiter.complete(), 'completed'],
    ['cancellation', (arbiter: ReturnType<typeof createActionArbiter<Kind>>) => arbiter.cancel(), 'cancelled'],
  ] as const)('runs exit exactly once on %s', (_label, finish, expectedReason) => {
    const onExit = vi.fn();
    const cue = vi.fn();
    const arbiter = createActionArbiter<Kind>();
    arbiter.request(record('mantle', { cues: [{ at: 0.5, fire: cue }], onExit }));

    finish(arbiter);
    arbiter.cancel();
    arbiter.complete();
    arbiter.update(2);

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(expectedReason);
    expect(arbiter.active).toBeNull();
    expect(arbiter.progress).toBe(0);
  });

  it('returns terminal progress=1 on the completing update after releasing ownership', () => {
    const arbiter = createActionArbiter<Kind>();
    arbiter.request(record('mantle', { duration: 0.5 }));

    const completed = arbiter.update(1);
    expect(completed?.progress).toBe(1);
    expect(arbiter.active).toBeNull();
  });

  it('uses an indefinite ActionSequence for stateful actions until an explicit exit', () => {
    const onExit = vi.fn();
    const arbiter = createActionArbiter<Kind>();
    arbiter.request(record('hang', { duration: Number.POSITIVE_INFINITY, onExit }));

    arbiter.update(60);
    expect(arbiter.active?.kind).toBe('hang');
    expect(arbiter.progress).toBe(0);
    arbiter.cancel();
    expect(onExit).toHaveBeenCalledWith('cancelled');
  });

  it('clamps invalid update deltas and still cleans up when enter throws', () => {
    const onExit = vi.fn();
    const arbiter = createActionArbiter<Kind>();
    arbiter.request(record('wall-kick'));
    arbiter.update(-1);
    arbiter.update(Number.NaN);
    expect(arbiter.progress).toBe(0);

    expect(() =>
      arbiter.request(record('hang', {
        onEnter: () => {
          throw new Error('setup failed');
        },
        onExit,
      })),
    ).toThrow('setup failed');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('cancelled');
    expect(arbiter.active).toBeNull();
  });
});
