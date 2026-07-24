import { describe, expect, it } from 'vitest';
import {
  REGION_OVERLAY_RULES,
  evaluateRegionOverlays,
} from './regionOverlays';
import type { OverlayContext } from './regionOverlays';
import { REGION_PREDICATES } from './trackMask';

function makeCtx(overrides: Partial<OverlayContext> = {}): OverlayContext {
  return {
    idleShare: 1,
    walkShare: 0,
    runShare: 0,
    sprintShare: 0,
    crouchingAmount: 0,
    inAirAmount: 0,
    ...overrides,
  };
}

const weightOf = (
  id: string,
  ctx: OverlayContext,
  alphas = { groundedAmount: 1, inAirAmount: 1 },
) => {
  const out = new Array(REGION_OVERLAY_RULES.length).fill(-1);
  evaluateRegionOverlays(REGION_OVERLAY_RULES, ctx, alphas, out);
  const i = REGION_OVERLAY_RULES.findIndex((r) => r.id === id);
  expect(i).toBeGreaterThanOrEqual(0);
  return out[i];
};

describe('region overlay rules', () => {
  it('every rule names a real region', () => {
    for (const rule of REGION_OVERLAY_RULES) {
      expect(REGION_PREDICATES[rule.region]).toBeTypeOf('function');
    }
  });

  it('rule ids are unique', () => {
    const ids = REGION_OVERLAY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all rules are silent in plain grounded idle', () => {
    const out = new Array(REGION_OVERLAY_RULES.length).fill(-1);
    evaluateRegionOverlays(
      REGION_OVERLAY_RULES,
      makeCtx(),
      { groundedAmount: 1, inAirAmount: 0 },
      out,
    );
    for (const w of out) expect(w).toBeCloseTo(0, 6);
  });

  it('ride alpha scales every rule (montage/jump fade overlays with their base)', () => {
    const ctx = makeCtx({ runShare: 0.5, sprintShare: 0.5 });
    expect(weightOf(
      'run-sprint-arms',
      ctx,
      { groundedAmount: 0.5, inAirAmount: 0 },
    )).toBeCloseTo(
      weightOf(
        'run-sprint-arms',
        ctx,
        { groundedAmount: 1, inAirAmount: 0 },
      ) * 0.5,
      6,
    );
  });

  it('run-sprint-arms only rides the run→sprint crossfade', () => {
    expect(weightOf(
      'run-sprint-arms',
      makeCtx({ runShare: 0.5, sprintShare: 0.5 }),
    )).toBeCloseTo(0.6, 6);
    expect(weightOf('run-sprint-arms', makeCtx({ runShare: 1 }))).toBeCloseTo(0, 6);
    expect(weightOf('run-sprint-arms', makeCtx({ sprintShare: 1 }))).toBeCloseTo(0, 6);
    expect(weightOf('run-sprint-arms', makeCtx({ walkShare: 1 }))).toBeCloseTo(0, 6);
  });

  it('never emits negative weights', () => {
    const out = new Array(REGION_OVERLAY_RULES.length).fill(-1);
    evaluateRegionOverlays(
      REGION_OVERLAY_RULES,
      makeCtx({ runShare: -3, sprintShare: -2, walkShare: -1 }),
      { groundedAmount: 1, inAirAmount: 1 },
      out,
    );
    for (const w of out) expect(w).toBeGreaterThanOrEqual(0);
  });
});
