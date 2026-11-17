import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import worker, { parseAllowedOrigins } from '../worker/index';

function makeEnv() {
  const assets = vi.fn(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
  return { env: { ASSETS: { fetch: assets } }, assets };
}

describe('Cloudflare Worker entry (Workers + static assets)', () => {
  it('serves non-API paths from the asset binding', async () => {
    const { env, assets } = makeEnv();
    const res = await worker.fetch(new Request('https://flovart.avabbbb.com/canvas/abc'), env);
    expect(res.status).toBe(200);
    expect(assets).toHaveBeenCalledTimes(1);
  });

  it('answers unknown /api/* with JSON 404 instead of the SPA shell', async () => {
    const { env, assets } = makeEnv();
    for (const path of ['/api/v1/auth/login', '/api/v1/prompts', '/api/v1/uploads/presign', '/api']) {
      const res = await worker.fetch(new Request(`https://flovart.avabbbb.com${path}`), env);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
    }
    expect(assets).not.toHaveBeenCalled();
  });

  it('routes /api/llm-proxy/* to the guarded proxy (cross-origin callers are refused)', async () => {
    const { env, assets } = makeEnv();
    const res = await worker.fetch(new Request('https://flovart.avabbbb.com/api/llm-proxy/https/opencode.ai/zen/v1/models', {
      headers: { origin: 'https://evil.example' },
    }), env);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(assets).not.toHaveBeenCalled();
  });

  it('parses the optional extra-origin allowlist', () => {
    expect(parseAllowedOrigins(' https://a.dev, ,https://b.dev ')).toEqual(['https://a.dev', 'https://b.dev']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('keeps wrangler on Workers assets: only /api/* runs the Worker first, SPA fallback', () => {
    const raw = readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const cfg = JSON.parse(raw);
    expect(cfg.main).toBe('./worker/index.ts');
    expect(cfg.pages_build_output_dir).toBeUndefined();
    expect(cfg.assets).toMatchObject({
      directory: './dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*'],
    });
  });

  it('keeps COOP/COEP in public/_headers', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(headers).toContain('Cross-Origin-Embedder-Policy: credentialless');
  });
});
