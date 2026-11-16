import { cropWorkflowImage, isFetchableMediaHref, loadWorkflowMediaBlob } from '../components/workflow/media';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { ResolvedWorkflowResource } from '../components/workflow/inputResolver';
import type { WorkflowReferenceRegion, WorkflowResource, WorkflowResourceKind, WorkflowResourceLocator } from '../components/workflow/types';

export type CreativeHostResourceLocator = Extract<WorkflowResourceLocator, { kind: 'creative-host' }>;

export interface WorkflowResourceResolverRuntime {
  loadMedia?: (storageKey: string) => Promise<Blob | null>;
  loadCreativeHostResource?: (locator: CreativeHostResourceLocator) => Promise<Blob | null>;
  /** 区域引用的裁剪/蒙版实现；缺省用浏览器 canvas（cropWorkflowImage + destination-in 蒙版）。测试可注入。 */
  cropRegion?: (source: Blob, region: WorkflowReferenceRegion, mask: Blob | null) => Promise<Blob>;
  /** 读取远程图（区域裁剪需要像素）；缺省 loadWorkflowMediaBlob。 */
  loadRemoteBlob?: (href: string) => Promise<Blob | null>;
}

export type ExecutableWorkflowResource =
  | { kind: 'inline-text'; text: string }
  | { kind: 'remote-url'; href: string }
  | { kind: 'blob-url'; href: string; source: 'asset' | 'workflow-storage' | 'runtime-artifact' | 'legacy-href' | 'creative-host' }
  | { kind: 'runtime-artifact'; taskId: string; artifactId?: string; outputIndex?: number };

export interface ResolvedExecutableWorkflowResource {
  resourceId: string;
  kind: WorkflowResourceKind;
  mimeType?: string;
  executable: ExecutableWorkflowResource;
}

const MEDIA_KIND_LABELS: Record<string, string> = { image: '图片', video: '视频', audio: '音频' };

function resolvedResource(resource: WorkflowResource, executable: ExecutableWorkflowResource): ResolvedExecutableWorkflowResource {
  return {
    resourceId: resource.resourceId,
    kind: resource.kind,
    mimeType: resource.mimeType,
    executable,
  };
}

async function materializeBlob(
  resource: WorkflowResource,
  blob: Blob | null,
  source: 'asset' | 'workflow-storage' | 'runtime-artifact' | 'legacy-href' | 'creative-host',
  cleanup: string[],
) {
  if (!blob) return null;
  const href = URL.createObjectURL(blob);
  cleanup.push(href);
  return resolvedResource(resource, { kind: 'blob-url', href, source });
}

async function loadLocatorBlob(locator: WorkflowResourceLocator, runtime: WorkflowResourceResolverRuntime) {
  if (locator.kind === 'workflow-storage') return (runtime.loadMedia || workflowMediaStorage.get)(locator.storageKey);
  if (locator.kind === 'asset') return loadWorkflowMediaBlob(undefined, `asset-library:${locator.assetId}`);
  if (locator.kind === 'runtime-artifact') return loadWorkflowMediaBlob(undefined, undefined, locator.artifactRef);
  if (locator.kind === 'creative-host') return runtime.loadCreativeHostResource?.(locator) || null;
  if (locator.kind === 'legacy-href') return loadWorkflowMediaBlob(undefined, locator.href);
  return null;
}

/** 将节点声明的 locator 物化为 Provider/Runtime 可消费资源；不读取 nodes、connections 或 metadata。 */
export async function resolveWorkflowResource(
  resource: WorkflowResource,
  runtime: WorkflowResourceResolverRuntime,
  cleanup: string[],
  options?: { allowArtifactReference?: boolean },
): Promise<ResolvedExecutableWorkflowResource | null> {
  const { locator } = resource;
  if (locator.kind === 'missing') return null;
  if (locator.kind === 'inline-text') return resolvedResource(resource, { kind: 'inline-text', text: locator.text });
  if (locator.kind === 'remote-url') return resolvedResource(resource, { kind: 'remote-url', href: locator.href });
  if (locator.kind === 'legacy-href' && isFetchableMediaHref(locator.href)) {
    return resolvedResource(resource, { kind: 'remote-url', href: locator.href });
  }

  try {
    return await materializeBlob(resource, await loadLocatorBlob(locator, runtime), locator.kind === 'asset' ? 'asset' : locator.kind, cleanup);
  } catch {
    if (locator.kind === 'runtime-artifact' && options?.allowArtifactReference) {
      const { taskId, artifactId, outputIndex } = locator.artifactRef;
      return resolvedResource(resource, { kind: 'runtime-artifact', taskId, artifactId, outputIndex });
    }
    return null;
  }
}

