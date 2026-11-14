// 受控的本机媒体能力：ffprobe 探测、黑帧 / 静音 / 响度、抽帧、并排对比。
// 不开放任意 ffmpeg 参数（docs/design/16-agent-video-pipeline.md C16）；缺依赖返回 CAPABILITY_UNAVAILABLE。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export class CapabilityError extends Error {
  constructor(capability, message, diagnose) {
    super(message);
    this.code = 'CAPABILITY_UNAVAILABLE';
    this.details = { capability, diagnose };
  }
}

export const ffmpegBin = () => process.env.FLOVART_FFMPEG || 'ffmpeg';
export const ffprobeBin = () => process.env.FLOVART_FFPROBE || 'ffprobe';

/** 运行一个本地可执行文件；ENOENT → CAPABILITY_UNAVAILABLE。返回 { stdout, stderr }。 */
export function runTool(bin, args, { capability = bin, timeoutMs = 10 * 60 * 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(new CapabilityError(capability, `无法启动 ${bin}：${error.message}`, `安装 ${capability} 或设置对应的 FLOVART_* 路径环境变量`));
      return;
    }
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener?.('abort', onAbort, { once: true });
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new CapabilityError(capability, `本机找不到 ${capability}（${bin}）`, `安装 ${capability} 并加入 PATH，或设置 FLOVART_${capability.toUpperCase()} 指向可执行文件`));
      } else reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (signal?.aborted) {
        reject(Object.assign(new Error(`${capability} 已取消`), { code: 'CANCELED' }));
      } else if (code !== 0) {
        reject(Object.assign(new Error(`${capability} 退出码 ${code}：${err.split('\n').filter(Boolean).slice(-4).join(' | ')}`), { code: 'LOCAL_TOOL_FAILED' }));
      } else resolve({ stdout: out, stderr: err });
    });
  });
}

export async function ffprobeJson(path) {
  const { stdout } = await runTool(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { capability: 'ffprobe' });
  return JSON.parse(stdout);
}

function parseRate(value) {
  const [num, den] = String(value || '0/1').split('/').map(Number);
  return den ? num / den : num;
}

/** 基础媒体信息（不做滤镜分析，导入素材时用）。 */
export async function mediaInfo(path) {
  const info = await ffprobeJson(path);
  const video = info.streams?.find(stream => stream.codec_type === 'video');
  const audio = info.streams?.find(stream => stream.codec_type === 'audio');
  const durationSec = Number(info.format?.duration);
  const isStill = video && (!Number.isFinite(durationSec) || ['png', 'mjpeg', 'webp', 'bmp'].includes(video.codec_name)) && !audio;
  return {
    container: info.format?.format_name,
    durationMs: Number.isFinite(durationSec) && !isStill ? Math.round(durationSec * 1000) : null,
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, fps: isStill ? null : Math.round(parseRate(video.avg_frame_rate) * 100) / 100 } : null,
    audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels } : null,
    kind: isStill ? 'image' : video ? 'video' : audio ? 'audio' : 'other',
  };
}

function parseIntervals(stderr, startKey, endKey) {
  const intervals = [];
  let open = null;
  for (const line of stderr.split('\n')) {
    const start = line.match(new RegExp(`${startKey}[:=]\\s*(-?[\\d.]+)`));
    const end = line.match(new RegExp(`${endKey}[:=]\\s*(-?[\\d.]+)`));
    if (start && end) intervals.push([Number(start[1]), Number(end[1])]);
    else if (start) open = Number(start[1]);
    else if (end && open !== null) { intervals.push([open, Number(end[1])]); open = null; }
  }
  return { intervals, open };
}

/**
 * media.probe：时长、编码、分辨率、黑帧区间、静音区间、综合响度。
 * 阈值固定在这里（受控参数），评审只读结果。
 */
export async function probeMedia(path) {
  const info = await mediaInfo(path);
  const result = { ...info, blackIntervals: [], silenceIntervals: [], loudnessLufs: null };
  if (info.kind === 'image' || info.kind === 'other') return result;
  const args = ['-hide_banner', '-nostats', '-i', path];
  if (info.video) args.push('-map', '0:v:0', '-vf', 'blackdetect=d=0.1:pix_th=0.10', '-f', 'null', '-');
  if (info.audio) args.push('-map', '0:a:0', '-af', 'silencedetect=noise=-45dB:d=0.35,ebur128', '-f', 'null', '-');
  const { stderr } = await runTool(ffmpegBin(), args, { capability: 'ffmpeg' });
  const durationSec = (info.durationMs ?? 0) / 1000;
  result.blackIntervals = parseIntervals(stderr, 'black_start', 'black_end').intervals
    .map(([start, end]) => ({ startSec: round(start), endSec: round(end) }));
  const silence = parseIntervals(stderr, 'silence_start', 'silence_end');
  if (silence.open !== null) silence.intervals.push([silence.open, durationSec]);
  result.silenceIntervals = silence.intervals.map(([start, end]) => ({ startSec: round(Math.max(0, start)), endSec: round(end) }));
  const integrated = [...stderr.matchAll(/I:\s+(-?[\d.]+)\s+LUFS/g)].at(-1);
  result.loudnessLufs = integrated ? Number(integrated[1]) : null;
  return result;
}

const round = value => Math.round(value * 1000) / 1000;

/** 在指定秒数抽帧（JPEG），可选放大区域 zoom = { x, y, w, h }（0–1 相对坐标）。 */
export async function extractFrame(path, atSec, outPath, { zoom, width = 720 } = {}) {
  const filters = [];
  if (zoom) {
    const { x = 0, y = 0, w = 1, h = 1 } = zoom;
    filters.push(`crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`);
  }
  filters.push(`scale=${width}:-2`);
  await runTool(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, atSec)), '-i', path,
    '-frames:v', '1', '-vf', filters.join(','), '-q:v', '3', outPath], { capability: 'ffmpeg' });
  if (!existsSync(outPath)) throw Object.assign(new Error(`第 ${atSec}s 超出媒体时长，未抽到帧`), { code: 'FRAME_OUT_OF_RANGE' });
  return outPath;
}

/** 两帧左右并排（左 = 当前版本，右 = 对比版本）。 */
export async function sideBySide(leftPath, rightPath, outPath) {
  await runTool(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', leftPath, '-i', rightPath,
    '-filter_complex', '[0:v]scale=-2:640[a];[1:v]scale=-2:640[b];[a][b]hstack=inputs=2', '-frames:v', '1', '-q:v', '3', outPath], { capability: 'ffmpeg' });
  return outPath;
}

/** drawtext 需要字体文件；按平台找一个能显示中文的字体，找不到再退到通用字体。 */
export function resolveFontFile() {
  const candidates = [
    process.env.FLOVART_FONT_FILE,
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
  ].filter(Boolean);
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new CapabilityError('font', '找不到可用于字幕的字体文件', '设置 FLOVART_FONT_FILE 指向一个 .ttf / .ttc 字体');
  return found;
}

/** ffmpeg 滤镜参数里的路径转义（Windows 盘符冒号、反斜杠、单引号）。 */
export function filterPath(path) {
  return String(path).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
