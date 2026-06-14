import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import type { Element, ImageElement, Point, VideoElement } from '../../types';
import {
  createSceneVideoScheduler,
  resolveVideoFrameStrategy,
  type SceneVideoScheduler,
} from '../scene/SceneVideoScheduler';
import {
  shouldRenderMediaInKonva,
  type KonvaMediaElement,
} from '../../utils/canvasKonvaMediaEligibility';

export { shouldRenderMediaInKonva } from '../../utils/canvasKonvaMediaEligibility';

interface CanvasKonvaMediaLayerProps {
  elements: Element[];
  width: number;
  height: number;
  panOffset: Point;
  zoom: number;
  dimmedElementIds?: ReadonlySet<string>;
  disabledElementIds?: ReadonlySet<string>;
  onMediaReady?: (elementId: string) => void;
  onMediaLoadError?: (elementId: string) => void;
}

const EMPTY_SET = new Set<string>();

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function useImageResource(href: string, onError?: () => void): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const onErrorRef = useLatestRef(onError);

  useEffect(() => {
    let cancelled = false;
    const next = new Image();
    next.decoding = 'async';
    setImage(null);
    next.onload = () => {
      if (cancelled) return;
      if (next.naturalWidth > 0 && next.naturalHeight > 0) {
        setImage(next);
      } else {
        setImage(null);
        onErrorRef.current?.();
      }
    };
    next.onerror = () => {
      if (cancelled) return;
      setImage(null);
      onErrorRef.current?.();
    };
    next.src = href;
    return () => {
      cancelled = true;
      next.onload = null;
      next.onerror = null;
    };
  }, [href, onErrorRef]);

  return image;
}

function useVideoResource(href: string): HTMLVideoElement | null {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    const next = document.createElement('video');
    next.src = href;
    next.loop = true;
    next.muted = true;
    next.playsInline = true;
    next.preload = 'metadata';
    const activate = () => {
      setVideo(next);
      void next.play().catch(() => undefined);
    };
    setVideo(next);
    next.addEventListener('loadeddata', activate, { once: true });
    next.addEventListener('loadedmetadata', activate, { once: true });
    return () => {
      next.pause();
      next.removeEventListener('loadeddata', activate);
      next.removeEventListener('loadedmetadata', activate);
      next.removeAttribute('src');
      next.load();
    };
  }, [href]);

  return video;
}

const ImageMediaNode: React.FC<{
  element: ImageElement;
  opacity: number;
  onReady?: (elementId: string) => void;
  onLoadError?: (elementId: string) => void;
}> = ({ element, opacity, onReady, onLoadError }) => {
  const image = useImageResource(element.href, () => onLoadError?.(element.id));
  const imageRef = useRef<Konva.Image>(null);
  const onReadyRef = useLatestRef(onReady);

  useEffect(() => {
    if (!image) return;
    onReadyRef.current?.(element.id);
    imageRef.current?.getLayer()?.batchDraw();
  }, [element.id, image, onReadyRef]);

  if (!image) return null;
  return (
    <KonvaImage
      ref={imageRef}
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      opacity={opacity}
      listening={false}
      data-testid={`canvas-konva-media-${element.id}`}
    />
  );
};

