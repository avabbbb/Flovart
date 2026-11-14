#!/usr/bin/env node
// Node 写入、Rust 读取的跨语言一致性检查：同一个 flovart-state.db 上，
// Rust `pipeline.run.get`（src-tauri/src/runtime/pipeline_trace.rs）必须返回与 Node `Pipeline.trace()` 完全相同的 JSON。
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipelineTraceScenario } from './e2e-pipeline-trace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const summary = await runPipelineTraceScenario({ log: () => {} });
const result = spawnSync('cargo', [
  'test', '--manifest-path', resolve(ROOT, 'src-tauri/Cargo.toml'), '--lib',
  'runtime::pipeline_trace::tests::matches_node_trace_for_real_run', '--', '--ignored', '--exact',
], {
  stdio: 'inherit',
  env: { ...process.env, FLOVART_PIPELINE_PARITY_DB: summary.dbPath, FLOVART_PIPELINE_PARITY_EXPECTED: summary.tracePath },
});
if (result.status !== 0) {
  console.error('Rust pipeline trace differs from Node trace');
  process.exit(result.status ?? 1);
}
console.log(`Rust pipeline.run.get matches Node trace (${summary.checks.length} scenario checks).`);
