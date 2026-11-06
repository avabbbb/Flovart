import { nanoid } from 'nanoid';
import { useEffect, useState } from 'react';
import { fromIdbRef, getImage, isDataUrl, isIdbRef } from '../../utils/imageDB';
import { fromIdbVideoRef, getVideoBlob, isIdbVideoRef } from '../../utils/mediaDB';
import { readColdMedia } from '../../utils/mediaIndexedDB';
import { getAssetById } from '../../utils/assetStorage';
import { loadRuntimeArtifactBlob } from '../../services/runtimeArtifacts';
import { loadBrowserImportArtifactBlob, parseBrowserImportHref } from '../../services/browserImportArtifacts';
import { LocalFolderError, parseLocalFolderHref, readLocalFolderFile } from '../../services/localFolderSource';
import { fetchRemoteMediaBlob, shouldUseDesktopNativeFetch } from '../../services/desktopNetwork';
import { transcodeVideoToH264 } from '../../services/videoTools';
import { workflowMediaStorage } from './storage';
import type { WorkflowArtifactRef, WorkflowNode, WorkflowNodeMetadata, WorkflowNodeType, WorkflowProject } from './types';

export type WorkflowMediaType = Extract<WorkflowNodeType, 'image' | 'video' | 'audio'>;

export interface WorkflowMediaRecord extends WorkflowNodeMetadata {
  type: WorkflowMediaType;
  storageKey: string;
  name: string;
  /** 入库降级提示（例如转码失败、保留原文件）；调用方展示后不得写进节点 metadata。 */
  warning?: string;
  mimeType: string;
  bytes: number;
}

const WORKFLOW_MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
};

function workflowMediaMimeType(file: Pick<File, 'name' | 'type'>) {
  if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return WORKFLOW_MEDIA_MIME_BY_EXTENSION[extension] || file.type;
}

const transientReferences = new Map<string, Set<string>>();
const pendingReferences = new Set<string>();
let canonicalReferences = new Set<string>();

function collectNodeKeys(nodes: WorkflowNode[], keys = new Set<string>()) {
  nodes.forEach(node => {
    const metadata = node.metadata || {};
    if (metadata.storageKey) keys.add(metadata.storageKey);
    if (metadata.posterStorageKey) keys.add(metadata.posterStorageKey);
    if (metadata.previewStorageKey) keys.add(metadata.previewStorageKey);
    // 原位生成的旧版本媒体挂在 Take 上，仍可被切回，必须保持可达。
    metadata.operation?.takes?.forEach(take => {
      if (take.outputMedia?.storageKey) keys.add(take.outputMedia.storageKey);
      if (take.outputMedia?.posterStorageKey) keys.add(take.outputMedia.posterStorageKey);
    });
  });
  return keys;
}

export type WorkflowMediaProjectLike = Pick<WorkflowProject, 'nodes'> & { snapshots?: Array<{ nodes: WorkflowNode[] }> };

// 命名快照里的节点也引用媒体，必须保持可达，否则恢复快照后图片丢失。
export function collectWorkflowMediaKeys(projects: WorkflowMediaProjectLike[]) {
  return projects.reduce((keys, project) => {
    collectNodeKeys(project.nodes, keys);
    project.snapshots?.forEach(snapshot => collectNodeKeys(snapshot.nodes || [], keys));
    return keys;
  }, new Set<string>());
}

export function setWorkflowMediaCanonicalProjects(projects: WorkflowMediaProjectLike[]) {
  canonicalReferences = collectWorkflowMediaKeys(projects);
}

export function registerWorkflowMediaTransientReferences(owner: string, nodeGroups: WorkflowNode[][]) {
  transientReferences.set(owner, nodeGroups.reduce((keys, nodes) => collectNodeKeys(nodes, keys), new Set<string>()));
}

export function unregisterWorkflowMediaTransientReferences(owner: string) {
  transientReferences.delete(owner);
}

// 只认本标签页内存里的引用，所以只有写入者标签页可以清理；否则会删掉其它标签页刚生成的媒体。
let pruneGuard: () => boolean = () => true;
export function setWorkflowMediaPruneGuard(guard: () => boolean) {
  pruneGuard = guard;
}

export async function pruneWorkflowMedia() {
  if (!pruneGuard()) return;
  const keys = await workflowMediaStorage.keys();
  const reachable = new Set([...canonicalReferences, ...pendingReferences]);
  transientReferences.forEach(keys => keys.forEach(key => reachable.add(key)));
  await Promise.all(keys.filter(key => !reachable.has(key)).map(key => workflowMediaStorage.remove(key)));
}

