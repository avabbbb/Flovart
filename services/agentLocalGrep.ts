// Agent 本地文件搜索：对已连接的本地文件夹做正则 grep（OMP grep 的浏览器版）。
// 浏览器没有任意路径访问权：只搜索用户在画布里授权过的文件夹，跳过非文本文件与二进制。
//
// 与 OMP grep（packages/coding-agent/src/tools/grep.ts）对齐的错误语义：
// - 「范围不存在」与「范围存在但没匹配」必须是两种结果：path 在所有文件夹里都不存在 → 报 Path not found，
//   不能回落成「没有匹配」；多个 path 中只缺一部分 → 照常搜索并在结尾注明 missingPaths。
// - 省略 path / 空串 / "." / "./" 都表示文件夹根目录；可用 ";" 分隔多个范围；path 可以指向单个文件。
// - 浏览器原生 DOMException（NotFoundError 等）不直接抛给模型，翻译成可操作的中文原因。
import {
  getLocalFolderPermission,
  listLocalFolderSources,
  loadLocalFolderHandle,
  type DirectoryHandleLike,
  type FileHandleLike,
} from './localFolderSource';

export const LOCAL_GREP_TOOL_NAME = 'flovart_grep';

export const LOCAL_GREP_LIMITS = {
  maxFiles: 400,
  maxFileBytes: 512 * 1024,
  maxMatches: 200,
  maxMatchesPerFile: 50,
  maxDepth: 6,
  timeoutMs: 30_000,
} as const;

const TEXT_EXTENSIONS: Record<string, true> = {
  txt: true, md: true, markdown: true, json: true, jsonl: true, csv: true, tsv: true,
  srt: true, vtt: true, ass: true, log: true, yaml: true, yml: true, toml: true, ini: true,
  xml: true, html: true, htm: true, css: true, scss: true, less: true,
  js: true, mjs: true, cjs: true, ts: true, tsx: true, jsx: true, py: true, rb: true,
  go: true, rs: true, java: true, kt: true, swift: true, sh: true, ps1: true, bat: true,
};
const SKIP_DIRECTORIES: Record<string, true> = {
  node_modules: true, '.git': true, '.svn': true, dist: true, build: true, '.next': true, '.cache': true,
};

export interface AgentGrepMatch {
  folderId: string;
  folderName: string;
  path: string;
  line: number;
  text: string;
}

export interface AgentGrepResult {
  matches: AgentGrepMatch[];
  scannedFiles: number;
  truncated: boolean;
  /** 读取权限失效（需要用户重新授权）的文件夹。 */
  skippedFolders: string[];
  /** 句柄还在，但磁盘上的目录已被移动 / 删除 / 改名的文件夹。 */
  staleFolders?: string[];
  missingFolders: boolean;
  /** 多范围搜索里，在任何文件夹中都不存在而被跳过的 path。 */
  missingPaths?: string[];
  /** 文本扩展名、但超过单文件上限而跳过的文件数。 */
  oversizedFiles?: number;
  /** 内容含 NUL 被当作二进制跳过的文件数。 */
  binaryFiles?: number;
  /** 搜索根本无法进行时的原因；有值时调用方应作为工具错误返回。 */
  error?: string;
}

export function isTextFilePath(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTENSIONS[name.slice(dot + 1).toLowerCase()] === true;
}

/** 正则优先；语法不合法时退回字面量，避免一次手误让整个搜索失败。 */
export function buildGrepMatcher(pattern: string, caseSensitive: boolean): (line: string) => boolean {
  try {
    const expression = new RegExp(pattern, caseSensitive ? '' : 'i');
    return line => expression.test(line);
  } catch {
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    return line => (caseSensitive ? line : line.toLowerCase()).includes(needle);
  }
}

/**
 * 把模型给的 path 规范成相对文件夹根目录的段列表。
 * ""、"."、"./"、"/" → 根目录（空数组）；"./src/" → ["src"]；反斜杠按分隔符处理。
 * 含 ".." 的路径直接拒绝：浏览器句柄不能越出授权目录，不假装支持。
 */
