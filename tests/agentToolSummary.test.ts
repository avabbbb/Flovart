import { describe, expect, it } from 'vitest';
import { formatToolDuration, joinNames, sanitizeToolDetail, summarizeToolCall, toolRawText, toolStepsHeadline } from '../components/agent/agentToolSummary';

const BASE64 = 'iVBORw0KGgo'.repeat(60);

describe('summarizeToolCall', () => {
  it('summarizes media view with node names and thumbnails instead of base64', () => {
    const result = {
      content: [
        { type: 'text', text: 'xgZX1A9hlQEVpH09HVyvC：图片「图片1」\nTnWR-nVGbUzNCgi6Z1VNi：图片「图片2」\nF_KX2：视频「片段」帧 first/last\nwNhN：图片「图片3」' },
        { type: 'image', mimeType: 'image/jpeg', data: BASE64 },
        { type: 'image', data: BASE64 },
      ],
    };
    const summary = summarizeToolCall({ toolName: 'flovart_workflow_media_view', args: { nodeIds: ['a', 'b', 'c', 'd'] }, result, status: 'success' });
    expect(summary.text).toBe('读取了 4 个节点：图片1、图片2、片段、图片3');
    expect(summary.thumbnails).toEqual([
      { src: 'data:image/jpeg;base64,' + BASE64, alt: '图片1' },
      { src: 'data:image/png;base64,' + BASE64, alt: '图片2' },
    ]);
    expect(summary.text).not.toContain('xgZX1A9hlQEVpH09HVyvC');
  });

  it('describes pending media view by node count', () => {
    expect(summarizeToolCall({ toolName: 'flovart_workflow_media_view', args: { nodeIds: ['a', 'b'] }, status: 'pending' }).text).toBe('查看 2 个节点的画面');
    expect(summarizeToolCall({ toolName: 'flovart_workflow_media_view', args: { nodeIds: ['a'] }, status: 'pending', language: 'en' }).text).toBe('Viewing 1 node');
  });

  it('counts nodes and links from an inspect result', () => {
    const text = JSON.stringify({ revision: 3, nodes: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }], edges: [{}] });
    expect(summarizeToolCall({ toolName: 'flovart_workflow_inspect', result: { content: [{ type: 'text', text }] }, status: 'success' }).text).toBe('读取了画布：2 个节点、1 条连线');
    expect(summarizeToolCall({ toolName: 'flovart_workflow_selection_get', result: text, status: 'success' }).text).toBe('读取了 2 个选中节点：A、B');
  });

  it('summarizes ask answers and pending ask', () => {
    expect(summarizeToolCall({ toolName: 'flovart_ask', status: 'pending' }).text).toBe('请在下方表单里回答');
    const result = { content: [{ type: 'text', text: '{"ok":true,"data":{"pair":"5+10","bg":["keep","warm"]}}' }] };
    expect(summarizeToolCall({ toolName: 'flovart_ask', result, status: 'success' }).text).toBe('你的回答：5+10；keep / warm');
  });

  it('uses the first error line for failures', () => {
    const summary = summarizeToolCall({ toolName: 'flovart_workflow_node_run', result: { content: [{ type: 'text', text: '\n生成失败：429\n详情…' }] }, status: 'error' });
    expect(summary.text).toBe('生成失败：429');
    expect(summarizeToolCall({ toolName: 'x', status: 'denied' }).text).toBe('已拒绝执行');
  });

  it('describes searches, todo and apply from their args', () => {
    expect(summarizeToolCall({ toolName: 'flovart_web_search', args: { query: '秋天公园 参考' }, status: 'success' }).text).toBe('搜索「秋天公园 参考」');
    expect(summarizeToolCall({ toolName: 'flovart_grep', args: { pattern: 'TODO' }, status: 'success', language: 'en' }).text).toBe('Searched “TODO”');
    expect(summarizeToolCall({ toolName: 'flovart_todo', args: { todos: [1, 2, 3] }, status: 'success' }).text).toBe('更新了 3 项任务');
    expect(summarizeToolCall({ toolName: 'flovart_workflow_apply', args: { operations: [1] }, status: 'success', language: 'en' }).text).toBe('Applied 1 change');
  });

  it('hides JSON results of unknown tools but keeps plain first lines', () => {
    expect(summarizeToolCall({ toolName: 'plugin_x', result: '{"a":1}', status: 'success' }).text).toBe('');
    expect(summarizeToolCall({ toolName: 'plugin_x', result: '已导入 3 个素材\n更多', status: 'success' }).text).toBe('已导入 3 个素材');
  });
});

describe('sanitizeToolDetail / toolRawText', () => {
  it('truncates base64, data URLs and long strings; collapses image blocks', () => {
    const value = sanitizeToolDetail({
      image: { type: 'image', mimeType: 'image/png', data: BASE64 },
      url: 'data:image/png;base64,' + BASE64,
      blob: BASE64,
      long: '字'.repeat(300),
      short: 'ok',
      list: Array.from({ length: 45 }, (_, index) => index),
    }) as Record<string, unknown>;
    expect(value.image).toEqual({ type: 'image', mimeType: 'image/png', data: '[图片数据 · 1 KB]' });
    expect(value.url).toBe('[image/png 数据 · 1 KB]');
    expect(value.blob).toBe('[二进制数据 · 1 KB]');
    expect(String(value.long)).toMatch(/…（另有 60 字）$/);
    expect(value.short).toBe('ok');
    expect((value.list as unknown[]).length).toBe(41);
  });

  it('caps nesting depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(sanitizeToolDetail(deep))).toContain('{…}');
  });

  it('labels args and result sections', () => {
    const text = toolRawText({ nodeIds: ['n1'] }, { content: [{ type: 'image', data: BASE64 }] });
    expect(text).toContain('"参数"');
    expect(text).toContain('"结果"');
    expect(text).not.toContain(BASE64);
  });
});

describe('formatting helpers', () => {
  it('formats durations like the boot sequence rows', () => {
    expect(formatToolDuration(180)).toBe('180ms');
    expect(formatToolDuration(1260)).toBe('1.2s');
    expect(formatToolDuration(65_000)).toBe('1m 05s');
    expect(formatToolDuration(undefined)).toBe('');
  });

  it('joins names with a cap', () => {
    expect(joinNames(['a', 'b', 'a'])).toBe('a、b');
    expect(joinNames(['1', '2', '3', '4', '5', '6'])).toBe('1、2、3、4 等 6 个');
    expect(joinNames(['1', '2', '3', '4', '5'], 'en')).toBe('1, 2, 3, 4 and 1 more');
  });

  it('builds the steps headline from real statuses only', () => {
    expect(toolStepsHeadline(['success', 'pending'], true)).toEqual({ count: '2 个步骤', state: '执行中', tone: 'active' });
    expect(toolStepsHeadline(['success', 'pending'], false).state).toBe('未完成');
    expect(toolStepsHeadline(['success', 'error'], false)).toMatchObject({ state: '1 个失败', tone: 'error' });
    expect(toolStepsHeadline(['success'], false, 'en')).toEqual({ count: '1 step', state: 'Done', tone: 'done' });
  });
});
