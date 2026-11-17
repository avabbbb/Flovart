import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { StudioTopMenu, type StudioMenuModel } from '../components/studio/StudioTopMenu';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoggedIn: false }),
}));

const menuModel = (mode: 'workflow' | 'agent'): StudioMenuModel => ({
  mode,
  title: mode === 'workflow' ? 'Workflow project' : 'Agent',
  themeMode: 'light',
  resolvedTheme: 'light',
  language: 'zho',
  status: {
    tone: 'warning',
    label: 'API 2/3',
    detail: '视频生成尚未配置',
  },
  actions: {
    changeMode: vi.fn(),
    setThemeMode: vi.fn(),
    toggleLanguage: vi.fn(),
    openSettings: vi.fn(),
  },
});

describe('shared studio shell', () => {
  it.each(['workflow', 'agent'] as const)('uses the same menu model in %s mode', mode => {
    const model = menuModel(mode);
    render(<MemoryRouter><StudioTopMenu model={model} /></MemoryRouter>);

    expect(screen.getAllByText(model.title).length).toBeGreaterThan(0);
    expect(screen.getByText('API 2/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(model.actions.openSettings).toHaveBeenCalledOnce();
  });

  it.each(['zho', 'en'] as const)('names the second top-level tab Iris and keeps it marked as coming soon (%s)', language => {
    render(<MemoryRouter><StudioTopMenu model={{ ...menuModel('workflow'), language }} /></MemoryRouter>);
    const tabs = screen.getAllByRole('tab').map(tab => tab.textContent);
    expect(tabs).toEqual(language === 'zho' ? ['画布', 'Iris优化中', 'Agent'] : ['Canvas', 'IrisSoon', 'Agent']);
    expect(tabs.join(' ')).not.toMatch(/逆向|Reverse/);
  });
});
