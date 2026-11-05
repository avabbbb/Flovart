import { describe, expect, it } from 'vitest';
import {
  buildAssetPrompt,
  canApproveAsset,
  defaultStyleBible,
  evaluateSimilarityGate,
  filterLedger,
  hashSimilarity,
  importLedger,
  overridePathFor,
  summarizeLedger,
} from '../services/reverse/game';

const manifest = {
  images: {
    '12': { path: 'img/12.png', width: 64, height: 32, hasAlpha: true },
    '15': { file: 'img/15.png', w: 800, h: 600 },
  },
  sounds: [{ id: '40', src: 'snd/40.mp3' }],
};
const assetMap = { BtnStart: 12, BtnStartHover: '12', BgMain: { id: '15' }, SfxClick: '40' };

describe('reverse game', () => {
  it('imports a grouped manifest with symbols, categories and must-replace default', () => {
    const ledger = importLedger(manifest, assetMap);
    expect(ledger.map((e) => [e.id, e.category, e.mediaKind, e.state])).toEqual([
      ['12', 'ui', 'image', 'must-replace'],
      ['15', 'background', 'image', 'must-replace'],
      ['40', 'audio', 'audio', 'must-replace'],
    ]);
    expect(ledger[0]).toMatchObject({ symbols: ['BtnStart', 'BtnStartHover'], width: 64, height: 32, hasAlpha: true });
    expect(ledger[1]).toMatchObject({ width: 800, height: 600, sourcePath: 'img/15.png' });
  });

  it('keeps human state on re-import', () => {
    const first = importLedger(manifest, assetMap);
    const edited = first.map((e) => (e.id === '15' ? { ...e, state: 'keep' as const, category: 'other' as const } : e));
    const again = importLedger(manifest, assetMap, edited);
    expect(again[1]).toMatchObject({ state: 'keep', category: 'other' });
    expect(summarizeLedger(again)).toMatchObject({ total: 3, byState: { keep: 1, 'must-replace': 2 } });
  });

  it('filters by category, state and symbol query', () => {
    const ledger = importLedger(manifest, assetMap);
    expect(filterLedger(ledger, { mediaKind: 'audio' }).map((e) => e.id)).toEqual(['40']);
    expect(filterLedger(ledger, { query: 'hover' }).map((e) => e.id)).toEqual(['12']);
    expect(filterLedger(ledger, { category: 'all', state: 'approved' })).toEqual([]);
  });

  it('scores hash similarity and gates approval', () => {
    expect(hashSimilarity('ff00', 'ff00')).toBe(1);
    expect(hashSimilarity('ff00', 'ff01')).toBeCloseTo(15 / 16);
    expect(hashSimilarity('ff', 'ff00')).toBeNull();
    const fail = evaluateSimilarityGate('12', 0.9);
    const pass = evaluateSimilarityGate('15', 0.4);
    expect([fail.status, pass.status, evaluateSimilarityGate('40', null).status]).toEqual(['failed', 'passed', 'pending']);
    const project = { gates: [fail, pass] };
    expect(canApproveAsset(project, '12')).toBe(false);
    expect(canApproveAsset(project, '15')).toBe(true);
    expect(canApproveAsset(project, '40')).toBe(false);
  });

  it('builds spec-only prompts and override paths', () => {
    const [btn, , sfx] = importLedger(manifest, assetMap);
    const bible = { ...defaultStyleBible(), palette: ['#112233'], forbidden: ['original logo'] };
    const prompt = buildAssetPrompt(btn, bible);
    expect(prompt).toContain('canvas 64x32px');
    expect(prompt).toContain('transparent background');
    expect(prompt).toContain('avoid: original logo');
    expect(prompt).not.toContain('img/12.png');
    expect(overridePathFor(btn)).toBe('remake/assets/override/12.png');
    expect(overridePathFor(sfx, 'out')).toBe('out/40.mp3');
  });
});
