import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStoredZip, crc32, executeWorkflowExport, planWorkflowExport, safeExportName, scriptShotsToCsv, WorkflowExportError } from '../components/workflow/nodeExport';
import { createWorkflowDispatcher } from '../services/workflowDispatcher';
import { useWorkflowStore } from '../components/workflow/store';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';

const node = (id: string, type: string, title: string, metadata: Record<string, unknown> = {}, extra: Partial<WorkflowNode> = {}) =>
  ({ id, type, title, position: { x: 0, y: 0 }, width: 100, height: 100, metadata, ...extra }) as WorkflowNode;

const project = (): WorkflowProject => ({
  id: 'p1', title: '短片', selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 }, connections: [],
  nodes: [
    node('img', 'image', '主角/定妆', { storageKey: 'k-img', mimeType: 'image/png' }, { batchId: 'g1', batchIndex: 0 }),
    node('vid', 'video', '镜头 1', { storageKey: 'k-vid', mimeType: 'video/mp4' }, { batchId: 'g1', batchIndex: 1 }),
    node('dup', 'image', '镜头 1', { href: 'https://cdn/x.jpg', mimeType: 'image/jpeg' }),
    node('note', 'text', '备注', { content: 'hi' }, { batchId: 'g1', batchIndex: 2 }),
    node('empty', 'image', '空图', {}),
    node('script', 'script', '分镜', { scriptBreakdown: { assets: [], shots: [
      { id: 's2', index: 2, action: '他说"走"，转身', durationSec: 3 },
      { id: 's1', index: 1, scene: '雨夜, 街口', camera: '推镜' },
    ] } }),
  ],
} as unknown as WorkflowProject);

describe('planWorkflowExport', () => {
  it('exports a single media node as its original file named after the node', () => {
    const plan = planWorkflowExport(project(), { nodeIds: ['img'] });
    expect(plan.mode).toBe('single');
    expect(plan.fileName).toBe('主角_定妆.png');
    expect(plan.entries[0]).toMatchObject({ kind: 'media', source: { storageKey: 'k-img' } });
  });

  it('zips several nodes, dedupes names and skips notes / empty nodes', () => {
    const plan = planWorkflowExport(project(), { nodeIds: ['vid', 'dup', 'note', 'empty', 'script'] });
    expect(plan.mode).toBe('zip');
    expect(plan.fileName).toBe('短片-导出.zip');
    expect(plan.entries.map(e => e.fileName)).toEqual(['镜头 1.mp4', '镜头 1.jpg', '分镜.csv']);
    expect(plan.skipped.map(s => s.nodeId)).toEqual(['note', 'empty']);
  });

  it('exports a group by batchId as a zip in batch order', () => {
    const plan = planWorkflowExport(project(), { groupId: 'g1', fileName: '定稿' });
    expect(plan).toMatchObject({ mode: 'zip', fileName: '定稿.zip' });
    expect(plan.entries.map(e => e.nodeId)).toEqual(['img', 'vid']);
  });

  it('rejects ambiguous, missing or empty targets', () => {
    expect(() => planWorkflowExport(project(), {})).toThrow(WorkflowExportError);
    expect(() => planWorkflowExport(project(), { nodeIds: ['img'], groupId: 'g1' })).toThrow('二选一');
    expect(() => planWorkflowExport(project(), { nodeIds: ['nope'] })).toThrow('节点不存在');
    expect(() => planWorkflowExport(project(), { groupId: 'zz' })).toThrow('分组不存在');
    expect(() => planWorkflowExport(project(), { nodeIds: ['note'] })).toThrow('没有可导出的内容');
  });

  it('safeExportName strips path characters', () => {
    expect(safeExportName('a/b:c*?.png')).toBe('a_b_c_.png');
    expect(safeExportName('   ')).toBe('node');
  });
});

describe('scriptShotsToCsv', () => {
  it('sorts by shot index, escapes quotes/commas and starts with a BOM', () => {
    const csv = scriptShotsToCsv([
      { id: 's2', index: 2, action: '他说"走"，转身', durationSec: 3 },
      { id: 's1', index: 1, scene: '雨夜, 街口', camera: '推镜' },
    ]);
    expect(csv.startsWith('\uFEFF镜号,时长(秒),运镜,场景')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[1].startsWith('1,,推镜,"雨夜, 街口"')).toBe(true);
    expect(lines[2]).toContain('"他说""走""，转身"');
  });
});

describe('buildStoredZip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('hello')).toString(16)).toBe('3610a686');
  });

  it('writes local headers, a central directory and an end record', () => {
    const zip = buildStoredZip([{ name: '镜头.txt', data: new TextEncoder().encode('hello') }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 10, 16, 12, 0, 0));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(view.getUint32(centralOffset + 16, true)).toBe(0x3610a686);
  });
});

describe('executeWorkflowExport', () => {
  it('returns the original bytes for a single node and saves once', async () => {
    const plan = planWorkflowExport(project(), { nodeIds: ['img'] });
    const save = vi.fn(async () => true);
    const result = await executeWorkflowExport(plan, { loadMedia: async () => new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' }), save }, { inline: true });
    expect(result).toMatchObject({ mode: 'single', mimeType: 'image/png', bytes: 3, saved: true, dataBase64: 'CQgH' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('builds a zip without saving when save=false', async () => {
    const plan = planWorkflowExport(project(), { nodeIds: ['img', 'script'] });
    const save = vi.fn(async () => true);
    const result = await executeWorkflowExport(plan, { loadMedia: async () => new Blob(['x'], { type: 'image/png' }), save }, { save: false });
    expect(result.mimeType).toBe('application/zip');
    expect(result.files.map(f => f.fileName)).toEqual(['主角_定妆.png', '分镜.csv']);
    expect(result.saved).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('workflow.export dispatcher', () => {
  afterEach(() => { useWorkflowStore.setState({ projects: [], activeProjectId: null }); });

  it('exports through the injected runtime without changing the document', async () => {
    const source = project();
    useWorkflowStore.setState({ projects: [source], activeProjectId: source.id });
    const loadMedia = vi.fn(async () => new Blob(['abc'], { type: 'video/mp4' }));
    const dispatch = createWorkflowDispatcher({
      getState: () => useWorkflowStore.getState() as never,
      createProject: title => useWorkflowStore.getState().createProject(title),
      setActiveProject: id => useWorkflowStore.getState().setActiveProject(id),
      deleteProjects: ids => useWorkflowStore.getState().deleteProjects(ids),
      updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
      exportRuntime: { loadMedia, save: async () => true },
    });
    const before = JSON.stringify(useWorkflowStore.getState().projects[0].nodes);
    const ok = await dispatch({ id: 'e1', command: 'workflow.export', args: { groupId: 'g1' }, source: 'agent' });
    expect(ok.ok).toBe(true);
    expect(ok.result).toMatchObject({ projectId: 'p1', mode: 'zip', saved: true, skipped: [{ nodeId: 'note' }] });
    expect(JSON.stringify(useWorkflowStore.getState().projects[0].nodes)).toBe(before);
    const bad = await dispatch({ id: 'e2', command: 'workflow.export', args: { nodeIds: ['note'] }, source: 'agent' });
    expect(bad.error?.code).toBe('NOTHING_TO_EXPORT');
  });
});
