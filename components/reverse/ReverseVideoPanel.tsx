import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appendPlannedOutputs, buildShotsFromCuts, expandVariantMatrix, planRun, readReference, wordRangeForShot, wordsText } from '../../services/reverse/video';
import type { ReferenceReading } from '../../services/reverse/video';
import { parseTranscriptJson } from '../../services/reverse/evidence';
import { planTarget, segmentsFromNarrative } from '../../services/reverse/target';
import { findReverseSubgraphFrame, sendReverseAsSubgraph } from '../../services/reverse/workflowBridge';
import { useWorkflowStore } from '../../components/workflow/store';
import type {
  ReverseCue,
  ReverseScriptDiagnostic,
  ReverseShot,
  ReverseSlot,
  ReverseSlotKind,
  ReverseTranscript,
  ReverseVariant,
  ReverseVideoAnalysis,
  ReverseVideoProject,
} from '../../services/reverse/types';
import { REVERSE_STEPS, initialOpen, newlyUnlocked, reverseSteps, type ReverseStepId, type ReverseStepState } from '../../services/reverse/disclosure';

export interface ReverseVideoPanelProps {
  project: ReverseVideoProject;
  language: 'en' | 'zho';
  workflowProjectId: string | null;
  onUpdate: (update: (project: ReverseVideoProject) => ReverseVideoProject) => void;
  /** 切回 Canvas 并定位到本工程的子画布框。 */
  onOpenInCanvas?: (nodeId: string) => void;
}

const SLOT_KINDS: ReverseSlotKind[] = ['character', 'product', 'copy', 'broll', 'voice', 'music', 'asset'];

