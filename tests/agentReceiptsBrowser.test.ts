import { describe, expect, it } from 'vitest';
import { formatReceiptContext, toReceipt } from '../services/agentReceipts';
import { useAgentReceiptStore } from '../stores/useAgentReceiptStore';

const raw = { id: 'r1', at: '2026-10-31T14:00:00.000Z', projectId: 'p1', kind: 'decision', title: '角色换成 yayi', summary: '不用米哈游素材', agentIdentity: 'codex', nodeIds: ['n1', 3] };

describe('agent receipts (browser)', () => {
  it('parses a valid receipt and rejects unknown kinds', () => {
    expect(toReceipt(raw)).toMatchObject({ id: 'r1', kind: 'decision', nodeIds: ['n1'] });
    expect(toReceipt({ ...raw, kind: 'memory' })).toBeNull();
    expect(toReceipt({ ...raw, projectId: '' })).toBeNull();
  });

  it('formats a read-only context block and is empty without receipts', () => {
    const receipt = toReceipt(raw);
    expect(receipt).not.toBeNull();
    const text = formatReceiptContext(receipt ? [receipt] : []);
    expect(text).toContain('只读参考');
    expect(text).toContain('- [决定] 角色换成 yayi：不用米哈游素材（来自 codex）');
    expect(formatReceiptContext([])).toBe('');
  });

  it('dedupes live events against hydrated receipts', () => {
    const receipt = toReceipt(raw);
    if (!receipt) throw new Error('fixture invalid');
    useAgentReceiptStore.getState().replace('p1', [receipt]);
    useAgentReceiptStore.getState().upsert(receipt);
    expect(useAgentReceiptStore.getState().byProject.p1).toHaveLength(1);
  });
});
