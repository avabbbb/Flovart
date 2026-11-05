import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WEB_MATCH_PATTERNS, WEB_ORIGINS, isAllowedWebOrigin } from '../extension/background/web-origins.js';
import { pairingTransition, readPairings, removePairing, setPairingStatus } from '../extension/background/web-pairings.js';

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
  };
}

describe('extension web bridge origins', () => {
  it('keeps manifest externally_connectable in sync with the origin allowlist', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), 'extension/manifest.json'), 'utf8'));
    expect(manifest.externally_connectable.matches).toEqual(WEB_MATCH_PATTERNS);
    expect(WEB_MATCH_PATTERNS).toHaveLength(WEB_ORIGINS.size);
  });

  it('accepts only exact allowlisted origins', () => {
    for (const origin of WEB_ORIGINS) expect(isAllowedWebOrigin(origin)).toBe(true);
    const demo = [...WEB_ORIGINS][0];
    expect(isAllowedWebOrigin(demo + '.attacker.example')).toBe(false);
    expect(isAllowedWebOrigin(demo + '/')).toBe(false);
    expect(isAllowedWebOrigin(demo.toUpperCase())).toBe(false);
    expect(isAllowedWebOrigin(undefined)).toBe(false);
  });
});

describe('extension web pairings', () => {
  it('moves pending to approved and removal clears the entry', async () => {
    const storage = memoryStorage();
    const origin = [...WEB_ORIGINS][0];
    await setPairingStatus(origin, 'pending', storage);
    expect((await readPairings(storage))[origin].status).toBe('pending');
    await setPairingStatus(origin, 'approved', storage);
    expect((await readPairings(storage))[origin].status).toBe('approved');
    await removePairing(origin, storage);
    expect(await readPairings(storage)).toEqual({});
  });

  it('serializes concurrent writes so no origin is lost', async () => {
    const storage = memoryStorage();
    const [first, second] = [...WEB_ORIGINS];
    await Promise.all([
      setPairingStatus(first, 'pending', storage),
      setPairingStatus(second, 'approved', storage),
    ]);
    const pairings = await readPairings(storage);
    expect(pairings[first].status).toBe('pending');
    expect(pairings[second].status).toBe('approved');
  });

  it('rejects unknown statuses', () => {
    expect(() => setPairingStatus('x', 'rejected', memoryStorage())).toThrow();
  });

  it('translates storage transitions into hello results', () => {
    expect(pairingTransition(undefined, 'pending')).toBe('pending');
    expect(pairingTransition('pending', 'approved')).toBe('approved');
    expect(pairingTransition('pending', undefined)).toBe('rejected');
    expect(pairingTransition('approved', undefined)).toBe('revoked');
  });
});
