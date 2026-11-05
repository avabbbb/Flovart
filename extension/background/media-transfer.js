// 媒体分块传输：Desktop（Native Messaging）与网页画布（externally_connectable Port）共用同一套 begin/chunk/commit 协议。
import { bytesToBase64, provenanceUrl, sha256Hex, splitImportBytes } from './import-protocol.js';

const PROGRESS_STEP_PERCENT = 12;
const COMMIT_TIMEOUT_MS = 15_000;

// send(message, timeoutMs?)：发出一条请求并返回对端 result（错误以抛出表示）。
// media: { bytes, name, mimeType, width, height }；source: { kind, sourceUrl, pageUrl, title }。
// onProgress(percent, sentBytes, totalBytes)：每前进约 12% 调用一次。
export async function transferMedia(send, media, source, onProgress = async () => {}) {
  const total = media.bytes.length;
  const transfer = await send({
    type: 'import.begin',
    payload: {
      requestId: crypto.randomUUID(),
      kind: source.kind,
      name: media.name,
      mimeType: media.mimeType,
      byteSize: total,
      sha256: await sha256Hex(media.bytes),
      sourceUrl: provenanceUrl(source.sourceUrl),
      sourcePageUrl: provenanceUrl(source.pageUrl || ''),
      sourceTitle: source.title?.slice(0, 4096) || null,
      naturalWidth: media.width,
      naturalHeight: media.height,
    },
  });

  let sequence = transfer?.nextSequence || 0;
  let offset = transfer?.receivedBytes || 0;
  if (offset > total) throw new Error('对端返回的续传偏移无效');
  let lastPercent = -1;
  for (const chunk of splitImportBytes(media.bytes.subarray(offset))) {
    const ack = await send({
      type: 'import.chunk',
      transferId: transfer.transferId,
      sequence,
      dataBase64: bytesToBase64(chunk),
    });
    sequence = ack.nextSequence;
    offset += chunk.length;
    const percent = Math.floor(offset * 100 / total);
    if (percent - lastPercent >= PROGRESS_STEP_PERCENT || offset === total) {
      lastPercent = percent;
      await onProgress(percent, offset, total);
    }
  }
  if (offset !== total) throw new Error('媒体分块传输未完整结束');

  return send({ type: 'import.commit', transferId: transfer.transferId }, COMMIT_TIMEOUT_MS);
}
