import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReleaseArtifacts } from '../scripts/check-release-artifacts.mjs';

const temporaryDirectories = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'iris-release-artifacts-'));
  temporaryDirectories.push(root);
  const installerDir = join(root, 'installers');
  mkdirSync(installerDir);
  const installer = join(installerDir, 'Iris_0.3.2_x64-setup.exe');
  const bytes = Buffer.from('deterministic installer fixture');
  writeFileSync(installer, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(root, 'SHA256SUMS.txt'), `${digest}  ${installer.split(/[\\/]/).pop()}\n`);
  const sbom = join(root, 'iris-windows-sbom.spdx.json');
  writeFileSync(sbom, JSON.stringify({ spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', name: 'Iris', packages: [] }));
  return { root, sbom };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release artifact verification', () => {
  it('verifies versioned installers, checksums, and SPDX metadata', () => {
    const { root, sbom } = fixture();
    expect(verifyReleaseArtifacts({ artifactDir: root, expectedVersion: '0.3.2', sbomPath: sbom })).toMatchObject({ ok: true, version: '0.3.2', installers: [{ name: 'Iris_0.3.2_x64-setup.exe' }] });
  });

  it('rejects a tampered installer and an incomplete checksum manifest', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'installers', 'Iris_0.3.2_x64-setup.exe'), 'tampered');
    const report = verifyReleaseArtifacts({ artifactDir: root, expectedVersion: '0.3.2' });
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('checksum mismatch')]));
  });
});
