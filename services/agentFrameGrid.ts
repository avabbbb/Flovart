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
}): string {
  const { nodeId, title, duration, times, layout } = input;
  const span = times.length ? formatTimecode(times[0]) + '–' + formatTimecode(times[times.length - 1]) : '';
  let text = nodeId + '：视频「' + title + '」（时长 ' + formatTimecode(duration) + '）帧网格 ' + times.length + ' 帧 '
    + layout.cols + '×' + layout.rows + '，' + span + '，左上→右下按时间排列，每格左上角标 #序号 时间码';
  if (input.totalPages && input.totalPages > 1) {
    const page = input.page ?? 1;
    text += '；第 ' + page + '/' + input.totalPages + ' 页' + (page < input.totalPages ? '，page=' + (page + 1) + ' 看下一页' : '');
  }
  return text;
}
