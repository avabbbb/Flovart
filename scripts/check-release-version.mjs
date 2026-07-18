import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const expected = String(process.argv[2] || readFileSync(resolve(root, 'VERSION'), 'utf8')).trim().replace(/^v/, '');
const sources = {
  VERSION: readFileSync(resolve(root, 'VERSION'), 'utf8').trim(),
  'package.json': JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  'tools/flovart/package.json': JSON.parse(readFileSync(resolve(root, 'tools/flovart/package.json'), 'utf8')).version,
  'src-tauri/tauri.conf.json': JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')).version,
  'src-tauri/Cargo.toml': readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
};
const mismatches = Object.entries(sources).filter(([, version]) => version !== expected);

if (mismatches.length) {
  throw new Error(`Release version ${expected} does not match: ${mismatches.map(([file, version]) => `${file}=${version || '(missing)'}`).join(', ')}`);
}
console.log(`Flovart release versions are aligned at ${expected}.`);
