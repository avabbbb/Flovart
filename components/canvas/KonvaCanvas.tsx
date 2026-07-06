/**
 * KonvaCanvas - 渐进式替代SVG渲染的Konva实现
 *
 * 迁移策略：
 * 1. 保持与现有SVG相同的props接口
 * 2. 支持所有元素类型（image, video, text, shape, path, arrow, line）
 * 3. 使用feature flag控制是否启用
 *
 * 使用方法：
 * 在App.tsx中：
 * const USE_KONVA = true; // 切换到Konva渲染
 * {USE_KONVA ? <KonvaCanvas {...props} /> : <SVGCanvas {...props} />}
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text as KonvaText, Line, Circle, RegularPolygon, Group as KonvaGroup } from 'react-konva';
import Konva from 'konva';
import type { ImageElement, VideoElement, TextElement, ShapeElement, PathElement, ArrowElement, LineElement, GroupElement, Element, Point } from '../types';

interface KonvaCanvasProps {
  elements: Element[];
  width: number;
  height: number;
  panOffset: Point;
  zoom: number;
  backgroundColor: string;
  selectedElementIds: string[];
  onElementClick?: (id: string, additive: boolean) => void;
  onElementDragStart?: (id: string) => void;
  onElementDrag?: (id: string, x: number, y: number) => void;
  onElementDragEnd?: (id: string, x: number, y: number) => void;
  onCanvasClick?: () => void;
}

/**
 * 图片元素渲染
 */
const ImageNode: React.FC<{
  element: ImageElement;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}> = ({ element, isSelected, onClick, onDragStart, onDrag, onDragEnd }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const nodeRef = useRef<Konva.Image>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = element.href;
    img.onload = () => setImage(img);
    return () => {
      img.src = '';
    };
  }, [element.href]);

  if (!image) return null;

  return (
    <KonvaImage
      ref={nodeRef}
      id={element.id}
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation || 0}
      opacity={element.opacity ?? 1}
      visible={element.isVisible ?? true}
      draggable={!(element.isLocked ?? false)}
      stroke={isSelected ? '#19c8b9' : undefined}
      strokeWidth={isSelected ? 2 : 0}
      shadowBlur={element.shadowBlur}
      shadowColor={element.shadowColor}
      shadowOpacity={element.shadowOpacity}
      onClick={() => onClick(element.id)}
      onTap={() => onClick(element.id)}
      onDragStart={() => onDragStart(element.id)}
      onDragMove={(e) => {
        const node = e.target;
        onDrag(element.id, node.x(), node.y());
      }}
      onDragEnd={(e) => {
        const node = e.target;
        onDragEnd(element.id, node.x(), node.y());
      }}
    />
  );
};

/**
 * 视频元素渲染
 */
const VideoNode: React.FC<{
  element: VideoElement;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}> = ({ element, isSelected, onClick, onDragStart, onDrag, onDragEnd }) => {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const nodeRef = useRef<Konva.Image>(null);

  useEffect(() => {
    const videoEl = document.createElement('video');
    videoEl.src = element.href;
    videoEl.crossOrigin = 'anonymous';
    videoEl.loop = true;
    videoEl.muted = true;
    videoEl.playsInline = true;

    videoEl.addEventListener('loadeddata', () => {
      setVideo(videoEl);
      videoEl.play().catch(err => console.warn('Video autoplay:', err));
    });

    return () => {
      videoEl.pause();
      videoEl.src = '';
    };
  }, [element.href]);

  useEffect(() => {
    if (!video || !nodeRef.current) return;

    const layer = nodeRef.current.getLayer();
    if (!layer) return;

    const anim = new Konva.Animation(() => {
      layer.batchDraw();
    }, layer);

    anim.start();
    return () => anim.stop();
  }, [video]);

  if (!video) return null;

  return (
    <KonvaImage
      ref={nodeRef}
      id={element.id}
      image={video}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation || 0}
      opacity={element.opacity ?? 1}
      visible={element.isVisible ?? true}
      draggable={!(element.isLocked ?? false)}
      stroke={isSelected ? '#19c8b9' : undefined}
      strokeWidth={isSelected ? 2 : 0}
      onClick={() => {
        onClick(element.id);
        // 切换播放/暂停
        if (video) {
          video.paused ? video.play() : video.pause();
        }
      }}
      onTap={() => onClick(element.id)}
      onDragStart={() => onDragStart(element.id)}
      onDragMove={(e) => onDrag(element.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(element.id, e.target.x(), e.target.y())}
    />
  );
};

/**
 * 文本元素渲染
 */
