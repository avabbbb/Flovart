import { loadWorkflowMediaBlob } from '../../components/workflow/media';
import type { FlovartArtifact } from './studioContract';
import type { WorkflowArtifactOutput } from '../workflowExecutor';

const ARTIFACT_TTL_MS = 30 * 60 * 1000;
const MAX_ARTIFACTS = 64;

interface Entry {
  artifact: WorkflowArtifactOutput;
  storageKey: string;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

function prune(now = Date.now()) {
  for (const [id, entry] of entries) if (entry.expiresAt <= now) entries.delete(id);
  while (entries.size > MAX_ARTIFACTS) entries.delete(entries.keys().next().value as string);
}

/** Registers only a session-scoped opaque result identity; storageKey never crosses the Host contract. */
export function registerWorkflowArtifact(input: {
  artifactId: string;
  storageKey: string;
  kind: 'image' | 'video' | 'audio';
  mimeType?: string;
  name?: string;
}, now = Date.now()) {
  const artifactId = input.artifactId.trim();
  const storageKey = input.storageKey.trim();
  if (!artifactId || !storageKey) return undefined;
  prune(now);
  const artifact: WorkflowArtifactOutput = {
    artifactId,
    mimeType: input.mimeType || 'application/octet-stream',
    kind: input.kind,
    ...(input.name ? { name: input.name } : {}),
  };
  entries.delete(artifactId);
  entries.set(artifactId, { artifact, storageKey, expiresAt: now + ARTIFACT_TTL_MS });
  prune(now);
  return artifact;
}

export async function loadWorkflowArtifact(artifactId: string, now = Date.now()): Promise<FlovartArtifact | null> {
  prune(now);
  const entry = entries.get(artifactId);
  if (!entry) return null;
  entries.delete(artifactId);
  entries.set(artifactId, entry);
  const blob = await loadWorkflowMediaBlob(entry.storageKey).catch(() => null);
  return blob ? { ...entry.artifact, blob } : null;
}

export function clearWorkflowArtifacts() {
  entries.clear();
}

export function workflowArtifactCount(now = Date.now()) {
  prune(now);
  return entries.size;
}
