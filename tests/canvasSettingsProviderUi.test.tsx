import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasSettings } from '../components/CanvasSettings';
import type { ModelPreference, UserApiKey } from '../types';

const modelPreference: ModelPreference = {
  textModel: 'custom-text-model',
  imageModel: 'custom-image-model',
  videoModel: 'custom-video-model',
};

function renderSettings(userApiKeys: UserApiKey[] = []) {
  return render(
    <CanvasSettings
      isOpen
      onClose={() => undefined}
      language="zho"
      setLanguage={() => undefined}
      themeMode="dark"
      resolvedTheme="dark"
      setThemeMode={() => undefined}
      wheelAction="zoom"
      setWheelAction={() => undefined}
      userApiKeys={userApiKeys}
      onAddApiKey={() => undefined}
      onDeleteApiKey={() => undefined}
      onUpdateApiKey={() => undefined}
      onSetDefaultApiKey={() => undefined}
      modelPreference={modelPreference}
      setModelPreference={() => undefined}
      modelPreferenceSavedAt={1234567890}
      modelPreferenceSaveError={null}
      t={(key) => key}
      clearKeysOnExit={false}
      setClearKeysOnExit={() => undefined}
      dynamicModelOptions={{
        text: ['custom-text-model'],
        image: ['custom-image-model'],
        video: ['custom-video-model'],
      }}
    />,
  );
}

describe('CanvasSettings provider configuration UI', () => {
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
    expect(screen.getByText('模型映射')).toBeTruthy();
    expect(screen.getByText('配置 JSON')).toBeTruthy();
    expect(screen.getByText('模型测试配置')).toBeTruthy();
  });

  it('does not expose a hardcoded image tool provider preset', () => {
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /添加 API Key|添加供应商/i }));

    expect(screen.queryByText('Banana Vision')).toBeNull();
  });

  it('shows RunningHub packaged provider entry and preserves model preference save status', () => {
    renderSettings();

    expect(screen.getByText(/已自动保存/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /添加 API Key|添加供应商/i }));

    expect(screen.getByText('RunningHub 标准模型')).toBeTruthy();
    expect(screen.getByText('3 个官方模型包')).toBeTruthy();
    expect(screen.queryByText('全能图片G-2.0-图生图-低价渠道版')).toBeNull();
    expect(screen.queryByText('全能视频V3.1-fast-图生视频-低价渠道版')).toBeNull();
  });

  it('does not expose a separate Agent model preference in the creative model list', () => {
    renderSettings();

    expect(screen.queryByText('Agent 模型')).toBeNull();
  });
});
