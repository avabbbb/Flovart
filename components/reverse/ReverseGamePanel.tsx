import React, { useMemo, useState } from 'react';
import {
  canApproveAsset,
  evaluateSimilarityGate,
  filterLedger,
  importLedger,
  overridePathFor,
  planAssetRun,
  summarizeLedger,
  type LedgerFilter,
} from '../../services/reverse/game';
import { sendAssetSpecsToWorkflow } from '../../services/reverse/workflowBridge';
import type { ReverseAssetCategory, ReverseAssetState, ReverseGameProject, ReverseGate } from '../../services/reverse/types';

export interface ReverseGamePanelProps {
  project: ReverseGameProject;
  language: 'en' | 'zho';
  workflowProjectId: string | null;
  onUpdate: (update: (project: ReverseGameProject) => ReverseGameProject) => void;
}

const CATEGORIES: ReverseAssetCategory[] = ['character', 'ui', 'background', 'effect', 'icon', 'prop', 'audio', 'other'];
const STATES: ReverseAssetState[] = ['must-replace', 'generating', 'candidate', 'approved', 'rejected', 'keep'];
const PAGE = 200;

const TEXT = {
  zho: {
    import: '导入原作素材清单', manifest: 'manifest.json', assetMap: 'asset-map.json（可选）', doImport: '导入 / 合并',
    importHint: '原作素材默认全部「必须替换」；重导保留已有状态。原图只提供尺寸与功能规格。',
    parseError: 'JSON 解析失败：', imported: (n: number) => '已导入 ' + n + ' 项',
    summary: '进度', bible: '风格圣经', palette: '色板（逗号分隔）', lineWork: '线条', texture: '质感',
    forbidden: '禁止沿用的原作特征（逗号分隔）', notes: '备注', threshold: '相似度上限',
    assets: '素材清单', search: '搜索 id 或符号', all: '全部', selectVisible: '选中当前页', clear: '清空选择',
    batch: (n: number) => '批量写入规格到 Workflow（' + n + '）', needWorkflow: '先在画布里打开一个 Workflow 项目',
    sent: (n: number) => '已写入 ' + n + ' 个规格节点，请在画布里接生成节点运行。', failed: '写入失败：',
    score: '相似度', record: '记录', approve: '批准', waive: '豁免', keep: '保留', showMore: '显示更多',
    empty: '先导入 manifest', specOnly: '提示词只含功能规格与风格圣经，不引用原作图像。',
    approveHint: '相似度闸门通过或豁免后才能批准，批准后回填到：',
    reusedNote: (n: number) => n + ' 项规格未变，按内容 key 沿用已写出的节点。', allReused: '所选素材规格都未变，已有节点可直接复用，无需重写。',
  },
  en: {
    import: 'Import original asset ledger', manifest: 'manifest.json', assetMap: 'asset-map.json (optional)', doImport: 'Import / merge',
    importHint: 'Original assets default to must-replace; re-import keeps existing states. Originals only provide size and function specs.',
    parseError: 'JSON parse failed: ', imported: (n: number) => n + ' assets imported',
    summary: 'Progress', bible: 'Style bible', palette: 'Palette (comma separated)', lineWork: 'Line work', texture: 'Texture',
    forbidden: 'Original traits to avoid (comma separated)', notes: 'Notes', threshold: 'Similarity limit',
    assets: 'Asset ledger', search: 'Search id or symbol', all: 'All', selectVisible: 'Select page', clear: 'Clear selection',
    batch: (n: number) => 'Write specs to Workflow (' + n + ')', needWorkflow: 'Open a Workflow project on the canvas first',
    sent: (n: number) => n + ' spec nodes written. Connect generation nodes on the canvas to run them.', failed: 'Write failed: ',
    score: 'Similarity', record: 'Record', approve: 'Approve', waive: 'Waive', keep: 'Keep', showMore: 'Show more',
    empty: 'Import a manifest first', specOnly: 'Prompts carry only function specs and the style bible, never the original image.',
    approveHint: 'Approval needs a passed or waived similarity gate; approved assets back-fill to: ',
    reusedNote: (n: number) => n + ' specs unchanged; existing nodes reused by content key.', allReused: 'Selected specs are unchanged; existing nodes are reused, nothing to write.',
  },
};

