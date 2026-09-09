import { isFetchableMediaHref, loadWorkflowMediaBlob } from '../components/workflow/media';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { ResolvedWorkflowResource } from '../components/workflow/inputResolver';
import type { WorkflowResource, WorkflowResourceKind, WorkflowResourceLocator } from '../components/workflow/types';

export type CreativeHostResourceLocator = Extract<WorkflowResourceLocator, { kind: 'creative-host' }>;

export interface WorkflowResourceResolverRuntime {
  loadMedia?: (storageKey: string) => Promise<Blob | null>;
  loadCreativeHostResource?: (locator: CreativeHostResourceLocator) => Promise<Blob | null>;
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

/** 兼容当前 Provider 输入路径的 href 适配器；新的调用方应优先消费 resolveWorkflowResource。 */
export async function resolveWorkflowResourceHref(
  resource: ResolvedWorkflowResource,
  runtime: WorkflowResourceResolverRuntime,
  cleanup: string[],
  options?: { allowArtifactReference?: boolean },
) {
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
