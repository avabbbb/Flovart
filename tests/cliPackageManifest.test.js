import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(import.meta.dirname, '..', 'tools', 'flovart');
const packageManifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
const packageEntries = new Set(packageManifest.files || []);

function isPackaged(relativePath) {
  return [...packageEntries].some((entry) => relativePath === entry || relativePath.startsWith(`${entry}/`));
}

function localImports(source) {
  const imports = new Set();
  const pattern = /(?:from\s+|import\s*\(|require\s*\()(['"])(\.\/[^'"\n]+)\1/g;
  let match;
  while ((match = pattern.exec(source))) imports.add(match[2]);
  return imports;
}

describe('flovart-cli package manifest', () => {
  it('ships every top-level local module reachable by the CLI', () => {
    const missing = [];
    const sourceFiles = readdirSync(packageDir).filter((name) => /\.(?:js|mjs)$/.test(name));

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(resolve(packageDir, sourceFile), 'utf8');
      for (const importPath of localImports(source)) {
        const target = resolve(packageDir, importPath);
        const targetRelative = relative(packageDir, target).replaceAll('\\', '/');
        if (isPackaged(targetRelative)) continue;
        missing.push(`${sourceFile} -> ${targetRelative}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('keeps the executable, managed agent, and Skill projections in the package', () => {
    expect(packageManifest.bin).toMatchObject({ flovart: './cli.js', 'flovart-cli': './cli.js', 'flovart-mcp': './mcp-server.js' });
    expect(packageEntries.has('mcp-server.js')).toBe(true);
    expect(packageEntries.has('operation-gateway.js')).toBe(true);
    expect([...packageEntries]).toEqual(expect.arrayContaining(['cli.js', 'managed-agent', 'skill', 'scripts']));
  });
});
