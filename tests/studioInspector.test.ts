import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mountedRoots: HTMLElement[] = [];
const sha256 = 'a'.repeat(64);

function preparedCandidate(overrides: Record<string, unknown> = {}) {
  const artifact = {
    artifactId: 'artifact-1', taskId: 'task-1', modelId: 'model-id', mimeType: 'image/png',
    sha256, byteSize: 9, blob: new Blob(['candidate'], { type: 'image/png' }),
  };
  return {
    candidateId: 'candidate-1', taskId: 'task-1', artifact,
    persistenceReceipt: { status: 'persisted', artifactId: 'artifact-1', taskId: 'task-1', modelId: 'model-id', mimeType: 'image/png', sha256, byteSize: 9 },
    executionTarget: {
      selectionSnapshot: { host: 'resolve', selectionId: 'clip-1', label: 'Interview_A.mov', locator: { projectId: 'project-1', clipId: 'clip-1' } },
      outputTarget: { kind: 'media-pool', projectId: 'project-1', sourceSelectionId: 'clip-1' },
      projectId: 'project-1',
    },
    ...overrides,
  };
}

function mountResolveInspector({
  available = true,
  selection = { host: 'resolve', selectionId: 'clip-1', label: 'Interview_A.mov', kind: 'video', locator: { projectId: 'project-1', clipId: 'clip-1' } },
  prepareCandidate = vi.fn(async () => preparedCandidate()),
  importCandidate = vi.fn(async () => ({ ok: true, mediaPoolItemId: 'media-pool-item-1' })),
}: {
  available?: boolean;
  selection?: { host: string; selectionId: string; label: string; kind: string; locator?: Record<string, string> } | null;
  prepareCandidate?: ReturnType<typeof vi.fn>;
  importCandidate?: ReturnType<typeof vi.fn>;
} = {}) {
  const source = readFileSync(join(process.cwd(), 'integrations', 'studio', 'shared', 'inspector.js'), 'utf8');
  new Function('window', source)(window);
  const adapter = {
    id: 'resolve',
    getContext: vi.fn(async () => ({ available, documentId: available ? 'project-1' : undefined, title: available ? 'Project 1' : '' })),
    getSelection: vi.fn(async () => selection),
  };
  const root = document.createElement('div');
  document.body.append(root);
  mountedRoots.push(root);
  const studioUi = (window as unknown as { FlovartStudioUI: { mountInspector: (options: Record<string, unknown>) => { dispose: () => void; refresh: () => Promise<void> } } }).FlovartStudioUI;
  const inspector = studioUi.mountInspector({
    root,
    adapter,
    controller: { prepareCandidate, importCandidate },
    hostLabel: 'DaVinci Resolve',
    defaultImportTarget: { kind: 'media-pool' },
    locale: 'zh-CN',
  });
  return { root, adapter, prepareCandidate, importCandidate, inspector };
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.remove();
  localStorage.clear();
});

