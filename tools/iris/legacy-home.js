// 2026-11-20 Flovart → Iris 更名的本机兼容层（Node 入口最先 import 本文件）：
// 1. 环境变量：FLOVART_* / FLOVARTBENCH_* 作为 IRIS_* / IRISBENCH_* 的回退（只在新名字未设置时复制）。
// 2. 数据目录：~/.iris 不存在而 ~/.flovart 存在时，整目录复制为 ~/.iris（先复制到临时目录再原子改名，
//    与桌面端 Rust 侧同一规则，谁先启动谁迁移）；旧目录本版本保留不删。
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function applyLegacyEnv(env = process.env) {
  const applied = [];
  for (const key of Object.keys(env)) {
    if (!key.startsWith('FLOVART')) continue;
    const next = 'IRIS' + key.slice('FLOVART'.length);
    if (env[next] === undefined) {
      env[next] = env[key];
      applied.push(next);
    }
  }
  return applied;
}

export function migrateLegacyHome({ home = homedir() } = {}) {
  const target = join(home, '.iris');
  const legacy = join(home, '.flovart');
  if (existsSync(target) || !existsSync(legacy)) return { migrated: false, target };
  const staging = join(home, `.iris.migrating-${process.pid}-${Date.now()}`);
  try {
    cpSync(legacy, staging, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    renameSync(staging, target);
    return { migrated: true, target };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    // 另一个进程（桌面端或另一个 CLI）已先完成迁移：以它为准。
    if (existsSync(target)) return { migrated: false, target };
    throw error;
  }
}

export function applyLegacyCompat({ env = process.env, home = homedir() } = {}) {
  applyLegacyEnv(env);
  try {
    migrateLegacyHome({ home });
  } catch (error) {
    console.error(`[iris] 迁移 ~/.flovart 到 ~/.iris 失败：${error?.message || error}`);
  }
}
