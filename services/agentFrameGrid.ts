// Agent 看视频：把多帧拼成一张带时间码的帧网格。这里只放纯函数（取哪些时间点、怎么排版、怎么写说明），
// 画布绘制在 agentMediaView.ts 里调用，方便单测。

export const FRAME_GRID_DEFAULT_COUNT = 9;
export const FRAME_GRID_MIN_COUNT = 1;
export const FRAME_GRID_MAX_COUNT = 16;
/** 一页最多覆盖的秒数；更长的窗口分页查看，避免一张网格里帧距太大看不出动作。 */
export const FRAME_GRID_DEFAULT_PAGE_SEC = 30;
export const FRAME_GRID_MAX_EDGE = 1536;
export const FRAME_GRID_GAP = 4;
/** 截帧时离片尾留的余量，currentTime 设到 duration 时部分浏览器拿不到帧。 */
const END_MARGIN_SEC = 0.01;

/** 秒数 → 时间码：不到 1 小时为 m:ss.s，否则 h:mm:ss.s。负数和非数字按 0。 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const tenths = Math.round(safe * 10);
  const totalSec = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0') + '.' + frac;
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

export interface FrameGridTimeRequest {
  duration: number;
  /** 每页帧数，默认 9，范围 1–16 */
  count?: number;
  /** 查看窗口起止秒数，默认整段 */
  start?: number;
  end?: number;
  /** 第几页（从 1 开始） */
  page?: number;
  /** 每页覆盖的秒数，默认 30s；窗口不超过它时只有 1 页 */
  pageSec?: number;
}

export interface FrameGridTimePlan {
  times: number[];
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 在窗口里均匀取帧：每页切成 count 段，取每段中点（避开黑场首帧和取不到的末帧）。 */
export function planFrameGridTimes(request: FrameGridTimeRequest): FrameGridTimePlan {
  const duration = Number.isFinite(request.duration) && request.duration > 0 ? request.duration : 0;
  const count = clampInt(request.count, FRAME_GRID_MIN_COUNT, FRAME_GRID_MAX_COUNT, FRAME_GRID_DEFAULT_COUNT);
  const lastTime = Math.max(0, duration - END_MARGIN_SEC);
  const start = Math.min(Math.max(0, request.start ?? 0), duration);
  const rawEnd = request.end === undefined || !Number.isFinite(request.end) ? duration : request.end;
  const end = Math.max(start, Math.min(duration, rawEnd));
  const window = end - start;
  if (window <= 0) {
    return { times: [round2(Math.min(start, lastTime))], page: 1, totalPages: 1, pageStart: start, pageEnd: end };
  }
  const pageSec = request.pageSec && request.pageSec > 0 ? request.pageSec : FRAME_GRID_DEFAULT_PAGE_SEC;
  const totalPages = Math.max(1, Math.ceil(window / pageSec - 1e-9));
  const page = clampInt(request.page, 1, totalPages, 1);
  const pageStart = start + (page - 1) * pageSec;
  const pageEnd = Math.min(end, pageStart + pageSec);
  const slice = (pageEnd - pageStart) / count;
  const times = Array.from({ length: count }, (_, index) => round2(Math.min(lastTime, pageStart + slice * (index + 0.5))));
  return { times, page, totalPages, pageStart: round2(pageStart), pageEnd: round2(pageEnd) };
}

/** 调用方指定的秒数：去掉非法值、去重、升序、截到片长内，最多 16 个。 */
export function normalizeFrameTimes(times: readonly number[], duration?: number): number[] {
  const cap = duration !== undefined && Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - END_MARGIN_SEC) : Infinity;
  const unique = new Set<number>();
  for (const time of times) {
    if (!Number.isFinite(time) || time < 0) continue;
    unique.add(round2(Math.min(time, cap)));
  }
  return [...unique].sort((a, b) => a - b).slice(0, FRAME_GRID_MAX_COUNT);
}

export interface FrameGridCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameGridLayout {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  width: number;
  height: number;
  /** 时间码字号（px） */
  fontSize: number;
  cells: FrameGridCell[];
}

/**
 * 网格排版：横画面列数多一点、竖画面行数多一点，让整张图接近方形；
 * 总长边不超过 maxEdge，单帧不放大。
 */
