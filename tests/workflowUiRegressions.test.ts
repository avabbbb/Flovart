import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 源码级回归：这些缺陷都出在接线/样式层，完整渲染 InfiniteWorkflow 成本过高。
const read = (path: string) => readFileSync(path, 'utf8');

describe('workflow UI regressions', () => {
  it('node toolbar resolves media through artifactRef so generated videos keep frame tools', () => {
    const src = read('components/workflow/WorkflowNodeToolbar.tsx');
    expect(src).toMatch(/useWorkflowMediaUrl\(\s*media\?\.metadata\.storageKey,\s*media\?\.metadata\.href,\s*media\?\.metadata\.artifactRef,?\s*\)/);
  });

  it('focus-selection action uses the Focus icon, not the frame icon', () => {
    const src = read('components/workflow/WorkflowNodeToolbar.tsx');
    // 第一处“聚焦”是 props 注释；以图标为锚点，确认它属于聚焦选中动作。
    const at = src.indexOf('icon: <Focus size={18} />');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 400), at + 400)).toMatch(/聚焦|onFrameSelection/);
    expect(src).not.toMatch(/聚焦选中[^\n]{0,200}<Frame size=\{18\}/);
  });

  it('clicking a group label selects every node in the group', () => {
    const src = read('components/workflow/InfiniteWorkflow.tsx');
    const start = src.indexOf('startBatchDrag');
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, start + 4000)).toMatch(/selectNodes\(batchNodes\.map\(item => item\.id\)\)/);
  });

  it('agent send icon does not inherit the transparent --agent-panel used by docked panels', () => {
    const css = read('styles/agentPanelLibtv.css');
    const rule = css.match(/\.agent-conversation \.agent-composer__send\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color:var(--isl-card)!important');
  });
});
