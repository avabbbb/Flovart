import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('offline-first document shell', () => {
  it('does not make startup depend on Google-hosted fonts', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('keeps workspace content flexible when the offline notice is empty', () => {
    const css = readFileSync('styles/index.css', 'utf8');
    expect(css).toContain('display: flex !important;\n    flex-direction: column;');
    expect(css).toContain('.app-shell__workspace { display: flex;');
    expect(css).toContain('.app-shell__content { display: flex; min-height: 0; flex: 1 1 auto;');
    expect(css).not.toContain('.app-shell__offline { grid-row: 1; }');
  });
});
