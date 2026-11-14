import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PIPELINE_MIGRATION_SQL, PIPELINE_MIGRATION_VERSION } from '../tools/flovart/pipeline/schema.js';

describe('pipeline schema', () => {
  it('JS 副本与 Rust migration 5 使用的 SQL 逐字一致', () => {
    const sql = readFileSync(resolve(process.cwd(), 'tools/flovart/contracts/runtime/migrations/0005_agent_pipeline.sql'), 'utf8');
    expect(PIPELINE_MIGRATION_SQL).toBe(sql);
    expect(PIPELINE_MIGRATION_VERSION).toBe(5);
    const rust = readFileSync(resolve(process.cwd(), 'src-tauri/src/runtime/store.rs'), 'utf8');
    expect(rust).toContain('migrations/0005_agent_pipeline.sql');
    expect(rust).toMatch(/\(5, MIGRATION_0005\)/);
  });
});
