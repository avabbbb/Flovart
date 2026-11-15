import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { RotateCcw, X } from 'lucide-react';
import type { WorkflowNode as WorkflowNodeData } from './types';
import {
  deriveGenerationPhase,
  formatGenerationElapsed,
  gridDivisions,
  lastGenerationRun,
  seededRandom,
  subscribeGenerationBeat,
  trackGenerationRun,
  useGenerationMotionSlot,
  useTickingText,
  type GenerationPhase,
} from './generationLoader';

/**
 * 节点生成加载态（DESIGN / 01 §19.6）。
 * - 网格：参考 Inspora「Grid Reveal animation」（posts/1-46）——圆角小方块铺满节点，按真实阶段 2×2 → 4×4 → 8×8 → 12×12 细分，
 *   约 0.9s 一次重排深浅噪点；完成时方块随机顺序淡出，露出结果。小节点自动少一级细分（格子不小于 9px）。
 * - 进度线：参考 Inspora「Agent Handoff」（posts/1-48）——3px 胶囊细线 + 前沿圆点，只用真实百分比，缓出约 0.5s；
 *   没有百分比时是一段来回滑动的短线（不确定态），不画假进度。
 * - 状态行：一行真实文案（传输明细 / 供应商消息 / 阶段名）+ 共享计时器耗时。
 */

export type WorkflowGenerationLoaderMode = 'running' | 'done' | 'error';
type Language = 'en' | 'zho';

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const PHASE_COPY: Record<Language, Record<Exclude<GenerationPhase, 'generate'>, string>> = {
  zho: { prepare: '准备请求', transcode: '转码参考视频', upload: '上传参考', queue: '排队中', download: '下载结果', write: '写入画布' },
  en: { prepare: 'Preparing request', transcode: 'Transcoding reference', upload: 'Uploading references', queue: 'Queued', download: 'Downloading result', write: 'Writing to canvas' },
};

const COPY = {
  zho: { done: '完成', failed: '生成失败', retry: '重试', redownload: '重新下载', resumed: '续接', stale: '已等待较久，如长时间无响应可点击停止' },
  en: { done: 'Done', failed: 'Generation failed', retry: 'Retry', redownload: 'Download again', resumed: 'Resumed', stale: 'Waiting a long time — stop it if nothing changes' },
} as const;

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function generatingLabel(node: WorkflowNodeData, language: Language): string {
  const mode = node.metadata.config?.mode || node.type;
  if (node.type === 'operation') return language === 'en' ? node.title : `${node.title}中`;
  if (language === 'en') return mode === 'video' ? 'Generating video' : mode === 'text' ? 'Generating text' : 'Generating image';
  return mode === 'video' ? '视频生成中' : mode === 'text' ? '文本生成中' : '图片生成中';
}

/** 传输明细：沿用原有文案（上传参考 / 下载结果 / 排队中 · 第 N 次查询 / tokens）与约 1 秒滑动窗口速度。 */
function useTransferLabel(node: WorkflowNodeData, language: Language): string {
  const transfer = node.metadata.generationTransfer;
  const bytesPhase = transfer?.phase === 'upload' || transfer?.phase === 'download' ? transfer.phase : undefined;
  const loaded = bytesPhase ? transfer?.loaded : undefined;
  const samples = useRef<{ phase: string; at: number; loaded: number }[]>([]);
  const [speed, setSpeed] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!bytesPhase || loaded === undefined) { samples.current = []; setSpeed(undefined); return; }
    const now = Date.now();
    const kept = samples.current.filter(sample => sample.phase === bytesPhase && now - sample.at <= 1000 && sample.loaded <= loaded);
    kept.push({ phase: bytesPhase, at: now, loaded });
    samples.current = kept;
    const first = kept[0];
    setSpeed(now > first.at ? (loaded - first.loaded) / ((now - first.at) / 1000) : undefined);
  }, [bytesPhase, loaded]);
  if (!transfer) return '';
  const bytes = loaded === undefined ? '' : transfer.total ? (loaded / 1048576).toFixed(1) + ' / ' + (transfer.total / 1048576).toFixed(1) + ' MB' : formatBytes(loaded);
  const label = transfer.phase === 'upload' ? [language === 'en' ? 'Uploading references' : '上传参考', bytes].filter(Boolean).join(' ')
    : transfer.phase === 'download' ? [language === 'en' ? 'Downloading result' : '下载结果', bytes].filter(Boolean).join(' ')
    : transfer.phase === 'queue' || transfer.polls
      ? (transfer.phase === 'queue' ? (language === 'en' ? 'Queued' : '排队中') : (language === 'en' ? 'Generating' : '生成中'))
        + (transfer.polls ? (language === 'en' ? ' · poll #' + transfer.polls : ' · 第 ' + transfer.polls + ' 次查询') : '')
      : '';
  const tokens = transfer.tokens ? (language === 'en' ? transfer.tokens + ' tokens out' : '已输出 ' + transfer.tokens + ' tokens') : '';
  const speedLabel = speed && speed > 0 ? (speed / 1048576).toFixed(1) + ' MB/s' : '';
  return [label, speedLabel, tokens].filter(Boolean).join(' · ');
}

