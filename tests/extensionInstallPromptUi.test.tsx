// 插件引导卡片：未安装时显示安装入口，"不再提醒"后隐藏；已配对且支持直连时不显示。
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

const bridgeState = { status: 'not-installed', extensionId: null, extensionVersion: null, capabilities: [] as string[] };
const listeners = new Set<() => void>();
const fakeBridge = {
  getState: () => bridgeState,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  connect: vi.fn(async () => bridgeState),
  supports: (capability: string) => bridgeState.status === 'approved' && bridgeState.capabilities.includes(capability),
  openChannel: () => null,
};
vi.mock('../services/extensionBridge', () => ({ getExtensionBridge: () => fakeBridge }));

const { ExtensionInstallPrompt } = await import('../components/extension/ExtensionInstallPrompt');
const { getExtensionPromptStore, PROMPT_DISMISS_KEY } = await import('../services/extensionInstallPrompt');

const t = (key: string) => key.split('.').pop() || key;

afterEach(() => {
  localStorage.removeItem(PROMPT_DISMISS_KEY);
});

describe('ExtensionInstallPrompt', () => {
  it('appears only once a reason exists, offers install, and hides for good on "never"', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ExtensionInstallPrompt isDark={false} t={t} />);
    expect(screen.queryByTestId('extension-install-prompt')).toBeNull();
    act(() => getExtensionPromptStore().note('configured'));
    expect(screen.getByTestId('extension-install-prompt')).toBeTruthy();
    fireEvent.click(screen.getByText('install'));
    expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\//), '_blank', 'noopener,noreferrer');
    fireEvent.click(screen.getByText('never'));
    expect(screen.queryByTestId('extension-install-prompt')).toBeNull();
    expect(localStorage.getItem(PROMPT_DISMISS_KEY)).toBe('1');
  });
});