export function releaseWorkflowMediaRecord(storageKey: string) {
  pendingReferences.delete(storageKey);
  pendingReferences.delete(workflowPosterStorageKey(storageKey));
  pendingReferences.delete(workflowPreviewStorageKey(storageKey));
}

export async function discardWorkflowMediaRecord(storageKey: string) {
  const keys = [storageKey, workflowPosterStorageKey(storageKey), workflowPreviewStorageKey(storageKey)];
  keys.forEach(key => pendingReferences.delete(key));
  await Promise.all(keys.map(key => workflowMediaStorage.remove(key).catch(() => undefined)));
}

/** 判断一个 storageKey 是否仍被项目节点或已注册的临时引用（撤销历史/剪贴板）持有。 */
export function isWorkflowMediaKeyReferenced(storageKey: string, projects: Array<Pick<WorkflowProject, 'nodes'>>) {
  const referenced = collectWorkflowMediaKeys(projects).has(storageKey)
    || pendingReferences.has(storageKey);
  if (referenced) return true;
  for (const keys of transientReferences.values()) {
    if (keys.has(storageKey)) return true;
  }
  return false;
}

export function workflowMediaType(file: Pick<File, 'name' | 'type'>): WorkflowMediaType {
  const mimeType = workflowMediaMimeType(file);
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  throw new Error('仅支持图片、视频或音频文件');
}

export function fitWorkflowMediaSize(type: WorkflowMediaType, naturalWidth?: number, naturalHeight?: number) {
  if (type === 'audio') return { width: 340, height: 120 };
  const width = naturalWidth || (type === 'video' ? 16 : 4);
  const height = naturalHeight || (type === 'video' ? 9 : 3);
  const scale = Math.min(420 / width, 320 / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function inspectImage(url: string) {
  return new Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight'>>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    image.onerror = () => reject(new Error('无法读取图片信息'));
    image.src = url;
  });
}

function inspectTimedMedia(url: string, type: 'video' | 'audio') {
  return new Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight' | 'durationMs'>>((resolve, reject) => {
    const media = document.createElement(type);
    media.preload = 'metadata';
    media.addEventListener('loadedmetadata', () => resolve({
      ...(type === 'video' ? {
        naturalWidth: (media as HTMLVideoElement).videoWidth,
        naturalHeight: (media as HTMLVideoElement).videoHeight,
      } : {}),
      durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined,
    }), { once: true });
    media.addEventListener('error', () => reject(new Error(type === 'video' ? '无法读取视频信息' : '无法读取音频信息')), { once: true });
    media.src = url;
    media.load();
  });
}

