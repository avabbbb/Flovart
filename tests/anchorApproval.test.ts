import { describe, expect, it } from 'vitest';
import { anchorApprovalPatch, deriveAnchorCodes, normalizeAnchorCode } from '../services/anchorApproval';

const now = new Date('2026-10-30T01:00:00.000Z');

describe('anchorApprovalPatch', () => {
  it('approves a pending anchor, stamps approvedAt and assigns a code', () => {
    expect(anchorApprovalPatch({ anchor: { kind: 'character', approved: false } }, now)).toEqual({
      anchor: { kind: 'character', approved: true, approvedAt: '2026-10-30T01:00:00.000Z', code: 'A01' },
    });
  });

  it('revokes an approved anchor, drops approvedAt but keeps its code', () => {
    expect(anchorApprovalPatch({ anchor: { kind: 'style', approved: true, approvedAt: 'x', code: 'T01' } }, now)).toEqual({
      anchor: { kind: 'style', approved: false, code: 'T01' },
    });
  });

  it('ignores non-anchor nodes and does not mutate input', () => {
    expect(anchorApprovalPatch({}, now)).toBeNull();
    const node = { anchor: { kind: 'character' as const, approved: false } };
    anchorApprovalPatch(node, now);
    expect(node.anchor).toEqual({ kind: 'character', approved: false });
  });

  it('allocates the next free code per kind among peers (including legacy approved anchors)', () => {
    const peers = [
      { id: 'a', anchor: { kind: 'character' as const, approved: true, code: 'A01' } },
      { id: 'b', anchor: { kind: 'character' as const, approved: true } }, // 旧数据 → A02
      { id: 's', anchor: { kind: 'scene' as const, approved: true, code: 'S01' } },
    ];
    const patch = anchorApprovalPatch({ id: 'c', anchor: { kind: 'character', approved: false } }, now, [...peers, { id: 'c', anchor: { kind: 'character', approved: false } }]);
    expect(patch?.anchor?.code).toBe('A03');
    expect(anchorApprovalPatch({ id: 'p', anchor: { kind: 'product', approved: false } }, now, peers)?.anchor?.code).toBe('P01');
  });

  it('keeps the code it already had when re-approved', () => {
    expect(anchorApprovalPatch({ id: 'x', anchor: { kind: 'scene', approved: false, code: 'S04' } }, now, [])?.anchor?.code).toBe('S04');
  });
});

describe('deriveAnchorCodes', () => {
  it('keeps explicit codes, derives legacy approved anchors in node order, skips unapproved', () => {
    const codes = deriveAnchorCodes([
      { id: 'n1', anchor: { kind: 'character', approved: true } },
      { id: 'n2', anchor: { kind: 'character', approved: true, code: 'A01' } },
      { id: 'n3', anchor: { kind: 'character', approved: false } },
      { id: 'n4', anchor: { kind: 'style', approved: true } },
      { id: 'n5' },
    ]);
    expect(Object.fromEntries(codes)).toEqual({ n2: 'A01', n1: 'A02', n4: 'T01' });
  });

  it('re-assigns duplicate or wrong-prefix codes deterministically', () => {
    const codes = deriveAnchorCodes([
      { id: 'n1', anchor: { kind: 'scene', approved: true, code: 'S01' } },
      { id: 'n2', anchor: { kind: 'scene', approved: true, code: 's1' } },
      { id: 'n3', anchor: { kind: 'scene', approved: true, code: 'A05' } },
    ]);
    expect(Object.fromEntries(codes)).toEqual({ n1: 'S01', n2: 'S02', n3: 'S03' });
  });

  it('normalizes code spellings', () => {
    expect(normalizeAnchorCode('a1')).toBe('A01');
    expect(normalizeAnchorCode('S002')).toBe('S02');
    expect(normalizeAnchorCode('X01')).toBe('');
  });
});
