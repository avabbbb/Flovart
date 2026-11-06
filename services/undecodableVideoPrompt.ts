import { requestUiConfirm } from './uiConfirm';

// 浏览器解不了、画布预览代理也没转出来的视频：弹窗让用户换文件，或复制本机转码命令自行转换。

// 本机 ffmpeg 转 H.264 + AAC MP4 的命令（Windows / macOS / Linux 通用的双引号写法）。
export function h264ConvertCommand(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'video';
  const quote = (name: string) => '"' + name.replace(/"/g, '\\"') + '"';
  return 'ffmpeg -i ' + quote(fileName) + ' -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -movflags +faststart ' + quote(base + '-h264.mp4');
}

// 返回 'replace' 表示用户选择换一个文件；其余（保留、Esc、被新弹窗顶掉）一律 'keep'。
export async function promptUndecodableVideo(fileName: string): Promise<'replace' | 'keep'> {
  const command = h264ConvertCommand(fileName);
  const replace = await requestUiConfirm({
    title: '浏览器无法解码这个视频',
    body: '「' + fileName + '」的编码浏览器播放不了（常见于 iPhone 拍摄的 HEVC/H.265、10bit 或 ProRes），画布预览没能生成。'
      + '原文件已保留，仍会作为生成参考上传，但部分 AI 服务也会拒收这类编码（返回 422）。\n\n'
      + '建议换一个 H.264 编码的 MP4，或先在本机转换：\n'
      + '• HandBrake：预设选「Fast 1080p30」，格式 MP4，导出后拖回画布\n'
      + '• ffmpeg：' + command,
    confirmLabel: '换一个文件',
    cancelLabel: '保留原文件',
    timeoutMs: 0,
    extraAction: {
      label: '复制转换命令',
      run: () => { void navigator.clipboard?.writeText(command).catch(() => undefined); },
    },
  });
  return replace ? 'replace' : 'keep';
}

// 弹出系统文件选择框（只列视频）；用户取消或关闭时返回 null。
export function pickVideoFile(): Promise<File | null> {
  const { promise, resolve } = Promise.withResolvers<File | null>();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm';
  input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
  input.addEventListener('cancel', () => resolve(null), { once: true });
  input.click();
  return promise;
}
