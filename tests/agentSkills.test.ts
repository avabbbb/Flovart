import { describe, expect, it } from 'vitest';
import {
  buildSkillIndex,
  createSkillReadTool,
  formatSkillIndexPrompt,
  normalizeSkillFilePath,
  paginateSkillText,
  parseSkillReadHeader,
  readSkillForAgent,
  SKILL_INDEX_DESCRIPTION_MAX,
  SkillReadLedger,
  type AgentSkillCatalog,
  type AgentSkillEntry,
} from '../services/agentSkills';
import { createBundledSkillCatalog, manifestSkillId, MergedSkillCatalog, skillEntryFromMarkdown } from '../services/agentSkillCatalog';
import { skillReadContent, summarizeToolCall } from '../components/agent/agentToolSummary';

const entry = (id: string, description = `${id} 的说明`, aliases: string[] = []): AgentSkillEntry => ({ id, aliases, name: id, description, source: 'project' });

function fakeCatalog(files: Record<string, Record<string, string>>, entries = Object.keys(files).map(id => entry(id))): AgentSkillCatalog {
  return {
    list: () => entries,
    files: id => Object.keys(files[id] || {}),
    read: async (id, file) => files[id]?.[file] ?? null,
  };
}

describe('skill index', () => {
  it('excludes the external-CLI skills, dedupes by id/alias and sorts', () => {
    const index = buildSkillIndex([
      entry('vox-director', 'VOX', ['community.vox-director']),
      entry('iris'),
      entry('open-iris'),
      entry('community.vox-director', '重复项'),
      entry('still-mad'),
    ]);
    expect(index.map(item => item.id)).toEqual(['still-mad', 'vox-director']);
  });

  it('caps long descriptions and keeps a sentence boundary', () => {
    const long = 'First sentence is long enough. '.repeat(30);
    const [item] = buildSkillIndex([entry('x', long)]);
    expect(item.description.length).toBeLessThanOrEqual(SKILL_INDEX_DESCRIPTION_MAX + 1);
    expect(item.description.endsWith('.…') || item.description.endsWith('…')).toBe(true);
  });

  it('formats the prompt section with read rule, forced skill and read list', () => {
    const text = formatSkillIndexPrompt(buildSkillIndex([entry('vox-director')]), { read: ['vox-director'], forced: 'vox-director' });
    expect(text).toContain('iris_skill_read');
    expect(text).toContain('- vox-director：vox-director 的说明');
    expect(text).toContain('强制使用');
    expect(text).toContain('本会话已读技能：vox-director');
    expect(formatSkillIndexPrompt([])).toBe('');
  });

  it('builds index entries from SKILL.md frontmatter and manifest id', () => {
    const item = skillEntryFromMarkdown('vox-director', '---\nname: vox-director\ndescription: Paper collage.\n---\n# VOX', 'schemaVersion: x\nid: community.vox-director\n');
    expect(item).toMatchObject({ id: 'vox-director', aliases: ['community.vox-director'], description: 'Paper collage.', source: 'bundled' });
    expect(manifestSkillId('  id: nested\nid: top.level')).toBe('top.level');
  });

  it('bundled catalog: indexes local .agents/skills but keeps iris readable by id', async () => {
    const catalog = createBundledSkillCatalog();
    const index = buildSkillIndex(catalog.list()).map(item => item.id);
    expect(index).toEqual(expect.arrayContaining(['still-mad', 'vox-director']));
    expect(index).not.toContain('iris');
    expect(index).not.toContain('open-iris');
    const ledger = new SkillReadLedger();
    const iris = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'iris' });
    expect(iris.details.isError).toBeFalsy();
    expect(iris.text).toContain('【技能 iris · SKILL.md');
    const reference = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'community.vox-director', file: 'references/creative-direction.md' });
    expect(reference.details).toMatchObject({ id: 'vox-director', file: 'references/creative-direction.md' });
    expect(reference.text).toContain('VOX');
  });
});

describe('skill file paths', () => {
  it('allows SKILL.md and files under references/ or commands/', () => {
    expect(normalizeSkillFilePath(undefined)).toEqual({ ok: true, path: 'SKILL.md' });
    expect(normalizeSkillFilePath('./references/a.md')).toEqual({ ok: true, path: 'references/a.md' });
    expect(normalizeSkillFilePath('commands/sub/b.md')).toEqual({ ok: true, path: 'commands/sub/b.md' });
  });

  it.each([
    '../secret.md', 'references/../../x.md', '/etc/passwd', 'C:/Windows/x.md', 'references\\..\\x.md',
    'scripts/install.md', 'flovart.skill.yaml', 'references/a.png', 'references/./a.md', 'file:///etc/passwd', 'references/a.md\0',
  ])('refuses %s', path => {
    expect(normalizeSkillFilePath(path).ok).toBe(false);
  });
});

describe('skill pagination', () => {
  const text = Array.from({ length: 1000 }, (_, index) => `line ${index + 1}`).join('\n');

  it('pages by lines and reports the next offset', () => {
    const first = paginateSkillText(text, 1, { lines: 400 });
    expect(first).toMatchObject({ startLine: 1, endLine: 400, totalLines: 1000, nextOffset: 401 });
    const last = paginateSkillText(text, 801, { lines: 400 });
    expect(last).toMatchObject({ startLine: 801, endLine: 1000, nextOffset: null });
    expect(last.text.split('\n')[0]).toBe('line 801');
  });

  it('pages by characters and splits a single overlong line', () => {
    const page = paginateSkillText(text, 1, { chars: 300, lines: 1000 });
    expect(page.text.length).toBeLessThanOrEqual(300);
    expect(page.nextOffset).toBe(page.endLine + 1);
    const giant = paginateSkillText('x'.repeat(5000), 1, { chars: 1000 });
    expect(giant.text).toHaveLength(1000);
  });

  it('clamps out-of-range offsets', () => {
    expect(paginateSkillText('a\nb', 99).startLine).toBe(2);
    expect(paginateSkillText('a\nb', -3).startLine).toBe(1);
  });
});

