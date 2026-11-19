// 副作用入口：CLI / MCP / Agent 的第一条 import，保证后续模块求值时环境变量与 ~/.iris 已就绪。
import { applyLegacyCompat } from './legacy-home.js';

if (!process.env.IRIS_SKIP_LEGACY_COMPAT) applyLegacyCompat();
