import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import localforage from 'localforage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/localSkillRegistry', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/localSkillRegistry')>();
  return { ...actual, createLocalSkillRegistry: vi.fn(async () => null) };
});

import { StudioHub } from '../components/studio/StudioHub';
import type { StudioMediaItem } from '../components/studio/StudioMediaBrowser';
import { listBundledProductionSkills } from '../services/productionSkillCatalog';
import { useSkillHubStore } from '../stores/useSkillHubStore';
import { HISTORY_FAVORITES_KEY, useStudioHubStore } from '../stores/useStudioHubStore';
import { useUserSkillsStore } from '../stores/useUserSkillsStore';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const items: StudioMediaItem[] = [
  { id: 'history:a', source: 'history', sourceId: 'a', name: 'A', href: PIXEL, mimeType: 'image/png', type: 'image', prompt: '雨夜霓虹', createdAt: 2 },
  { id: 'history:b', source: 'history', sourceId: 'b', name: 'B', href: PIXEL, mimeType: 'image/png', type: 'video', prompt: '海边日落', createdAt: 1 },
];

beforeEach(async () => {
  await localforage.removeItem(HISTORY_FAVORITES_KEY);
  useStudioHubStore.setState({ open: false, hub: 'skills', section: null, sidebarCollapsed: false, handlers: {}, historyFavorites: new Set(), historyFavoritesLoaded: false });
  useUserSkillsStore.setState({ skills: [], disabledIds: new Set(), favoriteIds: new Set(), loaded: true });
  useSkillHubStore.setState({ hubUrl: '', hubSkills: [], localSkills: [], registryStatus: 'unavailable', refreshLocal: vi.fn(async () => undefined) });
});

describe('StudioHub window', () => {
  it('renders nothing until opened, then switches Skills / History / Library from the sidebar', async () => {
    render(<StudioHub language="zho" historyItems={items} onRemoveHistory={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useStudioHubStore.getState().openHub('skills', 'all'));
    const dialog = await screen.findByRole('dialog', { name: '资源窗口' });
    const bundled = listBundledProductionSkills()[0];
    if (bundled) expect(within(dialog).getByText(bundled.displayName)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '历史' }));
    expect(await within(dialog).findByRole('heading', { name: /历史/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '素材库' }));
    expect(useStudioHubStore.getState().hub).toBe('library');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStudioHubStore.getState().open).toBe(false);
  });

  it('history: tabs filter, favourite persists, insert goes through the registered canvas handler, delete asks first', async () => {
    const onRemove = vi.fn();
    const insert = vi.fn();
    useStudioHubStore.getState().register('insertHistory', insert);
    render(<StudioHub language="zho" historyItems={items} onRemoveHistory={onRemove} />);
    act(() => useStudioHubStore.getState().openHub('history', null));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: /^插入画布/ })).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('tab', { name: '视频' }));
    expect(within(dialog).getAllByRole('button', { name: /^插入画布/ })).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('tab', { name: '全部' }));

    fireEvent.click(within(dialog).getAllByRole('button', { name: '收藏' })[0]);
    await waitFor(async () => expect(await localforage.getItem(HISTORY_FAVORITES_KEY)).toEqual(['history:a']));
    fireEvent.click(within(dialog).getByRole('tab', { name: '收藏' }));
    expect(within(dialog).getAllByRole('button', { name: /^插入画布/ })).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('tab', { name: '全部' }));

    fireEvent.click(within(dialog).getByRole('button', { name: '插入画布 A' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'history:a' }));

    fireEvent.click(within(dialog).getByRole('button', { name: '删除 A' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(within(dialog).getByRole('alertdialog')).getByRole('button', { name: '删除' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('Skills: “Use” attaches through the composer handler and is disabled when no composer is mounted', async () => {
    const bundled = listBundledProductionSkills()[0];
    if (!bundled) return;
    render(<StudioHub language="zho" historyItems={[]} onRemoveHistory={vi.fn()} />);
    act(() => useStudioHubStore.getState().openHub('skills', 'all'));
    const dialog = await screen.findByRole('dialog');
    const useButton = within(dialog).getAllByRole('button', { name: '使用' })[0] as HTMLButtonElement;
    expect(useButton.disabled).toBe(true);
    const attach = vi.fn();
    act(() => { useStudioHubStore.getState().register('attachSkill', attach); });
    await waitFor(() => expect((within(dialog).getAllByRole('button', { name: '使用' })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(dialog).getAllByRole('button', { name: '使用' })[0]);
    await waitFor(() => expect(attach).toHaveBeenCalledWith(expect.objectContaining({ id: bundled.id })));
  });
});
