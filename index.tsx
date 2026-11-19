// 入口：先把更名前（Flovart）的浏览器数据复制到 Iris 的新 key / 数据库名，再加载应用。
// 迁移必须早于任何 store 模块求值（localforage / zustand persist 会在 import 时打开或读取存储），
// 所以应用本体放在 appMain.tsx 里动态 import。迁移失败或超时（15s）都不阻塞启动。
import { migrateLegacyBrowserStorage } from './utils/legacyStorageMigration';

const MIGRATION_TIMEOUT_MS = 15_000;

void Promise.race([
  migrateLegacyBrowserStorage(),
  new Promise(resolve => setTimeout(resolve, MIGRATION_TIMEOUT_MS)),
])
  .catch(error => console.warn('[Iris] legacy storage migration failed', error))
  .finally(() => import('./appMain'));
