import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyUpdaterArtifacts } from '../scripts/check-updater-artifacts.mjs';

const temporaryDirectories = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'iris-updater-artifacts-'));
  temporaryDirectories.push(root);
  const installers = join(root, 'installers');
  mkdirSync(installers);
  const artifactName = 'Iris_0.3.2_x64-setup.exe';
  const signature = 'test-signature-content';
  writeFileSync(join(installers, artifactName), 'deterministic updater artifact');
  writeFileSync(join(root, `${artifactName}.sig`), `${signature}\n`);
  writeFileSync(join(root, 'latest.json'), JSON.stringify({
    version: '0.3.2',
    platforms: {
      'windows-x86_64': {
        signature,
        url: `https://example.test/${artifactName}`,
      },
    },
  }));
  return { root, signature, artifactName };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release updater artifact verification', () => {
  it('requires a versioned artifact, sidecar signature, and matching latest.json signature', () => {
    const { root, artifactName } = fixture();
    expect(verifyUpdaterArtifacts({ artifactDir: root, expectedVersion: '0.3.2' })).toMatchObject({
      ok: true,
      version: '0.3.2',
      verified: [{ platform: 'windows-x86_64', artifact: artifactName }],
    });
  });

  it('rejects a missing sidecar and mismatched feed signature', () => {
    const { root, artifactName } = fixture();
    writeFileSync(join(root, `${artifactName}.sig`), 'different-signature');
    const report = verifyUpdaterArtifacts({ artifactDir: root, expectedVersion: '0.3.2' });
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('latest.json signature does not match'),
    ]));
  });

  it('rejects a missing latest.json instead of treating a signed build as complete', () => {
    const { root } = fixture();
    rmSync(join(root, 'latest.json'));
    const report = verifyUpdaterArtifacts({ artifactDir: root, expectedVersion: '0.3.2' });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain('latest.json is missing');
  });

  it('rejects an insecure or version-mismatched updater URL', () => {
    const { root } = fixture();
    const manifest = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8'));
    manifest.platforms['windows-x86_64'].url = 'http://example.test/Iris_0.3.1_x64-setup.exe';
    writeFileSync(join(root, 'latest.json'), JSON.stringify(manifest));
    const report = verifyUpdaterArtifacts({ artifactDir: root, expectedVersion: '0.3.2' });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain('safe artifact filename');
  });
});
