/// <reference lib="webworker" />
import type { ArtWorkerIn, ArtWorkerOut } from './art-protocol';
import { edgesPipeline, type EdgesOptions } from './art-processors/edges';
import { normalsFromDepth, type NormalsFromDepthOptions } from './art-processors/normals';
import { depthFromImage, type DepthOptions } from './art-processors/depth';
import { lineartFromImage, type LineartOptions } from './art-processors/lineart';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let activeRequestId = -1;
let cancelled = false;

ctx.onmessage = async (e: MessageEvent<ArtWorkerIn>) => {
  const msg = e.data;
  if (msg.kind === 'cancel') {
    if (msg.requestId === activeRequestId) cancelled = true;
    return;
  }
  if (msg.kind !== 'process') return;
  const { requestId, toolId, blob, options } = msg;
  activeRequestId = requestId;
  cancelled = false;
  const send = (m: ArtWorkerOut) => ctx.postMessage(m);
  const onProgress = (phase: string, value?: number) => send({ kind: 'progress', requestId, phase, value });
  try {
    let rgba: Uint8ClampedArray;
    let width: number;
    let height: number;
    if (toolId === 'depth') {
      onProgress('decoding');
      const result = await depthFromImage(blob, onProgress, options as DepthOptions);
      if (cancelled) return;
      rgba = result.rgba;
      width = result.width;
      height = result.height;
    } else {
      onProgress('decoding');
      const bitmap = await createImageBitmap(blob);
      const { width: bw, height: bh } = bitmap;
      const maxDim = 1536;
      let dw = bw;
      let dh = bh;
      if (Math.max(bw, bh) > maxDim) {
        const r = maxDim / Math.max(bw, bh);
        dw = Math.max(1, Math.round(bw * r));
        dh = Math.max(1, Math.round(bh * r));
      }
      const off = new OffscreenCanvas(dw, dh);
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) throw new Error('OffscreenCanvas 2D 不可用');
      octx.drawImage(bitmap, 0, 0, dw, dh);
      bitmap.close?.();
      const image = octx.getImageData(0, 0, dw, dh);
      onProgress('processing', 0);
      if (toolId === 'edges') {
        rgba = edgesPipeline(image.data, dw, dh, options as EdgesOptions);
      } else if (toolId === 'lineart') {
        rgba = lineartFromImage(image.data, dw, dh, options as LineartOptions);
      } else if (toolId === 'normals') {
        rgba = normalsFromDepth(image.data, dw, dh, options as NormalsFromDepthOptions);
      } else {
        throw new Error(`工具 ${toolId} 暂未实现`);
      }
      width = dw;
      height = dh;
      if (cancelled) return;
    }
    onProgress('encoding', 1);
    const outCanvas = new OffscreenCanvas(width, height);
    const octx2 = outCanvas.getContext('2d');
    if (!octx2) throw new Error('OffscreenCanvas 2D 不可用');
    const outImageData = new ImageData(rgba, width, height);
    octx2.putImageData(outImageData, 0, 0);
    const outBlob = await outCanvas.convertToBlob({ type: 'image/png' });
    if (cancelled) return;
    const dataUrl = await blobToDataUrl(outBlob);
    send({ kind: 'result', requestId, toolId, dataUrl, width, height });
  } catch (err) {
    send({ kind: 'error', requestId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    if (activeRequestId === requestId) activeRequestId = -1;
  }
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 失败'));
    reader.readAsDataURL(blob);
  });
}