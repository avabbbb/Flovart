// Agent 本地文件搜索：对已连接的本地文件夹做正则 grep（OMP grep 的浏览器版）。
// 浏览器没有任意路径访问权：只搜索用户在画布里授权过的文件夹，跳过非文本文件与二进制。
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
  skippedFolders: string[];
  missingFolders: boolean;
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

export function formatGrepMatches(result: AgentGrepResult): string {
  if (!result.matches.length) {
    if (result.missingFolders) return '没有已连接的本地文件夹：请让用户在画布「本地」里先连接一个文件夹。';
    return result.skippedFolders.length
      ? `没有匹配。以下文件夹读取权限已失效，请用户重新连接：${result.skippedFolders.join('、')}`
      : '没有匹配。';
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
  const notes: string[] = [];
  if (result.truncated) notes.push(`结果已截断：显示 ${result.matches.length} 条匹配（已扫描 ${result.scannedFiles} 个文件）。收窄 pattern 或 path 再试。`);
  if (result.skippedFolders.length) notes.push(`权限失效已跳过：${result.skippedFolders.join('、')}`);
  return notes.length ? `${body}\n\n${notes.join('\n')}` : body;
}

interface GrepOptions {
  pattern: string;
  /** 只搜某个子目录（相对文件夹根）。 */
  path?: string;
  caseSensitive?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * 遍历已授权文件夹里的文本文件做逐行匹配。
 * 有硬上限（文件数/单文件体积/匹配数/30s），到顶就标记 truncated，不无限扫描。
 */
export async function grepLocalFolders(options: GrepOptions): Promise<AgentGrepResult> {
  const matches: AgentGrepMatch[] = [];
  const skippedFolders: string[] = [];
  const limit = Math.min(LOCAL_GREP_LIMITS.maxMatches, Math.max(1, Math.floor(options.limit ?? LOCAL_GREP_LIMITS.maxMatches)));
  const match = buildGrepMatcher(options.pattern, options.caseSensitive !== false);
  const sources = await listLocalFolderSources();
  const startedAt = Date.now();
  let scannedFiles = 0;
  let truncated = false;

  for (const source of sources) {
    if (matches.length >= limit || Date.now() - startedAt > LOCAL_GREP_LIMITS.timeoutMs) { truncated = true; break; }
    const permission = await getLocalFolderPermission(source.id);
    if (permission !== 'granted') { skippedFolders.push(source.name); continue; }
    const root = await loadLocalFolderHandle(source.id);
    if (!root) { skippedFolders.push(source.name); continue; }
    const start = options.path?.trim().replace(/^\.?\//, '');
    let directory: DirectoryHandleLike | undefined = root;
    if (start) {
      for (const segment of start.split('/').filter(Boolean)) {
        try {
          directory = await directory.getDirectoryHandle(segment);
        } catch {
          directory = undefined;
          break;
        }
      }
    }
    if (!directory) continue;
    const prefix = start ? start.replace(/\/+$/, '') + '/' : '';
    for await (const entry of walkFiles(directory, prefix, 1)) {
      if (matches.length >= limit || scannedFiles >= LOCAL_GREP_LIMITS.maxFiles || Date.now() - startedAt > LOCAL_GREP_LIMITS.timeoutMs) {
        truncated = true;
        break;
      }
      if (!isTextFilePath(entry.name)) continue;
      try {
        const file = await entry.handle.getFile();
        if (file.size > LOCAL_GREP_LIMITS.maxFileBytes) continue;
        scannedFiles += 1;
        const text = await file.text();
        if (text.includes('\u0000')) continue; // 二进制兜底
        let perFile = 0;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (!match(line)) continue;
          matches.push({
            folderId: source.id,
            folderName: source.name,
            path: entry.path,
            line: index + 1,
            text: line.length > 512 ? `${line.slice(0, 512)}…` : line,
          });
          perFile += 1;
          if (matches.length >= limit) { truncated = true; break; }
          if (perFile >= LOCAL_GREP_LIMITS.maxMatchesPerFile) { truncated = true; break; }
        }
      } catch {
        // 单个文件读失败不影响其它文件。
      }
    }
  }
  return { matches, scannedFiles, truncated, skippedFolders, missingFolders: sources.length === 0 };
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
}
