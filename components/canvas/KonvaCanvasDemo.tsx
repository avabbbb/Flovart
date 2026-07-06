/**
 * Konva.js Canvas Demo
 *
 * 演示Konva如何渲染图片和视频，性能对比SVG
 *
 * 核心优势：
 * - 视频作为普通Image节点渲染（自动每帧更新）
 * - 200+元素仍然60fps
 * - API类似SVG，学习曲线平缓
 */

import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text } from 'react-konva';
import Konva from 'konva';

interface MediaElement {
  id: string;
  type: 'image' | 'video';
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  name?: string;
}

interface KonvaCanvasDemoProps {
  elements: MediaElement[];
  width: number;
  height: number;
  onElementDrag?: (id: string, x: number, y: number) => void;
  onElementClick?: (id: string) => void;
}

/**
 * 视频节点组件 - Konva自动处理video→canvas渲染
 */
const VideoNode: React.FC<{
  element: MediaElement;
  onDragEnd?: (x: number, y: number) => void;
  onClick?: () => void;
}> = ({ element, onDragEnd, onClick }) => {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | HTMLVideoElement | null>(null);
  const imageRef = useRef<Konva.Image>(null);

  useEffect(() => {
    // 创建video元素
    const video = document.createElement('video');
    video.src = element.src;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true; // 自动播放需要muted
    video.playsInline = true;

    video.addEventListener('loadeddata', () => {
      setVideoElement(video);
      setImage(video);
      video.play().catch(err => console.warn('Video autoplay blocked:', err));
    });

    return () => {
      video.pause();
      video.src = '';
    };
  }, [element.src]);

  useEffect(() => {
    if (!videoElement || !imageRef.current) return;

    // Konva Layer动画 - 每帧更新video画面
    const layer = imageRef.current.getLayer();
    if (!layer) return;

    const anim = new Konva.Animation(() => {
      // Konva会自动从video提取当前帧
      imageRef.current?.cache();
      imageRef.current?.getLayer()?.batchDraw();
    }, layer);

    anim.start();

    return () => {
      anim.stop();
    };
  }, [videoElement]);

  if (!image) {
    // 加载中占位符
    return (
      <>
        <Rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#1a1917"
          stroke="#3a3834"
          strokeWidth={2}
          cornerRadius={8}
        />
        <Text
          x={element.x}
          y={element.y + element.height / 2 - 10}
          width={element.width}
          align="center"
          text="Loading video..."
          fill="#76726b"
          fontSize={12}
        />
      </>
    );
  }

  return (
    <KonvaImage
      ref={imageRef}
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      draggable
      shadowBlur={5}
      shadowOpacity={0.3}
      cornerRadius={8}
      onDragEnd={(e) => {
        onDragEnd?.(e.target.x(), e.target.y());
      }}
      onClick={() => {
        onClick?.();
        // 点击切换播放/暂停
        if (videoElement) {
          if (videoElement.paused) {
            videoElement.play();
          } else {
            videoElement.pause();
          }
        }
      }}
      onTap={() => {
        onClick?.();
        if (videoElement) {
          videoElement.paused ? videoElement.play() : videoElement.pause();
        }
      }}
      // Hover效果
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage) {
          stage.container().style.cursor = 'pointer';
        }
        e.target.to({
          scaleX: 1.02,
          scaleY: 1.02,
          shadowBlur: 10,
          duration: 0.2,
        });
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) {
          stage.container().style.cursor = 'default';
        }
        e.target.to({
          scaleX: 1,
          scaleY: 1,
          shadowBlur: 5,
          duration: 0.2,
        });
      }}
    />
  );
};

/**
 * 图片节点组件
 */
