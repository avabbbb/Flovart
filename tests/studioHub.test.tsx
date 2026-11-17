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
import { SKILL_ORDER_KEY } from '../components/studio/skillOrder';
import { AgentTodoCard } from '../components/agent/AgentTodoCard';

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

  it('Skills: Alt + arrow keys reorder the cards, the order persists to localStorage, and a recipe Skill shows its steps as a plan', async () => {
    localStorage.removeItem(SKILL_ORDER_KEY);
    const now = new Date().toISOString();
    useUserSkillsStore.setState({
      skills: [
        { id: 'u1', name: '甲 Skill', slug: 'jia', description: '第一个', prompt: 'p', createdAt: now, updatedAt: '2026-01-02', enabled: true },
        { id: 'u2', name: '乙 Skill', slug: 'yi', description: '第二个', prompt: 'p', createdAt: now, updatedAt: '2026-01-01', enabled: true,
          recipe: { steps: [{ nodeId: 'n1', type: 'image', title: '主图', model: 'image-g-2', prompt: '雨夜霓虹', params: {}, inputs: [] }, { nodeId: 'n2', type: 'video', title: '短片', params: {}, inputs: [] }], layout: { columns: 2 } } },
      ] as never,
      loaded: true,
    });
    render(<StudioHub language="zho" historyItems={[]} onRemoveHistory={vi.fn()} />);
    act(() => useStudioHubStore.getState().openHub('skills', 'mine'));
    const dialog = await screen.findByRole('dialog');
    const names = () => within(dialog).getAllByRole('button', { name: /^查看 .* 详情$/ }).map(button => button.getAttribute('aria-label'));
    await waitFor(() => expect(names()).toEqual(['查看 甲 Skill 详情', '查看 乙 Skill 详情']));
    const second = within(dialog).getByRole('button', { name: '查看 乙 Skill 详情' });
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(names()).toEqual(['查看 乙 Skill 详情', '查看 甲 Skill 详情']));
    expect(JSON.parse(localStorage.getItem(SKILL_ORDER_KEY) || '[]').slice(0, 2)).toEqual(['mine:u2', 'mine:u1']);
    expect(within(dialog).getByRole('button', { name: /自定义/ })).toBeTruthy();
    expect(within(dialog).getByRole('status', { name: '' }).textContent || '').toContain('已移到第 1 位');

    fireEvent.click(within(dialog).getByRole('button', { name: '查看 乙 Skill 详情' }));
    const plan = await within(dialog).findByRole('region', { name: '这个 Skill 会做什么' });
    expect(plan).toHaveTextContent('2 个步骤');
    expect(plan).toHaveTextContent('主图');
    fireEvent.click(within(plan).getByRole('button', { name: /主图/ }));
    expect(plan).toHaveTextContent('雨夜霓虹');
    expect(plan).toHaveTextContent('图片 · image-g-2');
    localStorage.removeItem(SKILL_ORDER_KEY);
  });

  it('todo card uses the shared plan layout: step count, status pills and the current step expanded', () => {
    render(<AgentTodoCard language="zho" items={[
      { id: '1', content: '读取参考图', status: 'done' },
      { id: '2', content: '拆分分镜', status: 'active', note: '每镜 3 秒' },
      { id: '3', content: '批量生成', status: 'pending' },
    ]} />);
    const card = screen.getByRole('region', { name: '执行计划' });
    expect(card).toHaveTextContent('3 个步骤');
    expect(card).toHaveTextContent('执行中');
    expect(card).toHaveTextContent('每镜 3 秒');
    expect(within(card).getByText('完成')).toBeTruthy();
    expect(within(card).getByText('待执行')).toBeTruthy();
    expect(card).toHaveTextContent('正在执行第 2 步，共 3 步');
  });
});
