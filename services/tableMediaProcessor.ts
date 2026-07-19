import { editImageWithProvider, runImageAgentWithProvider } from './aiGateway';
import type { UserApiKey } from '../types';
import { workflowBlobToDataUrl, workflowDataUrlToBlob } from '../components/workflow/media';
import { resolveRouteMappingForSubmit, type RouteFallbackResolution } from './routeMapping';

export type TableToolId = 'depth' | 'edges' | 'film' | 'reference' | 'applause' | 'cutout' | 'wardrobe';

export interface TableProcessResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

export interface TableProcessOptions {
  userApiKeys: UserApiKey[];
  productModelId?: string;
  confirmRouteFallback?: (resolution: RouteFallbackResolution) => boolean | Promise<boolean>;
  prompt?: string;
}

export async function processTableMedia(blob: Blob, tool: TableToolId, options: TableProcessOptions): Promise<TableProcessResult> {
  if (blob.type.startsWith('video/')) {
    if (tool === 'cutout' || tool === 'wardrobe' || tool === 'edges') {
      throw new Error('这个工具当前只支持图片；视频可使用深度、参考准备和风格滤镜。');
    }
    return processVideo(blob, tool);
  }
  if (!blob.type.startsWith('image/')) throw new Error('Table 当前只处理图片和视频。');
  if (tool === 'cutout') return processCutout(blob, options);
  if (tool === 'wardrobe') return processWardrobe(blob, options);
  return processImage(blob, tool);
}

async function processCutout(blob: Blob, options: TableProcessOptions): Promise<TableProcessResult> {
  const resolved = await resolveImageRoute(options);
  const source = await workflowBlobToDataUrl(blob);
  const result = await runImageAgentWithProvider(
    { href: source, mimeType: blob.type || 'image/png' },
    'remove-background',
    resolved.routeId,
    resolved.key,
  );
  return resultFromDataUrl(result.dataUrl, result.mimeType, result.width, result.height);
}

async function processWardrobe(blob: Blob, options: TableProcessOptions): Promise<TableProcessResult> {
  const resolved = await resolveImageRoute(options);
  const source = await workflowBlobToDataUrl(blob);
  const prompt = options.prompt?.trim() || '保留人物身份、脸部、发型、姿态和背景，只把服装整理为中性纯色基础款，轮廓清晰，方便后续全能参考。';
  const result = await editImageWithProvider(
    [{ href: source, mimeType: blob.type || 'image/png' }],
    prompt,
    resolved.routeId,
    resolved.key,
  );
  if (!result.newImageBase64) throw new Error(result.textResponse || '服装预处理没有返回图片。');
  return resultFromDataUrl(result.newImageBase64, result.newImageMimeType || 'image/png');
}

function resolveImageRoute(options: TableProcessOptions) {
  if (!options.productModelId) throw new Error('请先明确选择图片产品模型。');
  return resolveRouteMappingForSubmit(
    { kind: 'product-mode', productModelId: options.productModelId, mode: 'image-to-image' },
    options.userApiKeys,
    options.confirmRouteFallback,
  );
}

async function resultFromDataUrl(value: string, mimeType: string, width = 0, height = 0): Promise<TableProcessResult> {
  const dataUrl = value.startsWith('data:') ? value : `data:${mimeType};base64,${value}`;
  const blob = await workflowDataUrlToBlob(dataUrl);
  if (width && height) return { blob, mimeType, width, height };
  const image = await loadImage(blob);
  return { blob, mimeType, width: image.naturalWidth, height: image.naturalHeight };
}

async function processImage(blob: Blob, tool: TableToolId): Promise<TableProcessResult> {
  const image = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建图片处理画布。');
  drawFrame(context, image, canvas.width, canvas.height, tool, 0);
  const output = await canvasBlob(canvas, tool === 'cutout' ? 'image/png' : 'image/webp');
  return { blob: output, mimeType: output.type, width: canvas.width, height: canvas.height };
}

async function processVideo(blob: Blob, tool: TableToolId): Promise<TableProcessResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持视频预处理导出。');
  const video = document.createElement('video');
  const url = URL.createObjectURL(blob);
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('无法读取视频。'));
  });
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: tool === 'depth' });
  if (!context) throw new Error('当前浏览器无法创建视频处理画布。');
  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('视频预处理导出失败。'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });
  let frame = 0;
  const draw = () => {
    if (video.ended || video.paused) return;
    drawFrame(context, video, width, height, tool, frame++);
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
  };
  try {
    recorder.start(500);
    await video.play();
    draw();
    await new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error('视频处理过程中断。'));
    });
    recorder.stop();
    return { blob: await done, mimeType: 'video/webm', width, height };
  } finally {
    stream.getTracks().forEach(track => track.stop());
    URL.revokeObjectURL(url);
  }
}

function drawFrame(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, tool: TableToolId, frame: number) {
  context.save();
  context.clearRect(0, 0, width, height);
  context.filter = tool === 'film'
    ? 'contrast(1.08) saturate(.82) sepia(.18)'
    : tool === 'reference' ? 'contrast(1.1) saturate(.9)' : 'none';
  context.drawImage(source, 0, 0, width, height);
  context.restore();
  if (tool === 'depth' || tool === 'edges') applyPixelTool(context, width, height, tool);
  if (tool === 'film') addFilmGrain(context, width, height, frame);
  if (tool === 'applause') addApplause(context, width, height, frame);
}

function applyPixelTool(context: CanvasRenderingContext2D, width: number, height: number, tool: 'depth' | 'edges') {
  const image = context.getImageData(0, 0, width, height);
  const input = new Uint8ClampedArray(image.data);
  const gray = (index: number) => .299 * input[index] + .587 * input[index + 1] + .114 * input[index + 2];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      let value: number;
      if (tool === 'depth') {
        value = 255 - gray(index);
      } else {
        const left = gray(index - 4);
        const right = gray(index + 4);
        const top = gray(index - width * 4);
        const bottom = gray(index + width * 4);
        value = Math.min(255, Math.hypot(right - left, bottom - top) * 2.4);
      }
      image.data[index] = tool === 'depth' ? value * .28 : value;
      image.data[index + 1] = tool === 'depth' ? value * .78 : value;
      image.data[index + 2] = value;
    }
  }
  context.putImageData(image, 0, 0);
}

function addFilmGrain(context: CanvasRenderingContext2D, width: number, height: number, frame: number) {
  context.save();
  context.globalAlpha = .08;
  context.fillStyle = frame % 2 ? '#ffffff' : '#1f1d1a';
  for (let index = 0; index < 180; index += 1) {
    const x = Math.abs(Math.sin(index * 91.7 + frame) * width) % width;
    const y = Math.abs(Math.cos(index * 47.3 + frame) * height) % height;
    context.fillRect(x, y, 1.5, 1.5);
  }
  context.restore();
}

function addApplause(context: CanvasRenderingContext2D, width: number, height: number, frame: number) {
  const colors = ['#19c8b9', '#f5c31c', '#e8615a', '#ffffff'];
  context.save();
  for (let index = 0; index < 36; index += 1) {
    const x = (index * 83 + frame * (2 + index % 3)) % width;
    const y = (index * 47 + frame * (4 + index % 4)) % height;
    context.fillStyle = colors[index % colors.length];
    context.globalAlpha = .72;
    context.fillRect(x, y, 3 + index % 6, 8 + index % 9);
  }
  context.restore();
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('处理结果导出失败。')), mimeType, .92));
}