export function normalizeGrepPath(raw: string | undefined): { segments: string[] } | { error: string } {
  const text = (raw ?? '').trim().replace(/\\/g, '/');
  const segments = text.split('/').filter(segment => segment !== '' && segment !== '.');
  if (segments.includes('..')) return { error: `path 不能包含 ".."：只能搜索已连接文件夹内部（收到 ${raw}）` };
  return { segments };
}

/** OMP 风格：";" 分隔多个范围；全空等同于省略。 */
export function splitGrepPaths(raw: string | undefined): string[] {
  if (raw === undefined) return [''];
  const parts = raw.split(';').map(part => part.trim());
  const nonEmpty = parts.filter(Boolean);
  return nonEmpty.length ? nonEmpty : [''];
}

function domErrorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
}

type ScopeResolution =
  | { kind: 'directory'; handle: DirectoryHandleLike; prefix: string }
  | { kind: 'file'; handle: FileHandleLike; path: string }
  | { kind: 'missing' }
  | { kind: 'stale' };

/** 沿段逐级取句柄；最后一段允许是文件（与 OMP 一样，path 可以直接指向单个文件）。 */
async function resolveScope(root: DirectoryHandleLike, segments: string[]): Promise<ScopeResolution> {
  let directory = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    try {
      directory = await directory.getDirectoryHandle(segment);
    } catch (error) {
      const name = domErrorName(error);
      if (isLast && (name === 'TypeMismatchError' || name === 'TypeError' || name === 'NotFoundError')) {
        try {
          const file = await directory.getFileHandle(segment);
          return { kind: 'file', handle: file, path: segments.join('/') };
        } catch (fileError) {
          if (index === 0 && domErrorName(fileError) === 'NotFoundError' && !(await rootStillExists(root))) return { kind: 'stale' };
          return { kind: 'missing' };
        }
      }
      if (index === 0 && name === 'NotFoundError' && !(await rootStillExists(root))) return { kind: 'stale' };
      return { kind: 'missing' };
    }
  }
  return { kind: 'directory', handle: directory, prefix: segments.length ? `${segments.join('/')}/` : '' };
}

/** 目录被移动 / 删除后句柄仍在 IndexedDB 里，第一次读条目才会抛 NotFoundError。 */
async function rootStillExists(root: DirectoryHandleLike): Promise<boolean> {
  const iterator = typeof root.entries === 'function' ? root.entries() : typeof root.values === 'function' ? root.values() : null;
  if (!iterator) return true;
  try {
    await iterator.next();
    return true;
  } catch (error) {
    return domErrorName(error) !== 'NotFoundError';
  }
}

export function formatGrepMatches(result: AgentGrepResult): string {
  if (result.error) return result.error;
  const notes: string[] = [];
  if (result.truncated) notes.push(`结果已截断：显示 ${result.matches.length} 条匹配（已扫描 ${result.scannedFiles} 个文件）。收窄 pattern 或 path 再试。`);
  if (result.missingPaths?.length) notes.push(`以下 path 在已连接文件夹里不存在，已跳过：${result.missingPaths.join('、')}`);
  if (result.staleFolders?.length) notes.push(`以下文件夹已被移动或删除，请用户重新连接：${result.staleFolders.join('、')}`);
  if (result.skippedFolders.length) notes.push(`以下文件夹读取权限已失效，请用户重新连接：${result.skippedFolders.join('、')}`);
  if (result.oversizedFiles) notes.push(`${result.oversizedFiles} 个文件超过 ${Math.round(LOCAL_GREP_LIMITS.maxFileBytes / 1024)}KB 未搜索。`);
  if (result.binaryFiles) notes.push(`${result.binaryFiles} 个文件含二进制内容已跳过。`);

  if (!result.matches.length) {
    if (result.missingFolders) return '没有已连接的本地文件夹：请让用户在画布「本地」里先连接一个文件夹。';
    const head = `没有匹配（已扫描 ${result.scannedFiles} 个文本文件）。`;
    return notes.length ? `${head}\n${notes.join('\n')}` : head;
  }
  const grouped = new Map<string, AgentGrepMatch[]>();
  for (const match of result.matches) {
    const key = `${match.folderName}/${match.path}`;
    grouped.set(key, [...(grouped.get(key) || []), match]);
  }
  const body = [...grouped.entries()].map(([file, matches]) => [
    `[${file}]`,
    ...matches.map(match => `*${match.line}|${match.text}`),
  ].join('\n')).join('\n\n');
  return notes.length ? `${body}\n\n${notes.join('\n')}` : body;
}

