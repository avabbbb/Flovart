// 视频帧抽取：使用 <video> + canvas 客户端截帧，避免 ffmpeg.wasm 重型依赖。
// 仅用于一次截帧并落库到工作流节点，不做批量或精确定位。

export type VideoFramePosition = 'first' | 'middle' | 'current' | 'last';

export interface ExtractedVideoFrame {
  blob: Blob;
  width: number;
  height: number;
}

const LOAD_TIMEOUT_MS = 20_000;
const SEEK_TIMEOUT_MS = 10_000;
// 小于这个距离不再 seek：currentTime 赋同值时部分浏览器不会触发 seeked，截帧会一直挂起。
const SEEK_EPSILON_SEC = 0.001;

export async function extractVideoFrame(blob: Blob, position: VideoFramePosition, currentTimeSec = 0): Promise<ExtractedVideoFrame> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    // drawImage 需要当前帧数据（HAVE_CURRENT_DATA），只有元数据时画出来是空白。
    await waitForFrameData(video, LOAD_TIMEOUT_MS, '视频加载超时，无法截取帧');

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const targetTime = position === 'last'
      ? Math.max(0, duration - 0.01)
      : position === 'middle'
        ? duration / 2
        : position === 'current' ? Math.min(Math.max(0, currentTimeSec), Math.max(0, duration - 0.01)) : 0;

    if (Math.abs(video.currentTime - targetTime) > SEEK_EPSILON_SEC) {
      await seekTo(video, targetTime);
      await waitForFrameData(video, SEEK_TIMEOUT_MS, '视频定位超时，无法截取帧');
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('图像处理上下文初始化失败');
    ctx.drawImage(video, 0, 0, width, height);
    const blobResult = await new Promise<Blob | null>(resolve => canvas.toBlob(result => resolve(result), 'image/png', 0.95));
    if (!blobResult) throw new Error('截帧转 PNG 失败');
    return { blob: blobResult, width, height };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitForFrameData(video: HTMLVideoElement, timeoutMs: number, timeoutMessage: string): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };
    const onReady = () => {
      if (video.readyState < 2) return;
      cleanup();
      resolve();
    };
    const onError = () => { cleanup(); reject(new Error('视频加载失败，无法截取帧')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(timeoutMessage)); }, timeoutMs);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('视频 seek 失败')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('视频定位超时，无法截取帧')); }, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    try {
      video.currentTime = time;
    } catch {
      onSeeked();
    }
  });
}
