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

import { readFile, writeFile, mkdir, rename, unlink, stat, open } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const STORE = join(here, 'findings.json');
const LOCK_PATH = join(here, 'findings.json.lock');

async function load() {
  if (!existsSync(STORE)) return { findings: [], verdicts: {}, rejections: [], fixes: [] };
  return JSON.parse(await readFile(STORE, 'utf8'));
}

async function save(doc) {
  await mkdir(here, { recursive: true });
  const tmpPath = `${STORE}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(doc, null, 2));
  await rename(tmpPath, STORE);
}

async function acquireLock() {
  for (;;) {
    try {
      const fh = await open(LOCK_PATH, 'wx');
      return fh;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const st = await stat(LOCK_PATH);
          if (Date.now() - st.mtimeMs > 10_000) {
            await unlink(LOCK_PATH);
            continue;
          }
        } catch { /* lock file removed between stat and here */ }
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      throw err;
    }
  }
}

async function releaseLock(fh) {
  try { await fh.close(); } catch { /* already closed */ }
  await unlink(LOCK_PATH).catch(() => {});
}

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  const isWrite = cmd === 'add' || cmd === 'set';
  const lock = isWrite ? await acquireLock() : null;
  try {
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
  } finally {
    if (lock) await releaseLock(lock);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