const TEXT = {
  zho: {
    reference: '参考视频', refLabel: '名称', refLocator: '链接或本地路径', refNotes: '参考笔记：结构、节奏、值得保留的点', add: '添加',
    briefTitle: 'Brief / Treatment', brief: 'Brief：目标、事实、约束、已同意的付费范围', treatment: 'Treatment：针对 Brief 的创作方案',
    analysis: '拆解', duration: '时长（秒）', cuts: '切点（秒，逗号分隔）', apply: '生成镜头表',
    script: '参考转写稿。段头 [hook] 或 [段id:角色]，说话人 <A>，选区 @{名}…@{/名}，时刻 @{名!}',
    analysisHint: '未导入转写前，词时间在时长内按字长摊开，仅为占位。', badDuration: '请填写有效时长', shotDesc: '镜头描述（景别、动作）',
    transcript: '导入转写 JSON（WhisperX 或词数组）', transcriptBad: '无法识别的转写文件', transcriptOk: (n: number) => '已导入 ' + n + ' 个转写词并重新对齐',
    alignStat: (exact: number, measured: number, total: number) => '对齐：精确匹配 ' + exact + '%，实测 ' + measured + ' / ' + total + ' 词',
    noTranscript: '尚无转写：时间为占位估计', diagLine: (line: number) => '第 ' + line + ' 行：',
    cue: '跟随', noCue: '不跟随（顺延原时长）', notes: '整体理解：结构、节奏、为什么有效',
    target: '目标稿', targetScript: '目标稿：沿用参考里同名的选区 / 时刻，镜头按它们重新定时',
    targetHint: (sec: string) => '按参考语速估计时长 ' + sec + '（导入目标配音前仅为估计）',
    targetNeed: '先生成镜头表并填写目标稿', anchored: '跟随 cue', estimated: '顺延',
    slots: '替换槽位', slotLabel: '槽位名', slotOriginal: '原作内容（仅规格）', replacement: '替换为', remove: '删除',
    axes: '变体轴', axisLabel: '轴名（如 Hook）', axisTarget: '作用于', axisOptions: '选项，逗号分隔', pickTarget: '选择槽位或段',
    matrix: '变体矩阵', base: '原版', truncated: '组合超过上限，只展开前 64 个',
    canvas: '画布', toCanvas: '转为画布', syncCanvas: '同步到画布', openCanvas: '在画布中打开',
    needWorkflow: '先在画布里打开一个 Workflow 项目', needShots: '先生成镜头表',
    converted: '已转为画布上的子画布；双击子画布可回到逆向。', synced: '已同步到子画布：只增改变化项，保留画布上已选的版本。', upToDate: '子画布已是最新，无需同步。', failed: '写入失败：',
    renderPlan: (gen: number, reused: number) => '需生成 ' + gen + ' 个镜头，按内容 key 复用 ' + reused + ' 个',
    total: (n: number) => '共 ' + n + ' 组',
    optional: '可选', variants: '替换与变体', sumRefs: (n: number) => n + ' 个参考',
    sumShots: (n: number, dur: string) => n + ' 个镜头 · ' + dur,
    sumVariants: (s: number, a: number, v: number) => s + ' 个槽位 · ' + a + ' 条轴 · ' + v + ' 组',
    sumCanvas: '已转为子画布',
  },
  en: {
    reference: 'Reference video', refLabel: 'Name', refLocator: 'URL or local path', refNotes: 'Reference notes: structure, pacing, what to keep', add: 'Add',
    briefTitle: 'Brief / Treatment', brief: 'Brief: goal, facts, constraints, approved spend', treatment: 'Treatment: the creative answer to the brief',
    analysis: 'Breakdown', duration: 'Duration (s)', cuts: 'Cut points (s, comma separated)', apply: 'Build shot list',
    script: 'Reference transcript. Headers [hook] or [id:role], speaker <A>, selection @{name}…@{/name}, moment @{name!}',
    analysisHint: 'Until a transcript is imported, word timings are spread over the duration as placeholders.', badDuration: 'Enter a valid duration', shotDesc: 'Shot description (framing, action)',
    transcript: 'Import transcript JSON (WhisperX or word array)', transcriptBad: 'Unrecognised transcript file', transcriptOk: (n: number) => n + ' transcript words imported and re-aligned',
    alignStat: (exact: number, measured: number, total: number) => 'Alignment: ' + exact + '% exact, ' + measured + ' / ' + total + ' words measured',
    noTranscript: 'No transcript yet: timings are placeholders', diagLine: (line: number) => 'Line ' + line + ': ',
    cue: 'Follows', noCue: 'No cue (keep duration)', notes: 'Overall reading: structure, pacing, why it works',
    target: 'Target script', targetScript: 'Target script: reuse the reference selection / moment names; shots retime to them',
    targetHint: (sec: string) => 'Estimated length ' + sec + ' at the reference pace (an estimate until target audio exists)',
    targetNeed: 'Build the shot list and write a target script first', anchored: 'cue', estimated: 'carried',
    slots: 'Replaceable slots', slotLabel: 'Slot name', slotOriginal: 'Original content (spec only)', replacement: 'Replace with', remove: 'Remove',
    axes: 'Variant axes', axisLabel: 'Axis (e.g. Hook)', axisTarget: 'Applies to', axisOptions: 'Options, comma separated', pickTarget: 'Pick a slot or segment',
    matrix: 'Variant matrix', base: 'Base', truncated: 'Too many combinations; only the first 64 are expanded',
    canvas: 'Canvas', toCanvas: 'Convert to canvas', syncCanvas: 'Sync to canvas', openCanvas: 'Open in canvas',
    needWorkflow: 'Open a Workflow project on the canvas first', needShots: 'Build the shot list first',
    converted: 'Converted to a subgraph on the canvas; double-click it to come back to Reverse.', synced: 'Subgraph synced: only changed items were added or updated; versions picked on the canvas are kept.', upToDate: 'The subgraph is already up to date.', failed: 'Write failed: ',
    renderPlan: (gen: number, reused: number) => gen + ' shots to generate, ' + reused + ' reused by content key',
    total: (n: number) => n + ' combos',
    optional: 'Optional', variants: 'Slots & variants', sumRefs: (n: number) => n + (n === 1 ? ' reference' : ' references'),
    sumShots: (n: number, dur: string) => n + ' shots · ' + dur,
    sumVariants: (s: number, a: number, v: number) => s + ' slots · ' + a + ' axes · ' + v + ' combos',
    sumCanvas: 'Converted to a subgraph',
  },
};

const inputClass = 'w-full min-w-0 rounded-md px-2 py-1 text-xs outline-none';
const inputStyle: React.CSSProperties = { background: 'var(--isl-surface-1, transparent)', border: '1px solid var(--isl-line, rgba(127,127,127,0.25))', color: 'var(--isl-ink)' };
const btnClass = 'isl-opt shrink-0 rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40';
const ghost: React.CSSProperties = { color: 'var(--isl-ink-ghost)' };
const soft: React.CSSProperties = { color: 'var(--isl-ink-soft)' };

function newId(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 8);
}

function parseSeconds(text: string): number[] {
  return text.replace(/，/g, ',').split(/[ ,;]+/).filter(Boolean).map(Number).filter(Number.isFinite).map((s) => Math.round(s / 0.001));
}

function fmt(ms: number): string {
  return (ms / 1000).toFixed(1) + 's';
}

function cueValue(cue: ReverseCue | undefined): string {
  return cue ? cue.kind + ':' + cue.id : '';
}

function parseCue(value: string): ReverseCue | undefined {
  const sep = value.indexOf(':');
  if (sep < 0) return undefined;
  const kind = value.slice(0, sep);
  if (kind !== 'selection' && kind !== 'moment' && kind !== 'segment') return undefined;
  return { kind, id: value.slice(sep + 1) };
}

