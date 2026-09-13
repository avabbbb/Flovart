import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFolderBrowser } from '../components/workflow/LocalFolderBrowser';
import { forgetLocalFolderSource, listLocalFolderSources, type LocalFolderEntry } from '../services/localFolderSource';
import { fakeDirectoryHandle, fakeFileHandle } from './fixtures/fakeFolderHandle';

// 缩略图在 jsdom 里无法真正解码；本文件只验证面板行为，文件读取由 localFolderSource.test.ts 覆盖。
vi.mock('../components/workflow/media', async importOriginal => ({
  ...(await importOriginal<typeof import('../components/workflow/media')>()),
  createWorkflowImageThumbnail: vi.fn(async () => null),
  createWorkflowVideoPoster: vi.fn(async () => null),
}));

beforeEach(() => {
  // 视口永不发布相交事件：缩略图保持惰性，只有真实可见的卡片才会触发加载。
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(async () => {
  const sources = await listLocalFolderSources();
  await Promise.all(sources.map(source => forgetLocalFolderSource(source.id)));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubPicker(handle: ReturnType<typeof fakeDirectoryHandle> | null) {
  vi.stubGlobal('showDirectoryPicker', handle ? vi.fn(async () => handle) : undefined);
}

const sampleRoot = () => fakeDirectoryHandle('产品素材', [
  ['hero.png', fakeFileHandle({ name: 'hero.png', type: 'image/png' })],
  ['take-01.mp4', fakeFileHandle({ name: 'take-01.mp4', type: 'video/mp4' })],
  ['notes.psd', fakeFileHandle({ name: 'notes.psd', type: 'image/vnd.adobe.photoshop' })],
]);

/** 渲染并把挂载时的异步数据加载刷完，避免 act 警告。 */
async function renderPanel(onInsert: (entries: LocalFolderEntry[]) => void) {
  await act(async () => {
    render(<LocalFolderBrowser language="zho" onInsert={onInsert} />);
  });
}

/** 冲刷扫描结束后的收尾状态更新（例如 setScanning(false)）。 */
const settle = () => act(async () => { await Promise.resolve(); });

describe('LocalFolderBrowser', () => {
  it('explains the environment limit instead of faking folder access', async () => {
    stubPicker(null);
    await renderPanel(vi.fn());
    expect(screen.getByTestId('local-folder-unsupported')).toBeInTheDocument();
    expect(screen.queryByTestId('local-folder-pick')).toBeNull();
  });

  it('scans the granted folder and lists only media entries', async () => {
    stubPicker(sampleRoot());
    await renderPanel(vi.fn());

    fireEvent.click(screen.getByTestId('local-folder-pick'));

    expect(await screen.findByTestId('local-folder-card-hero.png')).toBeInTheDocument();
    expect(screen.getByTestId('local-folder-card-take-01.mp4')).toBeInTheDocument();
    expect(screen.queryByTestId('local-folder-card-notes.psd')).toBeNull();
    await settle();
  });

  it('adds only the selected entries to the canvas, even after filtering', async () => {
    stubPicker(sampleRoot());
    const onInsert = vi.fn();
    await renderPanel(onInsert);

    fireEvent.click(screen.getByTestId('local-folder-pick'));
    const heroCard = await screen.findByTestId('local-folder-card-hero.png');
    fireEvent.click(heroCard);
    expect(heroCard.getAttribute('aria-pressed')).toBe('true');

    // 筛选只影响展示，不应改变已选集合，也不应把未选中的素材带进画布。
    fireEvent.click(screen.getByTestId('local-folder-filter-video'));
    expect(screen.queryByTestId('local-folder-card-hero.png')).toBeNull();

    fireEvent.click(screen.getByTestId('local-folder-insert'));
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    const inserted = onInsert.mock.calls[0][0] as LocalFolderEntry[];
    expect(inserted.map(entry => entry.relativePath)).toEqual(['hero.png']);
    expect(inserted[0].kind).toBe('image');
  });

  it('asks for a fresh grant instead of pretending the folder is readable', async () => {
    stubPicker(fakeDirectoryHandle('受限素材', [
      ['hero.png', fakeFileHandle({ name: 'hero.png', type: 'image/png' })],
    ], 'prompt'));
    await renderPanel(vi.fn());

    fireEvent.click(screen.getByTestId('local-folder-pick'));
    expect(await screen.findByText(/再次确认该文件夹的读取权限/)).toBeInTheDocument();
    expect(screen.queryByTestId('local-folder-grid')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /重新连接/ }));
    expect(await screen.findByTestId('local-folder-card-hero.png')).toBeInTheDocument();
  });

  it('does not silently copy files dropped instead of a folder', async () => {
    stubPicker(sampleRoot());
    const onInsert = vi.fn();
    await renderPanel(onInsert);

    fireEvent.drop(screen.getByTestId('local-folder-browser'), { dataTransfer: { items: [{ kind: 'file' }] } });

    expect(await screen.findByText(/不支持从拖放中保留文件夹引用/)).toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('discloses reference semantics and which assets reach cloud providers', async () => {
    stubPicker(sampleRoot());
    await renderPanel(vi.fn());
    expect(screen.getByText(/只引用原文件，不复制副本/)).toBeInTheDocument();
    expect(screen.getByText(/会随本次生成发送给对应供应商/)).toBeInTheDocument();
  });
});
