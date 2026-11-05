// 网页画布接收插件分块导入（import.begin / import.chunk / import.commit），协议与 Desktop Native Host 一致。
// 校验字节数与 SHA-256 后写入 workflowMediaStorage，再复用 createBrowserImportWorkflowMutation 落到当前 Workflow。
// 本模块只有类型依赖，不引入 Tauri 或存储实现，便于在 node 环境测试。
import type { WorkflowProject } from '../components/workflow/types';
import type { BrowserImportReceipt } from './browserImports';
import type { ExtensionBridge, ExtensionBridgeMessage } from './extensionBridge';

const MAX_IMPORT_BYTES = 67_108_864; // 64 MiB，与插件侧上限一致
const MAX_ACTIVE_TRANSFERS = 4;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SUPPORTED_MIME: Record<string, BrowserImportReceipt['kind']> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
};

interface TransferState {
  importId: string;
  kind: BrowserImportReceipt['kind'];
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  sourceUrl: string | null;
  sourcePageUrl: string | null;
  sourceTitle: string | null;
  naturalWidth: number | null;
  naturalHeight: number | null;
  chunks: Uint8Array[];
  receivedBytes: number;
  nextSequence: number;
}

export interface WebImportDependencies {
  storeBlob(key: string, blob: Blob): Promise<void>;
  getActiveProject(): WorkflowProject | null;
  project(receipt: BrowserImportReceipt, project: WorkflowProject): Promise<{ nodeId: string }>;
}

export interface WebImportBeginResult {
  transferId: string;
  receivedBytes: number;
  nextSequence: number;
}

export interface WebImportChunkResult {
  receivedBytes: number;
  nextSequence: number;
}

export interface WebImportCommitResult {
  importId: string;
  destinationProjectId: string | null;
  nodeId: string | null;
}

export interface WebImportReceiver {
  begin(message: ExtensionBridgeMessage): WebImportBeginResult;
  chunk(message: ExtensionBridgeMessage): WebImportChunkResult;
  commit(message: ExtensionBridgeMessage): Promise<WebImportCommitResult>;
}

export function webBrowserImportStorageKey(importId: string): string {
  return 'browser-import:' + importId;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function text(value: unknown, max = 4096): string | null {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createWebImportReceiver(dependencies: WebImportDependencies): WebImportReceiver {
  const transfers = new Map<string, TransferState>();

  const transferOf = (message: ExtensionBridgeMessage): [string, TransferState] => {
    const transferId = typeof message.transferId === 'string' ? message.transferId : '';
    const transfer = transfers.get(transferId);
    if (!transfer) throw new Error('导入会话不存在或已过期');
    return [transferId, transfer];
  };

  return {
    begin(message) {
      const payload = record(message.payload);
      if (!payload) throw new Error('导入请求缺少 payload');
      const mimeType = text(payload.mimeType, 128) || '';
      const kind = Object.hasOwn(SUPPORTED_MIME, mimeType) ? SUPPORTED_MIME[mimeType] : null;
      if (!kind || payload.kind !== kind) throw new Error('不支持的媒体类型：' + (mimeType || '未知'));
      const byteSize = positiveInt(payload.byteSize);
      if (!byteSize || byteSize > MAX_IMPORT_BYTES) throw new Error('媒体大小无效或超过 64 MB');
      const sha256 = text(payload.sha256, 64);
      if (!sha256 || !SHA256_PATTERN.test(sha256)) throw new Error('缺少有效的 SHA-256');

      // 插件中途崩溃会留下半截会话；超过上限时淘汰最早的一个，而不是永久拒绝新导入。
      const oldest = transfers.keys().next();
      if (transfers.size >= MAX_ACTIVE_TRANSFERS && !oldest.done) transfers.delete(oldest.value);

      const transferId = crypto.randomUUID();
      transfers.set(transferId, {
        importId: crypto.randomUUID(),
        kind,
        name: text(payload.name, 255) || 'browser-import',
        mimeType,
        byteSize,
        sha256,
        sourceUrl: text(payload.sourceUrl),
        sourcePageUrl: text(payload.sourcePageUrl),
        sourceTitle: text(payload.sourceTitle),
        naturalWidth: positiveInt(payload.naturalWidth),
        naturalHeight: positiveInt(payload.naturalHeight),
        chunks: [],
        receivedBytes: 0,
        nextSequence: 0,
      });
      return { transferId, receivedBytes: 0, nextSequence: 0 };
    },

    chunk(message) {
      const [, transfer] = transferOf(message);
      if (message.sequence !== transfer.nextSequence) throw new Error('分块序号不连续');
      if (typeof message.dataBase64 !== 'string') throw new Error('分块数据缺失');
      const bytes = base64ToBytes(message.dataBase64);
      if (transfer.receivedBytes + bytes.length > transfer.byteSize) throw new Error('分块数据超出声明大小');
      transfer.chunks.push(bytes);
      transfer.receivedBytes += bytes.length;
      transfer.nextSequence += 1;
      return { receivedBytes: transfer.receivedBytes, nextSequence: transfer.nextSequence };
    },

    async commit(message) {
      const [transferId, transfer] = transferOf(message);
      transfers.delete(transferId);
      if (transfer.receivedBytes !== transfer.byteSize) throw new Error('媒体未完整接收');
      const merged = new Uint8Array(transfer.byteSize);
      let offset = 0;
      for (const chunk of transfer.chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const blob = new Blob([merged], { type: transfer.mimeType });
      if (await sha256Hex(await blob.arrayBuffer()) !== transfer.sha256) {
        throw new Error('内容校验失败（SHA-256 不一致）');
      }
      await dependencies.storeBlob(webBrowserImportStorageKey(transfer.importId), blob);

      const project = dependencies.getActiveProject();
      const receipt: BrowserImportReceipt = {
        importId: transfer.importId,
        artifactId: transfer.importId,
        contentHash: transfer.sha256,
        kind: transfer.kind,
        name: transfer.name,
        mimeType: transfer.mimeType,
        byteSize: transfer.byteSize,
        sourceUrl: transfer.sourceUrl,
        sourcePageUrl: transfer.sourcePageUrl,
        sourceTitle: transfer.sourceTitle,
        naturalWidth: transfer.naturalWidth,
        naturalHeight: transfer.naturalHeight,
        status: 'pending',
        destinationProjectId: project?.id ?? null,
        createdAt: Date.now(),
      };
      const nodeId = project ? (await dependencies.project(receipt, project)).nodeId : null;
      return { importId: transfer.importId, destinationProjectId: project?.id ?? null, nodeId };
    },
  };
}

export function registerWebBrowserImportReceiver(
  bridge: Pick<ExtensionBridge, 'onRequest'>,
  dependencies: WebImportDependencies,
): () => void {
  const receiver = createWebImportReceiver(dependencies);
  const disposers = [
    bridge.onRequest('import.begin', message => receiver.begin(message)),
    bridge.onRequest('import.chunk', message => receiver.chunk(message)),
    bridge.onRequest('import.commit', message => receiver.commit(message)),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
