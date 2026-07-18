import { describe, expect, it } from 'vitest';
import type {
  AIProvider,
  CharacterLockProfile,
  GenerationMode,
  PromptEnhanceMode,
  UserApiKey,
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

  it('instantiates CharacterLockProfile', () => {
    const profile: CharacterLockProfile = {
      id: 'cl-1',
      name: 'Test Character',
      anchorNodeId: 'img-1',
      referenceImage: 'data:image/png;base64,abc',
      descriptor: 'A woman with red hair',
      createdAt: Date.now(),
      isActive: true,
    };
    expect(profile.isActive).toBe(true);
    expect(profile.descriptor).toContain('red hair');
  });
});
