import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHostPicker } from '../components/agent/AgentHostPicker';
import { discoverAgentHosts, type AgentHostDiscovery, type AgentHostRecord } from '../services/agentHostDiscovery';
import { createWorkBuddySkillPackage } from '../services/agentSkillPackage';
import { ensureHostReady } from '../services/link/hostActivation';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

vi.mock('../services/agentHostDiscovery', () => ({ discoverAgentHosts: vi.fn() }));
vi.mock('../services/link/hostActivation', () => ({ ensureHostReady: vi.fn() }));
vi.mock('../services/agentSkillPackage', () => ({ createWorkBuddySkillPackage: vi.fn() }));

const host = (id: string, available = true, status = available ? 'available' : 'unavailable'): AgentHostRecord => ({
  id, label: id === 'deepseek-harness' ? 'DeepSeek Harness' : id[0].toUpperCase() + id.slice(1), category: id === 'workbuddy' ? 'mainstream-host' : id === 'deepseek-harness' ? 'harness' : 'coding-agent', status, available,
  executable: id, path: null, version: null, authStatus: 'not-inspected', distributionTargets: [], runtimeSurfaces: [], directorBinding: 'supported', diagnostic: '已取得状态',
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
  vi.mocked(ensureHostReady).mockResolvedValue({ activeHostWriter: { agentIdentity: 'codex', projectId: 'project-1', hasSessionId: false }, switched: false });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); useAgentConnectionStore.getState().reset(); });

describe('Link 2.0 agent selection', () => {
  it('shows the public four-state UX without implementation vocabulary', async () => {
    render(<AgentHostPicker />);
    await screen.findByRole('button', { name: '使用 Codex' });
    expect(screen.getByRole('heading', { name: '协作 Agent' })).toBeInTheDocument();
    expect(screen.queryByText(/Agent URL|Token|Projection|Writer|连接指令|Activate|Bridge/)).not.toBeInTheDocument();
  });

  it('uses one coordinator for Codex and reports the active project', async () => {
    render(<AgentHostPicker />);
    fireEvent.click(await screen.findByRole('button', { name: '使用 Codex' }));
    await waitFor(() => expect(ensureHostReady).toHaveBeenCalledWith('codex'));
    expect(await screen.findByRole('status')).toHaveTextContent('Codex 正在协作当前项目');
  });

  it('does not transfer control when selecting another assistant', async () => {
    render(<AgentHostPicker />);
    await screen.findByRole('button', { name: '使用 Codex' });
    fireEvent.click(screen.getByRole('button', { name: /^WorkBuddy/ }));
    expect(ensureHostReady).not.toHaveBeenCalled();
    expect(createWorkBuddySkillPackage).not.toHaveBeenCalled();
  });

  it('downloads the WorkBuddy connector package only after the user chooses install', async () => {
    vi.mocked(createWorkBuddySkillPackage).mockResolvedValue(new Blob(['package'], { type: 'application/zip' }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<AgentHostPicker />);
    fireEvent.click(screen.getByRole('button', { name: '安装' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(ensureHostReady).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('WorkBuddy 安装包已下载');
  });

  it('refreshes changed availability when the host count stays the same', async () => {
    vi.mocked(discoverAgentHosts).mockResolvedValueOnce(discovery(false)).mockResolvedValueOnce(discovery(true));
    render(<AgentHostPicker />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '启用' })).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '刷新协作状态' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '使用 Codex' })).toBeEnabled());
  });

  it('stops the pending coordinator result after the project changes', async () => {
    let finish: (value: { activeHostWriter: { agentIdentity: string; projectId: string; hasSessionId: boolean }; switched: boolean }) => void = () => {};
    vi.mocked(ensureHostReady).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<AgentHostPicker />);
    fireEvent.click(await screen.findByRole('button', { name: '使用 Codex' }));
    act(() => useAgentConnectionStore.getState().setStatus('ready', { projectId: 'project-2' }));
    await act(async () => finish({ activeHostWriter: { agentIdentity: 'codex', projectId: 'project-1', hasSessionId: false }, switched: false }));
    expect(screen.queryByText('Codex 正在协作当前项目')).not.toBeInTheDocument();
  });
});
