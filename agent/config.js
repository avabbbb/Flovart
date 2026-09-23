import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_AGENT_PORT = 17373;
// Canonical agent config resolution order:
//   FLOVART_AGENT_CONFIG (explicit file)
//   → FLOVART_AGENT_HOME (home dir, file = <home>/agent.json)
//   → canonical dir (~/.flovart, file = ~/.flovart/agent.json)
//   → ~/.flovart/agent.json
// tools/flovart/local-agent.js replicates this exact order for the packaged CLI,
// which cannot import this module.
export function resolveAgentHome(env = process.env) {
  const configured = env.FLOVART_AGENT_CONFIG ? path.resolve(env.FLOVART_AGENT_CONFIG) : null;
  const dir = env.FLOVART_AGENT_HOME
    ? path.resolve(env.FLOVART_AGENT_HOME)
    : configured
      ? path.dirname(configured)
      : path.join(os.homedir(), '.flovart');
  return { dir, configFile: configured || path.join(dir, 'agent.json') };
}

const agentHome = resolveAgentHome();
export const AGENT_DIR = agentHome.dir;
export const AGENT_CONFIG_FILE = agentHome.configFile;

export function loadAgentConfig(create = false) {
  let raw = null;
  try {
    raw = fs.readFileSync(AGENT_CONFIG_FILE, 'utf8');
  } catch {
    raw = null; // 配置文件尚不存在：走新生成逻辑。
  }
  if (raw !== null) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      // 配置损坏：先把损坏文件备份为 *.corrupt 再重新生成，不静默覆盖。
      try {
        const backup = backupCorruptConfig();
        console.error(`[flovart-agent] Agent 配置文件损坏，已备份为 ${backup}，将重新生成。原始错误：${error?.message || error}`);
      } catch (backupError) {
        console.error(`[flovart-agent] Agent 配置文件损坏且备份失败：${backupError?.message || backupError}`);
      }
    }
  }
  const port = Number(process.env.FLOVART_AGENT_PORT) || DEFAULT_AGENT_PORT;
  const config = { url: `http://127.0.0.1:${port}`, token: crypto.randomBytes(18).toString('hex'), origin: null, threads: {} };
  if (create) saveAgentConfig(config);
  return config;
}

// Windows 的 rename 不能覆盖已存在的目标，备份名冲突时降级为带时间戳的备份名。
function backupCorruptConfig() {
  try {
    fs.renameSync(AGENT_CONFIG_FILE, `${AGENT_CONFIG_FILE}.corrupt`);
    return `${AGENT_CONFIG_FILE}.corrupt`;
  } catch { /* 目标已存在等：换带时间戳的备份名重试 */ }
  const stamped = `${AGENT_CONFIG_FILE}.${Date.now()}.corrupt`;
  fs.renameSync(AGENT_CONFIG_FILE, stamped);
  return stamped;
}

export async function saveAgentConfig(config) {
  const dir = path.dirname(AGENT_CONFIG_FILE);
  const tempFile = path.join(dir, `.${path.basename(AGENT_CONFIG_FILE)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    // 写临时文件 + rename 原子替换，避免写盘中断留下半截配置。
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(tempFile, JSON.stringify(config, null, 2), 'utf8');
    try {
      if (process.platform !== 'win32') await fsp.chmod(tempFile, 0o600);
    } catch { /* POSIX 权限加固失败不阻断写盘 */ }
    await fsp.rename(tempFile, AGENT_CONFIG_FILE);
  } catch (error) {
    try { await fsp.rm(tempFile, { force: true }); } catch { /* best effort */ }
    // 写盘失败时降级为内存生效：调用方（请求/启动流程）不因此 500 或崩溃。
    console.error(`[flovart-agent] Agent 配置写入失败，本次修改仅在内存中生效：${error?.message || error}`);
  }
}

export function workspaceForProject(projectId = 'default') {
  const safe = String(projectId).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'default';
  const directory = path.join(AGENT_DIR, 'workspaces', safe);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
