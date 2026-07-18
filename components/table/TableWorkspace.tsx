import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight, CircleCheck, Image as ImageIcon, LoaderCircle, RotateCcw,
  Save, ScanLine, Scissors, Shirt, Sparkles, Upload, Video, WandSparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelPreference, UserApiKey } from '../../types';
import { loadWorkflowMediaBlob, useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { processTableMedia, type TableProcessResult, type TableToolId } from '../../services/tableMediaProcessor';

interface TableWorkspaceProps {
  project: WorkflowProject | null;
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  initialNodeId?: string | null;
  onCommit: (result: TableProcessResult, sourceNodeId: string | null, name: string) => Promise<void> | void;
  onSaveAsset: (result: TableProcessResult, name: string) => Promise<void> | void;
  onOpenWorkflow: () => void;
  onOpenSettings: () => void;
}

const TOOLS: Array<{ id: TableToolId; name: string; detail: string; icon: typeof Sparkles; imageOnly?: boolean }> = [
  { id: 'reference', name: '全能参考准备', detail: '统一对比度与色彩，保留可识别特征', icon: WandSparkles },
  { id: 'depth', name: '深度图', detail: '生成蓝色相对深度预览；视频逐帧导出', icon: ScanLine },
  { id: 'edges', name: '边缘图', detail: '提取轮廓，适合 ControlNet 与结构参考', icon: ScanLine, imageOnly: true },
  { id: 'cutout', name: '人物抠出', detail: '调用已配置图像工具端点移除背景', icon: Scissors, imageOnly: true },
  { id: 'wardrobe', name: '服装整理', detail: '保留身份和姿态，只修改服装供后续参考', icon: Shirt, imageOnly: true },
  { id: 'film', name: '胶片滤镜', detail: '低饱和、颗粒与柔和反差', icon: Sparkles },
  { id: 'applause', name: '鼓掌滤镜', detail: '添加轻量彩纸风格化效果', icon: Sparkles },
];

export function TableWorkspace({
  project, userApiKeys, modelPreference, initialNodeId, onCommit, onSaveAsset, onOpenWorkflow, onOpenSettings,
}: TableWorkspaceProps) {
  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [localSource, setLocalSource] = useState<{ blob: Blob; name: string } | null>(null);
  const [result, setResult] = useState<TableProcessResult | null>(null);
  const [selectedTool, setSelectedTool] = useState<TableToolId>('reference');
  const [wardrobePrompt, setWardrobePrompt] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedNode = mediaNodes.find(node => node.id === selectedNodeId) || null;
  const sourceType = localSource?.blob.type || selectedNode?.metadata.mimeType || (selectedNode?.type === 'video' ? 'video/mp4' : 'image/png');
  const isVideo = sourceType.startsWith('video/');
  const sourceMedia = useWorkflowMediaUrl(selectedNode?.metadata.storageKey, selectedNode?.metadata.href);
  const localUrl = useBlobUrl(localSource?.blob || null);
  const resultUrl = useBlobUrl(result?.blob || null);
  const previewUrl = resultUrl || localUrl || sourceMedia.url;
  const sourceName = localSource?.name || selectedNode?.metadata.name || selectedNode?.title || '未选择素材';

  useEffect(() => {
    if (!mediaNodes.length || localSource) return;
    const preferred = mediaNodes.find(node => node.id === initialNodeId) || mediaNodes.find(node => project?.selectedNodeIds.includes(node.id)) || mediaNodes[0];
    setSelectedNodeId(current => current && mediaNodes.some(node => node.id === current) ? current : preferred.id);
  }, [initialNodeId, localSource, mediaNodes, project?.selectedNodeIds]);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [selectedNodeId, localSource]);

  const chooseNode = (node: WorkflowNode) => {
    setLocalSource(null);
    setSelectedNodeId(node.id);
  };

  const importFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setError('请选择图片或视频。');
      return;
    }
    setSelectedNodeId(null);
    setLocalSource({ blob: file, name: file.name });
  };

  const process = async () => {
    if (!selectedNode && !localSource) return;
    setProcessing(true);
    setError('');
    try {
      const source = localSource?.blob || await loadWorkflowMediaBlob(selectedNode?.metadata.storageKey, selectedNode?.metadata.href);
      const next = await processTableMedia(source, selectedTool, { userApiKeys, modelPreference, prompt: wardrobePrompt });
      setResult(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '预处理失败。');
    } finally {
      setProcessing(false);
    }
  };

  const hasSource = Boolean(selectedNode || localSource);

  return (
    <div className="table-workspace grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden border-t" style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink)', background: 'var(--isl-surface-sunk)' }}>
      <aside className="flex min-h-0 flex-col border-r" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}>
        <div className="border-b p-3" style={{ borderColor: 'var(--isl-border)' }}>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: 'var(--isl-ink-ghost)' }}>Input</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <strong className="truncate text-sm">单素材工作台</strong>
            <button type="button" className="isl-icon-btn h-7 w-7" title="导入本地素材" onClick={() => inputRef.current?.click()}><Upload size={14} /></button>
          </div>
          <input ref={inputRef} hidden type="file" accept="image/*,video/*" onChange={event => { importFile(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {localSource && (
            <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-lg border p-2 text-left" style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-mint-bg)' }}>
              {localSource.blob.type.startsWith('video/') ? <Video size={15} /> : <ImageIcon size={15} />}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{localSource.name}</span>
            </button>
          )}
          <p className="mb-1.5 mt-1 px-1 text-[10px] font-bold" style={{ color: 'var(--isl-ink-ghost)' }}>当前 Workflow</p>
          {mediaNodes.map(node => <TableSourceRow key={node.id} node={node} active={!localSource && node.id === selectedNodeId} onClick={() => chooseNode(node)} />)}
          {!mediaNodes.length && <div className="rounded-lg border border-dashed p-3 text-center text-[11px] leading-5" style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink-soft)' }}>Workflow 暂无图片或视频。<br />也可以直接导入本地素材。</div>}
        </div>
        <button type="button" className="m-2 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold hover:bg-black/5" onClick={onOpenWorkflow}><ArrowRight size={13} />返回 Workflow</button>
      </aside>

      <main className={`grid min-h-0 ${hasSource ? 'grid-cols-[minmax(0,1fr)_256px]' : ''}`}>
        <section className="relative flex min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b px-3" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}>
            <div className="min-w-0"><strong className="block truncate text-xs">{sourceName}</strong><span className="text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{result ? '处理结果' : '原始输入'} · {isVideo ? '视频' : '图片'}</span></div>
            {result && <button type="button" className="isl-icon-btn h-7 gap-1 px-2 text-[11px]" onClick={() => setResult(null)}><RotateCcw size={12} />原图</button>}
          </div>
          {!hasSource ? (
            <div className="grid flex-1 place-content-center p-8 text-center">
              <motion.div initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 340, damping: 25 }}>
                <Upload className="mx-auto mb-3" size={28} style={{ color: 'var(--isl-mint)' }} />
                <strong className="text-base">先选择一个输入</strong>
                <p className="mt-1 max-w-sm text-xs leading-5" style={{ color: 'var(--isl-ink-soft)' }}>从 Workflow 选择一个媒体节点，或导入本地图片 / 视频。Table 不创建第二张节点图。</p>
                <button type="button" className="mt-3 rounded-lg px-3 py-2 text-xs font-bold" style={{ background: 'var(--isl-mint)', color: 'white' }} onClick={() => inputRef.current?.click()}>导入素材</button>
              </motion.div>
            </div>
          ) : (
            <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden p-6">
              <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(var(--isl-border-strong) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
              <AnimatePresence mode="wait">
                <motion.div key={previewUrl || 'loading'} className="relative z-10 max-h-full max-w-full overflow-hidden rounded-xl border bg-black" style={{ borderColor: 'var(--isl-border-strong)', boxShadow: 'var(--isl-shadow)' }} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .98 }} transition={{ type: 'spring', stiffness: 360, damping: 28 }}>
                  {previewUrl ? (isVideo ? <video className="block max-h-[calc(100vh-170px)] max-w-full" src={previewUrl} controls playsInline preload="metadata" /> : <img className="block max-h-[calc(100vh-170px)] max-w-full object-contain" src={previewUrl} alt={sourceName} />) : <div className="grid h-52 w-80 place-items-center text-white/55"><LoaderCircle className="animate-spin" size={18} /></div>}
                </motion.div>
              </AnimatePresence>
              {processing && <div className="absolute inset-0 z-20 grid place-content-center bg-black/35 backdrop-blur-[2px]"><div className="flex items-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-xs text-white"><LoaderCircle className="animate-spin" size={14} />{isVideo ? '逐帧处理中，请保持页面打开…' : '正在处理…'}</div></div>}
            </div>
          )}
          {error && <div role="alert" className="mx-3 mb-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--isl-coral)', color: 'var(--isl-coral-deep)', background: 'color-mix(in srgb,var(--isl-coral) 9%,transparent)' }}>{error}{/API Key|模型|端点/.test(error) && <button type="button" className="ml-2 underline" onClick={onOpenSettings}>打开设置</button>}</div>}
        </section>

        {hasSource && (
          <motion.aside className="flex min-h-0 flex-col border-l" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }} initial={{ x: 18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <div className="border-b p-3" style={{ borderColor: 'var(--isl-border)' }}><p className="m-0 text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: 'var(--isl-ink-ghost)' }}>Process</p><strong className="text-sm">预处理工具</strong></div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {TOOLS.map(tool => {
                const disabled = Boolean(isVideo && tool.imageOnly);
                const Icon = tool.icon;
                return <button key={tool.id} type="button" disabled={disabled} onClick={() => setSelectedTool(tool.id)} className="flex w-full gap-2 rounded-lg border p-2 text-left transition disabled:cursor-not-allowed disabled:opacity-35" style={{ borderColor: selectedTool === tool.id ? 'var(--isl-mint)' : 'transparent', background: selectedTool === tool.id ? 'var(--isl-mint-bg)' : 'transparent' }}><Icon className="mt-0.5 shrink-0" size={14} /><span><strong className="block text-xs">{tool.name}</strong><span className="mt-0.5 block text-[10px] leading-4" style={{ color: 'var(--isl-ink-soft)' }}>{tool.detail}</span></span></button>;
              })}
              {selectedTool === 'wardrobe' && <motion.textarea initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 78 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }} className="mt-2 w-full resize-none rounded-lg border p-2 text-[11px] outline-none" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-sunk)' }} value={wardrobePrompt} onChange={event => setWardrobePrompt(event.target.value)} placeholder="可选：描述目标服装；留空使用中性基础款" />}
            </div>
            <div className="space-y-2 border-t p-3" style={{ borderColor: 'var(--isl-border)' }}>
              {!result ? <button type="button" disabled={processing} onClick={() => void process()} className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold disabled:opacity-45" style={{ background: 'var(--isl-mint)', color: 'white' }}><WandSparkles size={14} />执行处理</button> : <><div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--isl-mint-deep)' }}><CircleCheck size={13} />结果已就绪</div><button type="button" onClick={() => void onCommit(result, selectedNode?.id || null, `${sourceName}-${selectedTool}`)} className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold" style={{ background: 'var(--isl-mint)', color: 'white' }}><ArrowRight size={14} />发送到 Workflow</button><button type="button" onClick={() => void onSaveAsset(result, `${sourceName}-${selectedTool}`)} className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold" style={{ borderColor: 'var(--isl-border)' }}><Save size={13} />保存到素材库</button></>}
            </div>
          </motion.aside>
        )}
      </main>
    </div>
  );
}

function TableSourceRow({ node, active, onClick }: { node: WorkflowNode; active: boolean; onClick: () => void }) {
  const media = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  return <button type="button" onClick={onClick} className="mb-1 flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition" style={{ borderColor: active ? 'var(--isl-mint)' : 'transparent', background: active ? 'var(--isl-mint-bg)' : 'transparent' }}>
    <span className="grid h-9 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-black/10">{media.url ? (node.type === 'video' ? <video src={media.url} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={media.url} alt="" className="h-full w-full object-cover" />) : node.type === 'video' ? <Video size={14} /> : <ImageIcon size={14} />}</span>
    <span className="min-w-0"><strong className="block truncate text-[11px]">{node.metadata.name || node.title}</strong><span className="text-[9px]" style={{ color: 'var(--isl-ink-ghost)' }}>{node.type === 'video' ? '视频节点' : '图片节点'}</span></span>
  </button>;
}

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