interface GrepOptions {
  pattern: string;
  /** 相对文件夹根目录的子目录或文件；";" 分隔多个；可用文件夹名开头限定某一个文件夹。 */
  path?: string;
  caseSensitive?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

interface UsableFolder {
  id: string;
  name: string;
  root: DirectoryHandleLike;
}

/**
 * 遍历已授权文件夹里的文本文件做逐行匹配。
 * 有硬上限（文件数/单文件体积/匹配数/30s），到顶就标记 truncated，不无限扫描。
 */
export async function grepLocalFolders(options: GrepOptions): Promise<AgentGrepResult> {
  const result: AgentGrepResult = {
    matches: [],
    scannedFiles: 0,
    truncated: false,
    skippedFolders: [],
    staleFolders: [],
    missingFolders: false,
    missingPaths: [],
    oversizedFiles: 0,
    binaryFiles: 0,
  };
  if (!options.pattern || !options.pattern.trim()) return { ...result, error: 'pattern 不能为空。' };

  const sources = await listLocalFolderSources();
  if (!sources.length) {
    return { ...result, missingFolders: true, error: '没有已连接的本地文件夹：请让用户在画布「本地」里先连接一个文件夹，再搜索。' };
  }

  // 1. 先确认哪些文件夹真的可读：权限失效、句柄丢失、目录被移走分别归类，不混进「没有匹配」。
  const folders: UsableFolder[] = [];
  for (const source of sources) {
    const permission = await getLocalFolderPermission(source.id);
    const root = permission === 'granted' ? await loadLocalFolderHandle(source.id) : null;
    if (!root) { result.skippedFolders.push(source.name); continue; }
    if (!(await rootStillExists(root))) { result.staleFolders!.push(source.name); continue; }
    folders.push({ id: source.id, name: source.name, root });
  }
  if (!folders.length) {
    const reasons: string[] = [];
    if (result.staleFolders!.length) reasons.push(`已被移动或删除：${result.staleFolders!.join('、')}`);
    if (result.skippedFolders.length) reasons.push(`读取权限已失效：${result.skippedFolders.join('、')}`);
    return { ...result, error: `已连接的本地文件夹都无法读取（${reasons.join('；')}）。请让用户在画布「本地」里重新连接。` };
  }

  // 2. 解析每个 path 范围；在任何文件夹里都找不到的范围记为 missing。
  const entries = splitGrepPaths(options.path);
  type Target = { folder: UsableFolder; scope: Exclude<ScopeResolution, { kind: 'missing' } | { kind: 'stale' }> };
  const targets: Target[] = [];
  for (const entry of entries) {
    const normalized = normalizeGrepPath(entry);
    if ('error' in normalized) return { ...result, error: normalized.error };
    let found = false;
    for (const folder of folders) {
      let scope = await resolveScope(folder.root, normalized.segments);
      // 允许以文件夹名开头（例如 "素材/refs"），文件夹里没有同名子目录时按「限定该文件夹」处理。
      if (scope.kind === 'missing' && normalized.segments[0] === folder.name) {
        scope = await resolveScope(folder.root, normalized.segments.slice(1));
      }
      if (scope.kind === 'stale') {
        if (!result.staleFolders!.includes(folder.name)) result.staleFolders!.push(folder.name);
        continue;
      }
      if (scope.kind === 'missing') continue;
      found = true;
      targets.push({ folder, scope });
    }
    if (!found) result.missingPaths!.push(entry || '.');
  }
  if (!targets.length) {
    const names = folders.map(folder => folder.name).join('、');
    return {
      ...result,
      error: `Path not found: ${result.missingPaths!.join('、')}。path 相对已连接文件夹的根目录（已连接：${names}）；省略 path 搜索全部文件夹。`,
    };
  }

  // 3. 逐个范围扫描。
  const limit = Math.min(LOCAL_GREP_LIMITS.maxMatches, Math.max(1, Math.floor(options.limit ?? LOCAL_GREP_LIMITS.maxMatches)));
  const match = buildGrepMatcher(options.pattern, options.caseSensitive !== false);
  const startedAt = Date.now();
  const seen = new Set<string>();
  const overBudget = () => result.matches.length >= limit
    || result.scannedFiles >= LOCAL_GREP_LIMITS.maxFiles
    || Date.now() - startedAt > LOCAL_GREP_LIMITS.timeoutMs;

  for (const { folder, scope } of targets) {
    if (options.signal?.aborted) throw new Error('搜索已取消');
    if (overBudget()) { result.truncated = true; break; }
    const files = scope.kind === 'file'
      ? singleFile(scope.path, scope.handle)
      : walkFiles(scope.handle, scope.prefix, 1);
    for await (const entry of files) {
      if (options.signal?.aborted) throw new Error('搜索已取消');
      if (overBudget()) { result.truncated = true; break; }
      // 指名的单文件不按扩展名过滤（与 OMP 一致）；目录扫描只看文本扩展名。
      if (scope.kind !== 'file' && !isTextFilePath(entry.name)) continue;
      const key = `${folder.id}:${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const file = await entry.handle.getFile();
        if (file.size > LOCAL_GREP_LIMITS.maxFileBytes) { result.oversizedFiles! += 1; continue; }
        result.scannedFiles += 1;
        const text = await file.text();
        if (text.includes('\u0000')) { result.binaryFiles! += 1; continue; }
        let perFile = 0;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (!match(line)) continue;
          result.matches.push({
            folderId: folder.id,
            folderName: folder.name,
            path: entry.path,
            line: index + 1,
            text: line.length > 512 ? `${line.slice(0, 512)}…` : line,
          });
          perFile += 1;
          if (result.matches.length >= limit) { result.truncated = true; break; }
          if (perFile >= LOCAL_GREP_LIMITS.maxMatchesPerFile) { result.truncated = true; break; }
        }
      } catch {
        // 单个文件读失败不影响其它文件。
      }
    }
  }
  return result;
}

async function* singleFile(path: string, handle: FileHandleLike): AsyncGenerator<{ path: string; name: string; handle: FileHandleLike }> {
  yield { path, name: handle.name || path.split('/').pop() || path, handle };
}

async function* walkFiles(
  directory: DirectoryHandleLike,
  prefix: string,
  depth: number,
): AsyncGenerator<{ path: string; name: string; handle: FileHandleLike }> {
  const iterator = typeof directory.entries === 'function'
    ? directory.entries()
    : typeof directory.values === 'function'
      ? directory.values()
      : null;
  if (!iterator) return;
  try {
    for await (const item of iterator) {
      const [name, handle] = Array.isArray(item)
        ? item
        : [(item as DirectoryHandleLike | FileHandleLike).name, item as DirectoryHandleLike | FileHandleLike];
      if (!name || name.startsWith('.')) continue;
      const path = prefix + name;
      if (handle.kind === 'file') {
        yield { path, name, handle: handle as FileHandleLike };
      } else if (depth < LOCAL_GREP_LIMITS.maxDepth && SKIP_DIRECTORIES[name] !== true) {
        yield* walkFiles(handle as DirectoryHandleLike, path + '/', depth + 1);
      }
    }
  } catch {
    // 子目录在扫描途中被删除或无权读取：跳过它，保留已扫到的结果。
  }
}
