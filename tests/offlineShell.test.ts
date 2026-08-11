import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('offline-first document shell', () => {
  it('does not make startup depend on Google-hosted fonts', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });
});
