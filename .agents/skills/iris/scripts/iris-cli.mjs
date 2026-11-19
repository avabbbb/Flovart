#!/usr/bin/env node
// Iris CLI 包装器 — 装完 skill 后只跑这一个文件即可。
//
// 解决两个问题：
//   1. skills/iris/ 装到用户全局（~/.claude/skills/）时相对路径会断
//   2. AI 代理不想记 npm run iris:cli -- 那一长串
//
// 用法（在 Iris 仓库根目录）：
//   node skills/iris/scripts/iris-cli.mjs status --json
//   node skills/iris/scripts/iris-cli.mjs workflow.inspect --project-id <id>
//   node skills/iris/scripts/iris-cli.mjs workflow.selection.get --project-id <id>
//
// 等价于：
//   npm run iris:cli -- status --json
//   node tools/iris/cli.js status --json
//
// 路径搜索顺序（找到第一个存在的就停）：
//   1. 同级 → ../../tools/iris/cli.js         （skill 在仓库内）
//   2. 同级 → ../../../tools/iris/cli.js      （skill 在用户全局）
//   3. 环境变量 IRIS_CLI                      （强制覆盖）
//   4. 当前工作目录 → tools/iris/cli.js       （在仓库根跑）

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function tryResolve(label) {
  if (existsSync(label) && statSync(label).isFile()) return label;
  return null;
}

const candidates = [
  process.env.IRIS_CLI,
  path.resolve(here, '../../tools/iris/cli.js'),
  path.resolve(here, '../../../tools/iris/cli.js'),
  path.resolve(here, '../../../../tools/iris/cli.js'),
  path.resolve(process.cwd(), 'tools/iris/cli.js'),
].filter(Boolean);

const target = candidates.map(tryResolve).find(Boolean);

if (!target) {
  console.error(
    '[iris-cli] 找不到 tools/iris/cli.js。\n' +
    '请在 Iris 仓库根目录运行此脚本，或设环境变量 IRIS_CLI 指向 cli.js 绝对路径。\n' +
    '搜索过的路径:\n  ' + candidates.join('\n  '),
  );
  process.exit(2);
}

// 把所有 argv 透传给原 cli.js。cli.js 用 process.argv[2:] 解析，
// 我们当前脚本占了 argv[0..1]，所以从 argv[2] 开始是用户参数。
// 但更稳的是直接 process.argv = [node, target, ...userArgs]。
const userArgs = process.argv.slice(2);
process.argv = [process.argv[0], target, ...userArgs];

await import('file://' + path.resolve(target).replace(/\\/g, '/'));
