import { describe, expect, it } from 'vitest';
import {
  REGION_OVERLAY_RULES,
  evaluateRegionOverlays,
} from './regionOverlays';
import type { OverlayContext } from './regionOverlays';
import { REGION_PREDICATES } from '../Utility/AlsConstants';

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

  it('ride alpha scales custom rules (montage/jump fade overlays with their base)', () => {
    const ctx = makeCtx({ runShare: 0.5, sprintShare: 0.5 });
    const rules = [{
      id: 'custom',
      clip: 'clip',
      region: 'arms' as const,
      phaseLock: true,
      weight: (c: OverlayContext) => c.runShare + c.sprintShare,
    }]
    const out = [0]
    evaluateRegionOverlays(
      rules,
      ctx,
      { groundedAmount: 0.5, inAirAmount: 0 },
      out,
    );
    expect(out[0]).toBeCloseTo(0.5, 6)
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
