// Node-side Skill Hub client for the CLI: reads the external HUB protocol
// (list + package endpoints) without the browser module's DOM assumptions.
// The HUB website exposes:
//   GET {hubUrl}/api/skills.json                 -> { ok: true, skills: [...] }
//   GET {hubUrl}/api/skills/{id}/package.json    -> { id, version, files: [{ path, content }] }
//   {hubUrl}/skills/{id}                         -> human-readable detail page

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_PACKAGE_BYTES = 6 * 1024 * 1024;

export class SkillHubError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkillHubError';
    this.code = code;
  }
}

export function normalizeHubUrl(input) {
  let text = String(input || '').trim();
  while (text.endsWith('/')) text = text.slice(0, -1);
  if (!text) throw new SkillHubError('INVALID_URL', 'Skill Hub 地址不能为空。');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new SkillHubError('INVALID_URL', 'Skill Hub 地址无效，请输入完整 URL（如 https://skills.example.com）。');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SkillHubError('INVALID_URL', 'Skill Hub 只支持 http(s) 地址。');
  }
  let pathname = url.pathname;
  while (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  return url.origin + pathname;
}

/** Install/downloads may only reach https endpoints or loopback http (SSRF guard). */
export function assertInstallableHubUrl(hubUrl) {
  const normalized = normalizeHubUrl(hubUrl);
  const url = new URL(normalized);
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new SkillHubError('INVALID_URL', 'Skill Hub 只允许 https 或本机 loopback http。');
  }
  return normalized;
}

export function hubSkillExternalUrl(hubUrl, id) {
  return `${hubUrl}/skills/${encodeURIComponent(id)}`;
}

function parseSkillList(payload) {
  const list = payload && typeof payload === 'object'
    ? Array.isArray(payload) ? payload : payload.skills
    : undefined;
  if (!Array.isArray(list)) throw new SkillHubError('BAD_MANIFEST', 'Skill Hub 返回的清单格式无效。');
  const skills = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const name = typeof item.name === 'string' ? item.name : id;
    const version = typeof item.version === 'string' ? item.version : '';
    if (!id || !version) continue;
    skills.push({
      id,
      name,
      version,
      description: typeof item.description === 'string' ? item.description : '',
      author: typeof item.author === 'string' ? item.author : undefined,
      homepageUrl: typeof item.homepageUrl === 'string' ? item.homepageUrl : undefined,
      tags: Array.isArray(item.tags) ? item.tags.map(String) : undefined,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    });
  }
  return skills;
}

export async function fetchHubSkillList(hubUrl, fetcher = fetch) {
  const url = new URL('/api/skills.json', hubUrl);
  let response;
  try {
    response = await fetcher(url.toString());
  } catch {
    throw new SkillHubError('UNREACHABLE', `无法连接 Skill Hub：${url.origin}`);
  }
  if (!response.ok) throw new SkillHubError('UNREACHABLE', `Skill Hub 返回错误（HTTP ${response.status}）。`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new SkillHubError('BAD_MANIFEST', 'Skill Hub 清单不是合法 JSON。');
  }
  return parseSkillList(payload);
}

function parseSkillPackage(payload) {
  if (!payload || typeof payload !== 'object') throw new SkillHubError('PACKAGE_REJECTED', 'Skill Hub 返回的包格式无效。');
  const id = typeof payload.id === 'string' ? payload.id : '';
  const version = typeof payload.version === 'string' ? payload.version : '';
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!id || !version) throw new SkillHubError('PACKAGE_REJECTED', 'Skill 包缺少 id/version。');
  const entries = [];
  let total = 0;
  for (const item of files) {
    if (!item || typeof item !== 'object') continue;
    const path = typeof item.path === 'string' ? item.path : '';
    const content = typeof item.content === 'string' ? item.content : '';
    if (!path || !content) continue;
    total += content.length;
    if (total > MAX_PACKAGE_BYTES) throw new SkillHubError('PACKAGE_REJECTED', 'Skill 包超过大小限制。');
    entries.push({ path, content });
  }
  if (!entries.some(entry => entry.path === 'SKILL.md')) {
    throw new SkillHubError('PACKAGE_REJECTED', 'Skill 包缺少 SKILL.md。');
  }
  return { id, version, files: entries };
}

export async function fetchHubSkillPackage(hubUrl, id, fetcher = fetch) {
  const url = new URL(`/api/skills/${encodeURIComponent(id)}/package.json`, hubUrl);
  let response;
  try {
    response = await fetcher(url.toString());
  } catch {
    throw new SkillHubError('UNREACHABLE', `无法从 Skill Hub 下载 ${id}。`);
  }
  if (!response.ok) throw new SkillHubError('UNREACHABLE', `Skill Hub 下载 ${id} 失败（HTTP ${response.status}）。`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new SkillHubError('PACKAGE_REJECTED', 'Skill 包不是合法 JSON。');
  }
  const parsed = parseSkillPackage(payload);
  if (parsed.id !== id) throw new SkillHubError('PACKAGE_REJECTED', 'Skill 包 id 与请求不一致。');
  return parsed;
}
