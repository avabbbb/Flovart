import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '../types';
import {
  CanvasKonvaMediaLayer,
  shouldRenderMediaInKonva,
} from '../components/canvas/CanvasKonvaMediaLayer';

vi.mock('react-konva', () => {
  const Mock = (name: string) => ({ children, ...props }: any) => {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => (
        key.startsWith('data-')
        || ['width', 'height', 'x', 'y', 'scaleX', 'scaleY', 'opacity'].includes(key)
      )),
    );
    return <div data-konva={name} {...domProps}>{children}</div>;
  };
  return {
    Stage: Mock('Stage'),
    Layer: Mock('Layer'),
    Group: Mock('Group'),
    Image: Mock('Image'),
  };
});

const elements: Element[] = [
  {
    id: 'plain-image',
    type: 'image',
    x: 10,
    y: 20,
    width: 320,
    height: 180,
    href: 'data:image/png;base64,a',
    mimeType: 'image/png',
  },
  {
    id: 'masked-image',
    type: 'image',
    x: 360,
    y: 20,
    width: 320,
    height: 180,
    href: 'data:image/png;base64,b',
    mimeType: 'image/png',
    mask: 'data:image/png;base64,mask',
  },
  {
    id: 'video',
    type: 'video',
    x: 10,
    y: 240,
    width: 320,
    height: 180,
    href: 'blob:video',
    mimeType: 'video/mp4',
  },
];

describe('CanvasKonvaMediaLayer', () => {
  beforeEach(() => {
    const createdImages: MockImage[] = [];
    class MockImage {
      crossOrigin = '';
      decoding = '';
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        createdImages.push(this);
      }
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    (MockImage as unknown as { createdImages: MockImage[] }).createdImages = createdImages;
    vi.stubGlobal('Image', MockImage);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes simple image and video elements to the Konva media layer', async () => {
    render(
      <CanvasKonvaMediaLayer
        elements={elements}
        width={1000}
        height={700}
        panOffset={{ x: 12, y: 24 }}
        zoom={0.75}
        dimmedElementIds={new Set(['plain-image'])}
      />,
    );

    expect(screen.getByTestId('canvas-konva-media-stage').getAttribute('width')).toBe('1000');
    expect(screen.getByTestId('canvas-konva-media-world').getAttribute('x')).toBe('12');
    expect(screen.getByTestId('canvas-konva-media-world').getAttribute('scalex')).toBe('0.75');
    await waitFor(() => {
      expect(screen.getByTestId('canvas-konva-media-plain-image')).not.toBeNull();
      expect(screen.getByTestId('canvas-konva-media-video')).not.toBeNull();
      expect(screen.queryByTestId('canvas-konva-media-masked-image')).toBeNull();
    });
  });

  it('keeps complex image effects on the SVG renderer until the full pipeline is ported', () => {
    expect(shouldRenderMediaInKonva(elements[0])).toBe(true);
    expect(shouldRenderMediaInKonva(elements[1])).toBe(false);
    expect(shouldRenderMediaInKonva({
      ...elements[0],
      type: 'image',
      filters: { brightness: 90 },
    } as Element)).toBe(false);
  });

  it('does not force anonymous CORS for canvas media previews', async () => {
    const ImageCtor = globalThis.Image as unknown as { createdImages: Array<{ crossOrigin: string }> };

    render(
      <CanvasKonvaMediaLayer
        elements={[elements[0]]}
        width={800}
        height={500}
        panOffset={{ x: 0, y: 0 }}
        zoom={1}
      />,
    );

    await waitFor(() => expect(ImageCtor.createdImages.length).toBe(1));
    expect(ImageCtor.createdImages[0].crossOrigin).toBe('');
  });

  it('reports image readiness before the app hides the SVG fallback', async () => {
    const onMediaReady = vi.fn();

    render(
      <CanvasKonvaMediaLayer
        elements={[elements[0]]}
        width={800}
        height={500}
        panOffset={{ x: 0, y: 0 }}
        zoom={1}
        onMediaReady={onMediaReady}
      />,
    );

    await waitFor(() => expect(onMediaReady).toHaveBeenCalledWith('plain-image'));
  });

  it('reports image load errors so the app can fall back to SVG rendering', async () => {
    class FailingImage {
      crossOrigin = '';
      decoding = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal('Image', FailingImage);
    const onMediaLoadError = vi.fn();

    render(
      <CanvasKonvaMediaLayer
        elements={[elements[0]]}
        width={800}
        height={500}
        panOffset={{ x: 0, y: 0 }}
        zoom={1}
        onMediaLoadError={onMediaLoadError}
      />,
    );

    await waitFor(() => expect(onMediaLoadError).toHaveBeenCalledWith('plain-image'));
  });
});
