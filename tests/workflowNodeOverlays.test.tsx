import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowNodeToolbar } from '../components/workflow/WorkflowNodeToolbar';
import { WorkflowNode } from '../components/workflow/WorkflowNode';
import { WorkflowNodePromptBar } from '../components/workflow/WorkflowNodePromptBar';
import { PromptBar } from '../components/PromptBar';
import { AssetLibraryBrowser } from '../components/studio/AssetLibraryBrowser';
import type { UserApiKey } from '../types';

const t = (key: string) => key;
const node = createWorkflowNode('image', 'image', { x: 100, y: 80 }, {
  prompt: '初始提示词',
  config: { mode: 'image', modelId: 'image-model' },
});
const productKey: UserApiKey = {
  id: 'openai-image', provider: 'openai', capabilities: ['image'], key: 'secret', customModels: ['gpt-image-2'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const }, routeId: 'gpt-image-2', order: 0 }],
  createdAt: 1, updatedAt: 1,
};
const videoProductKey: UserApiKey = {
  id: 'seedance-video', provider: 'volcengine', capabilities: ['video'], key: 'secret', customModels: ['doubao-seedance-2-0-260128'],
  routeMappings: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'].map((mode, order) => ({
    target: { kind: 'product-mode' as const, productModelId: 'flovart:seedance-2', mode: mode as 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'first-last-frame' },
    routeId: 'doubao-seedance-2-0-260128',
    order,
  })),
  createdAt: 1, updatedAt: 1,
};
const klingProductKey: UserApiKey = {
  id: 'kling-video', provider: 'keling', capabilities: ['video'], key: 'secret', customModels: ['kling-video-3.0'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:kling-video-3', mode: 'text-to-video' as const }, routeId: 'kling-video-3.0', order: 0 }],
  createdAt: 1, updatedAt: 1,
};
const runningHubVeoKey: UserApiKey = {
  id: 'runninghub-veo', provider: 'runningHub', capabilities: ['video'], key: 'secret',
  customModels: ['rhart-video-v3.1-fast/start-end-to-video'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:veo-3.1-fast', mode: 'first-last-frame' as const }, routeId: 'rhart-video-v3.1-fast/start-end-to-video', order: 0 }],
  createdAt: 1, updatedAt: 1,
};
const googleVeoKey: UserApiKey = {
  id: 'google-veo', provider: 'google', capabilities: ['video'], key: 'secret', customModels: ['veo-3.1-generate-preview'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:veo-3.1', mode: 'reference-to-video' as const }, routeId: 'veo-3.1-generate-preview', order: 0 }],
  createdAt: 1, updatedAt: 1,
};

describe('workflow node overlays', () => {
  it('defaults a blank video node to its first mapped model and exposes ratio and duration', async () => {
    const initialNode = createWorkflowNode('blank-video', 'video', { x: 0, y: 0 });
    const Harness = () => {
      const [currentNode, setCurrentNode] = useState(initialNode);
      return <WorkflowNodePromptBar
        node={currentNode}
        nodes={[currentNode]}
        t={t}
        theme="light"
        language="zho"
        userApiKeys={[videoProductKey]}
        dynamicModelOptions={{ text: [], image: [], video: ['flovart:seedance-2'] }}
        onChange={patch => setCurrentNode(value => ({ ...value, metadata: { ...value.metadata, ...patch } }))}
        onRun={vi.fn()}
      />;
    };

    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/Seedance/)).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('生成参数'));
    expect(screen.getByText('比例')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16:9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4s' })).toBeInTheDocument();
  });

  it('keeps the parameter entry visible before a model is configured', () => {
    const blankVideo = createWorkflowNode('unmapped-video', 'video', { x: 0, y: 0 });
    render(<WorkflowNodePromptBar node={blankVideo} nodes={[blankVideo]} t={t} theme="light" language="zho" userApiKeys={[]} dynamicModelOptions={{ text: [], image: [], video: ['flovart:seedance-2'] }} onChange={vi.fn()} onRun={vi.fn()} />);
    fireEvent.click(screen.getByTitle('生成参数'));
    expect(screen.getByText('选择模型')).toBeInTheDocument();
  });

  it('uses the shared toolbar shell and exposes only wired actions', () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<WorkflowNodeToolbar nodes={[node]} onCopy={onCopy} onDelete={onDelete} onRun={vi.fn()} onReplaceMedia={vi.fn()} onToggleFreeResize={vi.fn()} />);
    expect(screen.getByTestId('workflow-node-toolbar')).toHaveClass('isl-shell');
    fireEvent.click(screen.getByRole('button', { name: '复制节点' }));
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }));
    expect(onCopy).toHaveBeenCalledWith(['image']);
    expect(onDelete).toHaveBeenCalledWith(['image']);
  });

  it('isolates pointer and wheel events at the overlay boundary', () => {
    const pointer = vi.fn();
    const wheel = vi.fn();
    render(<div onPointerDown={pointer} onWheel={wheel}><WorkflowNodeToolbar nodes={[node]} onCopy={vi.fn()} onDelete={vi.fn()} /></div>);
    const overlay = screen.getByTestId('workflow-node-toolbar');
    fireEvent.pointerDown(overlay);
    fireEvent.wheel(overlay);
    expect(pointer).not.toHaveBeenCalled();
    expect(wheel).not.toHaveBeenCalled();
  });

  it('binds fixed product model changes to canonical workflow metadata', () => {
    const onChange = vi.fn();
    const productNode = createWorkflowNode('product-image', 'image', { x: 0, y: 0 }, {
      prompt: '初始提示词', config: { mode: 'image', modelId: 'flovart:gpt-image-2' },
    });
    render(<WorkflowNodePromptBar
      node={productNode}
      nodes={[productNode, createWorkflowNode('other', 'text', { x: 0, y: 0 }, { content: '参考文案' })]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[productKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }}
      onChange={onChange}
      onRun={vi.fn()}
    />);
    expect(screen.getByTestId('workflow-node-prompt-bar')).toBeInTheDocument();
    expect(screen.getByText('初始提示词')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('GPT Image 2')[0].closest('button')!);
    expect(screen.getByTestId('prompt-model-progressive')).toHaveAttribute('data-density', 'compact');
    expect(screen.queryByTestId('prompt-model-carousel')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /GPT Image 2/ }).at(-1)!);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ modelId: 'flovart:gpt-image-2' }) }));
  });

  it('keeps video generation mode visible as a compact progressive control', () => {
    const onChange = vi.fn();
    const videoNode = createWorkflowNode('seedance-video-node', 'video', { x: 0, y: 0 }, {
      prompt: '让人物转身',
      config: { mode: 'video', modelId: 'flovart:seedance-2', submode: 'text-to-video', durationSec: 5, resolution: '720p' },
      generationActualCost: 0.42,
      generationCurrency: 'CNY',
      generationActualTokens: 640000,
    });
    render(<WorkflowNodePromptBar
      node={videoNode}
      nodes={[videoNode]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[videoProductKey]}
      dynamicModelOptions={{ text: [], image: [], video: ['flovart:seedance-2'] }}
      onChange={onChange}
      onRun={vi.fn()}
    />);
    expect(screen.getByText('¥0.420 · 640,000 Token')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('视频生成方式'));
    const modePanel = screen.getByTestId('prompt-video-mode-panel');
    expect(modePanel).toHaveAttribute('data-density', 'compact');
    expect(within(modePanel).getByRole('button', { name: '文生视频' })).toBeInTheDocument();
    expect(within(modePanel).getByRole('button', { name: '图生视频' })).toBeInTheDocument();
    expect(within(modePanel).getByRole('button', { name: '全能参考' })).toBeInTheDocument();
    expect(within(modePanel).getByRole('button', { name: '首尾帧' })).toBeInTheDocument();
    fireEvent.click(within(modePanel).getByRole('button', { name: '全能参考' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ submode: 'reference-to-video' }) }));

    fireEvent.click(screen.getByTitle('生成参数'));
    expect(screen.getByTestId('prompt-parameter-panel')).toHaveAttribute('data-density', 'compact');
    expect(screen.getByText('分辨率')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '720p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5s' })).toBeInTheDocument();
  });

  it('shows only durations accepted by the final mapped video route', () => {
    const videoNode = createWorkflowNode('veo-start-end', 'video', { x: 0, y: 0 }, {
      prompt: '从首帧过渡到尾帧',
      config: { mode: 'video', modelId: 'flovart:veo-3.1-fast', submode: 'first-last-frame', durationSec: 4, resolution: '720p' },
    });
    render(<WorkflowNodePromptBar node={videoNode} nodes={[videoNode]} t={t} theme="light" language="zho" userApiKeys={[runningHubVeoKey]} dynamicModelOptions={{ text: [], image: [], video: ['flovart:veo-3.1-fast'] }} onChange={vi.fn()} onRun={vi.fn()} />);
    fireEvent.click(screen.getByTitle('生成参数'));
    expect(screen.queryByRole('button', { name: '4s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '6s' })).toBeNull();
    expect(screen.getByRole('button', { name: '8s' })).toBeInTheDocument();
  });

  it('blocks an @ media type that the final Provider route cannot receive', () => {
    const videoNode = createWorkflowNode('veo-reference', 'video', { x: 0, y: 0 }, {
      prompt: '跟随 @配乐 的节奏', mentionedNodeIds: ['audio-ref'],
      config: { mode: 'video', modelId: 'flovart:veo-3.1', submode: 'reference-to-video', durationSec: 8, resolution: '720p' },
    });
    const audioNode = createWorkflowNode('audio-ref', 'audio', { x: 0, y: 240 }, { href: 'https://cdn.example.com/music.mp3', mimeType: 'audio/mpeg' });
    audioNode.title = '配乐';
    render(<WorkflowNodePromptBar node={videoNode} nodes={[videoNode, audioNode]} connections={[{ id: 'audio-link', fromNodeId: 'audio-ref', toNodeId: 'veo-reference' }]} t={t} theme="light" language="zho" userApiKeys={[googleVeoKey]} dynamicModelOptions={{ text: [], image: [], video: ['flovart:veo-3.1'] }} onChange={vi.fn()} onRun={vi.fn()} />);
    const generate = screen.getByRole('button', { name: 'promptBar.generate' });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('title', '当前 Provider 线路不接收 @音频 参考');
    fireEvent.click(screen.getByTitle('视频生成方式'));
    expect(screen.getByText('当前 Provider 线路不接收 @音频 参考')).toBeInTheDocument();
  });

  it('disables modes unavailable on the mapped video Provider route', () => {
    const videoNode = createWorkflowNode('kling-video-node', 'video', { x: 0, y: 0 }, {
      prompt: '让人物转身', config: { mode: 'video', modelId: 'flovart:kling-video-3', submode: 'text-to-video', durationSec: 5, resolution: '720p' },
    });
    render(<WorkflowNodePromptBar node={videoNode} nodes={[videoNode]} t={t} theme="light" language="zho" userApiKeys={[klingProductKey]} dynamicModelOptions={{ text: [], image: [], video: ['flovart:kling-video-3'] }} onChange={vi.fn()} onRun={vi.fn()} />);
    fireEvent.click(screen.getByTitle('视频生成方式'));
    const panel = screen.getByTestId('prompt-video-mode-panel');
    expect(within(panel).getByRole('button', { name: '文生视频' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '图生视频' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '全能参考' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: '全能参考' })).toHaveAttribute('title', '该模型不支持多模态参考输入');
    expect(within(panel).getByRole('button', { name: '首尾帧' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: '首尾帧' })).toHaveAttribute('title', '未映射该模式的 API 线路，请在设置中配置');
  });

  it('blocks video submission until the selected mode has the required references', () => {
    const videoNode = createWorkflowNode('seedance-image-video', 'video', { x: 0, y: 0 }, {
      prompt: '让人物转身', config: { mode: 'video', modelId: 'flovart:seedance-2', submode: 'image-to-video', durationSec: 5, resolution: '720p' },
    });
    render(<WorkflowNodePromptBar node={videoNode} nodes={[videoNode]} t={t} theme="light" language="zho" userApiKeys={[videoProductKey]} dynamicModelOptions={{ text: [], image: [], video: ['flovart:seedance-2'] }} onChange={vi.fn()} onRun={vi.fn()} />);
    const generate = screen.getByRole('button', { name: 'promptBar.generate' });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('title', '图生视频需要添加 1 张图片');
    fireEvent.click(screen.getByTitle('视频生成方式'));
    expect(screen.getByText('图生视频需要添加 1 张图片')).toBeInTheDocument();
  });

  it('shows only the add control with zero refs and opens the shared canvas/asset picker', async () => {
    const target = createWorkflowNode('target', 'image', { x: 0, y: 0 }, { prompt: '生成海报', config: { mode: 'image', modelId: 'flovart:gpt-image-2' } });
    const source = createWorkflowNode('source', 'image', { x: 0, y: 240 }, { href: 'data:image/png;base64,AA==', name: '图片1' });
    source.title = '图片1';
        const onSelectWorkflowReference = vi.fn().mockReturnValue('source');
        render(<WorkflowNodePromptBar node={target} nodes={[target, source]} t={t} theme="light" language="zho" userApiKeys={[productKey]} dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }} onChange={vi.fn()} onRun={vi.fn()} onSelectWorkflowReference={onSelectWorkflowReference} />);

    const refs = screen.getByTestId('prompt-image-refs');
    expect(refs.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('prompt-reference-add'));
    expect(screen.getByTestId('asset-reference-picker')).toBeInTheDocument();
    fireEvent.click(screen.getByText('图片1').closest('button')!);
        expect(onSelectWorkflowReference).toHaveBeenCalledWith('source');
    await waitFor(() => expect(screen.queryByTestId('asset-reference-picker')).not.toBeInTheDocument());
  });

  it('matches pasted plain @ aliases against the asset library and requests a real reference binding', async () => {
    const target = createWorkflowNode('paste-target', 'image', { x: 0, y: 0 }, {
      prompt: '',
      config: { mode: 'image', modelId: 'flovart:gpt-image-2' },
    });
    const onResolvePastedMentions = vi.fn(mentions => mentions.map(mention => ({ ...mention, id: 'restored-asset-node' })));
    render(<WorkflowNodePromptBar
      node={target}
      nodes={[target]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[productKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }}
      onChange={vi.fn()}
      onRun={vi.fn()}
      assetItems={[{ id: 'asset-role-1', name: '角色1', folderIds: [], tags: ['角色'], thumbnail: '', elementType: 'image' }]}
      onResolvePastedMentions={onResolvePastedMentions}
    />);

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { getData: (type: string) => type === 'text/plain' ? '@角色1向左走' : '' },
    });

    await waitFor(() => expect(onResolvePastedMentions).toHaveBeenCalled());
    expect(onResolvePastedMentions).toHaveBeenCalledWith([
      expect.objectContaining({
        assetId: 'asset-role-1',
        label: '角色1',
        sourceType: 'assetLibrary',
      }),
    ]);
  });

  it('uses the compact personal asset browser shared with PromptBar references', () => {
    render(<AssetLibraryBrowser
      compact
      language="zho"
      library={{
        folders: [{ id: 'people', name: '人物', parentId: null, createdAt: 1 }],
        items: [{ id: 'portrait', name: '角色立绘', folderIds: ['people'], tags: ['人物'], dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 256, height: 256, createdAt: 1 }],
      }}
      onRenameAsset={vi.fn()}
      onRemoveAsset={vi.fn()}
      onCreateFolder={vi.fn()}
      onRenameFolder={vi.fn()}
      onRemoveFolder={vi.fn()}
    />);

    expect(screen.getByTestId('asset-library-browser')).toHaveAttribute('data-compact', 'true');
    expect(screen.getByRole('button', { name: '个人' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '人物' }));
    expect(screen.getByText('角色立绘')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '按标签筛选' }));
    expect(screen.getByTestId('asset-tag-filter')).toHaveTextContent('标签');
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByText(/PromptBar 已保持同步/)).toBeInTheDocument();
  });

  it('portals prompt panels outside the canvas and enables automatic vertical flipping', () => {
    const productNode = createWorkflowNode('floating-image', 'image', { x: 0, y: 0 }, {
      prompt: '生成海报', config: { mode: 'image', modelId: 'flovart:gpt-image-2' },
    });
    render(<WorkflowNodePromptBar
      node={productNode}
      nodes={[productNode]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[productKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }}
      onChange={vi.fn()}
      onRun={vi.fn()}
    />);

    const promptBar = screen.getByTestId('workflow-node-prompt-bar');
    fireEvent.click(screen.getByTitle('生成参数'));
    const panel = screen.getByTestId('prompt-floating-panel');
    expect(promptBar.contains(panel)).toBe(false);
    expect(panel).toHaveAttribute('data-preferred-side', 'auto');
    expect(panel).toHaveAttribute('data-side', 'down');
    expect(panel.style.maxHeight).not.toBe('');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('prompt-floating-panel')).not.toBeInTheDocument();
  });

  it('flips a prompt panel upward when the node is close to the viewport bottom', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if ((this as HTMLElement).hasAttribute('data-prompt-floating-panel')) {
        return { x: 0, y: 0, left: 0, top: 0, right: 560, bottom: 420, width: 560, height: 420, toJSON: () => ({}) } as DOMRect;
      }
      if ((this as HTMLElement).classList.contains('theme-aware')) {
        return { x: 180, y: 650, left: 180, top: 650, right: 1060, bottom: 750, width: 880, height: 100, toJSON: () => ({}) } as DOMRect;
      }
      // 展开面板现在锚定触发按钮：生成参数按钮靠近视口底部，面板应向上翻
      if ((this as HTMLElement).tagName === 'BUTTON' && (this as HTMLElement).getAttribute('title') === '生成参数') {
        return { x: 380, y: 660, left: 380, top: 660, right: 500, bottom: 692, width: 120, height: 32, toJSON: () => ({}) } as DOMRect;
      }
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    });
    const productNode = createWorkflowNode('bottom-image', 'image', { x: 0, y: 0 }, {
      prompt: '生成海报', config: { mode: 'image', modelId: 'flovart:gpt-image-2' },
    });
    render(<WorkflowNodePromptBar
      node={productNode}
      nodes={[productNode]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[productKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }}
      onChange={vi.fn()}
      onRun={vi.fn()}
    />);

    fireEvent.click(screen.getByTitle('生成参数'));
    expect(screen.getByTestId('prompt-floating-panel')).toHaveAttribute('data-side', 'up');
    rectSpy.mockRestore();
  });

  it('blocks Workflow generation when the selected product model has no confirmed BYOK mapping', () => {
    const onRun = vi.fn();
    const productNode = createWorkflowNode('product-image', 'image', { x: 0, y: 0 }, {
      prompt: '生成海报',
      config: { mode: 'image', modelId: 'flovart:gpt-image-2' },
    });
    render(<WorkflowNodePromptBar
      node={productNode}
      nodes={[productNode]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[]}
      dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }}
      onChange={vi.fn()}
      onRun={onRun}
    />);

    const run = screen.getByRole('button', { name: 'promptBar.generate' });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('replaces a rich prompt preset without retaining stale mention ids', () => {
    const onPromptInputChange = vi.fn();
    render(<PromptBar t={t} theme="light" prompt="@旧引用" promptDocument={{ type: 'doc', content: [] }} setPrompt={vi.fn()} onPromptInputChange={onPromptInputChange} onGenerate={vi.fn()} isLoading={false} isSelectionActive={false} selectedElementCount={0} userEffects={[{ id: 'effect', name: '干净预设', value: '新的提示词' }]} onAddUserEffect={vi.fn()} onDeleteUserEffect={vi.fn()} generationMode="image" setGenerationMode={vi.fn()} videoAspectRatio="16:9" setVideoAspectRatio={vi.fn()} imageAspectRatio="1:1" setImageAspectRatio={vi.fn()} />);
    fireEvent.click(screen.getByTitle('更多操作'));
    fireEvent.click(screen.getByRole('button', { name: /干净预设/ }));
    expect(onPromptInputChange).toHaveBeenCalledWith(expect.objectContaining({ plainText: '新的提示词', mentionedElementIds: [] }));
  });

  it('runs text nodes in text mode and exposes stop while loading', () => {
    const onStop = vi.fn();
    const textNode = createWorkflowNode('text', 'text', { x: 0, y: 0 }, { prompt: '写旁白', status: 'loading', config: { mode: 'text', modelId: 'text-model', count: 1 } });
    render(<WorkflowNodePromptBar node={textNode} nodes={[textNode]} t={t} theme="light" language="zho" userApiKeys={[]} dynamicModelOptions={{ text: ['text-model'], image: [], video: [] }} onChange={vi.fn()} onRun={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.getByText('文本映射')).toBeInTheDocument();
  });

  it('provides six-way multi alignment and only renders real optional actions', () => {
    const onAlign = vi.fn();
    const onExport = vi.fn();
    const nodes = [node, { ...node, id: 'second' }];
    render(<WorkflowNodeToolbar nodes={nodes} onCopy={vi.fn()} onDelete={vi.fn()} onAlign={onAlign} onExport={onExport} />);
    ['左对齐节点', '水平居中节点', '右对齐节点', '顶部对齐节点', '垂直居中节点', '底部对齐节点'].forEach(name => fireEvent.click(screen.getByRole('button', { name })));
    fireEvent.click(screen.getByRole('button', { name: '批量导出所选媒体' }));
    expect(onAlign.mock.calls.map(call => call[0])).toEqual(['left', 'horizontal-center', 'right', 'top', 'vertical-center', 'bottom']);
    expect(onExport).toHaveBeenCalledWith(nodes);
    expect(screen.queryByRole('button', { name: '保存到素材库' })).not.toBeInTheDocument();
  });

  it('covers a generating workflow media node with the shared frosted state', () => {
    render(<WorkflowNode
      node={{ ...node, metadata: { ...node.metadata, status: 'loading', progress: 42 } }}
      selected={false}
      onPointerDown={vi.fn()}
      onConnectStart={vi.fn()}
      onResizeStart={vi.fn()}
      onChangeText={vi.fn()}
      onChangeMetadata={vi.fn()}
      onRun={vi.fn()}
      onContextMenu={vi.fn()}
      onReplaceMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
    />);
    expect(screen.getByTestId('workflow-generation-glass')).toHaveTextContent('图片生成中');
    expect(screen.getByTestId('workflow-generation-glass')).toHaveTextContent('42%');
  });

  it('renders the media node label with source dimensions outside the card', () => {
    render(<WorkflowNode
      node={{ ...node, title: '角色定帧', metadata: { ...node.metadata, href: 'data:image/png;base64,AA==', naturalWidth: 2048, naturalHeight: 1152 } }}
      selected
      onPointerDown={vi.fn()}
      onConnectStart={vi.fn()}
      onResizeStart={vi.fn()}
      onChangeText={vi.fn()}
      onChangeMetadata={vi.fn()}
      onRun={vi.fn()}
      onContextMenu={vi.fn()}
      onReplaceMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
    />);
    expect(screen.getByText('角色定帧')).toBeInTheDocument();
    expect(screen.getByText('2048 × 1152')).toHaveClass('workflow-node__title-meta');
  });

  it('uses lightweight activation before mounting the custom video player controls', () => {
    const video = createWorkflowNode('video', 'video', { x: 0, y: 0 }, {
      href: 'data:video/mp4;base64,dmlkZW8=', poster: 'data:image/jpeg;base64,cG9zdGVy', durationMs: 9000,
    });
    const onExtractFrame = vi.fn();
    const props = {
      node: video,
      selected: true,
      onPointerDown: vi.fn(),
      onConnectStart: vi.fn(),
      onResizeStart: vi.fn(),
      onChangeText: vi.fn(),
      onChangeMetadata: vi.fn(),
      onRun: vi.fn(),
      onContextMenu: vi.fn(),
      onReplaceMedia: vi.fn(),
      onRemoveMedia: vi.fn(),
      onActivateMedia: vi.fn(),
      onDeactivateMedia: vi.fn(),
      onExtractFrame,
    };
    const view = render(<WorkflowNode {...props} mediaActive={false} />);
    expect(screen.getByRole('button', { name: '加载视频播放器' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: '视频进度' })).not.toBeInTheDocument();
    view.rerender(<WorkflowNode {...props} mediaActive />);
    expect(screen.getByRole('button', { name: '播放视频' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '视频进度' })).toBeInTheDocument();
    expect(screen.getByText('0:09')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toHaveAttribute('controls');
    expect(document.querySelector('video')).toHaveAttribute('preload', 'metadata');
    expect(document.querySelector('video')).toHaveAttribute('playsinline');
    fireEvent.click(screen.getByRole('button', { name: '视频截帧' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '截取当前帧' }));
    expect(onExtractFrame).toHaveBeenCalledWith('current', 0);
    fireEvent.click(screen.getByRole('button', { name: '静音视频' }));
    fireEvent.change(screen.getByRole('slider', { name: '视频音量' }), { target: { value: '.75' } });
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('uses explicit batch controls to collapse results and set a different primary image', () => {
    const onCollapseBatch = vi.fn();
    const onSetBatchPrimary = vi.fn();
    render(<WorkflowNode
      node={{ ...node, metadata: { ...node.metadata, href: 'data:image/png;base64,AA==' } }}
      selected={false}
      onPointerDown={vi.fn()}
      onConnectStart={vi.fn()}
      onResizeStart={vi.fn()}
      onChangeText={vi.fn()}
      onChangeMetadata={vi.fn()}
      onRun={vi.fn()}
      onContextMenu={vi.fn()}
      onReplaceMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
      batchCount={4}
      isBatchPrimary={false}
      onCollapseBatch={onCollapseBatch}
      onSetBatchPrimary={onSetBatchPrimary}
    />);
    fireEvent.click(screen.getByRole('button', { name: /4张/ }));
    fireEvent.click(screen.getByRole('button', { name: '设为主图' }));
    expect(onCollapseBatch).toHaveBeenCalledOnce();
    expect(onSetBatchPrimary).toHaveBeenCalledOnce();
  });

  it('moves selected nodes to the front or back through the shared toolbar', () => {
    const onLayer = vi.fn();
    render(<WorkflowNodeToolbar nodes={[node]} onCopy={vi.fn()} onDelete={vi.fn()} onLayer={onLayer} />);
    fireEvent.click(screen.getByRole('button', { name: '移到最前' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最后' }));
    expect(onLayer.mock.calls.map(call => call[0])).toEqual(['front', 'back']);
  });

  it('wires prompt focus, save, replace, free resize, download, run and stop actions', () => {
    const callbacks = { focus: vi.fn(), save: vi.fn(), replace: vi.fn(), resize: vi.fn(), run: vi.fn(), stop: vi.fn() };
    const media = { ...node, metadata: { ...node.metadata, href: 'data:image/png;base64,AA==', name: 'image.png' } };
    const { container, rerender } = render(<WorkflowNodeToolbar nodes={[media]} onCopy={vi.fn()} onDelete={vi.fn()} onRun={callbacks.run} onStop={callbacks.stop} onPromptFocus={callbacks.focus} onSaveMedia={callbacks.save} onReplaceMedia={callbacks.replace} onToggleFreeResize={callbacks.resize} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '保存到素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '切换自由缩放' }));
    fireEvent.click(screen.getByRole('button', { name: '运行节点' }));
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'replacement.png', { type: 'image/png' })] } });
    expect(screen.getByRole('link', { name: '下载媒体' })).toHaveAttribute('download', 'image.png');
    expect([callbacks.focus, callbacks.save, callbacks.resize, callbacks.run, callbacks.replace].every(callback => callback.mock.calls.length === 1)).toBe(true);
    rerender(<WorkflowNodeToolbar nodes={[{ ...media, metadata: { ...media.metadata, status: 'loading' } }]} onCopy={vi.fn()} onDelete={vi.fn()} onRun={callbacks.run} onStop={callbacks.stop} />);
    fireEvent.click(screen.getByRole('button', { name: '停止节点' }));
    expect(callbacks.stop).toHaveBeenCalledWith(media.id);
  });

  it('shows image tools only when real handlers are supplied', () => {
    const imageTools = { crop: vi.fn(), filter: vi.fn(), upscale: vi.fn(), removeBackground: vi.fn(), outpaint: vi.fn(), mask: vi.fn(), splitLayers: vi.fn() };
    const mediaNode = { ...node, metadata: { ...node.metadata, href: 'data:image/png;base64,AA==' } };
    const { rerender } = render(<WorkflowNodeToolbar nodes={[mediaNode]} onCopy={vi.fn()} onDelete={vi.fn()} imageTools={imageTools} />);
    ['裁剪图片', '图片滤镜', '高清放大', '移除背景', '扩展画面', '编辑蒙版', '拆分图层'].forEach(name => fireEvent.click(screen.getByRole('button', { name })));
    expect(Object.values(imageTools).every(handler => handler.mock.calls[0][0] === mediaNode.id)).toBe(true);
    rerender(<WorkflowNodeToolbar nodes={[mediaNode]} onCopy={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '裁剪图片' })).not.toBeInTheDocument();
  });
});
