import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '../components/SettingsPanel';
import type { UserApiKey } from '../types';

function renderSettings(
  userApiKeys: UserApiKey[] = [],
  onUpdateApiKey: (id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => void = () => undefined,
) {
  return render(
      <SettingsPanel
      isOpen
      onClose={() => undefined}
      resolvedTheme="dark"
      userApiKeys={userApiKeys}
      onAddApiKey={() => undefined}
      onDeleteApiKey={() => undefined}
      onUpdateApiKey={onUpdateApiKey}
      onSetDefaultApiKey={() => undefined}
      t={(key) => key}
      clearKeysOnExit={false}
      setClearKeysOnExit={() => undefined}
    />,
  );
}

describe('SettingsPanel provider configuration UI', () => {
  it('removes the Template Insight block from settings', () => {
    renderSettings();

    expect(screen.queryByText('Template Insight')).toBeNull();
    expect(screen.queryByText(/Current preferences resolved/i)).toBeNull();
  });

  it('opens a CC Switch style provider setup flow with advanced model config fields', () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /添加 API Key|添加供应商/i }));

    expect(screen.getByText('预设供应商')).toBeTruthy();
    expect(screen.getByText('自定义配置')).toBeTruthy();
    expect(screen.getByText('Claude Official')).toBeTruthy();
    expect(screen.queryByText('固定模型路由绑定')).toBeNull();
    expect(screen.getByText('价格规则')).toBeTruthy();
    expect(screen.getByText('预算策略')).toBeTruthy();
    expect(screen.getByText('配置 JSON')).toBeTruthy();
    expect(screen.getByText('模型测试配置')).toBeTruthy();
  });

  it('does not expose a hardcoded image tool provider preset', () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /添加 API Key|添加供应商/i }));

    expect(screen.queryByText('Banana Vision')).toBeNull();
  });

  it('shows one mapping center for text capabilities and media product routes', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '模型映射' }));
    await waitFor(() => expect(screen.getByText('提示词增强')).toBeTruthy());
    expect(screen.getByText('脚本拆解')).toBeTruthy();
    expect(screen.getByText('Agent 文本')).toBeTruthy();
    expect(screen.getByText('图像理解')).toBeTruthy();
    expect(screen.queryByText('模型偏好')).toBeNull();
  });

  it('puts image and video mapping before text routes and applies detected API model suggestions once confirmed', async () => {
    const onUpdateApiKey = vi.fn();
    const keys: UserApiKey[] = [
      {
        id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret',
        models: [{ id: 'gpt-image-2', name: 'GPT Image 2' }], createdAt: 1, updatedAt: 1,
      },
      {
        id: 'video-key', provider: 'volcengine', capabilities: ['video'], key: 'secret',
        models: [{ id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0' }], createdAt: 1, updatedAt: 1,
      },
    ];
    renderSettings(keys, onUpdateApiKey);

    fireEvent.click(screen.getByRole('button', { name: '模型映射' }));
    const sections = await screen.findByTestId('model-mapping-sections');
    expect(sections.textContent?.indexOf('图像模型')).toBeLessThan(sections.textContent?.indexOf('视频模型') || 0);
    expect(sections.textContent?.indexOf('视频模型')).toBeLessThan(sections.textContent?.indexOf('文本与 Agent') || 0);
    expect(screen.getByText(/检测到 6 条媒体映射建议/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '应用全部建议' }));
    expect(onUpdateApiKey).toHaveBeenCalledTimes(2);
    expect(onUpdateApiKey).toHaveBeenCalledWith('image-key', expect.objectContaining({
      routeMappings: expect.arrayContaining([
        expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, routeId: 'gpt-image-2' }),
        expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' }, routeId: 'gpt-image-2' }),
      ]),
    }));
    expect(onUpdateApiKey).toHaveBeenCalledWith('video-key', expect.objectContaining({
      routeMappings: expect.arrayContaining([
        expect.objectContaining({ target: expect.objectContaining({ kind: 'product-mode', productModelId: 'flovart:seedance-2' }), routeId: 'doubao-seedance-2-0-260128' }),
      ]),
    }));
  });

  it('adds a confirmed runtime route through the single mapping center', async () => {
    const onUpdateApiKey = vi.fn();
    const key: UserApiKey = {
      id: 'text-key',
      name: '主文本线路',
      provider: 'google',
      key: 'secret',
      capabilities: ['text'],
      models: [{ id: 'gemini-3-flash', name: 'Gemini 3 Flash' }],
      createdAt: 1,
      updatedAt: 1,
    };
    renderSettings([key], onUpdateApiKey);

    fireEvent.click(screen.getByRole('button', { name: '模型映射' }));
    const routeSelect = await screen.findByLabelText('提示词增强 添加线路');
    fireEvent.change(routeSelect, { target: { value: JSON.stringify(['text-key', 'gemini-3-flash']) } });

    expect(onUpdateApiKey).toHaveBeenCalledWith('text-key', {
      routeMappings: [{
        target: { kind: 'runtime-capability', capability: 'prompt-enhancement' },
        routeId: 'gemini-3-flash',
        order: 0,
      }],
    });
  });

  it('shows RunningHub packaged provider entry', async () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /添加 API Key|添加供应商/i }));

    expect(screen.getByText('RunningHub 标准模型')).toBeTruthy();
    expect(screen.getByText('点击获取官方模型')).toBeTruthy();
    expect(screen.queryByText('全能图片G-2.0-图生图-低价渠道版')).toBeNull();
    expect(screen.queryByText('全能视频V3.1-fast-图生视频-低价渠道版')).toBeNull();
  });

  it('does not expose a separate Agent model preference in the creative model list', () => {
    renderSettings();

    expect(screen.queryByText('Agent 模型')).toBeNull();
  });
});
