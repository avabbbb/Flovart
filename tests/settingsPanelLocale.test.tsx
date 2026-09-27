import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '../components/SettingsPanel';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import type { UserApiKey } from '../types';
import { translations } from '../utils/translations';

const { runtimeExecute, fetchModelsForProvider } = vi.hoisted(() => ({
  runtimeExecute: vi.fn(),
  fetchModelsForProvider: vi.fn(),
}));

vi.mock('../services/flovartRuntime', () => ({
  getFlovartRuntimeApi: () => ({ execute: runtimeExecute }),
}));

vi.mock('../services/modelFetcher', () => ({ fetchModelsForProvider }));

function translate(language: 'en' | 'zho', key: string, ...args: unknown[]): string {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, translations[language] as unknown);
  const translated = typeof value === 'function'
    ? (value as (...values: unknown[]) => unknown)(...args)
    : value;
  return typeof translated === 'string' ? translated : key;
}

function SettingsLocaleFixture({ userApiKeys = [] }: { userApiKeys?: UserApiKey[] }) {
  const language = useWorkspaceStore(state => state.language);
  const t = (key: string, ...args: unknown[]) => translate(language, key, ...args);

  return (
    <SettingsPanel
      isOpen
      onClose={() => undefined}
      resolvedTheme="dark"
      userApiKeys={userApiKeys}
      onAddApiKey={() => undefined}
      onDeleteApiKey={() => undefined}
      onUpdateApiKey={() => undefined}
      onSetDefaultApiKey={() => undefined}
      t={t}
      clearKeysOnExit={false}
      setClearKeysOnExit={() => undefined}
    />
  );
}

beforeEach(() => {
  useWorkspaceStore.setState({ language: 'zho' });
  runtimeExecute.mockReset();
  runtimeExecute.mockResolvedValue({ providers: [] });
  fetchModelsForProvider.mockReset();
});

afterEach(() => {
  cleanup();
  act(() => useWorkspaceStore.setState({ language: 'zho' }));
});

describe('SettingsPanel locale', () => {
  it('switches the empty service state through the active workspace locale', () => {
    render(<SettingsLocaleFixture />);

    expect(screen.getByText('还没有配置 AI 服务')).toBeInTheDocument();
    act(() => useWorkspaceStore.getState().setLanguage('en'));

    expect(screen.getByText('No AI service configured yet')).toBeInTheDocument();
    expect(screen.queryByText('还没有配置 AI 服务')).not.toBeInTheDocument();
  });

  it('renders the English service dialog with translated labels and accessible naming', async () => {
    useWorkspaceStore.setState({ language: 'en' });
    render(<SettingsLocaleFixture />);
    await waitFor(() => expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({ command: 'provider.status' })));

    fireEvent.click(screen.getByRole('button', { name: '+ Add AI service' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an AI service' });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close API key form' })).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('Enter the API key here; other fields can be filled automatically')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '🔄 Get models' })).toBeDisabled();
    expect(within(dialog).getByText('OpenAI-compatible endpoint')).toBeInTheDocument();
    expect(within(dialog).queryByText('常用 AI 服务')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('价格规则')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('预算策略')).not.toBeInTheDocument();
  });

  it('renders the Chinese service dialog with translated labels and accessible naming', async () => {
    render(<SettingsLocaleFixture />);
    await waitFor(() => expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({ command: 'provider.status' })));

    fireEvent.click(screen.getByRole('button', { name: '+ 添加 AI 服务' }));
    const dialog = await screen.findByRole('dialog', { name: '添加新的 AI 服务' });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: '关闭 API Key 表单' })).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('只需要在这里填写 API Key，下方配置可自动填充')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '🔄 获取模型' })).toBeDisabled();
  });

  it('localizes error framing while preserving provider errors and user service names', async () => {
    useWorkspaceStore.setState({ language: 'en' });
    fetchModelsForProvider.mockResolvedValue({ ok: false, error: 'Provider quota response: retry after 20 seconds' });
    const userService: UserApiKey = {
      id: 'private-service',
      name: 'My private endpoint',
      provider: 'custom',
      key: 'test-key',
      capabilities: ['text'],
      models: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(<SettingsLocaleFixture userApiKeys={[userService]} />);
    await waitFor(() => expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({ command: 'provider.status' })));

    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('My private endpoint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Add AI service' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an AI service' });
    fireEvent.change(within(dialog).getByLabelText('API key'), { target: { value: 'test-key' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '🔄 Get models' }));

    expect(await within(dialog).findByText(/Could not fetch models: Provider quota response: retry after 20 seconds/)).toBeInTheDocument();
    expect(within(dialog).getByText(/You can add a model manually/)).toBeInTheDocument();
  });
});