export function planFrameGridLayout(input: { count: number; frameWidth: number; frameHeight: number; maxEdge?: number; gap?: number }): FrameGridLayout {
  const count = Math.max(1, Math.round(input.count));
  const frameWidth = input.frameWidth > 0 ? input.frameWidth : 1280;
  const frameHeight = input.frameHeight > 0 ? input.frameHeight : 720;
  const maxEdge = input.maxEdge ?? FRAME_GRID_MAX_EDGE;
  const gap = count === 1 ? 0 : input.gap ?? FRAME_GRID_GAP;
  const aspect = frameWidth / frameHeight;
  // 让 cols*frameWidth ≈ rows*frameHeight：cols ≈ sqrt(count / aspect)
  let cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count / aspect))));
  if (count > 1 && cols === 1 && aspect < 1.2) cols = Math.min(count, 2);
  const rows = Math.ceil(count / cols);
  // 间隔不缩放：先扣掉间隔，再按剩余空间缩放单帧。
  const scale = Math.min(1, (maxEdge - (cols - 1) * gap) / (cols * frameWidth), (maxEdge - (rows - 1) * gap) / (rows * frameHeight));
  const cellWidth = Math.max(1, Math.floor(frameWidth * scale));
  const cellHeight = Math.max(1, Math.floor(frameHeight * scale));
  const cells: FrameGridCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    cells.push({ x: col * (cellWidth + gap), y: row * (cellHeight + gap), width: cellWidth, height: cellHeight });
  }
  return {
    cols,
    rows,
    cellWidth,
    cellHeight,
    gap,
    width: cols * cellWidth + (cols - 1) * gap,
    height: rows * cellHeight + (rows - 1) * gap,
    fontSize: Math.max(12, Math.round(Math.min(cellWidth, cellHeight) * 0.09)),
    cells,
  };
}

/** 每帧的标签：序号 + 时间码，例如 "#3 0:07.5"。 */
export function frameGridLabel(index: number, time: number): string {
  return '#' + (index + 1) + ' ' + formatTimecode(time);
}

/** 给模型的文字说明：网格怎么读、覆盖哪段、还有没有下一页。 */
export function describeFrameGrid(input: {
  nodeId: string;
  title: string;
  duration: number;
  times: readonly number[];
  layout: Pick<FrameGridLayout, 'cols' | 'rows'>;
  page?: number;
  totalPages?: number;
  /** 视频原始分辨率（实测），给了就写进说明 */
  width?: number;
  height?: number;
}): string {
  const { nodeId, title, duration, times, layout } = input;
  const span = times.length ? formatTimecode(times[0]) + '–' + formatTimecode(times[times.length - 1]) : '';
  const size = input.width && input.height ? '，' + describeMediaSize(input.width, input.height) : '';
  let text = nodeId + '：视频「' + title + '」（时长 ' + formatTimecode(duration) + size + '）帧网格 ' + times.length + ' 帧 '
    + layout.cols + '×' + layout.rows + '，' + span + '，左上→右下按时间排列，每格左上角标 #序号 时间码';
  if (input.totalPages && input.totalPages > 1) {
    const page = input.page ?? 1;
    text += '；第 ' + page + '/' + input.totalPages + ' 页' + (page < input.totalPages ? '，page=' + (page + 1) + ' 看下一页' : '');
  }
  return text;
}

/** 常见生成比例（横 → 竖），用于把实测宽高吸附成模型参数里的 aspectRatio。 */
export const COMMON_ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const;

/** 吸附到最接近的常见比例（按对数距离，横竖对称）；尺寸无效返回 ''。 */
export function nearestAspectRatio(width: number, height: number, candidates: readonly string[] = COMMON_ASPECT_RATIOS): string {
  if (!(width > 0) || !(height > 0)) return '';
  const target = Math.log(width / height);
  let best = '';
  let bestDistance = Infinity;
  for (const ratio of candidates) {
    const [w, h] = ratio.split(':').map(Number);
    if (!(w > 0) || !(h > 0)) continue;
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) { best = ratio; bestDistance = distance; }
  }
  return best;
}

/** 实测尺寸说明：「原始 1920×1080，比例≈16:9」。给 Agent 反推 / 复刻时直接当参数用，不必看图猜。 */
export function describeMediaSize(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!(w > 0) || !(h > 0)) return '';
  const ratio = nearestAspectRatio(w, h);
  return '原始 ' + w + '×' + h + (ratio ? '，比例≈' + ratio : '');
}

