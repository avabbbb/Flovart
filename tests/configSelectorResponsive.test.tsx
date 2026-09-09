import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSelector } from '../components/ConfigManager/ConfigSelector';
import type { UserApiKey } from '../types';

const configs: UserApiKey[] = [
  {
    id: 'openai-long',
    name: 'OpenAI Compatible Production Workspace',
    provider: 'openai',
    capabilities: ['image', 'video'],
    key: 'secret-key',
    models: [
      { id: 'gpt-image-2', name: 'GPT Image 2' },
      { id: 'video-model-with-a-deliberately-long-identifier', name: 'Video model with a deliberately long display name' },
      { id: 'model-3', name: 'Model 3' },
      { id: 'model-4', name: 'Model 4' },
      { id: 'model-5', name: 'Model 5' },
      { id: 'model-6', name: 'Model 6' },
    ],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'google',
    provider: 'google',
    capabilities: ['image'],
    key: 'another-secret',
    customModels: ['gemini-image'],
    createdAt: 1,
    updatedAt: 1,
  },
];

function renderSelector() {
  return render(
    <ConfigSelector
      configs={configs}
      activeConfigId="openai-long"
      activeModelId="gpt-image-2"
      onConfigChange={vi.fn()}
      onModelChange={vi.fn()}
      isDark={false}
    />,
  );
}

describe('ConfigSelector responsive contract', () => {
  it('keeps service and model selection in one portal-backed semantic menu', async () => {
    const onConfigChange = vi.fn();
    const onModelChange = vi.fn();
    render(
      <ConfigSelector
        configs={configs}
        activeConfigId="openai-long"
        activeModelId="gpt-image-2"
        onConfigChange={onConfigChange}
        onModelChange={onModelChange}
        isDark={false}
      />,
    );

    fireEvent.click(screen.getByTitle('OpenAI Compatible Production Workspace'));
    expect(screen.getByRole('menu', { name: 'AI 服务' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Google Gemini' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Google Gemini' }));
    expect(onConfigChange).toHaveBeenCalledWith('google');

    fireEvent.click(screen.getByTitle('GPT Image 2'));
    expect(screen.getByRole('menu', { name: '可用模型' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT Image 2' }));
    expect(onModelChange).toHaveBeenCalledWith('gpt-image-2');
    await waitFor(() => expect(screen.queryByRole('menu', { name: '可用模型' })).not.toBeInTheDocument());
  });

  it('supports long model names, search and Escape focus recovery', () => {
    renderSelector();
    const trigger = screen.getByTitle('GPT Image 2');
    fireEvent.click(trigger);

    const search = screen.getByPlaceholderText('搜索模型…');
    fireEvent.change(search, { target: { value: 'deliberately long' } });
    expect(screen.getByRole('menuitemradio', { name: /deliberately long display name/ })).toHaveAttribute(
      'title',
      'video-model-with-a-deliberately-long-identifier',
    );
    expect(screen.queryByRole('menuitemradio', { name: 'Model 3' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('config-selector-popover')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders a narrow combined trigger and an empty state without exposing secrets', () => {
    renderSelector();
    expect(screen.getByRole('button', { name: 'AI 服务 / 模型' })).toBeInTheDocument();
    expect(screen.queryByText('secret-key')).not.toBeInTheDocument();
    expect(screen.queryByText('another-secret')).not.toBeInTheDocument();
  });
});
