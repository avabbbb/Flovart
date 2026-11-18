import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentAskCard } from '../components/agent/AgentAskCard';
import { AgentConfirmCard } from '../components/agent/AgentConfirmCard';
import { AGENT_ASK_SKIPPED, buildAgentAskForm, type AgentAskForm } from '../components/agent/agentAskForm';
import { blockedTodoAction } from '../components/agent/agentTodo';
import { planWindow } from '../components/agent/plan/PlanSteps';
import { clampDrawerWidth } from '../components/studio/StudioRightDrawer';

function form(): AgentAskForm {
  const result = buildAgentAskForm({
    title: '开拍前确认',
    questions: [
      { id: 'auth', question: '用哪种鉴权？', options: [{ label: 'Session cookies' }, { label: 'JWT bearer' }, { label: 'OAuth only' }] },
      { id: 'flag', question: '要不要灰度？', options: [{ label: '要，逐步放量' }, { label: '不要，全量' }] },
      { id: 'extras', question: '附加项', type: 'multi', options: [{ label: '字幕' }, { label: '配乐' }], required: false },
    ],
  });
  if (!result.ok) throw new Error('bad form');
  return result.form;
}

describe('Questions card (flovart_ask)', () => {
  it('one question per page, letter badges, letter keys pick, Enter continues, pager and submit through collectAgentAskAnswers', () => {
    const onSubmit = vi.fn();
    render(<AgentAskCard form={form()} language="zho" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const card = screen.getByTestId('agent-ask');
    expect(card).toHaveTextContent('用哪种鉴权？');
    expect(card).not.toHaveTextContent('要不要灰度？');
    expect(within(card).getByRole('group', { name: '第 1 题，共 3 题' })).toHaveTextContent('1/3');
    const options = within(card).getAllByRole('radio');
    expect(options.map(option => option.querySelector('kbd')?.textContent)).toEqual(['A', 'B', 'C']);
    // 最后一行「其他…」是输入框，键帽 D
    const otherInput = within(card).getByRole('textbox', { name: '你自己的答案' });
    expect(otherInput.closest('label')?.querySelector('kbd')?.textContent).toBe('D');

    const proceed = within(card).getByRole('button', { name: '继续' });
    expect(proceed).toBeDisabled();
    // Enter 在没有答案时不前进
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card).toHaveTextContent('用哪种鉴权？');

    fireEvent.keyDown(card, { key: 'b' });
    expect(within(card).getByRole('radio', { name: /JWT bearer/ })).toHaveAttribute('aria-checked', 'true');
    expect(proceed).toBeEnabled();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card).toHaveTextContent('要不要灰度？');
    expect(within(card).getByRole('group', { name: '第 2 题，共 3 题' })).toBeTruthy();

    // ^ 回到上一题，答案还在
    fireEvent.click(within(card).getByRole('button', { name: '上一题' }));
    expect(within(card).getByRole('radio', { name: /JWT bearer/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(card).getByRole('button', { name: '下一题' }));

    // 字母 C 选「其他」：聚焦输入框，输入自定义答案
    fireEvent.keyDown(card, { key: 'C' });
    const other2 = within(card).getByRole('textbox', { name: '你自己的答案' });
    expect(document.activeElement).toBe(other2);
    fireEvent.change(other2, { target: { value: '只给内部用户' } });
    fireEvent.keyDown(other2, { key: 'Enter' });

    // 第 3 题多选：字母切换；跳过最后一题 = 不作答并提交
    expect(card).toHaveTextContent('附加项');
    fireEvent.keyDown(card, { key: 'a' });
    expect(within(card).getByRole('checkbox', { name: /字幕/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(card, { key: 'a' });
    expect(within(card).getByRole('checkbox', { name: /字幕/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(card).getByRole('button', { name: '跳过' }));
    expect(onSubmit).toHaveBeenCalledWith({ auth: 'JWT bearer', extras: AGENT_ASK_SKIPPED, flag: '只给内部用户' });
  });

  it('arrow keys move the highlight (wrapping) and Esc cancels', () => {
    const onCancel = vi.fn();
    render(<AgentAskCard form={form()} language="zho" onSubmit={vi.fn()} onCancel={onCancel} />);
    const card = screen.getByTestId('agent-ask');
    const radios = within(card).getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('data-active');
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1], { key: 'ArrowUp' });
    fireEvent.keyDown(radios[0], { key: 'ArrowUp' });
    // 回绕到最后一行「其他…」
    expect(document.activeElement).toBe(within(card).getByRole('textbox', { name: '你自己的答案' }));
    // Enter 在没有答案的选项行上 = 选中它
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    fireEvent.keyDown(radios[0], { key: 'Enter' });
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('skipping a required question answers it as skipped and submits', () => {
    const onSubmit = vi.fn();
    const result = buildAgentAskForm({ questions: [{ id: 'a', question: '第一题', options: [{ label: '甲' }, { label: '乙' }] }] });
    if (!result.ok) throw new Error('bad form');
    render(<AgentAskCard form={result.form} language="zho" onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(onSubmit).toHaveBeenCalledWith({ a: AGENT_ASK_SKIPPED });
  });
});

describe('Approval card (AgentConfirmCard)', () => {
  it('Enter on the card does not approve; only the primary approves; Esc denies', () => {
    const onDecide = vi.fn();
    render(<AgentConfirmCard summary="删除 2 个节点" nodes={[]} language="zho" mandateTasks={3} onMandateTasksChange={vi.fn()} onDecide={onDecide} />);
    const card = screen.getByRole('alertdialog', { name: 'Agent 请求确认' });
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onDecide).not.toHaveBeenCalled();
    const allow = within(card).getByRole('button', { name: '本次允许' });
    expect(allow.querySelector('kbd')?.textContent).toBe('⏎');
    fireEvent.click(allow);
    expect(onDecide).toHaveBeenLastCalledWith(true, 'once');
    fireEvent.click(within(card).getByRole('button', { name: '拒绝' }));
    expect(onDecide).toHaveBeenLastCalledWith(false, 'once');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onDecide).toHaveBeenCalledTimes(3);
  });
});

describe('blocked todo wiring', () => {
  const messages = { confirm: '确认，继续执行第 8 步：付费生成', skip: '不用，跳过第 8 步' };
  it('approves / rejects a pending tool confirmation', () => {
    expect(blockedTodoAction({ isRunPlan: false }, true, messages)).toEqual({ kind: 'confirm', approved: true });
    expect(blockedTodoAction({ isRunPlan: false }, false, messages)).toEqual({ kind: 'confirm', approved: false });
  });
  it('maps a pending run plan to auto / adjust', () => {
    expect(blockedTodoAction({ isRunPlan: true }, true, messages)).toEqual({ kind: 'run-plan', decision: 'auto' });
    expect(blockedTodoAction({ isRunPlan: true }, false, messages)).toEqual({ kind: 'run-plan', decision: 'adjust' });
  });
  it('sends a reply when nothing is pending', () => {
    expect(blockedTodoAction(null, true, messages)).toEqual({ kind: 'send', text: messages.confirm });
    expect(blockedTodoAction(undefined, false, messages)).toEqual({ kind: 'send', text: messages.skip });
  });
});

describe('layout helpers', () => {
  it('plan window keeps the focus row visible and shows everything when only one would hide', () => {
    expect(planWindow(8, 7, 3)).toEqual({ start: 5, end: 8 });
    expect(planWindow(8, 0, 3)).toEqual({ start: 0, end: 3 });
    expect(planWindow(8, 4, 3)).toEqual({ start: 3, end: 6 });
    expect(planWindow(8, -1, 3)).toEqual({ start: 0, end: 3 });
    expect(planWindow(4, 3, 3)).toEqual({ start: 0, end: 4 });
  });
  it('drawer width is clamped to the available viewport space while dragging', () => {
    expect(clampDrawerWidth(900, 280, 640, 1200)).toBe(640);
    expect(clampDrawerWidth(600, 280, 640, 500)).toBe(500);
    expect(clampDrawerWidth(100, 280, 640, 500)).toBe(280);
    expect(clampDrawerWidth(400, 280, 640, 240)).toBe(240);
  });
});