// —— 网格画布 ——

interface GridPalette { gap: string; tile: string; light: string; dark: string }

function readPalette(el: HTMLElement): GridPalette {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    gap: read('--isl-surface-sunk', '#f4f2ec'),
    tile: read('--isl-card', '#ffffff'),
    light: read('--isl-border', '#e3e0d8'),
    dark: read('--isl-ink-ghost', '#a8a49c'),
  };
}

/** 一帧网格：从上一级（prev）收缩到本级，噪点从 prevNoise 渐变到 noise；reveal ∈ [0,1] 是完成时的淡出进度。 */
function drawGrid(canvas: HTMLCanvasElement, state: {
  divisions: number; prevDivisions: number; split: number;
  noise: Float32Array; prevNoise: Float32Array; fade: number;
  reveal: number; revealDelays: Float32Array | null;
}) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const palette = readPalette(canvas);
  const cell = Math.min(width, height) / state.divisions;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const offsetX = (width - cols * cell) / 2;
  const offsetY = (height - rows * cell) / 2;
  const gap = cell >= 14 ? 2 : 1.5;
  const radius = Math.min(8, Math.max(1.5, cell * 0.12));
  // 细分：格子从上一级大小收缩到本级（中心锚定，缓出）。
  const grow = state.split < 1 ? 1 + (Math.max(1, state.prevDivisions ? state.divisions / state.prevDivisions : 1) - 1) * (1 - state.split) : 1;
  const revealing = state.reveal > 0;
  ctx.globalAlpha = revealing ? Math.max(0, 1 - state.reveal * 1.6) : 1;
  ctx.fillStyle = palette.gap;
  ctx.fillRect(0, 0, width, height);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      let alpha = 1;
      if (revealing && state.revealDelays) {
        const delay = state.revealDelays[index % state.revealDelays.length];
        alpha = 1 - Math.max(0, Math.min(1, (state.reveal - delay) / 0.45));
        if (alpha <= 0) continue;
      }
      const size = Math.max(1, (cell - gap) * grow);
      const x = offsetX + col * cell + (cell - size) / 2;
      const y = offsetY + row * cell + (cell - size) / 2;
      const n = state.noise[index % state.noise.length] * state.fade + state.prevNoise[index % state.prevNoise.length] * (1 - state.fade);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, radius);
      ctx.fillStyle = palette.tile;
      ctx.fill();
      if (Math.abs(n) > 0.01) {
        ctx.globalAlpha = alpha * Math.abs(n) * (n > 0 ? 0.75 : 0.22);
        ctx.fillStyle = n > 0 ? palette.light : palette.dark;
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

const NOISE_CELLS = 24 * 24;
function makeNoise(seed: number): Float32Array {
  const random = seededRandom(seed);
  const noise = new Float32Array(NOISE_CELLS);
  for (let index = 0; index < NOISE_CELLS; index += 1) {
    const roll = random();
    // 约 30% 的格子比底色浅或深一档（参考帖：每次细分后重新随机，不移动）。
    noise[index] = roll < 0.2 ? 1 : roll < 0.3 ? -1 : 0;
  }
  return noise;
}

function GenerationGrid({ level, animated, revealing, reduceMotion }: { level: number; animated: boolean; revealing: boolean; reduceMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    divisions: 0, prevDivisions: 0, split: 1, level: -1,
    noise: makeNoise(1), prevNoise: makeNoise(1), fade: 1, seed: 1,
    reveal: 0, revealDelays: null as Float32Array | null,
  });
  const redraw = () => { if (canvasRef.current) drawGrid(canvasRef.current, state.current); };

  // 级别变化（真实阶段前进）：格子收缩到新尺寸，噪点重排。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = state.current;
    const divisions = gridDivisions(level, Math.min(canvas.clientWidth, canvas.clientHeight) || 200);
    if (divisions === s.divisions) { redraw(); return; }
    s.prevDivisions = s.divisions || divisions;
    s.divisions = divisions;
    s.prevNoise = s.noise;
    s.seed += 1;
    s.noise = makeNoise(s.seed);
    if (reduceMotion || !animated || s.level < 0) { s.split = 1; s.fade = 1; s.level = level; redraw(); return; }
    s.level = level;
    const controls = animate(0, 1, { duration: 0.2, ease: EASE_OUT, onUpdate: value => { s.split = value; s.fade = value; redraw(); } });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, animated, reduceMotion]);

  // 节拍：约 0.9s 重排一次深浅噪点（交叉淡化 0.28s）。只有拿到动画名额且未要求减少动态时才跑。
  useEffect(() => {
    if (!animated || reduceMotion || revealing) return;
    let controls: { stop: () => void } | undefined;
    const unsubscribe = subscribeGenerationBeat(() => {
      const s = state.current;
      s.prevNoise = s.noise;
      s.seed += 1;
      s.noise = makeNoise(s.seed);
      controls?.stop();
      controls = animate(0, 1, { duration: 0.28, ease: 'easeOut', onUpdate: value => { s.fade = value; redraw(); } });
    });
    return () => { unsubscribe(); controls?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated, reduceMotion, revealing]);

  // 完成：方块按随机顺序淡出（每格 0–0.25s 随机延迟），露出结果。
  useEffect(() => {
    if (!revealing) return;
    const s = state.current;
    const random = seededRandom(s.seed + 97);
    s.revealDelays = Float32Array.from({ length: NOISE_CELLS }, () => random() * 0.5);
    if (reduceMotion) { s.reveal = 1; redraw(); return; }
    const controls = animate(0, 1, { duration: 0.6, ease: 'linear', onUpdate: value => { s.reveal = value; redraw(); } });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealing, reduceMotion]);

  // 尺寸变化（拖拽缩放节点）：重画；级别按新尺寸重新裁剪。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const s = state.current;
      const divisions = gridDivisions(level, Math.min(canvas.clientWidth, canvas.clientHeight) || 200);
      if (divisions !== s.divisions) { s.divisions = divisions; s.prevDivisions = divisions; s.split = 1; }
      redraw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  return <canvas ref={canvasRef} className="flv-gen__grid" aria-hidden="true" />;
}

