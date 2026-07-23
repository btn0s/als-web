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
    jogShare: 0,
    sneak: 0,
    posture: 0,
    crawlBlend: 0,
    jumpBlend: 0,
    ...overrides,
  };
}

const weightOf = (id: string, ctx: OverlayContext, alphas = { stance: 1, airborne: 1 }) => {
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
    // Grounded idle: stance alpha 1, airborne base 0 (jump-split arms carry no weight on the ground).
    evaluateRegionOverlays(REGION_OVERLAY_RULES, makeCtx(), { stance: 1, airborne: 0 }, out);
    for (const w of out) expect(w).toBeCloseTo(0, 6);
  });

  it('ride alpha scales every rule (montage/jump fade overlays with their base)', () => {
    const ctx = makeCtx({ jogShare: 1 });
    expect(weightOf('jog-sprint-arms', ctx, { stance: 0.5, airborne: 0 })).toBeCloseTo(
      weightOf('jog-sprint-arms', ctx, { stance: 1, airborne: 0 }) * 0.5,
      6,
    );
  });

  it('jog-sprint-arms rises with the jog share and is silent otherwise', () => {
    expect(weightOf('jog-sprint-arms', makeCtx({ jogShare: 1 }))).toBeCloseTo(0.6, 6);
    expect(weightOf('jog-sprint-arms', makeCtx({ walkShare: 1 }))).toBeCloseTo(0, 6);
  });

  it('never emits negative weights', () => {
    const out = new Array(REGION_OVERLAY_RULES.length).fill(-1);
    evaluateRegionOverlays(
      REGION_OVERLAY_RULES,
      makeCtx({ sneak: -5, jogShare: -3, walkShare: -1 }),
      { stance: 1, airborne: 1 },
      out,
    );
    for (const w of out) expect(w).toBeGreaterThanOrEqual(0);
  });
});
