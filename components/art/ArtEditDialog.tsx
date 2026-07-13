import { Modal, Button, Spin, Alert, Segmented } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import type { ImageElement, VideoElement } from '../../types';
import { ART_TOOLS, type ArtToolId } from './artTools';
import { useArtWorker, type ArtRunResult } from './useArtWorker';

export type ArtMediaElement = ImageElement | VideoElement;

export interface ArtEditState {
  toolId: ArtToolId;
  elementId: string;
}

export interface ArtEditDialogProps {
  state: ArtEditState | null;
  element: ArtMediaElement | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (resultHref: string) => void;
}

const TOOL_LABEL: Record<ArtToolId, string> = ART_TOOLS.reduce((acc, t) => {
  acc[t.id] = t.label;
  return acc;
}, {} as Record<ArtToolId, string>);

type Phase = 'idle' | 'decoding' | 'processing' | 'encoding' | 'done' | 'error';

interface RunState {
  phase: Phase;
  progress?: number;
  error?: string;
  result?: ArtRunResult;
}

export const ArtEditDialog: React.FC<ArtEditDialogProps> = ({ state, element, onClose, onConfirm }) => {
  const toolId = state?.toolId;
  const elementHref = element?.href;
  const { run, cancel } = useArtWorker();
  const [runState, setRunState] = useState<RunState>({ phase: 'idle' });
  const [view, setView] = useState<'original' | 'result'>('result');

  const start = useCallback(async () => {
    if (!toolId || !elementHref) return;
    setRunState({ phase: 'decoding' });
    setView('result');
    try {
      const result = await run(toolId, elementHref, undefined, (phase, value) => {
        if (phase === 'processing' && typeof value === 'number') {
          setRunState({ phase: 'processing', progress: value });
        } else {
          setRunState({ phase: phase as Phase });
        }
      });
      setRunState({ phase: 'done', result });
    } catch (err) {
      setRunState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }, [toolId, elementHref, run]);

  useEffect(() => {
    if (!state || !element) return;
    void start();
    return () => cancel();
  }, [state, element, start, cancel]);

  if (!state || !element) return null;
  const isVideo = element.type === 'video';
  const label = TOOL_LABEL[state.toolId] ?? state.toolId;
  const busy = runState.phase !== 'idle' && runState.phase !== 'done' && runState.phase !== 'error';
  const phaseText = {
    decoding: '读取媒体…',
    processing: '处理中…',
    encoding: '编码结果…',
    done: '完成',
    error: '失败',
    idle: '',
  }[runState.phase];

  return (
    <Modal
      open
      onCancel={busy ? undefined : onClose}
      footer={null}
      centered
      width={960}
      destroyOnHidden
      maskClosable={!busy}
      title={`${label} / Art Edit`}
    >
      <div className="workflow-image-tool__grid" data-workflow-overlay>
        <div className="workflow-image-tool__preview" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {busy && (
            <div style={{ textAlign: 'center' }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: 'var(--isl-mint, #5ec8c8)', fontSize: 13 }}>{phaseText}</div>
            </div>
          )}
          {!busy && runState.phase === 'done' && runState.result && (
            <>
              {view === 'result' ? (
                <img src={runState.result.dataUrl} alt="结果" draggable={false} style={{ maxWidth: '100%', maxHeight: '60vh' }} />
              ) : isVideo ? (
                <video src={elementHref} controls loop muted style={{ maxWidth: '100%', maxHeight: '60vh' }} />
              ) : (
                <img src={elementHref} alt="原图" draggable={false} style={{ maxWidth: '100%', maxHeight: '60vh' }} />
              )}
            </>
          )}
          {!busy && runState.phase === 'error' && (
            <Alert type="error" showIcon message={runState.error ?? '处理失败'} />
          )}
        </div>
        <div className="workflow-image-tool__controls">
          {runState.phase === 'done' && runState.result && (
            <div style={{ marginBottom: 12 }}>
              <Segmented
                size="small"
                value={view}
                onChange={(v) => setView(v as 'original' | 'result')}
                options={[
                  { label: '原图', value: 'original' },
                  { label: '结果', value: 'result' },
                ]}
              />
            </div>
          )}
          {runState.phase === 'error' && (
            <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
              <Button onClick={start} disabled={busy}>重试</Button>
            </div>
          )}
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button
            type="primary"
            disabled={busy || runState.phase !== 'done' || !runState.result}
            onClick={() => runState.result && onConfirm(runState.result.dataUrl)}
          >
            替换画布内容
          </Button>
        </div>
      </div>
    </Modal>
  );
};