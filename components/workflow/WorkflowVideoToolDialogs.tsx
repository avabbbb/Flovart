import { Button, Modal, Slider } from 'antd';
import { useEffect, useState } from 'react';
import { getVideoDuration } from '../../services/videoTools';
import { isFFmpegSupported, isMultiThreadAvailable } from '../../services/ffmpegClient';

export type WorkflowVideoToolKind = 'trim' | 'av-split' | 'merge';
export interface WorkflowVideoToolState { kind: WorkflowVideoToolKind; nodeId: string }
export type WorkflowVideoToolConfirmation =
  | { kind: 'trim'; startSec: number; endSec: number }
  | { kind: 'av-split' }
  | { kind: 'merge'; nodeIds: string[] };

export function WorkflowVideoToolDialogs({ tool, node, mediaUrl, busy, error, onClose, onConfirm }: {
  tool: WorkflowVideoToolState | null;
  node: import('./types').WorkflowNode | null;
  mediaUrl: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: WorkflowVideoToolConfirmation) => void;
}) {
  if (!tool || !node || !mediaUrl) return null;
  const common = { open: true, mediaUrl, busy, error, onClose };
  if (tool.kind === 'trim') return <TrimDialog {...common} onConfirm={(startSec, endSec) => onConfirm({ kind: 'trim', startSec, endSec })} />;
  if (tool.kind === 'av-split') return <SimpleVideoDialog {...common} title="音视频分离" description="将视频的音频轨和视频轨分离，分别创建独立的音频节点和静音视频节点。" action="分离音视频" onConfirm={() => onConfirm({ kind: 'av-split' })} />;
  if (tool.kind === 'merge') return <SimpleVideoDialog {...common} title="视频拼接" description="将选中的多个视频片段按顺序拼接为一个视频。仅支持相同分辨率和帧率的片段。" action="拼接视频" onConfirm={() => onConfirm({ kind: 'merge', nodeIds: [] })} />;
  return null;
}

type CommonProps = { open: boolean; mediaUrl: string; busy: boolean; error: string | null; onClose: () => void };
const modalProps = (props: CommonProps, width = 620) => ({ open: props.open, onCancel: props.busy ? undefined : props.onClose, footer: null, centered: true, width, destroyOnHidden: true, maskClosable: !props.busy });

function DialogError({ error }: { error: string | null }) {
  return error ? <div role="alert" className="workflow-image-tool__error">{error}</div> : null;
}

function FFmpegStatus() {
  if (!isFFmpegSupported()) return <p className="workflow-image-tool__error">当前浏览器不支持 WebAssembly，无法使用视频工具。</p>;
  if (!isMultiThreadAvailable()) return <p className="workflow-image-tool__hint">提示: 未启用多线程，处理速度较慢。COOP/COEP headers 需正确配置。</p>;
  return null;
}

function TrimDialog(props: CommonProps & { onConfirm: (startSec: number, endSec: number) => void }) {
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const videoRef = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    void getVideoDuration(new Blob([''])).catch(() => {});
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const d = video.duration || 0;
      setDuration(d);
      setEnd(d);
    };
    video.src = props.mediaUrl;
  }, [props.mediaUrl]);

  return <Modal {...modalProps(props, 720)} title="视频剪辑">
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><video src={props.mediaUrl} controls style={{ maxWidth: '100%', maxHeight: 320 }} /></div>
      <div className="workflow-image-tool__controls">
        <FFmpegStatus />
        <label>开始时间<Slider min={0} max={Math.floor(duration)} value={start} onChange={v => { setStart(v); if (v >= end) setEnd(Math.min(v + 1, duration)); }} /></label>
        <label>结束时间<Slider min={0} max={Math.floor(duration)} value={end} onChange={setEnd} /></label>
        <p className="workflow-image-tool__hint">裁取 {start.toFixed(1)}s – {end.toFixed(1)}s（时长 {(end - start).toFixed(1)}s），使用 stream copy 无需重编码。</p>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} disabled={start >= end || !isFFmpegSupported()} onClick={() => props.onConfirm(start, end)}>裁取片段</Button>
      </div>
    </div>
  </Modal>;
}

function SimpleVideoDialog(props: CommonProps & { title: string; description: string; action: string; onConfirm: () => void }) {
  return <Modal {...modalProps(props)} title={props.title}>
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><video src={props.mediaUrl} controls style={{ maxWidth: '100%', maxHeight: 240 }} /></div>
      <FFmpegStatus />
      <p>{props.description}</p>
      <DialogError error={props.error} />
      <Button type="primary" loading={props.busy} disabled={!isFFmpegSupported()} onClick={props.onConfirm}>{props.action}</Button>
    </div>
  </Modal>;
}
