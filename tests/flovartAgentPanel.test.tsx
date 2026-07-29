import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { getManagedAgentConnection } from '../services/managedAgentConnection';

vi.mock('../services/managedAgentConnection', () => ({
  getManagedAgentConnection: vi.fn(),
}));

describe('Flovart Agent panel', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.mocked(getManagedAgentConnection).mockResolvedValue({
      state: 'ready',
      url: 'http://127.0.0.1:17372',
      token: 'desktop-token',
      managed: true,
    });
  });

  it('shows a localized configuration state while keeping retry available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        sessionId: 'session-1',
        projectId: 'project-1',
        running: false,
        messages: [{
          id: 'assistant-error',
          role: 'assistant',
          text: '',
          error: 'No agent-text route is configured',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })));

    render(<FlovartAgentPanel projectId="project-1" onActivityChange={vi.fn()} />);

    expect(await screen.findByText('需要配置')).toBeInTheDocument();
    expect(screen.getByText('请在设置的“模型映射”中为 Agent 文本能力配置可用线路。')).toBeInTheDocument();
    expect(screen.queryByText('No agent-text route is configured')).not.toBeInTheDocument();

    const composer = screen.getByPlaceholderText('请先配置 Agent 文本模型映射');
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: '配置完成后重试' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  });
});
