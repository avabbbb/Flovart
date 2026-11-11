// 确定性预览：ProductionSpec → Remotion Player。只做播放/逐帧查看，不做拖拽剪辑。
import React, { useMemo } from 'react';
import { Player } from '@remotion/player';
import type { ReverseVideoProject } from '../../services/reverse/types';
import { buildProductionSpecV1, validateProductionSpec } from '../../services/reverse/productionSpec';
import { toPreviewSequences } from '../../services/reverse/remotionAdapter';
import { ProductionVideo } from './ProductionVideo';

export interface ProductionPreviewProps {
  project: ReverseVideoProject;
  language: 'zho' | 'en';
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
        component={ProductionVideo}
        inputProps={{ shots, language }}
        durationInFrames={Math.max(1, spec.output.durationFrames)}
        compositionWidth={spec.output.width}
        compositionHeight={spec.output.height}
        fps={spec.output.fps}
        controls
        acknowledgeRemotionLicense
        style={{ width: '100%', aspectRatio: `${spec.output.width} / ${spec.output.height}` }}
      />
    </div>
  );
}
