import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'integrations', 'studio', 'after-effects', 'cep-bridge.js'), 'utf8');

async function sha256(bytes: Uint8Array) {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function makeBlob(bytes: Uint8Array) {
  const copy = bytes.slice();
  return {
    size: copy.length,
    arrayBuffer: () => Promise.resolve(copy.buffer),
  };
}

function createBridge(options: {
  tamperOnWrite?: boolean;
  candidates?: unknown[];
} = {}) {
  const files = new Map<string, Uint8Array>();
  const hostCalls: Array<{ name: string; args: unknown[] }> = [];
  const cep = {
    fs: {
      SystemPath: { USER_DATA: 'USER_DATA' },
      getSystemPath: () => 'C:/cep/user-data',
      writeFile: (file: string, value: string) => {
        const bytes = new Uint8Array(Buffer.from(value, 'base64'));
        if (options.tamperOnWrite && bytes.length) bytes[0] ^= 0xff;
        files.set(file, bytes);
        return { err: 0 };
      },
      rename: (oldPath: string, newPath: string) => {
        if (files.has(newPath)) return { err: 1 };
        const bytes = files.get(oldPath);
        if (!bytes) return { err: 1 };
        files.set(newPath, bytes);
        files.delete(oldPath);
        return { err: 0 };
      },
      readFile: (file: string) => {
        const bytes = files.get(file);
        return bytes ? { err: 0, data: Buffer.from(bytes).toString('base64') } : { err: 1, data: '' };
      },
      deleteFile: (file: string) => ({ err: files.delete(file) ? 0 : 1 }),
    },
    encoding: { Base64: 1 },
  };
  const window = {
    cep,
    crypto: webcrypto,
    __adobe_cep__: {
      evalScript(script: string, callback: (value: string) => void) {
        const match = /^FlovartAE\.([A-Za-z0-9_]+)\((.*)\)$/.exec(script);
        if (!match) throw new Error(`Unexpected ExtendScript call: ${script}`);
        const args = JSON.parse(`[${match[2]}]`) as unknown[];
        hostCalls.push({ name: match[1], args });
        if (match[1] === 'listNativeCandidates') callback(JSON.stringify(options.candidates || []));
        else callback(JSON.stringify({ ok: true, targetId: 'applied-layer' }));
      },
    },
  };
  vm.runInNewContext(source, {
    window,
    Blob,
    Promise,
    Uint8Array,
    Array,
    Date,
    Math,
    atob,
    btoa,
    isFinite,
  });
  return {
    bridge: (window as unknown as { __FLOVART_AFTER_EFFECTS_BRIDGE__: any }).__FLOVART_AFTER_EFFECTS_BRIDGE__,
    files,
    hostCalls,
  };
}

describe('After Effects CEP bridge asset integrity', () => {
  it('reads back the persisted artifact and checks byte size and SHA-256 before importing it', async () => {
    const content = new Uint8Array([0, 1, 2, 254, 255]);
    const digest = await sha256(content);
    const { bridge, files, hostCalls } = createBridge();

    await expect(bridge.importArtifact({
      artifact: {
        artifactId: 'artifact-1',
        sha256: digest,
        byteSize: content.length,
        mimeType: 'image/png',
        blob: makeBlob(content),
      },
      target: null,
    })).resolves.toMatchObject({ ok: true, targetId: 'applied-layer' });

    expect(files.size).toBe(1);
    expect(Array.from(files.values())[0]).toEqual(content);
    expect(hostCalls.map(call => call.name)).toEqual(['importArtifact']);
    expect(hostCalls[0].args[2]).toMatchObject({ sha256: digest, byteSize: content.length });
  });

  it('refuses a same-size persisted replacement before sending the candidate to After Effects', async () => {
    const content = new Uint8Array([10, 20, 30, 40]);
    const digest = await sha256(content);
    const { bridge, hostCalls } = createBridge({ tamperOnWrite: true });

    await expect(bridge.importArtifact({
      artifact: {
        artifactId: 'artifact-2',
        sha256: digest,
        byteSize: content.length,
        mimeType: 'image/png',
        blob: makeBlob(content),
      },
    })).rejects.toThrow('SHA-256');

    expect(hostCalls).toEqual([]);
  });

  it('reuses an existing content-addressed file only when its bytes match without overwriting it', async () => {
    const content = new Uint8Array([61, 62, 63]);
    const digest = await sha256(content);
    const { bridge, files, hostCalls } = createBridge();
    const finalPath = `C:/cep/user-data/flovart-asset-artifact-reused-sha256-${digest}.png`;
    files.set(finalPath, content.slice());

    await expect(bridge.importArtifact({
      artifact: {
        artifactId: 'artifact-reused',
        sha256: digest,
        byteSize: content.length,
        mimeType: 'image/png',
        blob: makeBlob(content),
      },
    })).resolves.toMatchObject({ ok: true });

    expect(files.size).toBe(1);
    expect(Array.from(files.values())[0]).toEqual(content);
    expect(hostCalls.map(call => call.name)).toEqual(['importArtifact']);
  });

  it('rechecks the selected persisted candidate immediately before applying and hides its local path from the panel contract', async () => {
    const content = new Uint8Array([11, 12, 13]);
    const digest = await sha256(content);
    const candidate = {
      candidateLayerId: 'candidate-1',
      artifactId: 'artifact-3',
      sha256: digest,
      byteSize: content.length,
      mediaAvailable: true,
      sourcePath: 'C:/cep/user-data/candidate.png',
      sourceSelection: {
        selectionId: '1',
        locator: { documentId: 'comp-1', layerId: 1 },
      },
    };
    const { bridge, files, hostCalls } = createBridge({ candidates: [candidate] });
    files.set(candidate.sourcePath, content);

    await expect(bridge.listNativeCandidates('comp-1')).resolves.toMatchObject([
      { candidateLayerId: 'candidate-1', mediaAvailable: true },
    ]);
    const listed = await bridge.listNativeCandidates('comp-1');
    expect(listed[0]).not.toHaveProperty('sourcePath');

    await expect(bridge.applyNativeEffect({
      candidateLayerId: 'candidate-1',
      sourceSelection: {
        selectionId: '1',
        locator: { documentId: 'comp-1', layerId: 1 },
      },
    })).resolves.toMatchObject({ ok: true });
    expect(hostCalls.map(call => call.name)).toEqual([
      'listNativeCandidates',
      'listNativeCandidates',
      'listNativeCandidates',
      'applyNativeEffect',
    ]);
  });

  it('does not apply a same-size candidate whose bytes changed after import', async () => {
    const original = new Uint8Array([51, 52, 53, 54]);
    const replacement = new Uint8Array([51, 52, 53, 55]);
    const digest = await sha256(original);
    const candidate = {
      candidateLayerId: 'candidate-2',
      artifactId: 'artifact-4',
      sha256: digest,
      byteSize: original.length,
      mediaAvailable: true,
      sourcePath: 'C:/cep/user-data/candidate-2.png',
      sourceSelection: {
        selectionId: '2',
        locator: { documentId: 'comp-2', layerId: 2 },
      },
    };
    const { bridge, files, hostCalls } = createBridge({ candidates: [candidate] });
    files.set(candidate.sourcePath, replacement);

    await expect(bridge.applyNativeEffect({
      candidateLayerId: 'candidate-2',
      sourceSelection: {
        selectionId: '2',
        locator: { documentId: 'comp-2', layerId: 2 },
      },
    })).rejects.toThrow('SHA-256');
    expect(hostCalls.map(call => call.name)).toEqual(['listNativeCandidates']);
  });
});
