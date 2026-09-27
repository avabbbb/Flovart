import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistResolveArtifact } from '../integrations/studio/resolve/artifact-store.js';
import { resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const roots: string[] = [];
const testTempRoot = resolveTestTempRoot(process.cwd(), 'vitest');

function temporaryRoot() {
  const root = mkdtempSync(join(testTempRoot, 'iris-resolve-artifact-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Resolve durable artifact handoff', () => {
  it('writes a verified content-addressed artifact and provenance beside it', () => {
    const rootDir = temporaryRoot();
    const bytes = Buffer.from('candidate bytes');
    const result = persistResolveArtifact({
      rootDir,
      bytes,
      artifact: {
        artifactId: 'artifact_123',
        taskId: 'task_456',
        modelId: 'model/creative-v1',
        mimeType: 'video/mp4',
        name: 'Rainy street.mp4',
      },
      now: new Date('2026-09-27T02:00:00.000Z'),
    });

    expect(result.filePath).toContain(join(rootDir, 'artifacts', 'resolve'));
    expect(result.filePath).toContain(`sha256-${result.sha256}`);
    expect(result.filePath).not.toContain('artifact_123');
    expect(readFileSync(result.filePath)).toEqual(bytes);
    expect(result).toMatchObject({
      artifactId: 'artifact_123',
      taskId: 'task_456',
      modelId: 'model/creative-v1',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      byteSize: bytes.length,
      createdAt: '2026-09-27T02:00:00.000Z',
    });
    expect(JSON.parse(readFileSync(`${result.filePath}.json`, 'utf8'))).toMatchObject({
      artifactId: 'artifact_123',
      taskId: 'task_456',
      modelId: 'model/creative-v1',
      sha256: result.sha256,
      byteSize: bytes.length,
      mimeType: 'video/mp4',
      createdAt: result.createdAt,
    });
  });

  it('reuses identical bytes at the same stable path without changing first-seen provenance', () => {
    const rootDir = temporaryRoot();
    const artifact = { artifactId: 'artifact_123', taskId: 'task_456', mimeType: 'image/png' };
    const first = persistResolveArtifact({ rootDir, bytes: Buffer.from('same bytes'), artifact, now: new Date('2026-09-27T02:00:00.000Z') });
    const second = persistResolveArtifact({ rootDir, bytes: Buffer.from('same bytes'), artifact, now: new Date('2026-09-28T02:00:00.000Z') });

    expect(second.filePath).toBe(first.filePath);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('rejects declared size or SHA-256 that does not match the bytes', () => {
    const rootDir = temporaryRoot();
    const bytes = Buffer.from('candidate');

    expect(() => persistResolveArtifact({ rootDir, bytes, artifact: { artifactId: 'artifact_123', mimeType: 'image/png', byteSize: bytes.length + 1 } }))
      .toThrow(/字节数/);
    expect(() => persistResolveArtifact({ rootDir, bytes, artifact: { artifactId: 'artifact_123', mimeType: 'image/png', sha256: '0'.repeat(64) } }))
      .toThrow(/SHA-256/);
  });

  it('rejects same-size tampering rather than overwriting a durable artifact', () => {
    const rootDir = temporaryRoot();
    const artifact = { artifactId: 'artifact_123', mimeType: 'image/png' };
    const original = Buffer.from('original');
    const persisted = persistResolveArtifact({ rootDir, bytes: original, artifact });
    writeFileSync(persisted.filePath, Buffer.from('tampered'));

    expect(() => persistResolveArtifact({ rootDir, bytes: original, artifact })).toThrow(/已存在但校验失败/);
  });

  it('rejects secret-shaped or unbounded provenance IDs before writing them to disk', () => {
    const rootDir = temporaryRoot();
    const bytes = Buffer.from('candidate');

    expect(() => persistResolveArtifact({ rootDir, bytes, artifact: {
      artifactId: ['sk', '-abcdefgh123456789'].join(''), mimeType: 'image/png',
    } })).toThrow(/身份格式无效/);
    expect(() => persistResolveArtifact({ rootDir, bytes, artifact: {
      artifactId: 'artifact_safe', taskId: ['ghp', '_1234567890abcdefghijkl'].join(''), mimeType: 'image/png',
    } })).toThrow(/任务身份.*格式无效/);
    expect(() => persistResolveArtifact({ rootDir, bytes, artifact: {
      artifactId: 'artifact_safe', modelId: 'model/'.padEnd(220, 'x'), mimeType: 'image/png',
    } })).toThrow(/模型身份.*格式无效/);
  });

  it('rejects absolute, UNC, drive-rooted, file URL, and traversal path-shaped provenance IDs', () => {
    const rootDir = temporaryRoot();
    const bytes = Buffer.from('candidate');
    const invalidIds = [
      { taskId: '/Users/ava/private/task-1', label: '任务身份' },
      { taskId: 'C:/Users/ava/private/task-1', label: '任务身份' },
      { taskId: '\\\\server\\share\\task-1', label: '任务身份' },
      { modelId: 'file:///Users/ava/private/model.json', label: '模型身份' },
      { modelId: '../../private/model-key', label: '模型身份' },
    ];

    for (const invalid of invalidIds) {
      expect(() => persistResolveArtifact({
        rootDir,
        bytes,
        artifact: { artifactId: 'artifact_safe', mimeType: 'image/png', ...invalid },
      })).toThrow(new RegExp(`${invalid.label}.*格式无效`));
    }

    // Slash-separated provider/model identifiers are valid namespaced model IDs.
    expect(persistResolveArtifact({
      rootDir,
      bytes,
      artifact: { artifactId: 'artifact_model', modelId: 'provider/model-v2', mimeType: 'image/png' },
    }).modelId).toBe('provider/model-v2');
  });
});
