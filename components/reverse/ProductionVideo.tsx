// 共享合成：Player 与 Node 渲染读同一个组件，避免预览/成片两套画面。
import React from 'react';
import { AbsoluteFill, Img, Sequence, Video } from 'remotion';
import type { PreviewSequence } from '../../services/reverse/remotionAdapter';

export type ProductionVideoProps = {
  shots: PreviewSequence[];
  language?: 'zho' | 'en';
};

export function ProductionVideo({ shots, language = 'zho' }: ProductionVideoProps) {
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