export async function inspectWorkflowMedia(file: File): Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight' | 'durationMs'>> {
  const type = workflowMediaType(file);
  const url = URL.createObjectURL(file);
  try {
    if (type === 'image') return await inspectImage(url);
    return await inspectTimedMedia(url, type);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Chrome 遇到不支持的编码（HEVC 4:2:2/10bit、ProRes 等）可能只解出音轨（videoWidth 为 0）、直接报错，
// 或元数据正常但首帧解不出来。以首帧 loadeddata 为准；元数据正常但超时仍无首帧时按可解码处理，避免误转码。
const DECODE_PROBE_TIMEOUT_MS = 2500;

export async function isBrowserDecodableVideo(blob: Blob): Promise<boolean> {
  if (typeof document === 'undefined') return true;
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let sawMetadata = false;
  const timer = setTimeout(() => resolve(sawMetadata), DECODE_PROBE_TIMEOUT_MS);
  const settle = (value: boolean) => { clearTimeout(timer); resolve(value); };
  video.addEventListener('loadedmetadata', () => {
    if (!video.videoWidth || !video.videoHeight) settle(false);
    else sawMetadata = true;
  }, { once: true });
  video.addEventListener('loadeddata', () => settle(Boolean(video.videoWidth && video.videoHeight)), { once: true });
  video.addEventListener('error', () => settle(false), { once: true });
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  video.load();
  try {
    return await promise;
  } finally {
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

export type WorkflowMediaIngestStage =
  | { stage: 'probe' }
  | { stage: 'download'; progress: number }
  | { stage: 'transcode'; progress: number }
  | { stage: 'store' };

export interface WorkflowMediaIngestOptions {
  onStage?: (stage: WorkflowMediaIngestStage) => void;
  /** 取消入库：终止转码并以 AbortError 拒绝。 */
  signal?: AbortSignal;
}

// 画布预览代理：长边 1280（约 720p），只用于画布内播放；生成参考与下载仍用原文件。
const VIDEO_PREVIEW_MAX_EDGE = 1280;

async function ensureDecodableVideo(file: File, { onStage, signal }: WorkflowMediaIngestOptions): Promise<{ preview?: File; warning?: string }> {
  onStage?.({ stage: 'probe' });
  if (await isBrowserDecodableVideo(file)) return {};
  signal?.throwIfAborted();
  onStage?.({ stage: 'transcode', progress: 0 });
  try {
    const converted = await transcodeVideoToH264(file, file.name, {
      signal,
      maxEdge: VIDEO_PREVIEW_MAX_EDGE,
      onDownloadProgress: progress => onStage?.({ stage: 'download', progress }),
      onProgress: progress => onStage?.({ stage: 'transcode', progress }),
    });
    const name = file.name.replace(/\.[^.]+$/, '') + '-preview.mp4';
    return { preview: new File([converted], name, { type: 'video/mp4', lastModified: file.lastModified }) };
  } catch (error) {
    signal?.throwIfAborted();
    // 预览代理失败不丢素材：原文件照常入库（可下载、作参考上传），仅画布内可能无法预览。
    const reason = error instanceof Error ? error.message : String(error);
    return { warning: '浏览器无法解码该视频，生成画布预览失败，已保留原文件（画布内可能无法预览）：' + reason };
  }
}

// 不支持的编码可能既不触发 loadeddata 也不触发 error：封面/元数据读取必须有上限，不能让入库永远挂起。
const POSTER_TIMEOUT_MS = 8000;
const INSPECT_FALLBACK_TIMEOUT_MS = 5000;

function inspectWorkflowMediaLenient(file: File): Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight' | 'durationMs'>> {
  return Promise.race([
    inspectWorkflowMedia(file),
    new Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight' | 'durationMs'>>(resolve => setTimeout(() => resolve({}), INSPECT_FALLBACK_TIMEOUT_MS)),
  ]).catch(() => ({}));
}

export async function createWorkflowVideoPoster(blob: Blob, maxWidth = 640): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const loaded = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), POSTER_TIMEOUT_MS);
      video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(true); }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timer); resolve(false); }, { once: true });
      video.src = url;
      video.load();
    });
    if (!loaded) return null;
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const width = Math.min(maxWidth, sourceWidth);
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .76));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function workflowPosterStorageKey(storageKey: string) {
  return `${storageKey}-poster`;
}

export function workflowPreviewStorageKey(storageKey: string) {
  return storageKey + '-preview';
}

/** 浏览用缩略图：只缩小尺寸，不改变比例，也不写回项目状态。 */
export async function createWorkflowImageThumbnail(blob: Blob, maxWidth = 320): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const sourceUrl = URL.createObjectURL(blob);
  try {
    const image = await inspectImageElement(sourceUrl);
    const sourceWidth = image.naturalWidth || 1;
    const sourceHeight = image.naturalHeight || 1;
    const width = Math.max(1, Math.min(maxWidth, sourceWidth));
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .78));
    return result ? { blob: result, width: sourceWidth, height: sourceHeight } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function persistWorkflowVideoPoster(
  storageKey: string,
  blob: Blob,
  createPoster: (blob: Blob) => Promise<Blob | null> = createWorkflowVideoPoster,
) {
  const posterStorageKey = workflowPosterStorageKey(storageKey);
  try {
    const poster = await createPoster(blob);
    if (!poster) return undefined;
    await workflowMediaStorage.set(posterStorageKey, poster);
    return posterStorageKey;
  } catch {
    await workflowMediaStorage.remove(posterStorageKey).catch(() => undefined);
    return undefined;
  }
}

/**
 * 为缺少封面的视频补齐一张持久化封面，返回封面 storageKey。
 * 仅在节点已有媒体来源时调用；调用方把返回的 key 写回节点 metadata 后，
 * 需要调用 releaseWorkflowMediaRecord 解除临时引用（写回后由项目引用接管）。
 */