// 参考读数 → 分析：词与段由 narrative + alignment 派生；保留整体理解与时间笔记。
function analysisFrom(
  prev: ReverseVideoAnalysis | undefined,
  base: { durationMs: number; shots: ReverseShot[]; script: string },
  reading: ReferenceReading,
  transcript: ReverseTranscript | undefined,
): ReverseVideoAnalysis {
  const next: ReverseVideoAnalysis = {
    ...(prev ?? {}),
    durationMs: base.durationMs,
    shots: base.shots,
    script: base.script,
    words: reading.words,
    segments: segmentsFromNarrative(reading.narrative, reading.words),
    narrative: reading.narrative,
    alignment: reading.alignment,
    pacing: { avgShotMs: Math.round(base.durationMs / Math.max(1, base.shots.length)), hookMs: base.shots[0]?.endMs ?? 0 },
    analyzedAt: new Date().toISOString(),
    source: transcript ? 'alignment' : 'manual',
  };
  if (transcript) next.transcript = transcript;
  else delete next.transcript;
  return next;
}

interface StepProps {
  id: ReverseStepId;
  index: number;
  title: string;
  state: ReverseStepState;
  open: boolean;
  summary: string;
  lockHint: string;
  extra?: React.ReactNode;
  onToggle: () => void;
  children: React.ReactNode;
}