// ---------------------------------------------------------------------------
// 粗略时间线：采样帧之间画面突变的位置（切镜候选）。只比较网格里已经抽出的帧，不额外解码。
// ---------------------------------------------------------------------------

/** 每帧的签名边长：8×8 灰度。 */
export const FRAME_SIGNATURE_SIZE = 8;
/** 相邻采样帧平均灰度差（0–1）超过它就当作一次切镜候选。 */
export const SCENE_CUT_THRESHOLD = 0.22;

/** RGBA 像素 → 0–1 灰度签名。 */
export function frameSignatureFromRgba(data: ArrayLike<number>): number[] {
  const signature: number[] = [];
  for (let index = 0; index + 3 < data.length; index += 4) {
    signature.push((0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]) / 255);
  }
  return signature;
}

export interface SceneCut {
  /** 突变发生在这两个采样时间之间（秒）。 */
  from: number;
  to: number;
  /** 0–1：平均灰度差 */
  score: number;
}

/** 相邻采样帧的签名差 → 切镜候选（粗略：只能定位到两个采样点之间）。 */
export function detectSceneCuts(times: readonly number[], signatures: ReadonlyArray<readonly number[] | undefined>, threshold = SCENE_CUT_THRESHOLD): SceneCut[] {
  const cuts: SceneCut[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const previous = signatures[index - 1];
    const current = signatures[index];
    if (!previous || !current || !previous.length || previous.length !== current.length) continue;
    let total = 0;
    for (let cell = 0; cell < current.length; cell += 1) total += Math.abs(current[cell] - previous[cell]);
    const score = total / current.length;
    if (score >= threshold) cuts.push({ from: times[index - 1], to: times[index], score: Math.round(score * 100) / 100 });
  }
  return cuts;
}

/** 给模型的一句时间线：时长、采样间隔、切镜候选（没有就说没有明显切镜）。 */
export function describeSceneCuts(duration: number, times: readonly number[], cuts: readonly SceneCut[]): string {
  const step = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 0;
  const head = '粗略时间线（采样间隔约 ' + (Math.round(step * 10) / 10) + 's，总长 ' + formatTimecode(duration) + '）：';
  if (!cuts.length) return head + '采样帧之间没有明显切镜，可能是一个连续镜头';
  return head + cuts.length + ' 处疑似切镜 ' + cuts.map(cut => formatTimecode(cut.from) + '–' + formatTimecode(cut.to)).join('、')
    + '（只定位到采样点之间；要精确用 start/end 缩小窗口再看）';
}

// ---------------------------------------------------------------------------
// 并排对比：参考图与产物（图片或视频帧网格）拼成一张，每格上方标节点名。
// ---------------------------------------------------------------------------

export const COMPARE_MAX_EDGE = 2048;
export const COMPARE_MAX_PANELS = 4;
export const COMPARE_LABEL_HEIGHT = 28;

export interface CompareLayout {
  width: number;
  height: number;
  labelHeight: number;
  panels: Array<{ x: number; y: number; width: number; height: number }>;
}

/** 等高横排：每个面板缩到同一高度，总宽不超过 maxEdge；面板上方留一条标签。 */
export function planCompareLayout(sizes: ReadonlyArray<{ width: number; height: number }>, maxEdge = COMPARE_MAX_EDGE, gap = 8, labelHeight = COMPARE_LABEL_HEIGHT): CompareLayout {
  const items = sizes.map(size => ({ width: size.width > 0 ? size.width : 1024, height: size.height > 0 ? size.height : 1024 }));
  if (!items.length) return { width: 0, height: 0, labelHeight, panels: [] };
  const targetHeight = Math.min(...items.map(item => item.height), maxEdge - labelHeight);
  const widths = items.map(item => item.width * (targetHeight / item.height));
  const scale = Math.min(1, (maxEdge - gap * (items.length - 1)) / widths.reduce((sum, width) => sum + width, 0));
  const height = Math.max(1, Math.floor(targetHeight * scale));
  let x = 0;
  const panels = widths.map(width => {
    const panel = { x, y: labelHeight, width: Math.max(1, Math.floor(width * scale)), height };
    x += panel.width + gap;
    return panel;
  });
  return { width: x - gap, height: height + labelHeight, labelHeight, panels };
}
