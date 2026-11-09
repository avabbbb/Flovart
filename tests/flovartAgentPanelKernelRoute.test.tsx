import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';
import type * as BrowserAgentKernelModule from '../services/browserAgentKernel';

const spies = vi.hoisted(() => ({ construct: vi.fn(), close: vi.fn(async () => undefined) }));

vi.mock('../services/managedAgentConnection', () => ({ getManagedAgentConnection: vi.fn() }));

// 只替换内核构造；resolveBrowserAgentTextRoute 等保持真实实现，验证的是面板 effect 的重建条件。
vi.mock('../services/browserAgentKernel', async importOriginal => {
  const actual = await importOriginal<typeof BrowserAgentKernelModule>();
  class StubKernel {
    constructor(options: { projectId: string; route: unknown }) {
      spies.construct(options);
      const base: Record<string, unknown> = {
        openSession: async () => undefined,
        snapshot: async () => ({ sessionId: 'session-stub', projectId: options.projectId, running: false, messages: [] }),
        subscribe: () => () => undefined,
        close: spies.close,
      };
      // 面板可能调用的其他会话方法（列表、历史）统一返回空数组。
      return new Proxy(base, { get: (target, prop) => (prop in target ? target[prop as string] : prop === 'then' ? undefined : async () => []) }) as unknown as StubKernel;
    }
  }
  return { ...actual, BrowserAgentKernel: StubKernel };
});

const keyFor = (model: string) => ({
  id: 'key-hark',
  provider: 'openai',
  key: 'sk-test',
  status: 'ok',
  routeMappings: [{ routeId: model, order: 0, target: { kind: 'runtime-capability', capability: 'agent-text' } }],
  createdAt: 1,
  updatedAt: 1,
}) as never;

describe('Flovart Agent panel browser kernel route', () => {
  beforeEach(() => {
    spies.construct.mockClear();
    spies.close.mockClear();
    vi.mocked(getManagedAgentConnection).mockResolvedValue(null as never);
  });

  it('rebuilds the browser kernel when an agent-text key is added after mounting without one', async () => {
    // 回归：effect 曾只依赖 project.id，无 Key 打开面板后导入 Key/选模型，内核不重建，发送仍报缺凭证。
    const project = { ...createWorkflowProject('Agent 线路'), id: 'project-route' };
    const props = { project, onActivityChange: vi.fn(), onOpenSettings: vi.fn() };
    const { rerender } = render(<FlovartAgentPanel {...props} userApiKeys={[]} />);

    expect(await screen.findByTestId('agent-setup-card')).toBeInTheDocument();
    expect(spies.construct).not.toHaveBeenCalled();

    rerender(<FlovartAgentPanel {...props} userApiKeys={[keyFor('hark')]} />);
    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(1));
    expect(spies.construct.mock.calls[0][0].route).toMatchObject({ model: 'hark', apiKey: 'sk-test' });
    await waitFor(() => expect(screen.queryByTestId('agent-setup-card')).not.toBeInTheDocument());

    // 内容相同的新数组不应触发重建。
    rerender(<FlovartAgentPanel {...props} userApiKeys={[keyFor('hark')]} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(spies.construct).toHaveBeenCalledTimes(1);

    // 切换模型：关闭旧内核并用新线路重建。
    rerender(<FlovartAgentPanel {...props} userApiKeys={[keyFor('hark-2')]} />);
    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(2));
    expect(spies.close).toHaveBeenCalled();
    expect(spies.construct.mock.calls[1][0].route).toMatchObject({ model: 'hark-2' });
  });

  it('starts the browser kernel from a plain text key without an explicit agent-text mapping', async () => {
    // 回归：Key 已配好但没在模型映射里选 Agent 文本模型时，面板曾一直显示缺凭证。
    const project = { ...createWorkflowProject('Agent 回退'), id: 'project-fallback' };
    const plainKey = {
      id: 'key-plain',
      provider: 'openai_compatible',
      baseUrl: 'https://gw.example.com/v1',
      key: 'sk-plain',
      capabilities: ['text'],
      status: 'ok',
      customModels: ['chat-x'],
      defaultModel: 'chat-x',
      createdAt: 1,
      updatedAt: 1,
    } as never;
    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} userApiKeys={[plainKey]} />);

    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(1));
    expect(spies.construct.mock.calls[0][0].route).toMatchObject({ model: 'chat-x', apiKey: 'sk-plain' });
    await waitFor(() => expect(screen.queryByTestId('agent-setup-card')).not.toBeInTheDocument());
  });

  it('uses the browser kernel on web even when the local managed Agent is connected', async () => {
    // 回归：网页端检测到本机 Agent 就走托管路径，而托管 Agent 只会转发给桌面 Runtime，网页端永远报缺凭证。
    vi.mocked(getManagedAgentConnection).mockResolvedValue({ state: 'ready', url: 'agent.local', token: 't', managed: true } as never);
    const project = { ...createWorkflowProject('Agent 网页'), id: 'project-web' };
    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} userApiKeys={[keyFor('hark')]} />);

    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(1));
    expect(spies.construct.mock.calls[0][0].route).toMatchObject({ model: 'hark', apiKey: 'sk-test' });
    await waitFor(() => expect(screen.queryByTestId('agent-setup-card')).not.toBeInTheDocument());
  });
});
