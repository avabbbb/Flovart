import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UserApiKey } from '../types';

const { fetchModelsForProvider } = vi.hoisted(() => ({ fetchModelsForProvider: vi.fn() }));
vi.mock('../services/modelFetcher', () => ({ fetchModelsForProvider }));

import { AgentModelPicker } from '../components/agent/AgentModelPicker';

const agentText = (routeId: string) => ({ target: { kind: 'runtime-capability' as const, capability: 'agent-text' as const }, routeId, order: 0 });

describe('AgentModelPicker', () => {
  it('imports every model from a key + base URL and routes the agent to the first text model', async () => {
    fetchModelsForProvider.mockResolvedValue({
      ok: true,
      effectiveBaseUrl: 'https://api.example.com/v1',
      models: [
        { id: 'img-1', name: 'img-1', capability: 'image' },
        { id: 'chat-a', name: 'Chat A', capability: 'text' },
        { id: 'chat-b', name: 'Chat B', capability: 'text' },
      ],
    });
    const onAddApiKey = vi.fn();
    render(<AgentModelPicker userApiKeys={[]} onAddApiKey={onAddApiKey} onUpdateApiKey={vi.fn()} open onOpenChange={vi.fn()} language="zho" />);

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.example.com' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: /导入全部模型/ }));

    await waitFor(() => expect(onAddApiKey).toHaveBeenCalledOnce());
    expect(fetchModelsForProvider).toHaveBeenCalledWith('openai_compatible', 'sk-test', 'https://api.example.com');
    const payload = onAddApiKey.mock.calls[0][0];
    expect(payload).toMatchObject({ provider: 'openai_compatible', key: 'sk-test', baseUrl: 'https://api.example.com/v1', name: 'api.example.com' });
    expect(payload.models).toHaveLength(3);
    expect(payload.capabilities).toEqual(expect.arrayContaining(['text', 'image']));
    expect(payload.routeMappings).toEqual([agentText('chat-a')]);
  });

  it('shows an error instead of saving when no models come back', async () => {
    fetchModelsForProvider.mockResolvedValue({ ok: false, models: [], error: 'API Key 无效' });
    const onAddApiKey = vi.fn();
    render(<AgentModelPicker userApiKeys={[]} onAddApiKey={onAddApiKey} open onOpenChange={vi.fn()} language="zho" />);
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://bad.example.com' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByRole('button', { name: /导入全部模型/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('API Key 无效');
    expect(onAddApiKey).not.toHaveBeenCalled();
  });

  it('switches the agent model and leaves only one agent-text mapping', () => {
    const keys: UserApiKey[] = [
      { id: 'k1', provider: 'openai_compatible', capabilities: ['text'], key: 'a', baseUrl: 'https://one.example.com/v1', models: [{ id: 'm1', name: 'm1', capability: 'text' }], routeMappings: [agentText('m1')], createdAt: 0, updatedAt: 0 },
      { id: 'k2', provider: 'openai_compatible', capabilities: ['text'], key: 'b', baseUrl: 'https://two.example.com/v1', models: [{ id: 'm2', name: 'm2', capability: 'text' }], createdAt: 0, updatedAt: 0 },
    ];
    const onUpdateApiKey = vi.fn();
    const onOpenChange = vi.fn();
    render(<AgentModelPicker userApiKeys={keys} onUpdateApiKey={onUpdateApiKey} open onOpenChange={onOpenChange} language="zho" />);

    expect(screen.getByRole('option', { name: /m1/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'm2' } });
    expect(screen.queryByRole('option', { name: /m1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /m2/ }));

    expect(onUpdateApiKey).toHaveBeenCalledWith('k1', { routeMappings: [] });
    expect(onUpdateApiKey).toHaveBeenCalledWith('k2', { routeMappings: [agentText('m2')] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