const inputClass = 'w-full min-w-0 rounded-md px-2 py-1 text-xs outline-none';
const inputStyle: React.CSSProperties = { background: 'var(--isl-surface-1, transparent)', border: '1px solid var(--isl-line, rgba(127,127,127,0.25))', color: 'var(--isl-ink)' };
const btnClass = 'isl-opt shrink-0 rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40';
const miniBtn = 'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-30 hover:bg-black/5';

const STATE_COLOR: Record<ReverseAssetState, string> = {
  'must-replace': 'rgba(239,120,90,0.18)',
  generating: 'rgba(90,150,239,0.18)',
  candidate: 'rgba(230,190,60,0.22)',
  approved: 'rgba(80,190,120,0.22)',
  rejected: 'rgba(200,60,60,0.22)',
  keep: 'rgba(127,127,127,0.18)',
};

function splitList(text: string): string[] {
  return text.replace(/，/g, ',').split(',').map((s) => s.trim()).filter(Boolean);
}

function newId(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 8);
}

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className='settings-elevated settings-elevated--soft rounded-xl p-4' style={{ background: 'var(--isl-surface-2)' }}>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <h3 className='text-xs font-bold'>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

export function ReverseGamePanel({ project, language, workflowProjectId, onUpdate }: ReverseGamePanelProps) {
  const t = TEXT[language];
  const [manifestRaw, setManifestRaw] = useState<unknown>(null);
  const [mapRaw, setMapRaw] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>({ category: 'all', state: 'all', mediaKind: 'all', query: '' });
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const bible = project.styleBible;
  const [paletteText, setPaletteText] = useState(bible.palette.join(', '));
  const [forbiddenText, setForbiddenText] = useState(bible.forbidden.join(', '));

  const summary = useMemo(() => summarizeLedger(project.ledger), [project.ledger]);
  const visible = useMemo(() => filterLedger(project.ledger, filter), [project.ledger, filter]);
  const gates = useMemo(() => {
    const map = new Map<string, ReverseGate>();
    project.gates.forEach((g) => { if (g.kind === 'similarity') map.set(g.targetId, g); });
    return map;
  }, [project.gates]);

  const pickFile = (setter: (v: unknown) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setter(await readJsonFile(file));
      setNotice(null);
    } catch (err) {
      setNotice(t.parseError + (err instanceof Error ? err.message : String(err)));
    }
  };

  const doImport = () => {
    if (!manifestRaw) return;
    const ledger = importLedger(manifestRaw, mapRaw ?? undefined, project.ledger);
    onUpdate((p) => ({
      ...p,
      ledger,
      status: 'ready',
      references: [
        ...p.references.filter((r) => r.kind !== 'game-manifest' && r.kind !== 'asset-map'),
        { id: newId('ref'), kind: 'game-manifest', label: 'manifest', locator: 'manifest.json', importedAt: new Date().toISOString() },
        ...(mapRaw ? [{ id: newId('ref'), kind: 'asset-map' as const, label: 'asset-map', locator: 'asset-map.json', importedAt: new Date().toISOString() }] : []),
      ],
    }));
    setNotice(t.imported(ledger.length));
  };

  const patchEntries = (ids: Set<string>, state: ReverseAssetState) => onUpdate((p) => ({
    ...p,
    ledger: p.ledger.map((e) => (ids.has(e.id) ? { ...e, state } : e)),
  }));

  const setCategory = (id: string, category: ReverseAssetCategory) => onUpdate((p) => ({
    ...p,
    ledger: p.ledger.map((e) => (e.id === id ? { ...e, category } : e)),
  }));

  const recordScore = (id: string) => {
    const raw = (scores[id] ?? '').trim();
    if (!raw) return;
    const score = Number(raw);
    const gate = evaluateSimilarityGate(id, Number.isFinite(score) ? score : null, project.similarityThreshold, new Date().toISOString());
    onUpdate((p) => ({
      ...p,
      gates: [...p.gates.filter((g) => g.id !== gate.id), gate],
      ledger: p.ledger.map((e) => {
        if (e.id !== id || e.state === 'approved' || gate.status === 'pending') return e;
        return gate.status === 'failed' ? { ...e, state: 'rejected', rejectReason: 'too-similar' } : { ...e, state: 'candidate' };
      }),
    }));
  };

  // 豁免只由人在界面上点击产生；Agent 通道不暴露。
  const waive = (id: string) => onUpdate((p) => {
    const existing = p.gates.find((g) => g.kind === 'similarity' && g.targetId === id);
    const gate: ReverseGate = { ...(existing ?? evaluateSimilarityGate(id, null, p.similarityThreshold)), status: 'waived', checkedAt: new Date().toISOString() };
    return { ...p, gates: [...p.gates.filter((g) => g.id !== gate.id), gate] };
  });

  const approve = (id: string) => {
    if (!canApproveAsset(project, id)) return;
    patchEntries(new Set([id]), 'approved');
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // 生成中的素材也可重选：规格未变的按 key 复用跳过，变了的才重写节点。
  const batchTargets = project.ledger.filter((e) => selected.has(e.id) && (e.state === 'must-replace' || e.state === 'rejected' || e.state === 'generating'));
  const batchPlan = planAssetRun(batchTargets, project.styleBible);

  const sendBatch = async () => {
    if (!workflowProjectId || !batchTargets.length) return;
    if (!batchPlan.send.length) { setNotice(t.allReused); return; }
    setBusy(true);
    try {
      const specs = batchPlan.send.map(({ entry, prompt }) => ({ assetId: entry.id, prompt }));
      const res = await sendAssetSpecsToWorkflow(workflowProjectId, specs);
      if (!res.ok) { setNotice(t.failed + res.message); return; }
      const now = new Date().toISOString();
      const ids = new Set(batchPlan.send.map(({ entry }) => entry.id));
      const outputs = batchPlan.send.map(({ entry, key }, i) => ({ id: newId('out'), ownerKind: 'asset' as const, ownerId: entry.id, key, origin: 'generated' as const, workflowNodeId: res.nodeIds[i], createdAt: now }));
      onUpdate((p) => ({
        ...p,
        status: 'generating',
        workflowProjectId,
        outputs: [...p.outputs, ...outputs],
        ledger: p.ledger.map((e) => (ids.has(e.id) ? { ...e, state: 'generating', candidates: [...e.candidates, ...outputs.filter((o) => o.ownerId === e.id)] } : e)),
      }));
      setSelected(new Set());
      setNotice(t.sent(specs.length) + (batchPlan.reused.length ? ' ' + t.reusedNote(batchPlan.reused.length) : ''));
    } finally {
      setBusy(false);
    }
  };

  const updateBible = (patch: Partial<typeof bible>) => onUpdate((p) => ({ ...p, styleBible: { ...p.styleBible, ...patch } }));

  return (
    <div className='flex flex-col gap-4' data-testid='reverse-game-panel'>
      <Card title={t.import}>
        <div className='flex flex-wrap items-center gap-3 text-xs'>
          <label className='flex items-center gap-2'>
            <span style={{ color: 'var(--isl-ink-soft)' }}>{t.manifest}</span>
            <input type='file' accept='.json,application/json' onChange={pickFile(setManifestRaw)} data-testid='reverse-manifest-input' />
          </label>
          <label className='flex items-center gap-2'>
            <span style={{ color: 'var(--isl-ink-soft)' }}>{t.assetMap}</span>
            <input type='file' accept='.json,application/json' onChange={pickFile(setMapRaw)} />
          </label>
          <button type='button' className={btnClass} disabled={!manifestRaw} onClick={doImport}>{t.doImport}</button>
        </div>
        <p className='mt-2 text-[11px]' style={{ color: 'var(--isl-ink-ghost)' }}>{notice ?? t.importHint}</p>
      </Card>

      <Card title={t.summary} extra={<span className='text-[11px]' style={{ color: 'var(--isl-ink-soft)' }}>{Math.round(summary.progress / 0.01) + '% · ' + summary.total}</span>}>
        <div className='h-1.5 w-full overflow-hidden rounded-full' style={{ background: 'rgba(127,127,127,0.18)' }}>
          <div className='h-full rounded-full' style={{ width: Math.round(summary.progress / 0.01) + '%', background: 'rgba(80,190,120,0.8)' }} />
        </div>
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {STATES.map((s) => (
            <button key={s} type='button' onClick={() => setFilter((f) => ({ ...f, state: f.state === s ? 'all' : s }))} className={'rounded-md px-2 py-0.5 text-[11px] ' + (filter.state === s ? 'font-bold ring-1 ring-black/20' : '')} style={{ background: STATE_COLOR[s] }}>
              {s + ' ' + summary.byState[s]}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t.bible}>
        <div className='grid grid-cols-2 gap-2'>
          <input className={inputClass} style={inputStyle} placeholder={t.palette} value={paletteText} onChange={(e) => setPaletteText(e.target.value)} onBlur={() => updateBible({ palette: splitList(paletteText) })} />
          <input className={inputClass} style={inputStyle} placeholder={t.forbidden} value={forbiddenText} onChange={(e) => setForbiddenText(e.target.value)} onBlur={() => updateBible({ forbidden: splitList(forbiddenText) })} />
          <input className={inputClass} style={inputStyle} placeholder={t.lineWork} value={bible.lineWork ?? ''} onChange={(e) => updateBible({ lineWork: e.target.value })} />
          <input className={inputClass} style={inputStyle} placeholder={t.texture} value={bible.texture ?? ''} onChange={(e) => updateBible({ texture: e.target.value })} />
        </div>
        <textarea className={inputClass + ' mt-2'} style={inputStyle} rows={2} placeholder={t.notes} value={bible.notes ?? ''} onChange={(e) => updateBible({ notes: e.target.value })} />
        <div className='mt-2 flex items-center gap-2 text-xs'>
          <span style={{ color: 'var(--isl-ink-soft)' }}>{t.threshold}</span>
          <input className={inputClass + ' max-w-[5rem]'} style={inputStyle} type='number' min={0} max={1} step={0.01} value={project.similarityThreshold} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onUpdate((p) => ({ ...p, similarityThreshold: Math.min(1, Math.max(0, v)) })); }} />
          <span className='text-[11px]' style={{ color: 'var(--isl-ink-ghost)' }}>{t.specOnly}</span>
        </div>
      </Card>

      <Card title={t.assets} extra={<span className='text-[11px]' style={{ color: 'var(--isl-ink-ghost)' }}>{visible.length + ' / ' + project.ledger.length}</span>}>
        {project.ledger.length === 0 ? (
          <p className='py-4 text-center text-xs' style={{ color: 'var(--isl-ink-ghost)' }}>{t.empty}</p>
        ) : (
          <>
            <div className='mb-3 flex flex-wrap items-center gap-2'>
              <input className={inputClass + ' max-w-[12rem]'} style={inputStyle} placeholder={t.search} value={filter.query ?? ''} onChange={(e) => { setFilter((f) => ({ ...f, query: e.target.value })); setLimit(PAGE); }} />
              <select className={inputClass + ' max-w-[8rem]'} style={inputStyle} value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value as LedgerFilter['category'] }))}>
                <option value='all'>{t.all}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c + ' (' + summary.byCategory[c] + ')'}</option>)}
              </select>
              <select className={inputClass + ' max-w-[7rem]'} style={inputStyle} value={filter.mediaKind} onChange={(e) => setFilter((f) => ({ ...f, mediaKind: e.target.value as LedgerFilter['mediaKind'] }))}>
                <option value='all'>{t.all}</option>
                <option value='image'>image</option>
                <option value='audio'>audio</option>
              </select>
              <button type='button' className={miniBtn} onClick={() => setSelected(new Set(visible.slice(0, limit).map((e) => e.id)))}>{t.selectVisible}</button>
              <button type='button' className={miniBtn} disabled={!selected.size} onClick={() => setSelected(new Set())}>{t.clear}</button>
              <button type='button' className={btnClass + ' ml-auto'} disabled={!workflowProjectId || !batchTargets.length || busy} onClick={sendBatch} data-testid='reverse-batch'>{t.batch(batchPlan.send.length)}</button>
            </div>
            {!workflowProjectId && <p className='mb-2 text-[11px]' style={{ color: 'var(--isl-ink-ghost)' }}>{t.needWorkflow}</p>}
            <div className='flex flex-col divide-y' style={{ borderColor: 'rgba(127,127,127,0.15)' }} data-testid='reverse-ledger'>
              {visible.slice(0, limit).map((e) => {
                const gate = gates.get(e.id);
                const approvable = gate?.status === 'passed' || gate?.status === 'waived';
                return (
                  <div key={e.id} className='grid grid-cols-[1.25rem_minmax(0,1fr)_6.5rem_5rem_6.5rem_auto] items-center gap-2 py-1.5 text-xs'>
                    <input type='checkbox' checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={e.id} />
                    <div className='min-w-0'>
                      <div className='truncate font-semibold'>{e.id}</div>
                      {e.symbols.length > 0 && <div className='truncate text-[10px]' style={{ color: 'var(--isl-ink-ghost)' }}>{e.symbols.join(', ')}</div>}
                    </div>
                    <select className={inputClass} style={inputStyle} value={e.category} onChange={(ev) => setCategory(e.id, ev.target.value as ReverseAssetCategory)}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className='text-[11px]' style={{ color: 'var(--isl-ink-soft)' }}>{e.width && e.height ? e.width + 'x' + e.height + (e.hasAlpha ? ' α' : '') : e.mediaKind}</span>
                    <span className='truncate rounded px-1.5 py-0.5 text-center text-[10px]' style={{ background: STATE_COLOR[e.state] }} title={e.rejectReason}>{e.state}</span>
                    <div className='flex items-center gap-1'>
                      <input className={inputClass + ' w-14'} style={inputStyle} inputMode='decimal' placeholder={gate?.score !== undefined ? String(gate.score) : t.score} value={scores[e.id] ?? ''} onChange={(ev) => setScores((s) => ({ ...s, [e.id]: ev.target.value }))} />
                      <button type='button' className={miniBtn} onClick={() => recordScore(e.id)}>{t.record}</button>
                      <button type='button' className={miniBtn} disabled={!approvable || e.state === 'approved'} title={t.approveHint + overridePathFor(e, project.overrideDir)} onClick={() => approve(e.id)}>{t.approve}</button>
                      <button type='button' className={miniBtn} disabled={gate?.status === 'waived'} onClick={() => waive(e.id)}>{t.waive}</button>
                      <button type='button' className={miniBtn} onClick={() => patchEntries(new Set([e.id]), e.state === 'keep' ? 'must-replace' : 'keep')}>{t.keep}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {visible.length > limit && (
              <button type='button' className={miniBtn + ' mt-2'} onClick={() => setLimit((n) => n + PAGE)}>{t.showMore}</button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