const VideoMediaNode: React.FC<{
  element: VideoElement;
  opacity: number;
  scheduler: SceneVideoScheduler;
  onReady?: (elementId: string) => void;
}> = ({ element, opacity, scheduler, onReady }) => {
  const video = useVideoResource(element.href);
  const imageRef = useRef<Konva.Image>(null);
  const onReadyRef = useLatestRef(onReady);

  useEffect(() => {
    const layer = imageRef.current?.getLayer();
    if (!video || !layer) return;
    const id = element.id;
    const drawReadyFrame = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      onReadyRef.current?.(id);
      layer.batchDraw();
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawReadyFrame();
    }
    video.addEventListener('loadeddata', drawReadyFrame);
    video.addEventListener('canplay', drawReadyFrame);
    video.addEventListener('seeked', drawReadyFrame);

    if (resolveVideoFrameStrategy(video) === 'video-frame') {
      const requestFrame = (video as HTMLVideoElement & {
        requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => number;
      }).requestVideoFrameCallback.bind(video);
      const cancelFrame = (video as HTMLVideoElement & {
        cancelVideoFrameCallback?: (handle: number) => void;
      }).cancelVideoFrameCallback?.bind(video);
      let frameHandle: number | null = null;
      let stopped = false;

      const drawFrame: VideoFrameRequestCallback = () => {
        if (stopped) return;
        if (element.isVisible !== false && !video.paused) {
          layer.batchDraw();
        }
        frameHandle = requestFrame(drawFrame);
      };

      frameHandle = requestFrame(drawFrame);
      return () => {
        stopped = true;
        if (frameHandle !== null && cancelFrame) {
          cancelFrame(frameHandle);
        }
        video.removeEventListener('loadeddata', drawReadyFrame);
        video.removeEventListener('canplay', drawReadyFrame);
        video.removeEventListener('seeked', drawReadyFrame);
      };
    }

    scheduler.register({
      id,
      visible: element.isVisible !== false,
      playing: !video.paused,
      inViewport: true,
      layer,
    });
    scheduler.start();

    const syncPlaying = () => scheduler.update(id, { playing: !video.paused });
    video.addEventListener('play', syncPlaying);
    video.addEventListener('pause', syncPlaying);

    return () => {
      video.removeEventListener('play', syncPlaying);
      video.removeEventListener('pause', syncPlaying);
      video.removeEventListener('loadeddata', drawReadyFrame);
      video.removeEventListener('canplay', drawReadyFrame);
      video.removeEventListener('seeked', drawReadyFrame);
      scheduler.unregister(id);
    };
  }, [element.id, element.isVisible, onReadyRef, scheduler, video]);

  if (!video) return null;
  return (
    <KonvaImage
      ref={imageRef}
      image={video}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      opacity={opacity}
      listening={false}
      data-testid={`canvas-konva-media-${element.id}`}
    />
  );
};

export const CanvasKonvaMediaLayer: React.FC<CanvasKonvaMediaLayerProps> = ({
  elements,
  width,
  height,
  panOffset,
  zoom,
  dimmedElementIds = EMPTY_SET,
  disabledElementIds = EMPTY_SET,
  onMediaReady,
  onMediaLoadError,
}) => {
  const schedulerRef = useRef<SceneVideoScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createSceneVideoScheduler();
  }

  useEffect(() => () => schedulerRef.current?.stop(), []);

  const mediaElements = useMemo(
    () => elements.filter((element) => shouldRenderMediaInKonva(element, disabledElementIds)),
    [disabledElementIds, elements],
  );

  if (mediaElements.length === 0) return null;

  return (
    <Stage
      width={width}
      height={height}
      listening={false}
      data-testid="canvas-konva-media-stage"
    >
      <Layer listening={false} imageSmoothingEnabled>
        <Group
          x={panOffset.x}
          y={panOffset.y}
          scaleX={zoom}
          scaleY={zoom}
          listening={false}
          data-testid="canvas-konva-media-world"
        >
          {mediaElements.map((element) => {
            const opacity = dimmedElementIds.has(element.id) ? 0.82 : 1;
            if (element.type === 'image') {
              return (
                <ImageMediaNode
                  key={element.id}
                  element={element}
                  opacity={opacity}
                  onReady={onMediaReady}
                  onLoadError={onMediaLoadError}
                />
              );
            }
            return (
              <VideoMediaNode
                key={element.id}
                element={element}
                opacity={opacity}
                scheduler={schedulerRef.current!}
                onReady={onMediaReady}
              />
            );
          })}
        </Group>
      </Layer>
    </Stage>
  );
};
