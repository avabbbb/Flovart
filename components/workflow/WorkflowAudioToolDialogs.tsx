import { Button, Modal, Slider } from 'antd';
import { useEffect, useState } from 'react';
import { getAudioDuration } from '../../services/audioTools';
import { isFFmpegSupported, isMultiThreadAvailable } from '../../services/ffmpegClient';

export type WorkflowAudioToolKind = 'trim' | 'speed';
export interface WorkflowAudioToolState { kind: WorkflowAudioToolKind; nodeId: string }
export type WorkflowAudioToolConfirmation =
  | { kind: 'trim'; startSec: number; endSec: number }
  | { kind: 'speed'; speed: number };

export function WorkflowAudioToolDialogs({ tool, node, mediaUrl, busy, error, onClose, onConfirm }: {
  tool: WorkflowAudioToolState | null;
  node: import('./types').WorkflowNode | null;
  mediaUrl: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: WorkflowAudioToolConfirmation) => void;
}) {
  if (!tool || !node || !mediaUrl) return null;
  const common = { open: true, mediaUrl, busy, error, onClose };
  if (tool.kind === 'trim') return <AudioTrimDialog {...common} onConfirm={(startSec, endSec) => onConfirm({ kind: 'trim', startSec, endSec })} />;
  if (tool.kind === 'speed') return <AudioSpeedDialog {...common} onConfirm={(speed) => onConfirm({ kind: 'speed', speed })} />;
  return null;
}

type CommonProps = { open: boolean; mediaUrl: string; busy: boolean; error: string | null; onClose: () => void };
const modalProps = (props: CommonProps, width = 620) => ({ open: props.open, onCancel: props.busy ? undefined : props.onClose, footer: null, centered: true, width, destroyOnHidden: true, maskClosable: !props.busy });

function DialogError({ error }: { error: string | null }) {
  return error ? <div role="alert" className="workflow-image-tool__error">{error}</div> : null;
}

function FFmpegStatus() {
  if (!isFFmpegSupported()) return <p className="workflow-image-tool__error">当前浏览器不支持 WebAssembly，无法使用音频工具。</p>;
  if (!isMultiThreadAvailable()) return <p className="workflow-image-tool__hint">提示: 未启用多线程，处理速度较慢。COOP/COEP headers 需正确配置。</p>;
  return null;
}

function AudioTrimDialog(props: CommonProps & { onConfirm: (startSec: number, endSec: number) => void }) {
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);

  useEffect(() => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = audio.duration || 0;
      setDuration(d);
      setEnd(d);
    };
    audio.src = props.mediaUrl;
  }, [props.mediaUrl]);

  return <Modal {...modalProps(props, 720)} title="音频截取">
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><audio src={props.mediaUrl} controls style={{ width: '100%' }} /></div>
      <div className="workflow-image-tool__controls">
        <FFmpegStatus />
        <label>开始时间<Slider min={0} max={Math.floor(duration)} value={start} onChange={v => { setStart(v); if (v >= end) setEnd(Math.min(v + 1, duration)); }} /></label>
        <label>结束时间<Slider min={0} max={Math.floor(duration)} value={end} onChange={setEnd} /></label>
        <p className="workflow-image-tool__hint">截取 {start.toFixed(1)}s – {end.toFixed(1)}s（时长 {(end - start).toFixed(1)}s），使用 stream copy 无需重编码。</p>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} disabled={start >= end || !isFFmpegSupported()} onClick={() => props.onConfirm(start, end)}>截取片段</Button>
      </div>
    </div>
  </Modal>;
}

function AudioSpeedDialog(props: CommonProps & { onConfirm: (speed: number) => void }) {
  const [speed, setSpeed] = useState(1);

  return <Modal {...modalProps(props, 620)} title="音频变速">
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><audio src={props.mediaUrl} controls style={{ width: '100%' }} /></div>
      <div className="workflow-image-tool__controls">
        <FFmpegStatus />
        <label>播放速度<Slider min={0.25} max={4} step={0.05} value={speed} onChange={setSpeed} /></label>
        <p className="workflow-image-tool__hint">当前速度 {speed.toFixed(2)}x，使用 atempo 滤镜变速不变调。输出为 MP3 格式。</p>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} disabled={speed === 1 || !isFFmpegSupported()} onClick={() => props.onConfirm(speed)}>应用变速</Button>
      </div>
    </div>
  </Modal>;
}
