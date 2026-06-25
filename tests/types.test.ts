import { describe, expect, it } from 'vitest';
import type {
  AIProvider,
  AssetCategory,
  Board,
  CharacterLockProfile,
  GenerationMode,
  ImageElement,
  PromptEnhanceMode,
  UserApiKey,
  VideoElement,
} from '../types';

describe('types.ts', () => {
  it('covers the supported AI providers', () => {
    const providers: AIProvider[] = [
      'openai',
      'anthropic',
      'google',
      'qwen',
      'deepseek',
      'siliconflow',
      'keling',
      'flux',
      'midjourney',
      'runningHub',
      'minimax',
      'volcengine',
      'openrouter',
      'openai_compatible',
      'custom',
    ];
    expect(providers).toHaveLength(15);
  });

  it('covers the supported generation modes', () => {
    const modes: GenerationMode[] = ['image', 'video', 'keyframe'];
    expect(modes).toHaveLength(3);
  });

  it('covers the supported prompt enhance modes', () => {
    const modes: PromptEnhanceMode[] = ['smart', 'style', 'precise', 'translate'];
    expect(modes).toHaveLength(4);
  });

  it('instantiates UserApiKey with required fields', () => {
    const key: UserApiKey = {
      id: 'test-id',
      provider: 'google',
      capabilities: ['text', 'image'],
      key: 'api-key-value',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(key.provider).toBe('google');
    expect(key.capabilities).toContain('text');
  });

  it('instantiates ImageElement', () => {
    const image: ImageElement = {
      id: 'img-1',
      type: 'image',
      x: 0,
      y: 0,
      href: 'data:image/png;base64,abc',
      width: 100,
      height: 100,
      mimeType: 'image/png',
    };
    expect(image.type).toBe('image');
  });

  it('instantiates VideoElement with P3 metadata', () => {
    const video: VideoElement = {
      id: 'vid-1',
      type: 'video',
      x: 0,
      y: 0,
      href: 'blob:xxx',
      width: 640,
      height: 480,
      mimeType: 'video/mp4',
      poster: 'data:image/png;base64,poster',
      durationSec: 4,
      sourceKind: 'generation',
    };
    expect(video.type).toBe('video');
    expect(video.sourceKind).toBe('generation');
  });

  it('instantiates Board', () => {
    const board: Board = {
      id: 'board-1',
      name: 'Test Board',
      elements: [],
      history: [[]],
      historyIndex: 0,
      panOffset: { x: 0, y: 0 },
      zoom: 1,
      canvasBackgroundColor: '#ffffff',
    };
    expect(board.elements).toEqual([]);
    expect(board.zoom).toBe(1);
  });

  it('covers the supported asset categories', () => {
    const categories: AssetCategory[] = ['character', 'scene', 'prop'];
    expect(categories).toHaveLength(3);
  });

  it('instantiates CharacterLockProfile', () => {
    const profile: CharacterLockProfile = {
      id: 'cl-1',
      name: 'Test Character',
      anchorElementId: 'img-1',
      referenceImage: 'data:image/png;base64,abc',
      descriptor: 'A woman with red hair',
      createdAt: Date.now(),
      isActive: true,
    };
    expect(profile.isActive).toBe(true);
    expect(profile.descriptor).toContain('red hair');
  });
});