describe('Resolve Studio Iris inspector', () => {
  it('prepares a durable candidate first, then imports only after explicit Add to Media Pool', async () => {
    const { root, adapter, prepareCandidate, importCandidate, inspector } = mountResolveInspector();
    await vi.waitFor(() => expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Interview_A.mov'));

    expect(root.querySelector('.fs-tabs')).toBeNull();
    expect(root.textContent).not.toContain('本次记录');
    expect(root.textContent).not.toContain('制作');
    expect(root.querySelector('.fs-section-label span')?.textContent).toBe('当前片段');
    expect(root.querySelector('.fs-setting-static')?.textContent).toBe('模型自动');
    const output = root.querySelector<HTMLSelectElement>('.fs-setting-row select[aria-label="输出: Media Pool"]');
    expect(output).not.toBeNull();
    expect(Array.from(output!.options).map(item => [item.textContent, item.value])).toContainEqual(['Media Pool', 'media-pool']);
    expect(output!.value).toBe('media-pool');
    expect(root.querySelector('.fs-source-info span.fs-mono')?.textContent).toBe('Media Pool 片段');
    expect(root.querySelector<HTMLElement>('.fs-source-info span.fs-mono')?.hidden).toBe(false);
    expect(root.textContent).toContain('在 Iris 中打开');

    const prompt = root.querySelector<HTMLTextAreaElement>('textarea');
    prompt!.value = '根据当前选中的时间线片段生成一个新的场景版本';
    prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.fs-generate')!.click();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledWith(
      '根据当前选中的时间线片段生成一个新的场景版本',
      { kind: 'media-pool' },
      expect.any(Function),
    ));
    await vi.waitFor(() => expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('添加到 Media Pool'));
    expect(importCandidate).not.toHaveBeenCalled();
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('预览');
    expect(root.querySelector('.fs-task-label')?.textContent).toBe('已就绪');
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('基于 Interview_A.mov');
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('model-id');
    expect(root.textContent).not.toContain('00:00');
    expect(root.textContent).not.toContain('Timeline 1');

    adapter.getSelection.mockResolvedValue({
      host: 'resolve', selectionId: 'clip-2', label: 'Changed_Selection.mov', kind: 'video',
      locator: { projectId: 'project-1', clipId: 'clip-2' },
    });
    await inspector.refresh();
    expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Changed_Selection.mov');
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('基于 Interview_A.mov');
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).not.toContain('Changed_Selection.mov');

    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.fs-candidate-add')?.disabled).toBe(false));
    root.querySelector<HTMLButtonElement>('.fs-candidate-add')!.click();
    await vi.waitFor(() => expect(importCandidate).toHaveBeenCalledWith('candidate-1'));
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.fs-candidate-add')?.disabled).toBe(true));
    expect(root.querySelector('.fs-candidate-add')?.textContent).toBe('已添加到 Media Pool');
    root.querySelector<HTMLButtonElement>('.fs-candidate-add')!.click();
    expect(importCandidate).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('.fs-locale-toggle button[aria-label="English"]')!.click();
    expect(root.textContent).toContain('CURRENT CLIP');
    expect(root.textContent).toContain('GENERATE');
    expect(root.textContent).toContain('REFERENCES');
    expect(root.textContent).toContain('TASK');
    expect(root.textContent).toContain('CANDIDATES · 1');
    expect(root.textContent).toContain('Open in Iris');
    expect(root.querySelector('.fs-setting-static')?.textContent).toBe('ModelAuto');
    expect(root.querySelector('.fs-candidate-add')?.textContent).toBe('Added to Media Pool');
    root.querySelector<HTMLButtonElement>('.fs-locale-toggle button[aria-label="Simplified Chinese"]')!.click();
    expect(root.querySelector('.fs-candidate-add')?.textContent).toBe('已添加到 Media Pool');

    inspector.dispose();
  });

  it('accepts a frozen Resolve project when its ID differs from the Iris Workflow project', async () => {
    const resolveProjectId = 'resolve-project-7';
    const workflowProjectId = 'iris-workflow-project-42';
    const { root, inspector } = mountResolveInspector({
      selection: {
        host: 'resolve', selectionId: 'clip-1', label: 'Resolve_Source.mov', kind: 'video',
        locator: { projectId: resolveProjectId, clipId: 'clip-1' },
      },
      prepareCandidate: vi.fn(async () => preparedCandidate({
        executionTarget: {
          projectId: workflowProjectId,
          selectionSnapshot: {
            host: 'resolve', selectionId: 'clip-1', label: 'Resolve_Source.mov',
            locator: { projectId: resolveProjectId, clipId: 'clip-1' },
          },
          outputTarget: { kind: 'media-pool', projectId: resolveProjectId, sourceSelectionId: 'clip-1' },
        },
      })),
    });
    await vi.waitFor(() => expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Resolve_Source.mov'));
    const prompt = root.querySelector<HTMLTextAreaElement>('textarea');
    prompt!.value = 'Generate a candidate for the selected clip';
    prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.fs-generate')!.click();

    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.fs-candidate-add')?.disabled).toBe(false));
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('基于 Resolve_Source.mov');
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).not.toContain(workflowProjectId);
    inspector.dispose();
  });

  it('does not expose an empty generation form without a project or selection', async () => {
    const noProject = mountResolveInspector({ available: false, selection: null });
    await vi.waitFor(() => expect(noProject.root.querySelector('.fs-source-info strong')?.textContent).toBe('打开一个 Resolve 项目'));
    expect(noProject.root.querySelector<HTMLButtonElement>('.fs-generate')?.hidden).toBe(true);
    expect(noProject.adapter.getSelection).not.toHaveBeenCalled();
    noProject.inspector.dispose();

    const noSelection = mountResolveInspector({ selection: null });
    await vi.waitFor(() => expect(noSelection.root.querySelector('.fs-source-info strong')?.textContent).toBe('选择一个片段或素材'));
    expect(noSelection.root.querySelector<HTMLButtonElement>('.fs-generate')?.hidden).toBe(true);
    expect(noSelection.root.querySelector<HTMLElement>('.fs-prompt-box')?.hidden).toBe(true);
    noSelection.inspector.dispose();
  });

  it('does not offer an Add action when the persistence receipt does not match the artifact', async () => {
    const { root, inspector } = mountResolveInspector({
      prepareCandidate: vi.fn(async () => preparedCandidate({ persistenceReceipt: { status: 'persisted', artifactId: 'different-artifact', sha256, byteSize: 9, mimeType: 'image/png' } })),
    });
    await vi.waitFor(() => expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Interview_A.mov'));
    const prompt = root.querySelector<HTMLTextAreaElement>('textarea');
    prompt!.value = 'Create a new shot';
    prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.fs-generate')!.click();
    await vi.waitFor(() => expect(root.querySelector('.fs-status')?.textContent).toBe('候选未能完成持久化校验。'));
    expect(root.querySelector('.fs-resolve-candidate')).toBeNull();
    inspector.dispose();
  });

  it('keeps the same persisted candidate ID available when Media Pool import fails', async () => {
    const importCandidate = vi.fn()
      .mockResolvedValueOnce({ ok: false, importStatus: 'rejected', message: 'temporary import failure' })
      .mockResolvedValueOnce({ ok: true, mediaPoolItemId: 'media-pool-item-1' });
    const { root, importCandidate: importer, inspector } = mountResolveInspector({ importCandidate });
    await vi.waitFor(() => expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Interview_A.mov'));
    const prompt = root.querySelector<HTMLTextAreaElement>('textarea');
    prompt!.value = 'Create a new shot';
    prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.fs-generate')!.click();
    await vi.waitFor(() => expect(root.querySelector('.fs-candidate-add')?.textContent).toBe('添加到 Media Pool'));
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.fs-candidate-add')?.disabled).toBe(false));
    root.querySelector<HTMLButtonElement>('.fs-candidate-add')!.click();
    await vi.waitFor(() => expect(root.querySelector('.fs-candidate-add')?.textContent).toBe('重试添加'));
    expect(root.querySelector('.fs-candidate-add')?.textContent).toContain('重试');
    expect(importer).toHaveBeenNthCalledWith(1, 'candidate-1');
    root.querySelector<HTMLButtonElement>('.fs-candidate-add')!.click();
    await vi.waitFor(() => expect(root.querySelector('.fs-candidate-add')?.textContent).toBe('已添加到 Media Pool'));
    expect(importer).toHaveBeenNthCalledWith(2, 'candidate-1');
    inspector.dispose();
  });

  it('blocks retry and explains how to verify an import with unknown outcome in Chinese and English', async () => {
    const importCandidate = vi.fn(async () => ({ ok: false, importStatus: 'unknown' }));
    const { root, importCandidate: importer, inspector } = mountResolveInspector({ importCandidate });
    await vi.waitFor(() => expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Interview_A.mov'));
    const prompt = root.querySelector<HTMLTextAreaElement>('textarea');
    prompt!.value = 'Create a new shot';
    prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.fs-generate')!.click();
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.fs-candidate-add')?.disabled).toBe(false));
    root.querySelector<HTMLButtonElement>('.fs-candidate-add')!.click();

    await vi.waitFor(() => expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('导入状态未知'));
    const addButton = root.querySelector<HTMLButtonElement>('.fs-candidate-add')!;
    expect(addButton.disabled).toBe(true);
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('请先检查 Resolve Media Pool');
    addButton.click();
    expect(importer).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('.fs-locale-toggle button[aria-label="English"]')!.click();
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('Import status is unknown');
    expect(root.querySelector('.fs-resolve-candidate')?.textContent).toContain('Check the Resolve Media Pool');
    expect(root.querySelector<HTMLButtonElement>('.fs-candidate-add')?.disabled).toBe(true);
    inspector.dispose();
  });
});
