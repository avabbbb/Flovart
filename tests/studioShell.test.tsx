import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { StudioTopMenu, type StudioMenuModel } from '../components/studio/StudioTopMenu';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoggedIn: false }),
}));

const menuModel = (): StudioMenuModel => ({
  title: 'Workflow project',
  themeMode: 'light',
  resolvedTheme: 'light',
  language: 'zho',
  status: {
    tone: 'warning',
    label: 'API 2/3',
    detail: '视频生成尚未配置',
  },
  actions: {
    setThemeMode: vi.fn(),
    toggleLanguage: vi.fn(),
    openSettings: vi.fn(),
  },
});

describe('shared studio shell', () => {
  it('renders the shared menu model and routes settings through it', () => {
    const model = menuModel();
    render(<MemoryRouter><StudioTopMenu model={model} /></MemoryRouter>);

    expect(screen.getAllByText(model.title).length).toBeGreaterThan(0);
    expect(screen.getByText('API 2/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(model.actions.openSettings).toHaveBeenCalledOnce();
  });
});