async function applyMask(cropped: Blob, mask: Blob): Promise<Blob> {
  const [imageUrl, maskUrl] = [URL.createObjectURL(cropped), URL.createObjectURL(mask)];
  try {
    const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法读取区域蒙版'));
      image.src = url;
    });
    const [image, maskImage] = await Promise.all([load(imageUrl), load(maskUrl)]);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理蒙版');
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('蒙版合成失败')), 'image/png'));
  } finally {
    URL.revokeObjectURL(imageUrl);
    URL.revokeObjectURL(maskUrl);
  }
}

async function defaultCropRegion(source: Blob, region: WorkflowReferenceRegion, mask: Blob | null) {
  const cropped = await cropWorkflowImage(source, { x: region.x, y: region.y, width: region.w, height: region.h });
  return mask ? applyMask(cropped, mask) : cropped;
}

async function loadRegionSource(resource: WorkflowResource, runtime: WorkflowResourceResolverRuntime): Promise<Blob | null> {
  const { locator } = resource;
  const remote = locator.kind === 'remote-url' ? locator.href : locator.kind === 'legacy-href' && isFetchableMediaHref(locator.href) ? locator.href : '';
  if (remote) return runtime.loadRemoteBlob ? runtime.loadRemoteBlob(remote) : loadWorkflowMediaBlob(undefined, remote);
  return loadLocatorBlob(locator, runtime);
}

/**
 * 区域引用：先取原图像素，按 region 裁剪（有 mask 时叠蒙版），再出 blob URL。
 * 只处理图片；失败时抛出明确错误，不悄悄退回整图。
 */
export async function resolveRegionResourceHref(
  resource: ResolvedWorkflowResource & { region: WorkflowReferenceRegion },
  runtime: WorkflowResourceResolverRuntime,
  cleanup: string[],
): Promise<string> {
  let source: Blob | null = null;
  try { source = await loadRegionSource(resource, runtime); } catch { source = null; }
  if (!source) throw new Error(`引用的图片「${resource.title}」的媒体文件已不存在，无法按区域裁剪。请重新上传或重新生成该图片。`);
  let mask: Blob | null = null;
  if (resource.region.mask) {
    const { storageKey, href } = resource.region.mask;
    try {
      mask = storageKey
        ? await (runtime.loadMedia || workflowMediaStorage.get)(storageKey)
        : href ? await (runtime.loadRemoteBlob ? runtime.loadRemoteBlob(href) : loadWorkflowMediaBlob(undefined, href)) : null;
    } catch { mask = null; }
    if (!mask) throw new Error(`「${resource.title}」的区域蒙版已丢失，请重新点选主体。`);
  }
  let cropped: Blob;
  try {
    cropped = await (runtime.cropRegion || defaultCropRegion)(source, resource.region, mask);
  } catch (cause) {
    throw new Error(`「${resource.title}」按区域裁剪失败：${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const href = URL.createObjectURL(cropped);
  cleanup.push(href);
  return href;
}

/** 兼容当前 Provider 输入路径的 href 适配器；新的调用方应优先消费 resolveWorkflowResource。 */
export async function resolveWorkflowResourceHref(
  resource: ResolvedWorkflowResource,
  runtime: WorkflowResourceResolverRuntime,
  cleanup: string[],
  options?: { allowArtifactReference?: boolean },
) {
  if (resource.region && resource.kind === 'image') {
    return resolveRegionResourceHref(resource as ResolvedWorkflowResource & { region: WorkflowReferenceRegion }, runtime, cleanup);
  }
  const resolved = await resolveWorkflowResource(resource, runtime, cleanup, options);
  if (!resolved) return null;
  if (resolved.executable.kind === 'inline-text') return null;
  if (resolved.executable.kind === 'runtime-artifact') return `artifact://${resolved.executable.taskId}`;
  return resolved.executable.href;
}

export async function requireWorkflowResourceHref(
  resource: ResolvedWorkflowResource,
  runtime: WorkflowResourceResolverRuntime,
  cleanup: string[],
  options?: { allowArtifactReference?: boolean },
) {
  const href = await resolveWorkflowResourceHref(resource, runtime, cleanup, options);
  if (href) return href;
  const kind = MEDIA_KIND_LABELS[resource.kind] || '媒体';
  throw new Error(`引用的${kind}「${resource.title}」的媒体文件已不存在（可能已被清理）。请重新上传或重新生成该${kind}，再运行本节点。`);
}