const TextNode: React.FC<{
  element: TextElement;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}> = ({ element, isSelected, onClick, onDragStart, onDrag, onDragEnd }) => {
  return (
    <KonvaText
      id={element.id}
      text={element.text}
      x={element.x}
      y={element.y}
      fontSize={element.fontSize}
      fontFamily={element.fontFamily || 'Arial'}
      fontStyle={`${element.fontWeight || ''} ${element.fontStyle || ''}`.trim()}
      fill={element.fill}
      align={element.textAlign}
      rotation={element.rotation || 0}
      opacity={element.opacity ?? 1}
      visible={element.isVisible ?? true}
      draggable={!(element.isLocked ?? false)}
      stroke={isSelected ? '#19c8b9' : undefined}
      strokeWidth={isSelected ? 2 : 0}
      onClick={() => onClick(element.id)}
      onTap={() => onClick(element.id)}
      onDragStart={() => onDragStart(element.id)}
      onDragMove={(e) => onDrag(element.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(element.id, e.target.x(), e.target.y())}
    />
  );
};

/**
 * 形状元素渲染
 */
const ShapeNode: React.FC<{
  element: ShapeElement;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}> = ({ element, isSelected, onClick, onDragStart, onDrag, onDragEnd }) => {
  const commonProps = {
    id: element.id,
    x: element.x + (element.width || 100) / 2,
    y: element.y + (element.height || 100) / 2,
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth || 2,
    rotation: element.rotation || 0,
    opacity: element.opacity ?? 1,
    visible: element.isVisible ?? true,
    draggable: !(element.isLocked ?? false),
    onClick: () => onClick(element.id),
    onTap: () => onClick(element.id),
    onDragStart: () => onDragStart(element.id),
    onDragMove: (e: any) => onDrag(element.id, e.target.x() - (element.width || 100) / 2, e.target.y() - (element.height || 100) / 2),
    onDragEnd: (e: any) => onDragEnd(element.id, e.target.x() - (element.width || 100) / 2, e.target.y() - (element.height || 100) / 2),
  };

  if (element.shapeType === 'circle') {
    return (
      <Circle
        {...commonProps}
        radius={Math.min(element.width || 100, element.height || 100) / 2}
        stroke={isSelected ? '#19c8b9' : commonProps.stroke}
      />
    );
  }

  if (element.shapeType === 'triangle') {
    return (
      <RegularPolygon
        {...commonProps}
        sides={3}
        radius={(element.width || 100) / 2}
        stroke={isSelected ? '#19c8b9' : commonProps.stroke}
      />
    );
  }

  // Rectangle (default)
  return (
    <Rect
      {...commonProps}
      x={element.x}
      y={element.y}
      width={element.width || 100}
      height={element.height || 100}
      cornerRadius={element.cornerRadius || 0}
      stroke={isSelected ? '#19c8b9' : commonProps.stroke}
    />
  );
};

/**
 * 路径元素渲染（画笔）
 */
const PathNode: React.FC<{
  element: PathElement;
  isSelected: boolean;
  onClick: (id: string) => void;
}> = ({ element, isSelected, onClick }) => {
  const points = element.points.flatMap(p => [p.x, p.y]);

  return (
    <Line
      id={element.id}
      points={points}
      stroke={element.strokeColor}
      strokeWidth={element.strokeWidth}
      lineCap="round"
      lineJoin="round"
      opacity={element.strokeOpacity ?? 1}
      visible={element.isVisible ?? true}
      tension={0.5}
      onClick={() => onClick(element.id)}
      onTap={() => onClick(element.id)}
      shadowColor={isSelected ? '#19c8b9' : undefined}
      shadowBlur={isSelected ? 10 : 0}
    />
  );
};

/**
 * 主Konva Canvas组件
 */
export const KonvaCanvas: React.FC<KonvaCanvasProps> = ({
  elements,
  width,
  height,
  panOffset,
  zoom,
  backgroundColor,
  selectedElementIds,
  onElementClick,
  onElementDragStart,
  onElementDrag,
  onElementDragEnd,
  onCanvasClick,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const selectedIds = new Set(selectedElementIds);

  const handleElementClick = useCallback((id: string, e?: any) => {
    if (e) e.cancelBubble = true;
    onElementClick?.(id, e?.evt?.shiftKey || false);
  }, [onElementClick]);

  const handleStageClick = useCallback((e: any) => {
    // 点击空白区域
    if (e.target === e.target.getStage()) {
      onCanvasClick?.();
    }
  }, [onCanvasClick]);

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      onClick={handleStageClick}
      onTap={handleStageClick}
      scaleX={zoom}
      scaleY={zoom}
      x={panOffset.x * zoom}
      y={panOffset.y * zoom}
    >
      {/* 背景层 */}
      <Layer>
        <Rect
          x={-panOffset.x}
          y={-panOffset.y}
          width={width / zoom}
          height={height / zoom}
          fill={backgroundColor}
        />
      </Layer>

      {/* 元素层 */}
      <Layer>
        {elements.map((element) => {
          const isSelected = selectedIds.has(element.id);

          if (element.type === 'image') {
            return (
              <ImageNode
                key={element.id}
                element={element}
                isSelected={isSelected}
                onClick={handleElementClick}
                onDragStart={onElementDragStart!}
                onDrag={onElementDrag!}
                onDragEnd={onElementDragEnd!}
              />
            );
          }

          if (element.type === 'video') {
            return (
              <VideoNode
                key={element.id}
                element={element}
                isSelected={isSelected}
                onClick={handleElementClick}
                onDragStart={onElementDragStart!}
                onDrag={onElementDrag!}
                onDragEnd={onElementDragEnd!}
              />
            );
          }

          if (element.type === 'text') {
            return (
              <TextNode
                key={element.id}
                element={element}
                isSelected={isSelected}
                onClick={handleElementClick}
                onDragStart={onElementDragStart!}
                onDrag={onElementDrag!}
                onDragEnd={onElementDragEnd!}
              />
            );
          }

          if (element.type === 'shape') {
            return (
              <ShapeNode
                key={element.id}
                element={element}
                isSelected={isSelected}
                onClick={handleElementClick}
                onDragStart={onElementDragStart!}
                onDrag={onElementDrag!}
                onDragEnd={onElementDragEnd!}
              />
            );
          }

          if (element.type === 'path') {
            return (
              <PathNode
                key={element.id}
                element={element}
                isSelected={isSelected}
                onClick={handleElementClick}
              />
            );
          }

          // TODO: arrow, line, group 类型

          return null;
        })}
      </Layer>
    </Stage>
  );
};
