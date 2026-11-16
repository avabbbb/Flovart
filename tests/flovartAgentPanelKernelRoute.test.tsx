import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';
import type * as BrowserAgentKernelModule from '../services/browserAgentKernel';

const spies = vi.hoisted(() => ({
  construct: vi.fn(),
  close: vi.fn(async () => undefined),
  // 默认立即结束；单个用例可换成挂起的 promise 模拟「正在运行」。
  send: vi.fn(async (_text: string) => undefined as unknown),
  steer: vi.fn((_text: string) => true),
  cancel: vi.fn(),
}));

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
        send: (text: string) => spies.send(text),
        steer: (text: string) => spies.steer(text),
        cancel: () => spies.cancel(),
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
    spies.send.mockReset().mockResolvedValue(undefined);
    spies.steer.mockReset().mockReturnValue(true);
    spies.cancel.mockReset();
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

  it('keeps a running turn alive across a model switch and steers a mid-run message into it', async () => {
    // 回归：运行中切模型 / 改 Key 会重建内核并 abort 正在跑的一轮（"signal is aborted without reason"）；
    // 以前运行中也不能再发消息，只能先停止。
    let finish: () => void = () => undefined;
    spies.send.mockImplementation(() => new Promise(resolve => { finish = () => resolve(undefined); }));
    const project = { ...createWorkflowProject('Agent 插话'), id: 'project-steer-ui' };
    const props = { project, onActivityChange: vi.fn(), onOpenSettings: vi.fn() };
    const { rerender } = render(<FlovartAgentPanel {...props} userApiKeys={[keyFor('hark')]} />);
    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(1));
    const composer = await screen.findByLabelText('开始你的创作，或者 @ 引用工作流/节点/资源') as HTMLTextAreaElement;
    await waitFor(() => expect(composer).toBeEnabled());

    fireEvent.change(composer, { target: { value: '先做 A' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(spies.send).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: '停止' })).toBeInTheDocument();

    rerender(<FlovartAgentPanel {...props} userApiKeys={[keyFor('hark-2')]} />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(spies.construct).toHaveBeenCalledTimes(1);
    expect(spies.close).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: '顺便做 B' } });
    fireEvent.click(screen.getByRole('button', { name: '发送（不打断当前任务）' }));
    expect(spies.steer).toHaveBeenCalledTimes(1);
    expect(spies.steer.mock.calls[0][0]).toContain('顺便做 B');
    expect(spies.cancel).not.toHaveBeenCalled();
    expect(spies.send).toHaveBeenCalledTimes(1);
    expect(screen.getByText('已加入当前任务，下一步生效')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

    // 这一轮结束后才换到新模型。
    finish();
    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(2));
    expect(spies.construct.mock.calls[1][0].route).toMatchObject({ model: 'hark-2' });
  });

  it('shows a stopped turn as 已中止 instead of the raw abort error', async () => {
    const project = { ...createWorkflowProject('Agent 中止'), id: 'project-aborted' };
    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} userApiKeys={[keyFor('hark')]} />);
    await waitFor(() => expect(spies.construct).toHaveBeenCalledTimes(1));
    const composer = await screen.findByLabelText('开始你的创作，或者 @ 引用工作流/节点/资源') as HTMLTextAreaElement;
    await waitFor(() => expect(composer).toBeEnabled());
    spies.send.mockImplementation(() => Promise.reject(new DOMException('signal is aborted without reason', 'AbortError')));
    fireEvent.change(composer, { target: { value: '跑一下' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(await screen.findByText('已中止')).toBeInTheDocument();
    expect(screen.queryByText(/signal is aborted/)).not.toBeInTheDocument();
  });
});
