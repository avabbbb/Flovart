import type { MaterializedHostSelection } from './studioContract';
import type { CreativeHostResourceLocator } from '../workflowResourceResolver';

const RESOURCE_TTL_MS = 30 * 60 * 1000;
const MAX_RESOURCES = 16;

interface HostResourceEntry {
  blob: Blob;
  expiresAt: number;
}

const resources = new Map<string, HostResourceEntry>();

function locatorKey(locator: CreativeHostResourceLocator): string {
  return `${locator.host}:${JSON.stringify(Object.entries(locator.locator).sort(([left], [right]) => left.localeCompare(right)))}`;
}

function prune(now = Date.now()) {
  for (const [key, entry] of resources) if (entry.expiresAt <= now) resources.delete(key);
  while (resources.size > MAX_RESOURCES) resources.delete(resources.keys().next().value as string);
}

/**
 * Keeps a materialized host Blob in the current browser session only. The
 * Workflow document stores the opaque locator, never this Blob or a data URL.
 */
export function registerCreativeHostResource(materialized: MaterializedHostSelection, now = Date.now()): void {
  const locator = materialized.resource.locator;
  if (locator.kind !== 'creative-host') throw new Error('Studio resource 必须使用 creative-host locator。');
  if (!(materialized.blob instanceof Blob)) throw new Error('创作软件没有提供可执行的参考素材。');
  prune(now);
  resources.delete(locatorKey(locator));
  resources.set(locatorKey(locator), { blob: materialized.blob, expiresAt: now + RESOURCE_TTL_MS });
  prune(now);
}

export async function loadCreativeHostResource(locator: CreativeHostResourceLocator, now = Date.now()): Promise<Blob | null> {
  prune(now);
  const entry = resources.get(locatorKey(locator));
  if (!entry) return null;
  resources.delete(locatorKey(locator));
  resources.set(locatorKey(locator), entry);
  return entry.blob;
}

export function clearCreativeHostResources(): void {
  resources.clear();
}

export function creativeHostResourceCount(now = Date.now()): number {
  prune(now);
  return resources.size;
}