describe('iris_skill_read', () => {
  const long = Array.from({ length: 900 }, (_, index) => `step ${index + 1}`).join('\n');
  const catalog = fakeCatalog({ demo: { 'SKILL.md': long, 'references/a.md': '# A' } }, [entry('demo', 'Demo', ['community.demo'])]);

  it('paginates long files and tells the model the next offset', async () => {
    const ledger = new SkillReadLedger();
    const first = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'demo' });
    expect(first.text).toContain('offset=401');
    expect(first.details.nextOffset).toBe(401);
    const second = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'demo', offset: 401 });
    expect(second.text.split('\n')[1]).toBe('step 401');
    expect(parseSkillReadHeader(second.text)).toEqual({ id: 'demo', file: 'SKILL.md' });
  });

  it('returns a short 已读过 note for repeated reads unless forced', async () => {
    const ledger = new SkillReadLedger();
    await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'demo', file: 'references/a.md' });
    const again = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'demo', file: 'references/a.md' });
    expect(again.details.alreadyRead).toBe(true);
    expect(again.text).toContain('已读过');
    expect(again.text).not.toContain('# A');
    expect(again.record).toBeUndefined();
    const afterCompaction = await readSkillForAgent({ catalog, ledger, epoch: 1, id: 'demo', file: 'references/a.md' });
    expect(afterCompaction.text).toContain('压缩');
    const forced = await readSkillForAgent({ catalog, ledger, epoch: 1, id: 'demo', file: 'references/a.md', force: true });
    expect(forced.text).toContain('# A');
  });

  it('reads the whole SKILL.md without pagination for a pinned skill', async () => {
    const ledger = new SkillReadLedger();
    const full = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'community.demo', full: true, force: true });
    expect(full.text).toContain('step 900');
    expect(full.text).not.toContain('offset=');
    expect(ledger.hasFullRead('demo', 0)).toBe(true);
    expect(ledger.hasFullRead('demo', 1)).toBe(false);
  });

  it('reports unknown skills, missing files and traversal as tool errors', async () => {
    const ledger = new SkillReadLedger();
    expect((await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'nope' })).details.isError).toBe(true);
    const missing = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'demo', file: 'references/b.md' });
    expect(missing.details.isError).toBe(true);
    expect(missing.text).toContain('references/a.md');
    const traversal = await readSkillForAgent({ catalog, ledger, epoch: 0, id: 'demo', file: '../../.env' });
    expect(traversal.details.isError).toBe(true);
    expect(ledger.skillIds()).toEqual([]);
  });

  it('tool persists each real read through onRead and survives a ledger restore', async () => {
    const ledger = new SkillReadLedger();
    const records: unknown[] = [];
    const tool = createSkillReadTool({ catalog, ledger, getEpoch: () => 0, onRead: record => { records.push(record); } });
    await tool.execute('c1', { id: 'demo', file: 'references/a.md' } as never, undefined as never);
    await tool.execute('c2', { id: 'demo', file: 'references/a.md' } as never, undefined as never);
    expect(records).toHaveLength(1);
    const restored = new SkillReadLedger();
    restored.restore(records as never);
    const again = await readSkillForAgent({ catalog, ledger: restored, epoch: 0, id: 'demo', file: 'references/a.md' });
    expect(again.details.alreadyRead).toBe(true);
  });

  it('merged catalog falls back to the local registry for installed skills', async () => {
    const merged = new MergedSkillCatalog(fakeCatalog({ demo: { 'SKILL.md': '# demo' } }));
    await merged.attachRemote({
      listLocalSkills: async () => [{ id: 'community.installed', name: 'Installed', description: 'From registry' }, { id: 'demo', name: 'dup', description: '' }] as never,
      readSkillFile: async (id, path) => `${id}:${path}`,
    });
    expect(merged.list().map(item => item.id)).toEqual(['demo', 'community.installed']);
    expect(await merged.read('community.installed', 'SKILL.md')).toBe('community.installed:SKILL.md');
    expect(await merged.read('demo', 'SKILL.md')).toBe('# demo');
    expect(await merged.read('other', 'SKILL.md')).toBeNull();
  });
});

describe('skill read card', () => {
  it('summarises as 已读取 xxx 技能 and exposes the content for the expandable view', () => {
    const result = { content: [{ type: 'text', text: '【技能 vox-director · SKILL.md】\n# VOX' }], details: { forced: true } };
    expect(summarizeToolCall({ toolName: 'iris_skill_read', args: { id: 'vox-director', forced: true }, result, status: 'success' }).text).toBe('已读取 vox-director 技能（强制使用）');
    expect(summarizeToolCall({ toolName: 'iris_skill_read', result: '【技能 still-mad · references/direction.md】\n…', status: 'success' }).text).toBe('已读取 still-mad 技能 · references/direction.md');
    expect(summarizeToolCall({ toolName: 'iris_skill_read', args: { id: 'x' }, status: 'pending' }).text).toBe('正在读取 x 技能');
    expect(skillReadContent('iris_skill_read', result)).toBe('# VOX');
    expect(skillReadContent('iris_skill_read', '【技能 x · SKILL.md】\n已读过（…）')).toBe('');
    expect(skillReadContent('flovart_todo', result)).toBe('');
  });
});
