#!/usr/bin/env node
// Append-only findings store for the Product Maturity Eval.
// Agents record findings/verdicts here so concurrent subagents share one
// evidence base without clobbering each other.
//
//   node eval/product-maturity/findings.mjs add <json-file>
//   node eval/product-maturity/findings.mjs list [--status X] [--group Y]
//   node eval/product-maturity/findings.mjs get <id>
//   node eval/product-maturity/findings.mjs set <id> <json-patch-file>
//
// The store is a single JSON document at eval/product-maturity/findings.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const STORE = join(here, 'findings.json');

async function load() {
  if (!existsSync(STORE)) return { findings: [], verdicts: {}, rejections: [], fixes: [] };
  return JSON.parse(await readFile(STORE, 'utf8'));
}
async function save(doc) {
  await mkdir(here, { recursive: true });
  await writeFile(STORE, JSON.stringify(doc, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  const doc = await load();
  if (cmd === 'add') {
    const items = JSON.parse(await readFile(resolve(rest[0]), 'utf8'));
    const arr = Array.isArray(items) ? items : [items];
    for (const f of arr) {
      if (!doc.findings.some(x => x.id === f.id)) doc.findings.push(f);
      else Object.assign(doc.findings.find(x => x.id === f.id), f);
    }
    await save(doc);
    console.log(`added ${arr.length}; total ${doc.findings.length}`);
    return;
  }
  if (cmd === 'list') {
    const si = rest.indexOf('--status');
    const gi = rest.indexOf('--group');
    let rows = doc.findings;
    if (si > -1) rows = rows.filter(f => f.status === rest[si + 1]);
    if (gi > -1) rows = rows.filter(f => f.group === rest[gi + 1]);
    console.log(JSON.stringify(rows.map(f => ({ id: f.id, group: f.group, severity: f.severity, status: f.status, verdict: f.verdict, title: f.title })), null, 2));
    return;
  }
  if (cmd === 'get') {
    const f = doc.findings.find(x => x.id === rest[0]);
    console.log(JSON.stringify(f || null, null, 2));
    return;
  }
  if (cmd === 'set') {
    const id = rest[0];
    const patch = JSON.parse(await readFile(resolve(rest[1]), 'utf8'));
    const i = doc.findings.findIndex(x => x.id === id);
    if (i < 0) { console.error('not found: ' + id); process.exit(2); }
    doc.findings[i] = { ...doc.findings[i], ...patch };
    await save(doc);
    console.log('updated ' + id);
    return;
  }
  console.error('commands: add <file> | list [--status|--group] | get <id> | set <id> <patch>');
  process.exit(2);
}
main().catch(e => { console.error(e.message); process.exit(1); });