export async function ensureWorkflowVideoPoster(
  source: { storageKey?: string; href?: string; artifactRef?: WorkflowArtifactRef },
  createPoster: (blob: Blob) => Promise<Blob | null> = createWorkflowVideoPoster,
): Promise<string | undefined> {
  if (!source.storageKey && !source.href && !source.artifactRef?.taskId) return undefined;
  const blob = await loadWorkflowMediaBlob(source.storageKey, source.href, source.artifactRef);
  const posterStorageKey = workflowPosterStorageKey(source.storageKey || `workflow-media-${nanoid()}`);
  pendingReferences.add(posterStorageKey);
  try {
    const poster = await createPoster(blob);
    if (!poster) {
      pendingReferences.delete(posterStorageKey);
      return undefined;
    }
    await workflowMediaStorage.set(posterStorageKey, poster);
    return posterStorageKey;
  } catch (error) {
    pendingReferences.delete(posterStorageKey);
    await workflowMediaStorage.remove(posterStorageKey).catch(() => undefined);
    throw error;
  }
}

export async function ingestWorkflowMedia(
  file: File,
  createPoster: (blob: Blob) => Promise<Blob | null> = createWorkflowVideoPoster,
  options: WorkflowMediaIngestOptions = {},
): Promise<WorkflowMediaRecord> {
  const type = workflowMediaType(file);
  const declaredMimeType = workflowMediaMimeType(file);
  const declaredFile = declaredMimeType === file.type ? file : new File([file], file.name, { type: declaredMimeType, lastModified: file.lastModified });
  const { preview, warning }: { preview?: File; warning?: string } = type === 'video' ? await ensureDecodableVideo(declaredFile, options) : {};
  options.signal?.throwIfAborted();
  options.onStage?.({ stage: 'store' });
  // 浏览器解不了的原文件可能连元数据都读不出：宽高缺省时取预览代理的（比例一致），不阻断入库。
  const inspected = preview || warning ? await inspectWorkflowMediaLenient(declaredFile) : await inspectWorkflowMedia(declaredFile);
  const dimensions = preview && !inspected.naturalWidth ? { ...inspected, ...(await inspectWorkflowMediaLenient(preview)) } : inspected;
  const storageKey = 'workflow-media-' + nanoid();
  const reservedPosterStorageKey = type === 'video' ? workflowPosterStorageKey(storageKey) : undefined;
  const previewStorageKey = preview ? workflowPreviewStorageKey(storageKey) : undefined;
  pendingReferences.add(storageKey);
  if (reservedPosterStorageKey) pendingReferences.add(reservedPosterStorageKey);
  if (previewStorageKey) pendingReferences.add(previewStorageKey);
  try {
    await workflowMediaStorage.set(storageKey, declaredFile);
    if (previewStorageKey && preview) await workflowMediaStorage.set(previewStorageKey, preview);
    // 封面从可解码的那份取：有代理用代理。
    const posterStorageKey = type === 'video'
      ? await persistWorkflowVideoPoster(storageKey, preview || declaredFile, createPoster)
      : undefined;
    if (reservedPosterStorageKey && !posterStorageKey) pendingReferences.delete(reservedPosterStorageKey);
    return {
      type,
      storageKey,
      poster: undefined,
      posterStorageKey,
      ...(previewStorageKey ? { previewStorageKey } : {}),
      name: declaredFile.name,
      mimeType: declaredMimeType,
      bytes: declaredFile.size,
      ...dimensions,
      status: 'success',
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    await discardWorkflowMediaRecord(storageKey);
    throw error;
  }
}

export async function workflowBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('无法读取图片'));
    reader.readAsDataURL(blob);
  });
}

function decodeDataUrl(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^,]*),(.*)$/is);
  if (!match) throw new Error('无法读取图片结果');
  const metadata = match[1] || 'text/plain;charset=US-ASCII';
  const mimeType = metadata.split(';', 1)[0] || 'application/octet-stream';
  const payload = match[2];
  if (!metadata.split(';').slice(1).some(part => part.toLowerCase() === 'base64')) {
    try {
      return new Blob([decodeURIComponent(payload)], { type: mimeType });
    } catch {
      throw new Error('无法读取图片结果');
    }
  }
  try {
    const binary = atob(payload.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  } catch {
    throw new Error('无法读取图片结果');
  }
}

export async function workflowDataUrlToBlob(dataUrl: string): Promise<Blob> {
  const trimmed = dataUrl.trim();
  if (/^data:/i.test(trimmed)) return decodeDataUrl(trimmed);
  return fetchRemoteMediaBlob(dataUrl);
}

export function isFetchableMediaHref(href: string) {
  return /^(https?:|blob:)/i.test(href) || isDataUrl(href);
}

