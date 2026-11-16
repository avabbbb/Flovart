// Seedance 参考图合规预检（libtv-docs-study D.4-5 / A.8）。
// 纯函数：只看节点上已记录的格式、像素尺寸与体积，不读文件、不发请求。
// 规则：格式 jpeg/png/webp/bmp/tiff/gif，宽高各 300–6000 px，宽高比 0.4–2.5，体积 < 30MB。
// 一项不合格，整批不提交；尺寸或体积未知时不判（交给运行时 Provider 校验兜底）。

export const SEEDANCE_IMAGE_LIMITS = {
  formats: ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'] as const,
  minSide: 300,
  maxSide: 6000,
  minAspect: 0.4,
  maxAspect: 2.5,
  maxBytes: 30 * 1024 * 1024,
};

export type SeedanceIssueCode =
  | 'SEEDANCE_FORMAT'
  | 'SEEDANCE_SIDE_TOO_SMALL'
  | 'SEEDANCE_SIDE_TOO_LARGE'
  | 'SEEDANCE_ASPECT'
  | 'SEEDANCE_TOO_LARGE';

export interface SeedanceReferenceInput {
  title: string;
  kind: string;
  mimeType?: string;
  /** 文件名或 URL，mimeType 缺失时用扩展名判断格式。 */
  name?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface SeedanceIssue {
  code: SeedanceIssueCode;
  reference: string;
  message: string;
}

export interface SeedanceNodeInput {
  nodeId: string;
  title: string;
  references: SeedanceReferenceInput[];
}

export interface SeedanceNodeFailure {
  nodeId: string;
  title: string;
  issues: SeedanceIssue[];
}

export interface SeedanceBatchResult {
  ok: boolean;
  failures: SeedanceNodeFailure[];
}

export function isSeedanceModel(modelId: string | undefined | null): boolean {
  return Boolean(modelId && modelId.toLowerCase().includes('seedance'));
}

const EXTENSION_FORMAT: Record<string, string> = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', bmp: 'bmp', tif: 'tiff', tiff: 'tiff', gif: 'gif',
  heic: 'heic', heif: 'heif', avif: 'avif', svg: 'svg',
};

/** 归一化图片格式；无法判断时返回 undefined（不拦）。 */
export function seedanceImageFormat(reference: Pick<SeedanceReferenceInput, 'mimeType' | 'name'>): string | undefined {
  const mime = reference.mimeType?.toLowerCase().split(';')[0].trim();
  if (mime?.startsWith('image/')) {
    const sub = mime.slice('image/'.length).replace(/^x-/, '');
    if (sub === 'jpg' || sub === 'pjpeg') return 'jpeg';
    if (sub === 'svg+xml') return 'svg';
    return sub;
  }
  const name = reference.name?.split(/[?#]/)[0] ?? '';
  if (name.startsWith('data:image/')) return seedanceImageFormat({ mimeType: name.slice(5, name.indexOf(';') > 0 ? name.indexOf(';') : undefined) });
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? EXTENSION_FORMAT[match[1].toLowerCase()] ?? match[1].toLowerCase() : undefined;
}

function positive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** 单张参考图的问题清单；非图片参考不在本预检范围（视频分辨率由 referenceTranscode 处理）。 */
export function checkSeedanceReference(reference: SeedanceReferenceInput): SeedanceIssue[] {
  if (reference.kind !== 'image') return [];
  const limits = SEEDANCE_IMAGE_LIMITS;
  const issues: SeedanceIssue[] = [];
  const label = '「' + reference.title + '」';
  const format = seedanceImageFormat(reference);
  if (format && !(limits.formats as readonly string[]).includes(format)) {
    issues.push({ code: 'SEEDANCE_FORMAT', reference: reference.title, message: label + ' 格式 ' + format + ' 不受支持，仅支持 ' + limits.formats.join('/') });
  }
  if (positive(reference.width) && positive(reference.height)) {
    const { width, height } = reference;
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    if (short < limits.minSide) {
      issues.push({ code: 'SEEDANCE_SIDE_TOO_SMALL', reference: reference.title, message: label + ' ' + width + '×' + height + ' 边长小于 ' + limits.minSide + 'px' });
    }
    if (long > limits.maxSide) {
      issues.push({ code: 'SEEDANCE_SIDE_TOO_LARGE', reference: reference.title, message: label + ' ' + width + '×' + height + ' 边长大于 ' + limits.maxSide + 'px' });
    }
    const aspect = width / height;
    if (aspect < limits.minAspect || aspect > limits.maxAspect) {
      issues.push({ code: 'SEEDANCE_ASPECT', reference: reference.title, message: label + ' 宽高比 ' + aspect.toFixed(2) + ' 超出 ' + limits.minAspect + '–' + limits.maxAspect });
    }
  }
  if (positive(reference.bytes) && reference.bytes >= limits.maxBytes) {
    issues.push({ code: 'SEEDANCE_TOO_LARGE', reference: reference.title, message: label + ' 体积 ' + (reference.bytes / 1024 / 1024).toFixed(1) + 'MB，需小于 30MB' });
  }
  return issues;
}

/** 整批预检：任一节点任一参考不合格，ok=false，逐节点列出问题。 */
export function seedanceBatchPreflight(nodes: readonly SeedanceNodeInput[]): SeedanceBatchResult {
  const failures: SeedanceNodeFailure[] = [];
  for (const node of nodes) {
    const issues = node.references.flatMap(checkSeedanceReference);
    if (issues.length) failures.push({ nodeId: node.nodeId, title: node.title, issues });
  }
  return { ok: failures.length === 0, failures };
}

/** 整批拒绝时的文案：一行总述 + 每节点一行。 */
export function describeSeedanceFailures(result: SeedanceBatchResult): string {
  if (result.ok) return '';
  return [
    'Seedance 合规预检未通过，整批未提交（' + result.failures.length + ' 个节点不合格）：',
    ...result.failures.map(failure => '「' + failure.title + '」(' + failure.nodeId + ')：' + failure.issues.map(issue => issue.message).join('；')),
  ].join('\n');
}
