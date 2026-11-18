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
import { useWorkflowStore, createWorkflowProject } from '../components/workflow/store';
import { applyWorkflowDraftChangeSet } from '../components/workflow/draftAuthority';
import { createWorkflowNode } from '../components/workflow/constants';

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

  it('todo card uses the shared plan layout: heading, 待办 count, status words and the current step expanded', () => {
    render(<AgentTodoCard language="zho" items={[
      { id: '1', content: '读取参考图', status: 'done' },
      { id: '2', content: '拆分分镜', status: 'active', note: '每镜 3 秒' },
      { id: '3', content: '批量生成', status: 'pending' },
    ]} />);
    const card = screen.getByRole('region', { name: '执行计划' });
    expect(card).toHaveTextContent('待办3');
    expect(card).toHaveTextContent('执行中');
    expect(within(card).getByRole('heading', { name: '正在执行第 2 步，共 3 步' })).toBeTruthy();
    expect(card).toHaveTextContent('已完成 1 / 3');
    expect(card).toHaveTextContent('每镜 3 秒');
    expect(within(card).getByText('完成')).toBeTruthy();
    expect(within(card).getByText('待执行')).toBeTruthy();
    // 没有受阻步时不显示确认按钮
    expect(within(card).queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('todo card: a blocked step is expanded and offers 拒绝 / 确认 that report the step once', () => {
    const onDecide = vi.fn();
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: String(index + 1),
      content: index === 7 ? '付费生成链路（node_run）——等你确认，这一步会真实扣费并生成四张高清图' : `第 ${index + 1} 步：只读工具检查（inspect / selection / models / shortcut / list / search）`,
      status: index === 7 ? 'blocked' as const : 'done' as const,
      note: index === 7 ? '需用户确认费用' : undefined,
    }));
    const { rerender } = render(<AgentTodoCard language="zho" items={items} onDecideBlocked={onDecide} />);
    const card = screen.getByRole('region', { name: '执行计划' });
    expect(within(card).getByRole('heading', { name: '第 8 步等你确认' })).toBeTruthy();
    // 受阻行自动展开，说明可见；长标题单行省略，全文在 title 里
    expect(card).toHaveTextContent('需用户确认费用');
    expect(within(card).getByTitle(items[7].content)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '确认' }));
    expect(onDecide).toHaveBeenCalledWith(true, { index: 8, title: items[7].content });
    // 同一个受阻步只回复一次
    expect(within(card).queryByRole('button', { name: '确认' })).toBeNull();
    expect(card).toHaveTextContent('已回复，等 Agent 继续');
    // 清单变了（新的受阻步）再放开；拒绝走 false
    const next = items.map(item => item.id === '8' ? { ...item, content: '付费生成链路：改成两张' } : item);
    rerender(<AgentTodoCard language="zho" items={next} onDecideBlocked={onDecide} />);
    fireEvent.click(within(card).getByRole('button', { name: '拒绝' }));
    expect(onDecide).toHaveBeenLastCalledWith(false, { index: 8, title: '付费生成链路：改成两张' });
  });

  it('plan card shows 3 rows around the blocked step, then toggles 还有 N 项 / 收起', async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: String(index + 1),
      content: `步骤 ${index + 1}`,
      status: index === 7 ? 'blocked' as const : 'done' as const,
    }));
    render(<AgentTodoCard language="zho" items={items} onDecideBlocked={vi.fn()} />);
    const card = screen.getByRole('region', { name: '执行计划' });
    const rows = () => Array.from(card.querySelectorAll('.flv-plan__step-title')).map(item => item.textContent || '');
    expect(rows()).toEqual(['步骤 6', '步骤 7', '步骤 8']);
    const more = within(card).getByRole('button', { name: '还有 5 项' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(rows()).toHaveLength(8);
    const less = within(card).getByRole('button', { name: '收起' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    await waitFor(() => expect(rows()).toHaveLength(3));
  });
});

