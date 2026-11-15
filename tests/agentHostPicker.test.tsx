import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHostPicker } from '../components/agent/AgentHostPicker';
import { discoverAgentHosts, type AgentHostDiscovery, type AgentHostRecord } from '../services/agentHostDiscovery';
import { prepareAgent } from '../services/link/hostActivation';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

vi.mock('../services/agentHostDiscovery', () => ({ discoverAgentHosts: vi.fn() }));
vi.mock('../services/link/hostActivation', () => ({ prepareAgent: vi.fn() }));

const host = (id: string, available = true, status = available ? 'available' : 'unavailable'): AgentHostRecord => ({
  id, label: id === 'deepseek-harness' ? 'DeepSeek Harness' : id[0].toUpperCase() + id.slice(1), category: id === 'workbuddy' ? 'mainstream-host' : id === 'deepseek-harness' ? 'harness' : 'coding-agent', status, available,
  executable: id, path: null, version: null, authStatus: 'not-inspected', distributionTargets: [], runtimeSurfaces: [], diagnostic: '已取得状态',
});
const discovery = (codexAvailable = true): AgentHostDiscovery => ({
  ok: true,
  state: 'ready',
  agents: [host('codex', codexAvailable), host('workbuddy', false, 'manual-import'), host('deepseek-harness', false, 'external-plugin')],
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useAgentConnectionStore.getState().reset();
  useAgentConnectionStore.getState().setStatus('ready', { projectId: 'project-1', clientId: 'client-1', writerStatus: 'inactive' });
  vi.mocked(discoverAgentHosts).mockResolvedValue(discovery());
  vi.mocked(prepareAgent).mockResolvedValue({ state: 'ready', label: '已准备', message: 'Codex 已选择并准备连接。', notice: 'Codex 已选择并准备连接。' });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); useAgentConnectionStore.getState().reset(); });

describe('Link 2.0 agent selection', () => {
  it('shows the public four-state UX without implementation vocabulary', async () => {
    render(<AgentHostPicker />);
    await screen.findByRole('button', { name: '使用 Codex' });
    expect(screen.getByRole('heading', { name: '协作 Agent' })).toBeInTheDocument();
    expect(screen.queryByText(/Agent URL|Token|Port|Projection|Writer|Director|连接指令|Activate|Bridge/)).not.toBeInTheDocument();
  });

  it('prepares Codex through the unified action and reports the active project', async () => {
    render(<AgentHostPicker />);
    fireEvent.click(await screen.findByRole('button', { name: '使用 Codex' }));
    await waitFor(() => expect(prepareAgent).toHaveBeenCalledWith('codex'));
    expect(await screen.findByRole('status')).toHaveTextContent('Codex 已选择并准备连接');
  });

  it('does not transfer control when selecting another assistant', async () => {
    render(<AgentHostPicker />);
    await screen.findByRole('button', { name: '使用 Codex' });
    fireEvent.click(screen.getByRole('button', { name: /^WorkBuddy/ }));
    expect(prepareAgent).not.toHaveBeenCalled();
  });

  it('surfaces setup guidance from the host definition without host branches', async () => {
    vi.mocked(prepareAgent).mockResolvedValue({ state: 'needs_setup', label: '需安装', message: '安装包已下载，在 WorkBuddy 的技能页导入后即可使用 Flovart。' });
    render(<AgentHostPicker />);
    await screen.findByRole('button', { name: '使用 Codex' });
    const workbuddyCard = screen.getByRole('button', { name: /^WorkBuddy/ }).closest('.agent-card')!;
    fireEvent.click(within(workbuddyCard as HTMLElement).getByRole('button', { name: '设置' }));
    await waitFor(() => expect(prepareAgent).toHaveBeenCalledWith('workbuddy'));
    expect(await screen.findByRole('status')).toHaveTextContent('安装包已下载');
  });

  it('offers Reconnect while the local link is down and explains the classified cause', async () => {
    useAgentConnectionStore.getState().setStatus('auth_failed', { issue: { kind: 'auth', at: new Date().toISOString(), url: 'http://127.0.0.1:17372' } });
    vi.mocked(discoverAgentHosts).mockResolvedValue({ ok: false, state: 'offline', agents: [] });
    render(<AgentHostPicker />);
    const reconnect = await screen.findAllByRole('button', { name: '重新连接' });
    expect(screen.getByText(/连接凭证已失效/)).toBeInTheDocument();
    expect(screen.getByTestId('agent-link-badge')).toHaveTextContent('凭证失效');
    const before = useAgentConnectionStore.getState().reconnectNonce;
    fireEvent.click(reconnect[0]);
    expect(useAgentConnectionStore.getState().reconnectNonce).toBe(before + 1);
    // Preparing a host cannot work without the link; it must not be attempted.
    expect(prepareAgent).not.toHaveBeenCalled();
  });

  it('shows numbered DSH steps with copyable commands when DeepSeek Harness is selected', async () => {
    localStorage.setItem('flovart.agent.selectedHost', 'deepseek-harness');
    render(<AgentHostPicker />);
    const guide = await screen.findByTestId('agent-setup-guide');
    expect(within(guide).getByRole('heading', { name: 'DeepSeek Harness 接入步骤' })).toBeInTheDocument();
    expect(within(guide).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(guide).toHaveTextContent('npm run dsh:profile:install');
    expect(guide).toHaveTextContent('npm run dsh:start');
    expect(within(guide).getAllByRole('button', { name: '复制命令' }).length).toBeGreaterThanOrEqual(3);
  });

  it('refreshes changed availability when the host count stays the same', async () => {
    vi.mocked(discoverAgentHosts).mockResolvedValueOnce(discovery(false)).mockResolvedValueOnce(discovery(true));
    render(<AgentHostPicker />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '设置' })).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: '刷新协作状态' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '使用 Codex' })).toBeEnabled());
  });
  it('stops the pending coordinator result after the project changes', async () => {
    let finish: (value: { state: 'ready'; label: string; message: string; notice: string }) => void = () => {};
    vi.mocked(prepareAgent).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<AgentHostPicker />);
    fireEvent.click(await screen.findByRole('button', { name: '使用 Codex' }));
    act(() => useAgentConnectionStore.getState().setStatus('ready', { projectId: 'project-2' }));
    await act(async () => finish({ state: 'ready', label: '已准备', message: 'Codex 已选择并准备连接。', notice: 'Codex 已选择并准备连接。' }));
    expect(screen.queryByText('Codex 已准备，可以操作当前项目')).not.toBeInTheDocument();
  });
});
