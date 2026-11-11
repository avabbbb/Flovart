// 确定性预览：ProductionSpec → Remotion Player。只做播放/逐帧查看，不做拖拽剪辑。
import React, { useMemo } from 'react';
import { AbsoluteFill, Img, Sequence, Video } from 'remotion';
import { Player } from '@remotion/player';
import type { ReverseVideoProject } from '../../services/reverse/types';
import { buildProductionSpecV1, validateProductionSpec } from '../../services/reverse/productionSpec';
import { toPreviewSequences, type PreviewSequence } from '../../services/reverse/remotionAdapter';

export interface ProductionPreviewProps {
  project: ReverseVideoProject;
  language: 'zho' | 'en';
}

function ShotLayer({ shots, language }: { shots: PreviewSequence[]; language: 'zho' | 'en' }) {
  return (
    <AbsoluteFill style={{ background: '#0b0b0c' }}>
      {shots.map(shot => (
        <Sequence key={shot.shotId} from={shot.from} durationInFrames={shot.durationInFrames}>
          <AbsoluteFill style={{ background: '#111114', overflow: 'hidden' }}>
            {shot.kind === 'video' && shot.src
              ? <Video src={shot.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
              : shot.kind === 'image' && shot.src
                ? <Img src={shot.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8a92', fontSize: 28, fontFamily: 'system-ui, sans-serif' }}>
                    {language === 'zho' ? `镜头 ${shot.index} · 待生成` : `Shot ${shot.index} · pending`}
                  </AbsoluteFill>}
            {shot.label && (
              <div style={{
                position: 'absolute', left: 24, right: 24, bottom: 24,
                padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.55)',
                color: '#f2f2f4', fontSize: 20, fontFamily: 'system-ui, sans-serif', whiteSpace: 'pre-wrap',
              }}>{shot.label}</div>
            )}
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

export function ProductionPreview({ project, language }: ProductionPreviewProps) {
  const spec = useMemo(() => buildProductionSpecV1(project), [project]);
  const errors = useMemo(() => validateProductionSpec(spec), [spec]);
  const labels = useMemo(() => Object.fromEntries(
    (project.analysis?.shots ?? []).map(shot => [shot.id, shot.description ?? ''] as const),
  ), [project.analysis?.shots]);
  const shots = useMemo(() => toPreviewSequences(spec, labels), [spec, labels]);

  if (errors.length) {
    return (
      <p role='alert' className='text-[11px]' style={{ color: 'var(--isl-coral)' }} data-testid='reverse-preview-invalid'>
        {language === 'zho' ? '预览不可用：' : 'Preview unavailable: '}{errors.join('；')}
      </p>
    );
  }
  if (!shots.length) {
    return (
      <p className='text-[11px]' style={{ color: 'var(--isl-ink-ghost)' }} data-testid='reverse-preview-empty'>
        {language === 'zho' ? '先生成镜头表，预览会按镜头顺序播放。' : 'Build the shot list first; the preview plays it in order.'}
      </p>
    );
  }
  return (
    <div className='overflow-hidden rounded-lg border' style={{ borderColor: 'var(--isl-line, rgba(127,127,127,0.25))' }} data-testid='reverse-production-preview'>
      <Player
        component={ShotLayer}
        inputProps={{ shots, language }}
        durationInFrames={Math.max(1, spec.output.durationFrames)}
        compositionWidth={spec.output.width}
        compositionHeight={spec.output.height}
        fps={spec.output.fps}
        controls
        style={{ width: '100%', aspectRatio: `${spec.output.width} / ${spec.output.height}` }}
      />
    </div>
  );
}
