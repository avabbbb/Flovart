// 奶蛙思考加载动画：移植自同一作者的 OfferU（frontend/src/components/brand/NaiwaThinking.tsx + globals.css 的 .naiwa-think / nw-*）。
// SVG、关键帧、时长与原作一致；底图随模块打包（import），不依赖 public/ 路径，子路径部署 / DSH 嵌入 / Tauri 都能取到。
import { useId, type CSSProperties } from 'react';
import naiwaThinkBase from './naiwa-think-base.webp';
import '../../styles/naiwaThinking.css';

/**
 * 奶蛙托腮思考。底图是去掉瞳孔和嘴的 LOGO，瞳孔、眼皮、嘴用 SVG 叠加并由 styles/naiwaThinking.css 的 nw-* 关键帧驱动：
 * 眼珠往上看 → 眯眼琢磨 → 眨眼 → 换个方向想 → 回正；嘴跟着歪；整颗头轻轻晃。bubble 是右上角的「…」思考气泡。
 */
export function NaiwaThinking({ size = 72, bubble = true, className = '' }: { size?: number; bubble?: boolean; className?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const left = `nw-eye-l-${raw}`;
  const right = `nw-eye-r-${raw}`;
  return (
    <span className={`naiwa-think ${className}`.trim()} data-bubble={bubble ? '' : undefined} style={{ '--naiwa-size': `${size}px` } as CSSProperties} aria-hidden="true">
      <svg className="naiwa-think__svg" viewBox="0 0 1024 1024">
        <defs>
          <clipPath id={left}><circle cx="222" cy="328" r="126" /></clipPath>
          <clipPath id={right}><circle cx="800" cy="386" r="126" /></clipPath>
        </defs>
        <g className="nw-head">
          <image href={naiwaThinkBase} width="1024" height="1024" />
          <g clipPath={`url(#${left})`}>
            <circle className="nw-pupil" cx="222" cy="330" r="78" />
            <g className="nw-lid"><rect x="80" y="-80" width="290" height="268" /><line x1="80" y1="188" x2="370" y2="188" /></g>
          </g>
          <g clipPath={`url(#${right})`}>
            <circle className="nw-pupil" cx="800" cy="387" r="79" />
            <g className="nw-lid"><rect x="660" y="-22" width="290" height="268" /><line x1="660" y1="246" x2="950" y2="246" /></g>
          </g>
          <line className="nw-mouth" x1="380" y1="537" x2="610" y2="570" />
        </g>
      </svg>
      {bubble && <span className="naiwa-think__bubble"><i /><i /><i /></span>}
    </span>
  );
}