const ImageNode: React.FC<{
  element: MediaElement;
  onDragEnd?: (x: number, y: number) => void;
  onClick?: () => void;
}> = ({ element, onDragEnd, onClick }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = element.src;
    img.crossOrigin = 'anonymous';
    img.onload = () => setImage(img);

    return () => {
      img.src = '';
    };
  }, [element.src]);

  if (!image) {
    return (
      <>
        <Rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#f1efe9"
          stroke="#cfcbc1"
          strokeWidth={2}
          cornerRadius={8}
        />
        <Text
          x={element.x}
          y={element.y + element.height / 2 - 10}
          width={element.width}
          align="center"
          text="Loading..."
          fill="#6b6862"
          fontSize={12}
        />
      </>
    );
  }

  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      draggable
      shadowBlur={5}
      shadowOpacity={0.2}
      cornerRadius={8}
      onDragEnd={(e) => {
        onDragEnd?.(e.target.x(), e.target.y());
      }}
      onClick={onClick}
      onTap={onClick}
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage) {
          stage.container().style.cursor = 'move';
        }
        e.target.to({
          scaleX: 1.02,
          scaleY: 1.02,
          shadowBlur: 10,
          duration: 0.15,
        });
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) {
          stage.container().style.cursor = 'default';
        }
        e.target.to({
          scaleX: 1,
          scaleY: 1,
          shadowBlur: 5,
          duration: 0.15,
        });
      }}
    />
  );
};

/**
 * Konva Canvas Demo主组件
 */
export const KonvaCanvasDemo: React.FC<KonvaCanvasDemoProps> = ({
  elements,
  width,
  height,
  onElementDrag,
  onElementClick,
}) => {
  const [fps, setFps] = useState(60);
  const lastTimeRef = useRef(Date.now());
  const frameCountRef = useRef(0);

  // FPS监控
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTimeRef.current;
      const currentFps = Math.round((frameCountRef.current * 1000) / delta);
      setFps(currentFps);
      frameCountRef.current = 0;
      lastTimeRef.current = now;
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const countFrame = () => {
      frameCountRef.current++;
      requestAnimationFrame(countFrame);
    };
    const handle = requestAnimationFrame(countFrame);
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <div className="relative" style={{ width, height }}>
      {/* FPS显示 */}
      <div
        className="absolute top-4 right-4 z-10 isl-chip px-3 py-1.5 text-xs font-bold"
        style={{
          boxShadow: '0 2px 0 0 var(--isl-edge)',
          background: fps < 30 ? 'var(--isl-coral)' : fps < 50 ? 'var(--isl-sun)' : 'var(--isl-mint)',
          color: '#fff',
        }}
      >
        {fps} FPS · {elements.length} Elements
      </div>

      {/* Konva Stage */}
      <Stage
        width={width}
        height={height}
        style={{
          background: 'var(--isl-surface)',
          borderRadius: 'var(--isl-r-lg)',
        }}
      >
        <Layer>
          {/* 背景网格（可选） */}
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="var(--isl-surface)"
          />

          {/* 渲染所有元素 */}
          {elements.map((element) =>
            element.type === 'video' ? (
              <VideoNode
                key={element.id}
                element={element}
                onDragEnd={(x, y) => onElementDrag?.(element.id, x, y)}
                onClick={() => onElementClick?.(element.id)}
              />
            ) : (
              <ImageNode
                key={element.id}
                element={element}
                onDragEnd={(x, y) => onElementDrag?.(element.id, x, y)}
                onClick={() => onElementClick?.(element.id)}
              />
            )
          )}
        </Layer>
      </Stage>

      {/* 信息面板 */}
      <div
        className="absolute bottom-4 left-4 isl-pop p-3 text-xs"
        style={{ maxWidth: '300px' }}
      >
        <div className="font-bold mb-2" style={{ color: 'var(--isl-ink)' }}>
          🎬 Konva.js Demo
        </div>
        <div style={{ color: 'var(--isl-ink-soft)' }}>
          • 拖拽元素移动位置<br />
          • 点击视频播放/暂停<br />
          • Hover查看缩放效果<br />
          • 性能：{fps >= 55 ? '✅ 流畅' : fps >= 30 ? '⚠️ 一般' : '❌ 卡顿'}
        </div>
      </div>
    </div>
  );
};
