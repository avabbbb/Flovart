import { describe, expect, it } from 'vitest';
import { anchorApprovalPatch } from '../services/anchorApproval';

const now = new Date('2026-10-30T01:00:00.000Z');

describe('anchorApprovalPatch', () => {
  it('approves a pending anchor and stamps approvedAt', () => {
    expect(anchorApprovalPatch({ anchor: { kind: 'character', approved: false } }, now)).toEqual({
      anchor: { kind: 'character', approved: true, approvedAt: '2026-10-30T01:00:00.000Z' },
    });
  });

  it('revokes an approved anchor and drops approvedAt', () => {
    expect(anchorApprovalPatch({ anchor: { kind: 'style', approved: true, approvedAt: 'x' } }, now)).toEqual({
      anchor: { kind: 'style', approved: false },
    });
  });

  it('ignores non-anchor nodes and does not mutate input', () => {
    expect(anchorApprovalPatch({}, now)).toBeNull();
    const node = { anchor: { kind: 'character' as const, approved: false } };
    anchorApprovalPatch(node, now);
    expect(node.anchor.approved).toBe(false);
  });
});
