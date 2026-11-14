// 共享合成：Player 与 Node 渲染读同一个组件，避免预览/成片两套画面。
import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video, staticFile, useVideoConfig } from 'remotion';
import type { ProductionAudioV1, ProductionCaptionV1, ProductionTextV1 } from '../../services/reverse/productionSpec';
import {
  MUSIC_DUCK_FACTOR,
  STATIC_ASSET_PREFIX,
  dbToLinearVolume,
  isStaticAssetRef,
  overlayLayout,
  voiceActiveAt,
  type PreviewSequence,
} from '../../services/reverse/remotionAdapter';

export type ProductionVideoProps = {
  shots: PreviewSequence[];
  texts?: ProductionTextV1[];
  captions?: ProductionCaptionV1[];
  audio?: ProductionAudioV1[];
  language?: 'zho' | 'en';
};

// 中文优先的字体栈：Linux 渲染机装 Noto CJK，macOS 用苹方，Windows 用雅黑。
export const PRODUCTION_FONT_STACK = '"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const resolveSrc = (src: string) => (isStaticAssetRef(src) ? staticFile(src.slice(STATIC_ASSET_PREFIX.length)) : src);

function TextLayer({ clip, height }: { clip: ProductionTextV1; height: number }) {
  const scale = height / 1080;
  const size = Math.round((clip.size ?? 64) * scale);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '5%', right: '5%', ...overlayLayout(clip.position, height),
        textAlign: 'center', color: clip.color || '#ffffff', fontSize: size, lineHeight: 1.25,
        fontFamily: PRODUCTION_FONT_STACK, fontWeight: 600, whiteSpace: 'pre-wrap',
        textShadow: `0 0 ${Math.max(1, Math.round(3 * scale))}px rgba(0,0,0,0.6), 0 ${Math.round(2 * scale)}px ${Math.round(6 * scale)}px rgba(0,0,0,0.45)`,
      }}>{clip.text}</div>
    </AbsoluteFill>
  );
}

function CaptionLayer({ clip, height }: { clip: ProductionCaptionV1; height: number }) {
  const scale = height / 1080;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '6%', right: '6%', bottom: Math.round(height * 0.12), display: 'flex', justifyContent: 'center' }}>
        <span style={{
          padding: `${Math.round(8 * scale)}px ${Math.round(14 * scale)}px`, background: 'rgba(0,0,0,0.55)',
          color: '#ffffff', fontSize: Math.round(44 * scale), lineHeight: 1.3, textAlign: 'center',
          fontFamily: PRODUCTION_FONT_STACK, whiteSpace: 'pre-wrap',
        }}>{clip.text}</span>
      </div>
    </AbsoluteFill>
  );
}

export function ProductionVideo({ shots, texts = [], captions = [], audio = [], language = 'zho' }: ProductionVideoProps) {
  const { height, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: '#0b0b0c' }}>
      {shots.map(shot => (
        <Sequence key={shot.shotId} from={shot.from} durationInFrames={shot.durationInFrames}>
          <AbsoluteFill style={{ background: '#111114', overflow: 'hidden' }}>
            {shot.kind === 'video' && shot.src
              ? <Video src={resolveSrc(shot.src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
              : shot.kind === 'image' && shot.src
                ? <Img src={resolveSrc(shot.src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8a92', fontSize: 28, fontFamily: PRODUCTION_FONT_STACK }}>
                    {language === 'zho' ? `镜头 ${shot.index} · 待生成` : `Shot ${shot.index} · pending`}
                  </AbsoluteFill>}
            {shot.label && (
              <div style={{
                position: 'absolute', left: 24, right: 24, bottom: 24,
                padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.55)',
                color: '#f2f2f4', fontSize: 20, fontFamily: PRODUCTION_FONT_STACK, whiteSpace: 'pre-wrap',
              }}>{shot.label}</div>
            )}
          </AbsoluteFill>
        </Sequence>
      ))}
      {texts.map(clip => (
        <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationFrames} layout='none'>
          <TextLayer clip={clip} height={height} />
        </Sequence>
      ))}
      {captions.map(clip => (
        <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationFrames} layout='none'>
          <CaptionLayer clip={clip} height={height} />
        </Sequence>
      ))}
      {audio.map(clip => {
        const base = dbToLinearVolume(clip.gainDb);
        const ducks = clip.role === 'music' && clip.duck !== false;
        return (
          <Sequence key={clip.id} from={clip.startFrame} {...(clip.durationFrames ? { durationInFrames: clip.durationFrames } : {})} layout='none'>
            <Audio
              src={resolveSrc(clip.src)}
              volume={ducks ? frame => (voiceActiveAt(clip.startFrame + frame, audio, durationInFrames) ? base * MUSIC_DUCK_FACTOR : base) : base}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
