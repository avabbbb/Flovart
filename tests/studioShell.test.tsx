import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StudioTopMenu, type StudioMenuModel } from '../components/studio/StudioTopMenu';
import { Toolbar } from '../components/Toolbar';

const menuModel = (mode: 'canvas' | 'workflow'): StudioMenuModel => ({
  mode,
  title: mode === 'canvas' ? 'Canvas board' : 'Workflow project',
  theme: 'light',
  language: 'zho',
  status: {
    tone: 'warning',
    label: 'API 2/3',
    detail: '视频生成尚未配置',
  },
  actions: {
    changeMode: vi.fn(),
    toggleTheme: vi.fn(),
    toggleLanguage: vi.fn(),
    openSettings: vi.fn(),
  },
});

const toolbarProps = {
  t: (key: string) => key,
  theme: 'light' as const,
  compactScale: 1,
  topOffset: 0,
  leftClosed: 0,
  leftOpen: 0,
  activeTool: 'select' as const,
  setActiveTool: vi.fn(),
  drawingOptions: { strokeColor: '#111827', strokeWidth: 4 },
  setDrawingOptions: vi.fn(),
  onUpload: vi.fn(),
  onConfirmCrop: vi.fn(),
  onCancelCrop: vi.fn(),
  onSettingsClick: vi.fn(),
  onLayersClick: vi.fn(),
  onBoardsClick: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
};

describe('shared studio shell', () => {
  it.each(['canvas', 'workflow'] as const)('uses the same menu model in %s mode', mode => {
    const model = menuModel(mode);
    render(<StudioTopMenu model={model} />);

    expect(screen.getByText(model.title)).toBeTruthy();
    expect(screen.getByText('API 2/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(model.actions.openSettings).toHaveBeenCalledOnce();
  });

  it('keeps embedded crop controls interactive', () => {
    render(<Toolbar {...toolbarProps} isCropping orientation="horizontal" embedded />);

    const controls = screen.getByTestId('canvas-crop-controls');
    expect(controls.className).toContain('pointer-events-auto');
    fireEvent.click(screen.getByRole('button', { name: 'toolbar.crop.confirm' }));
    expect(toolbarProps.onConfirmCrop).toHaveBeenCalledOnce();
  });

  it('does not clip horizontal tool-group popovers inside a scroll box', () => {
    render(<Toolbar {...toolbarProps} isCropping={false} orientation="horizontal" embedded />);

    const toolbar = screen.getByTestId('canvas-toolbar');
    expect(toolbar.className).toContain('flex-wrap');
    expect(toolbar.className).not.toContain('overflow-x-auto');
  });
});