export async function loadFallbackMediaBlob(href: string): Promise<Blob> {
  const folderRef = parseLocalFolderHref(href);
  if (folderRef) return readLocalFolderFile(folderRef.folderId, folderRef.relativePath);
  const browserImportId = parseBrowserImportHref(href);
  if (browserImportId) return loadBrowserImportArtifactBlob(browserImportId);
  if (isIdbRef(href)) {
    const dataUrl = await getImage(fromIdbRef(href));
    if (!dataUrl) throw new Error('本地图片文件不存在，请重新选择文件');
    return workflowDataUrlToBlob(dataUrl);
  }
  if (isIdbVideoRef(href)) {
    const blob = await getVideoBlob(fromIdbVideoRef(href));
    if (!blob) throw new Error('本地视频文件不存在，请重新选择文件');
    return blob;
  }
  if (href.startsWith('cold-media:')) {
    const dataUrl = await readColdMedia(href.slice('cold-media:'.length));
    if (!dataUrl) throw new Error('本地媒体文件不存在，请重新选择文件');
    return workflowDataUrlToBlob(dataUrl);
  }
  if (href.startsWith('asset-library:')) {
    const asset = await getAssetById(href.slice('asset-library:'.length));
    if (!asset) throw new Error('素材不存在，可能已从素材库移除');
    return workflowDataUrlToBlob(asset.dataUrl);
  }
  if (!isFetchableMediaHref(href)) {
    throw new Error('无法读取本地媒体引用，请重新导入素材');
  }
  return fetchRemoteMediaBlob(href);
}

export async function loadWorkflowMediaBlob(storageKey?: string, href?: string, artifactRef?: WorkflowArtifactRef): Promise<Blob> {
  if (storageKey) {
    const blob = await workflowMediaStorage.get(storageKey);
    if (!blob) throw new Error('图片文件不存在，请重新选择文件');
    return blob;
  }
  if (artifactRef?.taskId) return loadRuntimeArtifactBlob(artifactRef.taskId, artifactRef.mimeType);
  if (!href) throw new Error('图片节点没有可用媒体');
  return loadFallbackMediaBlob(href);
}

export interface WorkflowCropRect { x: number; y: number; width: number; height: number }

export async function cropWorkflowImage(blob: Blob, crop: WorkflowCropRect): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(blob);
  try {
    const image = await inspectImageElement(sourceUrl);
    const x = Math.max(0, Math.min(1, crop.x));
    const y = Math.max(0, Math.min(1, crop.y));
    const width = Math.max(.01, Math.min(1 - x, crop.width));
    const height = Math.max(.01, Math.min(1 - y, crop.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * width));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法裁剪图片');
    context.drawImage(image, image.naturalWidth * x, image.naturalHeight * y, image.naturalWidth * width, image.naturalHeight * height, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片裁剪失败')), blob.type || 'image/png'));
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function inspectImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片信息'));
    image.src = url;
  });
}

export function useWorkflowMediaUrl(storageKey?: string, fallbackHref?: string, artifactRef?: WorkflowArtifactRef) {
  const artifactKey = artifactRef?.taskId || '';
  const mediaKey = storageKey || artifactKey || fallbackHref || '';
  const nativeRemote = shouldUseDesktopNativeFetch(fallbackHref);
  const immediateUrl = storageKey || nativeRemote ? null : (fallbackHref && !isFetchableMediaHref(fallbackHref) ? null : fallbackHref || null);
  const [state, setState] = useState<{ key: string; url: string | null; error: string | null }>({
    key: mediaKey,
    url: immediateUrl,
    error: null,
  });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setState({ key: mediaKey, url: immediateUrl, error: null });
    if (!storageKey && !artifactRef && (!fallbackHref || (isFetchableMediaHref(fallbackHref) && !nativeRemote))) return () => undefined;
    void loadWorkflowMediaBlob(storageKey, fallbackHref, artifactRef).then(blob => {
      if (!active) return;
      if (!blob) {
        setState({ key: mediaKey, url: null, error: '媒体文件不存在，请重新选择文件' });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setState({ key: mediaKey, url: objectUrl, error: null });
    }).catch(error => {
      if (!active) return;
      // 本地文件夹直读的失败原因（权限失效 / 原文件被移动）要原样呈现，方便用户重新定位。
      if (error instanceof LocalFolderError) {
        setState({ key: mediaKey, url: null, error: error.message });
        return;
      }
      const missing = error instanceof Error && error.message.includes('不存在');
      setState({ key: mediaKey, url: null, error: missing ? '媒体文件不存在，请重新选择文件' : '媒体文件读取失败，请重新选择文件' });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactKey, artifactRef?.mimeType, fallbackHref, mediaKey, nativeRemote, storageKey]);

  return state.key === mediaKey ? state : { url: immediateUrl, error: null };
}
