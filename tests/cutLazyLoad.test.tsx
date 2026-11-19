// Cut 编辑器懒加载：App 只懒引用 CutPage；CutPage 不静态引用 mediabunny / 编辑器；
// 编辑器 chunk 只在编辑器子页渲染时才被请求；WebCodecs 缺失时给出提示而不加载编辑器。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { editorLoaded } = vi.hoisted(() => ({ editorLoaded: vi.fn() }));
vi.mock('../components/cut/CutEditor', () => {
  editorLoaded();
  return { default: () => <div data-testid="mock-cut-editor">editor</div> };
});
vi.mock('../components/reverse/IrisStoryboardPage', () => ({
  IrisStoryboardPage: () => <div data-testid="mock-storyboard">storyboard</div>,
}));

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const staticImports = (source: string) => [...source.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map(match => match[1]);

const webCodecs = ['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder', 'VideoFrame', 'OffscreenCanvas', 'OfflineAudioContext'] as const;

afterEach(() => {
  for (const name of webCodecs) delete (globalThis as Record<string, unknown>)[name];
  sessionStorage.clear();
});

describe('Cut lazy loading', () => {
  it('App reaches the Cut page only through React.lazy', () => {
    const app = read('App.tsx');
    expect(staticImports(app).some(path => path.includes('components/cut'))).toBe(false);
    expect(app).toMatch(/React\.lazy\(\(\) => import\('\.\/components\/cut\/CutPage'\)/);
  });

  it('CutPage has no static import of the editor or mediabunny', () => {
    const imports = staticImports(read('components/cut/CutPage.tsx'));
    expect(imports.filter(path => /mediabunny|CutEditor|mediaEngine|player/.test(path))).toEqual([]);
  });

  it('only the editor module imports mediabunny', () => {
    for (const file of ['services/cut/timeline.ts', 'services/cut/render.ts', 'services/cut/support.ts', 'services/cut/canvasMedia.ts', 'services/cut/player.ts', 'services/cut/cutStore.ts', 'services/cut/agentTools.ts', 'services/cut/agentOps.ts', 'services/cut/runtime.ts', 'services/cut/subtitles.ts', 'services/cut/shortcuts.ts', 'services/cut/actions.ts', 'services/cut/fonts.ts']) {
      expect(read(file)).not.toMatch(/from 'mediabunny'/);
    }
    expect(read('services/cut/mediaEngine.ts')).toMatch(/from 'mediabunny'/);
  });

  it('the agent kernel only statically pulls the light Cut tool shell (schemas), not the store or implementation', () => {
    const shell = staticImports(read('services/cut/agentTools.ts'));
    expect(shell.filter(path => path.startsWith('.'))).toEqual([]);
    expect(read('services/cut/agentTools.ts')).toMatch(/import\('\.\/agentToolsImpl'\)/);
    expect(staticImports(read('services/browserAgentKernel.ts'))).toContain('./cut/agentTools');
  });

  it('requests the editor chunk only when the editor sub-view renders', async () => {
    for (const name of webCodecs) (globalThis as Record<string, unknown>)[name] = function stub() { /* */ };
    const { CutPage } = await import('../components/cut/CutPage');
    expect(editorLoaded).not.toHaveBeenCalled();
    render(<CutPage language="en" project={null} onCreateProject={() => 'p'} onFocusNode={() => undefined} chat={null} initialView="storyboard" />);
    expect(await screen.findByTestId('mock-storyboard')).toBeTruthy();
    expect(editorLoaded).not.toHaveBeenCalled();
    await act(async () => { screen.getByTestId('cut-subtab-editor').click(); });
    expect(await screen.findByTestId('mock-cut-editor')).toBeTruthy();
    expect(editorLoaded).toHaveBeenCalledTimes(1);
    // storyboard (reverse tools) is still reachable from inside Cut
    await act(async () => { screen.getByTestId('cut-subtab-storyboard').click(); });
    expect(await screen.findByTestId('mock-storyboard')).toBeTruthy();
  });

  it('shows a clear message instead of the editor when WebCodecs is missing', async () => {
    const { CutPage } = await import('../components/cut/CutPage');
    render(<CutPage language="en" project={null} onCreateProject={() => 'p'} onFocusNode={() => undefined} chat={null} initialView="editor" />);
    expect(screen.getByTestId('cut-unsupported').textContent).toMatch(/WebCodecs/);
    expect(screen.queryByTestId('mock-cut-editor')).toBeNull();
  });
});