// —— 进度线 ——

function GenerationLine({ value, animated, reduceMotion, label }: { value: number | undefined; animated: boolean; reduceMotion: boolean; label: string }) {
  const determinate = value !== undefined;
  return (
    <div
      className={`flv-gen__line${determinate ? '' : ' is-indeterminate'}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      {determinate ? (
        <motion.i
          className="flv-gen__fill"
          initial={false}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: EASE_OUT }}
        ><b className="flv-gen__thumb" /></motion.i>
      ) : (
        <motion.i
          className="flv-gen__fill is-segment"
          initial={false}
          animate={animated && !reduceMotion ? { left: ['0%', '72%'] } : { left: '0%' }}
          transition={animated && !reduceMotion ? { duration: 1.6, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' } : { duration: 0 }}
        ><b className="flv-gen__thumb" /></motion.i>
      )}
    </div>
  );
}

function Elapsed({ since, className }: { since: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useTickingText(ref, since, formatGenerationElapsed);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

export function WorkflowGenerationLoader({ node, mode, language = 'zho', onRetry }: {
  node: WorkflowNodeData;
  mode: WorkflowGenerationLoaderMode;
  language?: Language;
  onRetry?: () => void;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const copy = COPY[language];
  const metadata = node.metadata;
  const running = mode === 'running';
  const phase = deriveGenerationPhase(metadata);
  const run = running ? trackGenerationRun(node.id, metadata.generationStartedAt, phase) : lastGenerationRun(node.id);
  // 完成时的总耗时：第一次渲染完成态时定格（运行中与完成态是同一个实例，网格原地淡出）。
  const endedAtRef = useRef<number | undefined>(undefined);
  if (mode === 'done' && endedAtRef.current === undefined) endedAtRef.current = Date.now();
  if (mode !== 'done') endedAtRef.current = undefined;
  const endedAt = endedAtRef.current ?? Date.now();
  const transferLabel = useTransferLabel(node, language);
  const slot = useGenerationMotionSlot(running && !reduceMotion);

  const [stale, setStale] = useState(false);
  useEffect(() => {
    setStale(false);
    if (!running || !metadata.generationStartedAt) return;
    const wait = metadata.generationStartedAt + 180000 - Date.now();
    if (wait <= 0) { setStale(true); return; }
    const timer = window.setTimeout(() => setStale(true), wait);
    return () => window.clearTimeout(timer);
  }, [running, metadata.generationStartedAt]);

  if (mode === 'error') {
    const errorMessage = metadata.error || '';
    const retryLabel = metadata.generationDownloadPending ? copy.redownload : copy.retry;
    return (
      <motion.div
        className="flv-gen flv-gen--error"
        data-testid="workflow-generation-error"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.16 } }}
        transition={{ duration: reduceMotion ? 0 : 0.22, ease: EASE_OUT }}
      >
        <div className="flv-gen__error" data-workflow-overlay>
          <div className="flv-gen__error-head">
            <span className="flv-gen__error-icon" aria-hidden="true"><X size={9} strokeWidth={3.2} /></span>
            <strong>{copy.failed}</strong>
            {onRetry && (
              <button
                type="button"
                className="flv-gen__retry"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onRetry(); }}
              >
                <RotateCcw size={11} aria-hidden="true" />{retryLabel}
              </button>
            )}
          </div>
          {errorMessage && <p className="flv-gen__error-message" title={errorMessage}>{errorMessage}</p>}
        </div>
      </motion.div>
    );
  }

  const progress = metadata.progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(metadata.progress)));
  const count = metadata.config?.count && metadata.config.count > 1 && (metadata.config?.mode || node.type) !== 'text' ? metadata.config.count : undefined;
  // 只用上游给出的真实百分比；0 且非批量视为“还没有百分比”。
  const lineValue = mode === 'done' ? 100 : progress !== undefined && (progress > 0 || Boolean(count)) ? progress : undefined;
  const phaseLabel = phase === 'generate' ? generatingLabel(node, language) : PHASE_COPY[language][phase];
  const statusLabel = mode === 'done' ? copy.done : transferLabel || metadata.generationMessage || phaseLabel;
  const resumed = running && Boolean(metadata.generationDownloadPending);
  const level = mode === 'done' ? 3 : run?.level ?? 0;

  return (
    <motion.div
      className={`flv-gen flv-gen--${mode}`}
      data-testid="workflow-generation-glass"
      data-generation-phase={running ? phase : 'done'}
      aria-label={generatingLabel(node, language)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.2, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: EASE_OUT }}
    >
      <GenerationGrid level={level} animated={slot || mode === 'done'} revealing={mode === 'done'} reduceMotion={reduceMotion} />
      <div className="flv-gen__hud">
        <div className="flv-gen__status" role="status">
          <i className="flv-gen__dot" aria-hidden="true" />
          {resumed && <span className="flv-gen__tag" title={language === 'en' ? 'Resuming the earlier provider task' : '续接上次的供应商任务：只查询与下载，不重新提交'}>{copy.resumed}</span>}
          <span className="flv-gen__label-wrap">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={statusLabel}
                className="flv-gen__label"
                title={statusLabel}
                data-testid={transferLabel && running ? 'workflow-generation-transfer' : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.24, ease: 'easeOut' }}
              >{statusLabel}</motion.span>
            </AnimatePresence>
          </span>
          {lineValue !== undefined && running && <b className="flv-gen__pct">{lineValue}%</b>}
          {running && run && <Elapsed since={run.startedAt} className="flv-gen__elapsed" />}
          {mode === 'done' && run && <span className="flv-gen__elapsed">{formatGenerationElapsed(endedAt - run.startedAt)}</span>}
        </div>
        <GenerationLine value={lineValue} animated={slot} reduceMotion={reduceMotion} label={generatingLabel(node, language)} />
        {stale && <div className="flv-gen__stale">{copy.stale}</div>}
      </div>
    </motion.div>
  );
}
