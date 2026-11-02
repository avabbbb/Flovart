import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspaceForProject } from './config.js';

// Project-level shared context: append-only, read-only receipts (task / artifact /
// decision / note) that any Agent may add and every Agent may read. This is NOT a
// shared memory store (12-agent.md §7): it never merges conversations, never holds
// login state, and is keyed by project only.
export const RECEIPT_KINDS = Object.freeze(['task', 'artifact', 'decision', 'note']);
export const RECEIPT_LIST_LIMIT = 200;
export const RECEIPT_IMPORT_LIMIT = 200;

const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|api[_-]?key\s*[:=]\s*\S+)/gi;

export class ReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const dedupeKey = receipt => (receipt.agentIdentity || '') + '|' + receipt.externalRef;

const clean = (value, max) => (typeof value === 'string' ? value.replace(SECRET_PATTERN, '[redacted]').trim().slice(0, max) : '');

export function normalizeReceipt(input = {}, caller = {}) {
  const projectId = clean(input.projectId, 120);
  if (!projectId) throw new ReceiptError('INVALID_ARGUMENT', '回执必须绑定 projectId。');
  if (!RECEIPT_KINDS.includes(input.kind)) throw new ReceiptError('INVALID_ARGUMENT', '回执类型只能是 ' + RECEIPT_KINDS.join(' / ') + '。');
  const title = clean(input.title, 120);
  if (!title) throw new ReceiptError('INVALID_ARGUMENT', '回执必须有标题。');
  const nodeIds = Array.isArray(input.nodeIds)
    ? input.nodeIds.filter(id => typeof id === 'string' && id).slice(0, 20).map(id => id.slice(0, 120))
    : [];
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    projectId,
    kind: input.kind,
    title,
    summary: clean(input.summary, 1000) || null,
    agentIdentity: clean(caller.agentIdentity || input.agentIdentity, 60) || null,
    externalRef: clean(input.externalRef, 200) || null,
    nodeIds,
  };
}

export class ReceiptStore {
  constructor({ dirFor = workspaceForProject } = {}) {
    this.dirFor = dirFor;
  }

  file(projectId) {
    return path.join(this.dirFor(projectId), 'receipts.jsonl');
  }

  async readAll(projectId) {
    let text = '';
    try {
      text = await fsp.readFile(this.file(projectId), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const receipts = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const receipt = JSON.parse(line);
        if (receipt?.projectId === projectId) receipts.push(receipt);
      } catch { /* skip a torn line; the log stays append-only */ }
    }
    return receipts;
  }

  async list(projectId, limit = 50) {
    if (!projectId) throw new ReceiptError('INVALID_ARGUMENT', '读取回执需要 projectId。');
    const count = Math.max(1, Math.min(RECEIPT_LIST_LIMIT, Number(limit) || 50));
    return (await this.readAll(projectId)).slice(-count);
  }

  // Idempotent on (agentIdentity, externalRef): re-importing the same history adds nothing.
  async appendMany(inputs, caller = {}) {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new ReceiptError('INVALID_ARGUMENT', '没有要写入的回执。');
    if (inputs.length > RECEIPT_IMPORT_LIMIT) throw new ReceiptError('INVALID_ARGUMENT', '一次最多导入 ' + RECEIPT_IMPORT_LIMIT + ' 条回执。');
    const normalized = inputs.map(input => normalizeReceipt(input, caller));
    const added = [];
    const skipped = [];
    const byProject = new Map();
    for (const receipt of normalized) {
      if (!byProject.has(receipt.projectId)) {
        const existing = await this.readAll(receipt.projectId);
        byProject.set(receipt.projectId, new Set(existing.filter(r => r.externalRef).map(dedupeKey)));
      }
      const seen = byProject.get(receipt.projectId);
      const key = receipt.externalRef ? dedupeKey(receipt) : null;
      if (key && seen.has(key)) { skipped.push(receipt.externalRef); continue; }
      if (key) seen.add(key);
      await fsp.appendFile(this.file(receipt.projectId), JSON.stringify(receipt) + '\n', 'utf8');
      added.push(receipt);
    }
    return { added, skipped };
  }
}
