import React, { useState, useMemo } from 'react';
import type { CanvasElement } from '../../types';

interface CanvasElementPickerProps {
  canvasImages: Array<{ id: string; name?: string; href: string; mimeType: string }>;
  canvasVideos: Array<{ id: string; name?: string; href: string; mimeType: string; poster?: string; width?: number; height?: number }>;
  onSelectImage?: (image: { id: string; name?: string; href: string; mimeType: string }) => void;
  onSelectVideo?: (video: { id: string; name?: string; href: string; mimeType: string; poster?: string; width?: number; height?: number }) => void;
  mode: 'image' | 'video' | 'both';
  language?: 'en' | 'zho';
}

const COPY = {
  en: {
    selectFromCanvas: 'Select from Canvas',
    noImages: 'No images on canvas',
    noVideos: 'No videos on canvas',
    images: 'Images',
    videos: 'Videos',
    selectImage: 'Select image',
    selectVideo: 'Select video',
  },
  zho: {
    selectFromCanvas: '从画布选择',
    noImages: '画布上没有图片',
    noVideos: '画布上没有视频',
    images: '图片',
    videos: '视频',
    selectImage: '选择图片',
    selectVideo: '选择视频',
  },
};

export const CanvasElementPicker: React.FC<CanvasElementPickerProps> = ({
  canvasImages,
  canvasVideos,
  onSelectImage,
  onSelectVideo,
  mode,
  language = 'en',
}) => {
  const [activeTab, setActiveTab] = useState<'image' | 'video'>(
    mode === 'video' ? 'video' : 'image'
  );

  const copy = COPY[language];
  const showImages = mode === 'image' || mode === 'both';
  const showVideos = mode === 'video' || mode === 'both';

  const displayImages = useMemo(() => canvasImages.slice().reverse(), [canvasImages]);
  const displayVideos = useMemo(() => canvasVideos.slice().reverse(), [canvasVideos]);

  return (
    <div className="isl-pop w-80 p-3 max-h-96 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: 'var(--isl-border)' }}>
        <span className="text-xs font-bold" style={{ color: 'var(--isl-ink-soft)' }}>
          {copy.selectFromCanvas}
        </span>
        {mode === 'both' && (
          <div className="ml-auto flex gap-1">
            {showImages && (
              <button
                type="button"
                onClick={() => setActiveTab('image')}
                className={`isl-chip text-xs px-2 py-1 ${activeTab === 'image' ? 'isl-chip--active' : ''}`}
                style={{ boxShadow: activeTab === 'image' ? 'none' : '0 1px 0 0 var(--isl-edge)' }}
              >
                {copy.images}
              </button>
            )}
            {showVideos && (
              <button
                type="button"
                onClick={() => setActiveTab('video')}
                className={`isl-chip text-xs px-2 py-1 ${activeTab === 'video' ? 'isl-chip--active' : ''}`}
                style={{ boxShadow: activeTab === 'video' ? 'none' : '0 1px 0 0 var(--isl-edge)' }}
              >
                {copy.videos}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'image' && (
          <div className="grid grid-cols-2 gap-2">
            {displayImages.length === 0 ? (
              <div className="col-span-2 text-center py-6 text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>
                {copy.noImages}
              </div>
            ) : (
              displayImages.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => onSelectImage?.(img)}
                  className="isl-row group relative aspect-video overflow-hidden cursor-pointer"
                  title={img.name || `Image ${img.id.slice(-4)}`}
                >
                  <img
                    src={img.href}
                    alt={img.name || 'Canvas image'}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
                  <div className="absolute bottom-1 left-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                       style={{ background: 'var(--isl-card)', color: 'var(--isl-ink)', opacity: 0.9 }}>
                    {img.name || `#${img.id.slice(-4)}`}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {activeTab === 'video' && (
          <div className="grid grid-cols-2 gap-2">
            {displayVideos.length === 0 ? (
              <div className="col-span-2 text-center py-6 text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>
                {copy.noVideos}
              </div>
            ) : (
              displayVideos.map((vid) => (
                <button
                  key={vid.id}
                  type="button"
                  onClick={() => onSelectVideo?.(vid)}
                  className="isl-row group relative aspect-video overflow-hidden cursor-pointer"
                  title={vid.name || `Video ${vid.id.slice(-4)}`}
                >
                  {vid.poster ? (
                    <img
                      src={vid.poster}
                      alt={vid.name || 'Canvas video'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--isl-surface-sunk)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--isl-ink-ghost)' }}>
                        <path d="m22 8-6 4 6 4V8Z" />
                        <rect x="2" y="6" width="14" height="12" rx="2" />
                      </svg>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
                  <div className="absolute bottom-1 left-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                       style={{ background: 'var(--isl-card)', color: 'var(--isl-ink)', opacity: 0.9 }}>
                    {vid.name || `#${vid.id.slice(-4)}`}
                  </div>
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold"
                       style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