// 分步卡：未解锁只留标题和解锁条件；折叠时标题行显示摘要；点标题展开 / 收起。
function Step({ id, index, title, state, open, summary, lockHint, extra, onToggle, children }: StepProps) {
  const bodyId = 'reverse-step-body-' + id;
  const expanded = state.unlocked && open;
  return (
    <section
      className='settings-elevated settings-elevated--soft rounded-xl p-4'
      style={{ background: 'var(--isl-surface-2)', opacity: state.unlocked ? 1 : 0.6 }}
      data-testid={'reverse-step-' + id}
      data-unlocked={state.unlocked}
      data-complete={state.complete}
    >
      <div className='flex items-center justify-between gap-2'>
        <h3 className='min-w-0 flex-1 text-xs font-bold'>
          <button
            type='button'
            className='flex w-full min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed'
            disabled={!state.unlocked}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
            data-testid={'reverse-step-toggle-' + id}
          >
            <span
              className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold'
              style={state.complete ? { background: 'var(--isl-ink)', color: 'var(--isl-surface-2)' } : { background: 'rgba(127,127,127,0.18)' }}
            >
              {state.complete ? '✓' : index}
            </span>
            <span className='shrink-0'>{title}</span>
            {!expanded && <span className='min-w-0 truncate text-[11px] font-normal' style={ghost}>{state.unlocked ? summary : lockHint}</span>}
            {state.unlocked && <span aria-hidden className='ml-auto shrink-0 text-[10px] font-normal' style={ghost}>{expanded ? '▾' : '▸'}</span>}
          </button>
        </h3>
        {state.unlocked && extra}
      </div>
      {expanded && <div id={bodyId} className='mt-3'>{children}</div>}
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <h4 className='mb-2 mt-4 text-[11px] font-semibold' style={soft}>{children}</h4>;
}

function Diagnostics({ items, label }: { items: readonly ReverseScriptDiagnostic[]; label: (line: number) => string }) {
  if (!items.length) return null;
  return (
    <ul className='mt-2 flex flex-col gap-0.5 text-[11px]' style={{ color: 'var(--isl-coral-deep)' }} data-testid='reverse-diagnostics'>
      {items.map((d, i) => <li key={i}>{label(d.line) + d.message}</li>)}
    </ul>
  );
}

export function ReverseVideoPanel({ project, language, workflowProjectId, onUpdate, onOpenInCanvas }: ReverseVideoPanelProps) {
  const t = TEXT[language];
  const analysis = project.analysis;
  const shots = analysis?.shots ?? [];
  const words = analysis?.words ?? [];

  const [refLabel, setRefLabel] = useState('');
  const [refLocator, setRefLocator] = useState('');
  const [refNotes, setRefNotes] = useState('');
  const [durationSec, setDurationSec] = useState(analysis ? String(analysis.durationMs / 1000) : '');
  const [cutsSec, setCutsSec] = useState(analysis ? shots.slice(1).map((s) => s.startMs / 1000).join(', ') : '');
  const [script, setScript] = useState(analysis ? (analysis.script ?? analysis.segments.map((s) => s.text).join(' ')) : '');
  const [diagnostics, setDiagnostics] = useState<ReverseScriptDiagnostic[]>([]);
  const [slotKind, setSlotKind] = useState<ReverseSlotKind>('product');
  const [slotLabel, setSlotLabel] = useState('');
  const [slotOriginal, setSlotOriginal] = useState('');
  const [axisLabel, setAxisLabel] = useState('');
  const [axisTarget, setAxisTarget] = useState('');
  const [axisOptions, setAxisOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null);

  const expansion = useMemo(() => expandVariantMatrix(project.axes, project.variants), [project.axes, project.variants]);
  const target = useMemo(() => planTarget(project), [project]);
  const run = useMemo(
    () => planRun({ ...project, variants: expansion.variants }, target ? target.dialogueFor : undefined),
    [project, expansion.variants, target],
  );
  const frameId = useWorkflowStore((s) => (workflowProjectId
    ? findReverseSubgraphFrame(s.projects.find((p) => p.id === workflowProjectId), project.id)?.id ?? null
    : null));
  const windowsById = useMemo(() => new Map((target?.windows ?? []).map((w) => [w.shotId, w] as const)), [target]);

  const cueOptions = useMemo(() => {
    const n = analysis?.narrative;
    if (!n) return [];
    return [
      ...n.selections.map((s) => ({ value: 'selection:' + s.id, label: '@{' + s.id + '}' })),
      ...n.moments.map((m) => ({ value: 'moment:' + m.id, label: '@{' + m.id + '!}' })),
      ...n.segments.map((s) => ({ value: 'segment:' + s.id, label: '[' + s.id + ']' })),
    ];
  }, [analysis?.narrative]);

  const timings = analysis?.alignment?.timings ?? [];
  const measured = timings.filter((x) => x.measured).length;
  const exactPct = Math.round((analysis?.alignment?.exactRatio ?? 0) / 0.01);

  const steps = useMemo(() => reverseSteps({
    references: project.references.length,
    shots: shots.length,
    hasTarget: Boolean(target),
    axes: project.axes.length,
    hasFrame: Boolean(frameId),
  }), [project.references.length, shots.length, target, project.axes.length, frameId]);
  const stepById = useMemo(() => new Map(steps.map((s) => [s.id, s] as const)), [steps]);
  const [open, setOpen] = useState(() => initialOpen(steps));
  const seenUnlocked = useRef(new Set<ReverseStepId>(steps.filter((s) => s.unlocked).map((s) => s.id)));
  useEffect(() => {
    const fresh = newlyUnlocked(seenUnlocked.current, steps);
    seenUnlocked.current = new Set(steps.filter((s) => s.unlocked).map((s) => s.id));
    if (fresh.length) setOpen((o) => ({ ...o, ...Object.fromEntries(fresh.map((id) => [id, true])) }));
  }, [steps]);
  const stepProps = (id: ReverseStepId) => ({
    id,
    index: REVERSE_STEPS.indexOf(id) + 1,
    state: stepById.get(id)!,
    open: open[id],
    lockHint: t.needShots,
    onToggle: () => setOpen((o) => ({ ...o, [id]: !o[id] })),
  });

  const addReference = () => {
    const locator = refLocator.trim();
    if (!locator) return;
    const notes = refNotes.trim();
    onUpdate((p) => ({
      ...p,
      references: [...p.references, {
        id: newId('ref'),
        kind: /^https?:/i.test(locator) ? 'video-url' : 'video-file',
        label: refLabel.trim() || locator,
        locator,
        importedAt: new Date().toISOString(),
        ...(notes ? { notes } : {}),
      }],
    }));
    setRefLabel(''); setRefLocator(''); setRefNotes('');
  };

  const applyAnalysis = () => {
    const durationMs = Math.round(Number(durationSec) / 0.001);
    if (!Number.isFinite(durationMs) || durationMs <= 0) { setAnalysisNotice(t.badDuration); return; }
    const cuts = parseSeconds(cutsSec);
    const text = script.trim();
    const transcript = analysis?.transcript;
    const reading = readReference(text, durationMs, transcript);
    setDiagnostics(reading.diagnostics);
    onUpdate((p) => {
      const prev = p.analysis?.shots ?? [];
      const nextShots = buildShotsFromCuts(cuts, durationMs).map((s, i) => {
        const old = prev[i];
        if (!old) return s;
        return {
          ...s,
          slotIds: old.slotIds,
          ...(old.description ? { description: old.description } : {}),
          ...(old.camera ? { camera: old.camera } : {}),
          ...(old.segmentId ? { segmentId: old.segmentId } : {}),
          ...(old.cue ? { cue: old.cue } : {}),
        };
      });
      return { ...p, status: 'ready', analysis: analysisFrom(p.analysis, { durationMs, shots: nextShots, script: text }, reading, transcript) };
    });
    setAnalysisNotice(null);
  };

  const importTranscript = async (file: File | undefined) => {
    if (!file || !analysis) return;
    let parsed: ReverseTranscript | null = null;
    try {
      parsed = parseTranscriptJson(JSON.parse(await file.text()));
    } catch {
      parsed = null;
    }
    if (!parsed || !parsed.words.length) { setAnalysisNotice(t.transcriptBad); return; }
    const transcript = parsed;
    const text = analysis.script ?? script.trim();
    const reading = readReference(text, analysis.durationMs, transcript);
    setDiagnostics(reading.diagnostics);
    onUpdate((p) => (p.analysis
      ? { ...p, analysis: analysisFrom(p.analysis, { durationMs: p.analysis.durationMs, shots: p.analysis.shots, script: text }, reading, transcript) }
      : p));
    setAnalysisNotice(t.transcriptOk(transcript.words.length));
  };

  const updateAnalysis = (patch: Partial<ReverseVideoAnalysis>) => onUpdate((p) => (p.analysis ? { ...p, analysis: { ...p.analysis, ...patch } } : p));

  const updateShot = (id: string, patch: Partial<ReverseShot>) => onUpdate((p) => (p.analysis
    ? { ...p, analysis: { ...p.analysis, shots: p.analysis.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) } }
    : p));

  const setShotCue = (id: string, value: string) => onUpdate((p) => {
    if (!p.analysis) return p;
    const cue = parseCue(value);
    const nextShots = p.analysis.shots.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s };
      if (cue) next.cue = cue;
      else delete next.cue;
      return next;
    });
    return { ...p, analysis: { ...p.analysis, shots: nextShots } };
  });

  const toggleShotSlot = (shot: ReverseShot, slotId: string) => updateShot(shot.id, {
    slotIds: shot.slotIds.includes(slotId) ? shot.slotIds.filter((x) => x !== slotId) : [...shot.slotIds, slotId],
  });

  const addSlot = () => {
    const label = slotLabel.trim();
    if (!label) return;
    const original = slotOriginal.trim();
    onUpdate((p) => ({ ...p, slots: [...p.slots, { id: newId('slot'), kind: slotKind, label, ...(original ? { original } : {}) }] }));
    setSlotLabel(''); setSlotOriginal('');
  };

  const updateSlot = (id: string, patch: Partial<ReverseSlot>) => onUpdate((p) => ({ ...p, slots: p.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const removeSlot = (id: string) => onUpdate((p) => {
    const axes = p.axes
      .map((a) => ({ ...a, targets: a.targets.filter((tg) => !(tg.kind === 'slot' && tg.id === id)) }))
      .filter((a) => a.targets.length > 0);
    return {
      ...p,
      slots: p.slots.filter((s) => s.id !== id),
      axes,
      variants: expandVariantMatrix(axes, p.variants).variants,
      analysis: p.analysis ? { ...p.analysis, shots: p.analysis.shots.map((s) => ({ ...s, slotIds: s.slotIds.filter((x) => x !== id) })) } : p.analysis,
    };
  });

  const commitAxes = (fn: (axes: ReverseVideoProject['axes']) => ReverseVideoProject['axes']) => onUpdate((p) => {
    const axes = fn(p.axes);
    return { ...p, axes, variants: expandVariantMatrix(axes, p.variants).variants };
  });

  const addAxis = () => {
    const label = axisLabel.trim();
    const opts = axisOptions.replace(/，/g, ',').split(',').map((s) => s.trim()).filter(Boolean);
    const sep = axisTarget.indexOf(':');
    if (!label || !opts.length || sep < 0) return;
    const kind = axisTarget.slice(0, sep) === 'slot' ? 'slot' as const : 'segment' as const;
    const targetId = axisTarget.slice(sep + 1);
    commitAxes((axes) => [...axes, {
      id: newId('axis'),
      label,
      targets: [{ kind, id: targetId }],
      options: opts.map((o, i) => ({ id: 'o' + (i + 1), label: o, value: o })),
    }]);
    setAxisLabel(''); setAxisOptions('');
  };

  const toggleVariant = (id: string) => onUpdate((p) => ({
    ...p,
    variants: expandVariantMatrix(p.axes, p.variants).variants.map((v) => (v.id === id ? { ...v, enabled: !v.enabled } : v)),
  }));

  const variantLabel = (v: ReverseVariant) => project.axes
    .filter((a) => v.picks[a.id])
    .map((a) => a.options.find((o) => o.id === v.picks[a.id])?.label ?? v.picks[a.id])
    .join(' / ') || t.base;

  const targetName = (kind: 'slot' | 'segment', id: string) => (kind === 'slot'
    ? project.slots.find((s) => s.id === id)?.label
    : analysis?.segments.find((s) => s.id === id)?.id) ?? id;

  // 转为画布 / 同步到画布：一次 workflow.apply 打包子画布与子节点；生成仍在画布里由人批准运行。
  const sendToCanvas = async () => {
    if (!workflowProjectId || !shots.length) return;
    setBusy(true);
    try {
      const res = await sendReverseAsSubgraph(workflowProjectId, project);
      if (!res.ok) { setNotice(t.failed + res.message); return; }
      if (res.mode === 'noop') { setNotice(t.upToDate); return; }
      const now = new Date().toISOString();
      const pending = run.steps.filter((s) => !s.reuse);
      onUpdate((p) => ({
        ...p,
        workflowProjectId,
        // 只登记计划：素材尚未生成，不能带 completed 语义，也不能被 planRun 复用。
        outputs: appendPlannedOutputs(p.outputs, pending, { workflowProjectId, workflowNodeId: res.frameId, now, createId: () => newId('out') }),
      }));
      setNotice(res.mode === 'create' ? t.converted : t.synced);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-4' data-testid='reverse-video-panel'>
      <Step {...stepProps('reference')} title={t.reference} summary={project.references.length ? t.sumRefs(project.references.length) : t.optional}>
        {project.references.length > 0 && (
          <ul className='mb-3 flex flex-col gap-1'>
            {project.references.map((r) => (
              <li key={r.id} className='flex min-w-0 items-baseline gap-2 text-xs'>
                <span className='font-semibold'>{r.label}</span>
                <span className='min-w-0 truncate' style={ghost}>{r.locator}</span>
                <button type='button' className='ml-auto text-[11px] opacity-50 hover:opacity-90' onClick={() => onUpdate((p) => ({ ...p, references: p.references.filter((x) => x.id !== r.id) }))}>{t.remove}</button>
              </li>
            ))}
          </ul>
        )}
        <div className='flex gap-2'>
          <input className={inputClass + ' max-w-[10rem]'} style={inputStyle} placeholder={t.refLabel} value={refLabel} onChange={(e) => setRefLabel(e.target.value)} />
          <input className={inputClass} style={inputStyle} placeholder={t.refLocator} value={refLocator} onChange={(e) => setRefLocator(e.target.value)} />
          <button type='button' className={btnClass} disabled={!refLocator.trim()} onClick={addReference}>{t.add}</button>
        </div>
        <textarea className={inputClass + ' mt-2'} style={inputStyle} rows={2} placeholder={t.refNotes} value={refNotes} onChange={(e) => setRefNotes(e.target.value)} />
        <SubHead>{t.briefTitle}</SubHead>
        <div className='grid grid-cols-2 gap-2'>
          <textarea className={inputClass} style={inputStyle} rows={3} placeholder={t.brief} value={project.brief ?? ''} onChange={(e) => onUpdate((p) => ({ ...p, brief: e.target.value }))} data-testid='reverse-brief' />
          <textarea className={inputClass} style={inputStyle} rows={3} placeholder={t.treatment} value={project.treatment ?? ''} onChange={(e) => onUpdate((p) => ({ ...p, treatment: e.target.value }))} data-testid='reverse-treatment' />
        </div>
      </Step>

      <Step {...stepProps('analysis')} title={t.analysis} summary={analysis && shots.length ? t.sumShots(shots.length, fmt(analysis.durationMs)) : ''}>
        <div className='grid grid-cols-[8rem_1fr] gap-2'>
          <input className={inputClass} style={inputStyle} inputMode='decimal' placeholder={t.duration} value={durationSec} onChange={(e) => setDurationSec(e.target.value)} />
          <input className={inputClass} style={inputStyle} placeholder={t.cuts} value={cutsSec} onChange={(e) => setCutsSec(e.target.value)} />
        </div>
        <textarea className={inputClass + ' mt-2 font-mono'} style={inputStyle} rows={4} placeholder={t.script} value={script} onChange={(e) => setScript(e.target.value)} data-testid='reverse-script' />
        <div className='mt-2 flex flex-wrap items-center gap-3'>
          <button type='button' className={btnClass} onClick={applyAnalysis} data-testid='reverse-apply-analysis'>{t.apply}</button>
          <label className='flex items-center gap-2 text-[11px]' style={soft}>
            <span>{t.transcript}</span>
            <input type='file' accept='.json,application/json' className='max-w-[14rem] text-[11px]' disabled={!analysis} onChange={(e) => { void importTranscript(e.target.files?.[0]); e.target.value = ''; }} data-testid='reverse-transcript' />
          </label>
        </div>
        <p className='mt-1 text-[11px]' style={ghost}>
          {analysisNotice ?? (analysis
            ? (analysis.transcript ? t.alignStat(exactPct, measured, timings.length) : t.noTranscript + ' · ' + t.analysisHint)
            : t.analysisHint)}
        </p>
        <Diagnostics items={diagnostics} label={t.diagLine} />
        {shots.length > 0 && (
          <>
            <div className='mt-4 flex h-7 w-full overflow-hidden rounded-md' data-testid='reverse-timeline'>
              {shots.map((s, i) => (
                <div
                  key={s.id}
                  title={'#' + s.index + ' ' + fmt(s.startMs) + ' - ' + fmt(s.endMs)}
                  className='flex items-center justify-center text-[10px] font-semibold'
                  style={{ flexGrow: s.endMs - s.startMs, flexBasis: 0, background: i % 2 ? 'rgba(127,127,127,0.12)' : 'rgba(127,127,127,0.24)', borderRight: '1px solid var(--isl-surface-2)' }}
                >
                  {s.index}
                </div>
              ))}
            </div>
            <div className='mt-3 flex flex-col gap-2'>
              {shots.map((s) => {
                const line = wordsText(words, wordRangeForShot(words, s));
                return (
                  <div key={s.id} className='grid grid-cols-[2.5rem_6.5rem_1fr] items-start gap-2 text-xs'>
                    <span className='pt-1 font-bold'>{'#' + s.index}</span>
                    <span className='pt-1' style={soft}>{fmt(s.startMs) + ' - ' + fmt(s.endMs)}</span>
                    <div className='flex min-w-0 flex-col gap-1'>
                      <div className='flex gap-2'>
                        <input className={inputClass} style={inputStyle} placeholder={t.shotDesc} value={s.description ?? ''} onChange={(e) => updateShot(s.id, { description: e.target.value })} />
                        <select className={inputClass + ' max-w-[9rem]'} style={inputStyle} value={cueValue(s.cue)} onChange={(e) => setShotCue(s.id, e.target.value)} aria-label={t.cue} data-testid='reverse-shot-cue'>
                          <option value=''>{t.noCue}</option>
                          {cueOptions.map((o) => <option key={o.value} value={o.value}>{t.cue + ' ' + o.label}</option>)}
                        </select>
                      </div>
                      {line ? <span className='truncate text-[11px]' style={soft}>{'“' + line + '”'}</span> : null}
                      {project.slots.length > 0 && (
                        <div className='flex flex-wrap gap-1'>
                          {project.slots.map((sl) => {
                            const on = s.slotIds.includes(sl.id);
                            return (
                              <button key={sl.id} type='button' onClick={() => toggleShotSlot(s, sl.id)} className={'rounded-full px-2 py-0.5 text-[10px] ' + (on ? 'bg-black/10 font-semibold' : 'opacity-50 hover:opacity-80')}>
                                {sl.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <textarea className={inputClass + ' mt-3'} style={inputStyle} rows={3} placeholder={t.notes} value={analysis?.notes ?? ''} onChange={(e) => updateAnalysis({ notes: e.target.value })} data-testid='reverse-analysis-notes' />
          </>
        )}
      </Step>

      <Step {...stepProps('target')} title={t.target} summary={target ? t.targetHint(fmt(target.durationMs)) : ''}>
        <textarea className={inputClass + ' font-mono'} style={inputStyle} rows={3} placeholder={t.targetScript} value={project.targetScript ?? ''} onChange={(e) => onUpdate((p) => ({ ...p, targetScript: e.target.value }))} data-testid='reverse-target-script' />
        {target ? (
          <>
            <p className='mt-1 text-[11px]' style={ghost}>{t.targetHint(fmt(target.durationMs))}</p>
            <Diagnostics items={target.reading.diagnostics} label={t.diagLine} />
            <div className='mt-2 flex flex-col gap-1' data-testid='reverse-target-windows'>
              {shots.map((s) => {
                const w = windowsById.get(s.id);
                if (!w) return null;
                const line = target.dialogueFor(s);
                return (
                  <div key={s.id} className='grid grid-cols-[2.5rem_6.5rem_4.5rem_1fr] items-baseline gap-2 text-xs'>
                    <span className='font-bold'>{'#' + s.index}</span>
                    <span style={soft}>{fmt(w.startMs) + ' - ' + fmt(w.endMs)}</span>
                    <span className='text-[10px]' style={w.anchored ? undefined : ghost}>{w.anchored ? t.anchored : t.estimated}</span>
                    <span className='min-w-0 truncate text-[11px]' style={soft}>{line ? '“' + line + '”' : ''}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className='mt-1 text-[11px]' style={ghost}>{t.targetNeed}</p>
        )}
      </Step>

      <Step {...stepProps('variants')} title={t.variants} summary={t.sumVariants(project.slots.length, project.axes.length, expansion.total)}>
        <h4 className='mb-2 text-[11px] font-semibold' style={soft}>{t.slots}</h4>
        {project.slots.length > 0 && (
          <ul className='mb-3 flex flex-col gap-2'>
            {project.slots.map((sl) => (
              <li key={sl.id} className='grid grid-cols-[5rem_8rem_1fr_auto] items-center gap-2 text-xs'>
                <span className='rounded px-1.5 py-0.5 text-center text-[10px]' style={{ background: 'rgba(127,127,127,0.15)' }}>{sl.kind}</span>
                <span className='min-w-0 truncate font-semibold' title={sl.original}>{sl.label}</span>
                <input className={inputClass} style={inputStyle} placeholder={t.replacement + (sl.original ? ' (' + sl.original + ')' : '')} value={sl.replacement ?? ''} onChange={(e) => updateSlot(sl.id, { replacement: e.target.value })} />
                <button type='button' className='text-[11px] opacity-50 hover:opacity-90' onClick={() => removeSlot(sl.id)}>{t.remove}</button>
              </li>
            ))}
          </ul>
        )}
        <div className='flex gap-2'>
          <select className={inputClass + ' max-w-[7rem]'} style={inputStyle} value={slotKind} onChange={(e) => setSlotKind(e.target.value as ReverseSlotKind)}>
            {SLOT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className={inputClass + ' max-w-[10rem]'} style={inputStyle} placeholder={t.slotLabel} value={slotLabel} onChange={(e) => setSlotLabel(e.target.value)} />
          <input className={inputClass} style={inputStyle} placeholder={t.slotOriginal} value={slotOriginal} onChange={(e) => setSlotOriginal(e.target.value)} />
          <button type='button' className={btnClass} disabled={!slotLabel.trim()} onClick={addSlot}>{t.add}</button>
        </div>

        <SubHead>{t.axes}</SubHead>
        {project.axes.length > 0 && (
          <ul className='mb-3 flex flex-col gap-2'>
            {project.axes.map((a) => (
              <li key={a.id} className='flex min-w-0 flex-wrap items-center gap-2 text-xs'>
                <span className='font-semibold'>{a.label}</span>
                <span style={ghost}>{'→ ' + a.targets.map((tg) => targetName(tg.kind, tg.id)).join(', ')}</span>
                {a.options.map((o) => <span key={o.id} className='rounded-full px-2 py-0.5 text-[10px]' style={{ background: 'rgba(127,127,127,0.15)' }}>{o.label}</span>)}
                <button type='button' className='ml-auto text-[11px] opacity-50 hover:opacity-90' onClick={() => commitAxes((axes) => axes.filter((x) => x.id !== a.id))}>{t.remove}</button>
              </li>
            ))}
          </ul>
        )}
        <div className='flex gap-2'>
          <input className={inputClass + ' max-w-[9rem]'} style={inputStyle} placeholder={t.axisLabel} value={axisLabel} onChange={(e) => setAxisLabel(e.target.value)} />
          <select className={inputClass + ' max-w-[10rem]'} style={inputStyle} value={axisTarget} onChange={(e) => setAxisTarget(e.target.value)} aria-label={t.axisTarget}>
            <option value=''>{t.pickTarget}</option>
            {project.slots.map((sl) => <option key={sl.id} value={'slot:' + sl.id}>{sl.label}</option>)}
            {(analysis?.segments ?? []).map((sg) => <option key={sg.id} value={'segment:' + sg.id}>{sg.id}</option>)}
          </select>
          <input className={inputClass} style={inputStyle} placeholder={t.axisOptions} value={axisOptions} onChange={(e) => setAxisOptions(e.target.value)} />
          <button type='button' className={btnClass} disabled={!axisLabel.trim() || !axisTarget || !axisOptions.trim()} onClick={addAxis}>{t.add}</button>
        </div>

        <SubHead>{t.matrix + ' · ' + t.total(expansion.total)}</SubHead>
        {expansion.truncated && <p className='mb-2 text-[11px]' style={{ color: 'var(--isl-coral-deep)' }}>{t.truncated}</p>}
        <div className='flex flex-wrap gap-1.5' data-testid='reverse-matrix'>
          {expansion.variants.map((v) => (
            <button key={v.id} type='button' onClick={() => toggleVariant(v.id)} className={'rounded-md px-2 py-1 text-[11px] ' + (v.enabled ? 'bg-black/10 font-semibold' : 'line-through opacity-40')}>
              {variantLabel(v)}
            </button>
          ))}
        </div>
      </Step>

      <Step
        {...stepProps('canvas')}
        title={t.canvas}
        summary={frameId ? t.sumCanvas : ''}
        extra={<span className='shrink-0 text-[11px]' style={soft} data-testid='reverse-run-plan'>{t.renderPlan(run.toGenerate, run.reused)}</span>}
      >
        <div className='flex flex-wrap items-center gap-2'>
          <button type='button' className={btnClass} disabled={!workflowProjectId || !shots.length || busy} onClick={sendToCanvas} data-testid='reverse-to-canvas'>{frameId ? t.syncCanvas : t.toCanvas}</button>
          {frameId && onOpenInCanvas && <button type='button' className={btnClass} onClick={() => onOpenInCanvas(frameId)} data-testid='reverse-open-canvas'>{t.openCanvas}</button>}
          <span className='text-[11px]' style={ghost}>{notice ?? (!workflowProjectId ? t.needWorkflow : '')}</span>
        </div>
      </Step>
    </div>
  );
}
