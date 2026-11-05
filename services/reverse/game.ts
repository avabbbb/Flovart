import type {
  ReverseAssetCategory,
  ReverseAssetEntry,
  ReverseAssetState,
  ReverseGameProject,
  ReverseGate,
  ReverseOutputRef,
  ReverseStyleBible,
} from './types';

export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
export const DEFAULT_OVERRIDE_DIR = 'remake/assets/override/';

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac)$/i;

// 按 id / 符号名 / 路径关键词粗分类；分不出归 other，由人工在面板修正。
const CATEGORY_RULES: Array<[ReverseAssetCategory, RegExp]> = [
  ['ui', /(btn|button|panel|dialog|frame|bar|tab|menu|hud|ui)/i],
  ['icon', /(icon|ico|badge|coin|gem)/i],
  ['background', /(bg|background|scene|map|sky|ground)/i],
  ['effect', /(fx|effect|eff|particle|explode|explosion|hit|glow)/i],
  ['character', /(char|hero|role|npc|enemy|boss|player|monster|avatar)/i],
  ['prop', /(prop|item|weapon|tool|box|chest)/i],
];

export function classifyAsset(text: string, mediaKind: 'image' | 'audio'): ReverseAssetCategory {
  if (mediaKind === 'audio') return 'audio';
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(text)) return category;
  }
  return 'other';
}

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;
}

