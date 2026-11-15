// 轻量命令清单：Skill 生态（本机注册表 / Hub / 画布转 Skill）与项目共享回执在 Runtime 注册表与 MCP 上的投影。
// 执行实现在 skill-commands.js（懒加载），这里只放名字，避免 MCP / CLI 启动时加载注册表与网络模块。
export const SKILL_SURFACE_COMMAND_NAMES = Object.freeze([
  'skill.list',
  'skill.manifest',
  'skill.hub.list',
  'skill.validate',
  'skill.init',
  'skill.draft',
  'skill.install',
  'skill.uninstall',
  'receipts.list',
]);

export const SKILL_SURFACE_WRITE_COMMAND_NAMES = Object.freeze([
  'skill.init',
  'skill.draft',
  'skill.install',
  'skill.uninstall',
]);

export const SKILL_SURFACE_COMMANDS = new Set(SKILL_SURFACE_COMMAND_NAMES);
export const SKILL_SURFACE_WRITE_COMMANDS = new Set(SKILL_SURFACE_WRITE_COMMAND_NAMES);
