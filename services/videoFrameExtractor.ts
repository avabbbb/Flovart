// 视频首帧/尾帧抽取：使用 <video> + canvas 客户端截帧，避免 ffmpeg.wasm 重型依赖。
// 仅用于一次截帧并落库到工作流节点，不做批量或精确定位。

export type VideoFramePosition = 'first' | 'last';

export interface ExtractedVideoFrame {
  blob: Blob;
  width: number;
  height: number;
}

export async function extractVideoFrame(blob: Blob, position: VideoFramePosition): Promise<ExtractedVideoFrame> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        if (video.readyState >= 1) resolve();
      };
      const onError = () => reject(new Error('视频加载失败，无法截取帧'));
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const targetTime = position === 'last' ? Math.max(0, duration - 0.01) : 0;

    await seekTo(video, targetTime);

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('图像处理上下文初始化失败');
    ctx.drawImage(video, 0, 0, width, height);
    const blobResult = await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), 'image/png', 0.95));
    if (!blobResult) throw new Error('截帧转 PNG 失败');
    return { blob: blobResult, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = () => { video.removeEventListener('error', onError); reject(new Error('视频 seek 失败')); };
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try {
      video.currentTime = time;
    } catch {
      onSeeked();
    }
  });
}
