import { describe, expect, it } from 'vitest';
import { assetSpecKey, defaultStyleBible, planAssetRun } from '../services/reverse/game';
import type { ReverseAssetEntry } from '../services/reverse/types';

const entry = (patch: Partial<ReverseAssetEntry> = {}): ReverseAssetEntry => ({
  id: 'btn_ok', symbols: ['BtnOk'], category: 'ui', mediaKind: 'image', width: 64, height: 32, hasAlpha: true, state: 'must-replace', candidates: [], ...patch,
});

describe('asset run reuse', () => {
  const bible = defaultStyleBible();

  it('sends specs that have no candidate for the current key', () => {
    const plan = planAssetRun([entry()], bible);
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0]!.key).toBe(assetSpecKey(entry(), bible));
    expect(plan.reused).toHaveLength(0);
  });

  it('reuses only a candidate with the identical key', () => {
    const key = assetSpecKey(entry(), bible);
    const withCandidate = entry({ state: 'generating', candidates: [{ id: 'o1', ownerKind: 'asset', ownerId: 'btn_ok', key, origin: 'generated', createdAt: 'fixture' }] });
    expect(planAssetRun([withCandidate], bible).reused).toHaveLength(1);
    expect(planAssetRun([withCandidate], { ...bible, palette: ['teal'] }).send).toHaveLength(1);
    expect(planAssetRun([{ ...withCandidate, width: 128 }], bible).send).toHaveLength(1);
  });

  it('re-specs a rejected asset even when its key is unchanged', () => {
    const key = assetSpecKey(entry(), bible);
    const rejected = entry({ state: 'rejected', candidates: [{ id: 'o1', ownerKind: 'asset', ownerId: 'btn_ok', key, origin: 'generated', createdAt: 'fixture' }] });
    expect(planAssetRun([rejected], bible).send).toHaveLength(1);
  });
});
