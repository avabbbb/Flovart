import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWorkflowArtifacts,
  loadWorkflowArtifact,
  registerWorkflowArtifact,
  workflowArtifactCount,
} from '../services/studio/artifactRegistry';
import { workflowMediaStorage } from '../components/workflow/storage';

afterEach(async () => {
  clearWorkflowArtifacts();
  await workflowMediaStorage.clear();
});

describe('Studio Artifact registry', () => {
  it('resolves a committed media record through an opaque id without exposing storageKey', async () => {
    await workflowMediaStorage.set('workflow-media-result', new Blob(['result'], { type: 'image/png' }));
    const descriptor = registerWorkflowArtifact({
      artifactId: 'run-session-1',
      storageKey: 'workflow-media-result',
      kind: 'image',
      mimeType: 'image/png',
      name: '生成图片',
    });

    expect(descriptor).toEqual(expect.objectContaining({ artifactId: 'run-session-1', kind: 'image' }));
    expect(JSON.stringify(descriptor)).not.toContain('workflow-media-result');
    const loaded = await loadWorkflowArtifact('run-session-1');
    expect(loaded).toMatchObject({ artifactId: 'run-session-1', mimeType: 'image/png' });
    expect(loaded?.blob).toBeTruthy();
    expect(workflowArtifactCount()).toBe(1);
  });

  it('expires session artifacts', async () => {
    await workflowMediaStorage.set('workflow-media-expiring', new Blob(['result'], { type: 'image/png' }));
    registerWorkflowArtifact({ artifactId: 'run-session-2', storageKey: 'workflow-media-expiring', kind: 'image' }, 100);
    await expect(loadWorkflowArtifact('run-session-2', 100 + 30 * 60 * 1000)).resolves.toBeNull();
  });
});