describe('StudioHub history Agent filter and Timeline', () => {
  it('history: the "Agent" sub-item (formerly 其它) shows only Agent-originated generations', async () => {
    const tagged: StudioMediaItem[] = [
      { ...items[0], origin: 'agent' },
      { ...items[1], origin: 'user' },
      { id: 'history:c', source: 'history', sourceId: 'c', name: 'C', href: PIXEL, mimeType: 'image/png', type: 'image', prompt: '外部', createdAt: 0, origin: 'external-agent' },
    ];
    render(<StudioHub language="zho" historyItems={tagged} onRemoveHistory={vi.fn()} />);
    act(() => useStudioHubStore.getState().openHub('history', null));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: '其它' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agent' }));
    expect(within(dialog).getAllByRole('button', { name: /^插入画布/ }).map(button => button.getAttribute('aria-label'))).toEqual(['插入画布 A', '插入画布 C']);
  });

  it('timeline: lists canvas changes as sentences with rev, selects with the keyboard and focuses nodes', async () => {
    let project = createWorkflowProject('镜头测试');
    const step = (actor: 'ui' | 'agent', ops: Parameters<typeof applyWorkflowDraftChangeSet>[1]['ops']) => {
      const result = applyWorkflowDraftChangeSet(project, { actor, intent: 'test', ops });
      if (result.ok === false) throw new Error(result.error.message);
      project = result.project;
    };
    step('ui', [{ type: 'add_node', node: { ...createWorkflowNode('n1', 'image', { x: 0, y: 0 }), title: '图片 1' } }]);
    step('agent', [{ type: 'update_node', id: 'n1', metadata: { prompt: '雨夜' } }]);
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const focus = vi.fn(() => true);
    useStudioHubStore.getState().register('focusNodes', focus);
    render(<StudioHub language="zho" historyItems={[]} onRemoveHistory={vi.fn()} />);
    act(() => useStudioHubStore.getState().openHub('timeline', project.id));
    const dialog = await screen.findByRole('dialog');
    const list = within(dialog).getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Agent 修改了「图片 1」的提示词');
    expect(options[0]).toHaveTextContent('rev 3');
    expect(options[1]).toHaveTextContent('你添加了图片节点「图片 1」');
    expect(within(dialog).getByText('今天')).toBeTruthy();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: '定位节点' }));
    expect(focus).toHaveBeenCalledWith(project.id, ['n1']);
    expect(useStudioHubStore.getState().open).toBe(false);
  });

  it('timeline: restoring asks first, saves a safety snapshot and commits one undoable change', async () => {
    let project = createWorkflowProject('恢复测试');
    const step = (ops: Parameters<typeof applyWorkflowDraftChangeSet>[1]['ops']) => {
      const result = applyWorkflowDraftChangeSet(project, { actor: 'ui', intent: 'test', ops });
      if (result.ok === false) throw new Error(result.error.message);
      project = result.project;
    };
    step([{ type: 'add_node', node: { ...createWorkflowNode('n1', 'image', { x: 0, y: 0 }), title: '图片 1' } }]);
    step([{ type: 'add_node', node: { ...createWorkflowNode('n2', 'image', { x: 400, y: 0 }), title: '图片 2' } }]);
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    render(<StudioHub language="zho" historyItems={[]} onRemoveHistory={vi.fn()} />);
    act(() => useStudioHubStore.getState().openHub('timeline', project.id));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('你添加了图片节点「图片 1」'));
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复到此版本' }));
    const confirm = within(dialog).getByRole('alertdialog');
    expect(confirm).toHaveTextContent('把画布恢复到 rev 2？');
    expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(2);
    fireEvent.click(within(confirm).getByRole('button', { name: '恢复' }));
    const restored = useWorkflowStore.getState().projects[0];
    expect(restored.nodes.map(node => node.id)).toEqual(['n1']);
    expect(restored.snapshots?.at(-1)?.name).toBe('恢复前 · rev 3');
    expect(restored.snapshots?.at(-1)?.nodes).toHaveLength(2);
    expect(restored.draftChangeSets?.at(-1)).toMatchObject({ actor: 'ui', intent: '恢复到 rev 2', status: 'completed' });
    expect(await within(dialog).findByText('你把画布恢复到 rev 2')).toBeTruthy();
  });
});
