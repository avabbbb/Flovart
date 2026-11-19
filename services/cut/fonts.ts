// 字体：系统字体（queryLocalFonts，可用时）+ 一小组按需加载的网页字体（含中文）。
// 网页字体加载器改编自 OpenCut classic apps/web/src/fonts/google-fonts.ts（MIT，见 third_party/opencut/LICENSE）：
// 只在第一次用到某个字体时插入 Google Fonts 样式表并等 document.fonts 就绪，预览与导出共用同一份 FontFace。
import { effectiveTextStyle, type CutProject } from './timeline';

export interface CutFontOption { family: string; label: string; source: 'web' | 'system' | 'builtin'; cjk?: boolean }

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2';

/** 按需加载的网页字体（Google Fonts，开源授权）。 */
export const WEB_FONTS: readonly CutFontOption[] = [
  { family: 'Noto Sans SC', label: '思源黑体 Noto Sans SC', source: 'web', cjk: true },
  { family: 'Noto Serif SC', label: '思源宋体 Noto Serif SC', source: 'web', cjk: true },
  { family: 'LXGW WenKai TC', label: '霞鹜文楷 LXGW WenKai', source: 'web', cjk: true },
  { family: 'ZCOOL KuaiLe', label: '站酷快乐体 ZCOOL KuaiLe', source: 'web', cjk: true },
  { family: 'ZCOOL XiaoWei', label: '站酷小薇 ZCOOL XiaoWei', source: 'web', cjk: true },
  { family: 'Ma Shan Zheng', label: '马善政毛笔 Ma Shan Zheng', source: 'web', cjk: true },
  { family: 'Noto Sans JP', label: 'Noto Sans JP', source: 'web', cjk: true },
  { family: 'Noto Sans KR', label: 'Noto Sans KR', source: 'web', cjk: true },
  { family: 'Inter', label: 'Inter', source: 'web' },
  { family: 'Montserrat', label: 'Montserrat', source: 'web' },
  { family: 'Bebas Neue', label: 'Bebas Neue', source: 'web' },
  { family: 'Playfair Display', label: 'Playfair Display', source: 'web' },
  { family: 'Roboto Mono', label: 'Roboto Mono', source: 'web' },
];

/** 不需要下载的常见系统字体（OpenCut 的 SYSTEM_FONTS + 常见中文系统字体）。 */
export const BUILTIN_FONTS: readonly CutFontOption[] = [
  { family: 'system-ui', label: 'System UI', source: 'builtin' },
  { family: 'PingFang SC', label: '苹方 PingFang SC', source: 'builtin', cjk: true },
  { family: 'Microsoft YaHei', label: '微软雅黑 Microsoft YaHei', source: 'builtin', cjk: true },
  { family: 'Arial', label: 'Arial', source: 'builtin' },
  { family: 'Helvetica', label: 'Helvetica', source: 'builtin' },
  { family: 'Georgia', label: 'Georgia', source: 'builtin' },
  { family: 'Times New Roman', label: 'Times New Roman', source: 'builtin' },
  { family: 'Courier New', label: 'Courier New', source: 'builtin' },
];

const WEB_FAMILIES = new Set(WEB_FONTS.map(font => font.family));
const loaded = new Map<string, Promise<boolean>>();

function encodeFamily(family: string) {
  return family.replace(/ /g, '+');
}

/**
 * 加载一个字体；网页字体第一次用时才下载，系统字体只等 document.fonts 解析。失败返回 false（回退到默认字体）。
 * text：要画的实际文字。中文网页字体按 unicode-range 分成上百个分片，Canvas2D 画字时不会等分片下载，
 * 所以导出 / 快照前要用实际文字把对应分片都拉下来，否则首帧会画出豆腐块。
 */
export function loadCutFont(family: string | undefined, weights: number[] = [400, 700], text?: string): Promise<boolean> {
  const base = loadCutFontFamily(family, weights);
  if (!text || !family || family === 'system-ui' || typeof document === 'undefined') return base;
  return base.then(async ok => {
    if (!ok) return ok;
    const quoted = family.replace(/"/g, '\\"');
    await Promise.all(weights.map(weight => document.fonts.load(`${weight} 32px "${quoted}"`, text))).catch(() => undefined);
    return ok;
  });
}

function loadCutFontFamily(family: string | undefined, weights: number[]): Promise<boolean> {
  if (!family || family === 'system-ui' || typeof document === 'undefined') return Promise.resolve(true);
  const existing = loaded.get(family);
  if (existing) return existing;
  const job = (async () => {
    if (WEB_FAMILIES.has(family)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${GOOGLE_FONTS_CSS}?family=${encodeFamily(family)}:wght@${weights.join(';')}&display=swap`;
      link.dataset.cutFont = family;
      const ready = new Promise<boolean>(resolve => {
        link.addEventListener('load', () => resolve(true), { once: true });
        link.addEventListener('error', () => resolve(false), { once: true });
      });
      document.head.appendChild(link);
      if (!(await ready)) return false;
    }
    const quoted = family.replace(/"/g, '\\"');
    // 中文字体按 unicode-range 分片：带上中文样字才会真正下载对应分片。
    await Promise.all(weights.map(weight => document.fonts.load(`${weight} 32px "${quoted}"`, 'Aa中文字幕')));
    return document.fonts.check(`400 32px "${quoted}"`);
  })().catch(() => false);
  loaded.set(family, job);
  return job;
}

/** 导出 / 快照前：等项目里用到的所有字体就绪。 */
export async function loadProjectFonts(project: CutProject) {
  // family → 用这个字体要画的全部文字（字幕走项目字幕样式 + 单条覆盖，文字片段走自己的样式）。
  const families = new Map<string, string>();
  const add = (family: string | undefined, text = '') => { if (family) families.set(family, (families.get(family) || '') + text); };
  add(project.subtitleStyle?.fontFamily);
  for (const clip of project.clips) {
    if (clip.kind === 'subtitle' || clip.kind === 'text') add(effectiveTextStyle(project, clip).fontFamily, clip.text || '');
    else add(clip.textStyle?.fontFamily);
  }
  await Promise.all([...families].map(([family, text]) => loadCutFont(family, undefined, [...new Set(text)].join('') || undefined)));
}

let systemFonts: Promise<CutFontOption[]> | null = null;

export function canQuerySystemFonts() {
  return typeof window !== 'undefined' && typeof (window as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';
}

/** 读取本机安装的字体族（需要用户授权；不支持时返回空）。 */
export function querySystemFonts(): Promise<CutFontOption[]> {
  if (!canQuerySystemFonts()) return Promise.resolve([]);
  systemFonts ??= (async () => {
    const fonts = await (window as unknown as { queryLocalFonts: () => Promise<Array<{ family: string }>> }).queryLocalFonts();
    const families = [...new Set(fonts.map(font => font.family))].sort((a, b) => a.localeCompare(b));
    return families.map(family => ({ family, label: family, source: 'system' as const }));
  })().catch(() => { systemFonts = null; return []; });
  return systemFonts;
}