function pickString(obj: Loose, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickNumber(obj: Loose, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

interface RawManifestItem {
  id: string;
  path?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  mediaKind: 'image' | 'audio';
}

function normalizeItem(raw: unknown, fallbackId: string | undefined, hint?: 'image' | 'audio'): RawManifestItem | null {
  if (typeof raw === 'string') {
    if (!fallbackId) return null;
    return { id: fallbackId, path: raw, mediaKind: hint ?? (AUDIO_EXT_RE.test(raw) ? 'audio' : 'image') };
  }
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = pickString(obj, ['id', 'key', 'name', 'symbolId']) ?? fallbackId;
  if (!id) return null;
  const path = pickString(obj, ['path', 'file', 'src', 'url', 'output']);
  const typeText = (pickString(obj, ['type', 'kind', 'mediaKind']) ?? '').toLowerCase();
  const mediaKind: 'image' | 'audio' = hint
    ?? (/(sound|audio|sfx|music)/.test(typeText) || (path !== undefined && AUDIO_EXT_RE.test(path)) ? 'audio' : 'image');
  const alpha = obj.hasAlpha ?? obj.alpha ?? obj.transparent;
  return {
    id,
    path,
    width: pickNumber(obj, ['width', 'w']),
    height: pickNumber(obj, ['height', 'h']),
    hasAlpha: typeof alpha === 'boolean' ? alpha : undefined,
    mediaKind,
  };
}

// 容忍多种 manifest 形状：数组、id → 条目的对象、或 { images, sounds|audio } 分组。
export function parseManifest(manifest: unknown): RawManifestItem[] {
  const out: RawManifestItem[] = [];
  const push = (raw: unknown, key?: string, hint?: 'image' | 'audio') => {
    const item = normalizeItem(raw, key, hint);
    if (item) out.push(item);
  };
  const walk = (value: unknown, hint?: 'image' | 'audio') => {
    if (Array.isArray(value)) { value.forEach((raw) => push(raw, undefined, hint)); return; }
    const obj = asRecord(value);
    if (!obj) return;
    Object.entries(obj).forEach(([key, raw]) => push(raw, key, hint));
  };
  const root = asRecord(manifest);
  if (root && (root.images || root.sounds || root.audio || root.assets)) {
    if (root.assets) walk(root.assets);
    if (root.images) walk(root.images, 'image');
    if (root.sounds) walk(root.sounds, 'audio');
    if (root.audio) walk(root.audio, 'audio');
  } else {
    walk(manifest);
  }
  const seen = new Set<string>();
  return out.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

// asset-map：符号名 → 素材 id（字符串 / 数字 / { id }），反转成 id → 符号列表。
export function invertAssetMap(assetMap: unknown): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const obj = asRecord(assetMap);
  if (!obj) return result;
  for (const [symbol, raw] of Object.entries(obj)) {
    const rec = asRecord(raw);
    const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : rec ? pickString(rec, ['id', 'swfId', 'assetId']) : undefined;
    if (!id) continue;
    const list = result.get(id) ?? [];
    list.push(symbol);
    result.set(id, list);
  }
  result.forEach((list) => list.sort());
  return result;
}

// 导入 ledger。原作素材默认全部 must-replace；重导时保留已有的状态、候选和人工分类。
export function importLedger(manifest: unknown, assetMap?: unknown, existing: readonly ReverseAssetEntry[] = []): ReverseAssetEntry[] {
  const symbolsById = invertAssetMap(assetMap);
  const prev = new Map(existing.map((e) => [e.id, e]));
  return parseManifest(manifest).map((item) => {
    const symbols = symbolsById.get(item.id) ?? [];
    const old = prev.get(item.id);
    const entry: ReverseAssetEntry = {
      id: item.id,
      symbols,
      category: old?.category ?? classifyAsset([item.id, ...symbols, item.path ?? ''].join(' '), item.mediaKind),
      mediaKind: item.mediaKind,
      state: old?.state ?? 'must-replace',
      candidates: old?.candidates ?? [],
    };
    if (item.width !== undefined) entry.width = item.width;
    if (item.height !== undefined) entry.height = item.height;
    if (item.hasAlpha !== undefined) entry.hasAlpha = item.hasAlpha;
    if (item.path !== undefined) entry.sourcePath = item.path;
    if (old?.rejectReason) entry.rejectReason = old.rejectReason;
    return entry;
  });
}

export interface LedgerFilter {
  category?: ReverseAssetCategory | 'all';
  state?: ReverseAssetState | 'all';
  mediaKind?: 'image' | 'audio' | 'all';
  query?: string;
}

export function filterLedger(ledger: readonly ReverseAssetEntry[], filter: LedgerFilter): ReverseAssetEntry[] {
  const q = filter.query?.trim().toLowerCase();
  return ledger.filter((e) => {
    if (filter.category && filter.category !== 'all' && e.category !== filter.category) return false;
    if (filter.state && filter.state !== 'all' && e.state !== filter.state) return false;
    if (filter.mediaKind && filter.mediaKind !== 'all' && e.mediaKind !== filter.mediaKind) return false;
    if (q && !e.id.toLowerCase().includes(q) && !e.symbols.some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  });
}

export interface LedgerSummary {
  total: number;
  byState: Record<ReverseAssetState, number>;
  byCategory: Record<ReverseAssetCategory, number>;
  // 已批准或保留占比，0..1。
  progress: number;
}

export function summarizeLedger(ledger: readonly ReverseAssetEntry[]): LedgerSummary {
  const byState: Record<ReverseAssetState, number> = { 'must-replace': 0, generating: 0, candidate: 0, approved: 0, rejected: 0, keep: 0 };
  const byCategory: Record<ReverseAssetCategory, number> = { character: 0, ui: 0, background: 0, effect: 0, icon: 0, prop: 0, audio: 0, other: 0 };
  for (const e of ledger) { byState[e.state] += 1; byCategory[e.category] += 1; }
  const done = byState.approved + byState.keep;
  return { total: ledger.length, byState, byCategory, progress: ledger.length ? done / ledger.length : 0 };
}

// pHash 相似度：两个等长十六进制哈希的 1 - 汉明距离/位数。长度不等或非法返回 null。
export function hashSimilarity(a: string, b: string): number | null {
  const ha = a.trim().toLowerCase();
  const hb = b.trim().toLowerCase();
  if (!ha || ha.length !== hb.length || !/^[0-9a-f]+$/.test(ha) || !/^[0-9a-f]+$/.test(hb)) return null;
  let distance = 0;
  for (let i = 0; i < ha.length; i += 1) {
    let x = parseInt(ha[i], 16) ^ parseInt(hb[i], 16);
    while (x) { distance += x & 1; x >>= 1; }
  }
  return 1 - distance / (ha.length << 2);
}

// 相似度闸门：越像原作越危险，分数达到阈值即 failed。waived 只能由人工设置，这里不产生。
export function evaluateSimilarityGate(
  targetId: string,
  score: number | null,
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
  checkedAt?: string,
): ReverseGate {
  const base: ReverseGate = { id: 'gate:similarity:' + targetId, kind: 'similarity', targetId, status: 'pending', threshold };
  if (checkedAt) base.checkedAt = checkedAt;
  if (score === null || !Number.isFinite(score)) return { ...base, message: 'no-score' };
  const failed = score >= threshold;
  return { ...base, score, status: failed ? 'failed' : 'passed', message: failed ? 'too-similar-to-original' : undefined };
}

// 候选只有在相似度闸门 passed 或人工 waived 时才可批准。
export function canApproveAsset(project: Pick<ReverseGameProject, 'gates'>, assetId: string): boolean {
  const gate = project.gates.find((g) => g.kind === 'similarity' && g.targetId === assetId);
  return gate?.status === 'passed' || gate?.status === 'waived';
}

export function defaultStyleBible(): ReverseStyleBible {
  return { palette: [], forbidden: [], anchorNodeIds: [] };
}

const CATEGORY_PROMPT: Record<ReverseAssetCategory, string> = {
  character: 'game character sprite',
  ui: 'game UI element',
  background: 'game background',
  effect: 'game visual effect',
  icon: 'game icon',
  prop: 'game prop',
  audio: 'game sound effect',
  other: 'game asset',
};

// 生成提示词只用功能规格（类别、尺寸、透明、符号含义）和风格圣经；不引用原作图像。
export function buildAssetPrompt(entry: ReverseAssetEntry, bible: ReverseStyleBible): string {
  const parts: string[] = [CATEGORY_PROMPT[entry.category]];
  if (entry.symbols.length) parts.push('role: ' + entry.symbols.slice(0, 3).join(', '));
  if (entry.width && entry.height) parts.push('canvas ' + entry.width + 'x' + entry.height + 'px');
  if (entry.hasAlpha) parts.push('transparent background');
  if (bible.palette.length) parts.push('palette ' + bible.palette.join(' '));
  if (bible.lineWork) parts.push('line work: ' + bible.lineWork);
  if (bible.texture) parts.push('texture: ' + bible.texture);
  parts.push('original design, do not imitate any existing game');
  if (bible.forbidden.length) parts.push('avoid: ' + bible.forbidden.join(', '));
  return parts.join('; ');
}

// 规格 key：提示词（功能规格 + 风格圣经）的内容哈希。key 不变 = 已写出的规格节点仍对应当前输入，可显式复用；
// 风格圣经、尺寸或符号一改 key 就变，旧候选不再算当前产物。
export function assetSpecKey(entry: ReverseAssetEntry, bible: ReverseStyleBible): string {
  const prompt = buildAssetPrompt(entry, bible);
  let hash = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i += 1) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return entry.id + '@' + hash.toString(36);
}

export interface AssetRunPlan {
  send: Array<{ entry: ReverseAssetEntry; key: string; prompt: string }>;
  // 已有同 key 候选且素材未被驳回：跳过，不重复写规格节点。
  reused: Array<{ entry: ReverseAssetEntry; candidate: ReverseOutputRef }>;
}

// 复用只认 key 相同，不按 id 或文件名推断；被驳回的素材即使 key 相同也重新出规格。
export function planAssetRun(entries: readonly ReverseAssetEntry[], bible: ReverseStyleBible): AssetRunPlan {
  const plan: AssetRunPlan = { send: [], reused: [] };
  for (const entry of entries) {
    const key = assetSpecKey(entry, bible);
    const candidate = entry.state === 'rejected' ? undefined : entry.candidates.find((c) => c.key === key);
    if (candidate) plan.reused.push({ entry, candidate });
    else plan.send.push({ entry, key, prompt: buildAssetPrompt(entry, bible) });
  }
  return plan;
}

export function overridePathFor(entry: Pick<ReverseAssetEntry, 'id' | 'mediaKind' | 'sourcePath'>, overrideDir = DEFAULT_OVERRIDE_DIR): string {
  const dir = overrideDir.endsWith('/') ? overrideDir : overrideDir + '/';
  const extMatch = entry.sourcePath?.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : entry.mediaKind === 'audio' ? '.mp3' : '.png';
  return dir + entry.id.replace(/[^a-zA-Z0-9._-]/g, '_') + ext;
}

export function createGameProject(id: string, title: string, now: string): ReverseGameProject {
  return {
    id,
    title,
    direction: 'game',
    status: 'draft',
    references: [],
    anchors: [],
    outputs: [],
    gates: [],
    ledger: [],
    styleBible: defaultStyleBible(),
    similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
    overrideDir: DEFAULT_OVERRIDE_DIR,
    createdAt: now,
    updatedAt: now,
  };
}
