// 对话转 Skill：把一次 Agent 会话的回执（receipts）和画布子图编译成 Production Skill 草稿包，
// 再用 evaluateSkillDraft 做基础验收；验收通过才允许 installPackage 入库。
// 纯函数模块：不读写磁盘，CLI（skill.draft）和测试共用。
import {
  parseProductionSkillManifest,
  parseSkillFrontmatter,
  safeSkillPackageName,
  validateSkillPackageEntries,
} from './skill-package.js';

export const SKILL_DRAFT_MAX_NODES = 60;
export const SKILL_DRAFT_MAX_RECEIPTS = 40;
const PROMPT_PREVIEW = 80;
const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|api[_-]?key\s{0,8}[:=]\s{0,8}\S+)/i;
const SECRET_PATTERN_GLOBAL = new RegExp(SECRET_PATTERN.source, 'gi');

const CAPABILITY_BY_NODE_TYPE = Object.freeze({
  image: 'image.generate',
  video: 'video.generate',
  audio: 'audio.tts',
});

const redact = value => (typeof value === 'string' ? value.replace(SECRET_PATTERN_GLOBAL, '[redacted]') : '');
const oneLine = (value, max) => redact(value).replace(/\s+/g, ' ').trim().slice(0, max);
const yamlString = value => JSON.stringify(String(value));

function endpoint(connection, side) {
  if (!connection || typeof connection !== 'object') return '';
  const keys = side === 'from' ? ['fromNodeId', 'from', 'source', 'sourceId'] : ['toNodeId', 'to', 'target', 'targetId'];
  for (const key of keys) {
    if (typeof connection[key] === 'string' && connection[key]) return connection[key];
  }
  return '';
}

// 取子图：给了 nodeIds 只保留这些节点及其内部连线；否则取全部节点。
export function extractCanvasSubgraph(project = {}, nodeIds = []) {
  const allNodes = Array.isArray(project.nodes) ? project.nodes : [];
  const wanted = Array.isArray(nodeIds) && nodeIds.length ? new Set(nodeIds) : null;
  const picked = allNodes.filter(node => node && typeof node.id === 'string' && (!wanted || wanted.has(node.id))).slice(0, SKILL_DRAFT_MAX_NODES);
  const ids = new Set(picked.map(node => node.id));
  const nodes = picked.map(node => {
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    return {
      id: node.id,
      type: String(node.type || 'text'),
      title: oneLine(node.title || '', 80),
      prompt: redact(metadata.prompt || metadata.content || '').slice(0, 4000),
      ...(metadata.config && typeof metadata.config === 'object' ? { config: metadata.config } : {}),
    };
  });
  const connections = (Array.isArray(project.connections) ? project.connections : [])
    .map(connection => ({ from: endpoint(connection, 'from'), to: endpoint(connection, 'to') }))
    .filter(connection => ids.has(connection.from) && ids.has(connection.to));
  return { nodes, connections };
}

// Kahn 拓扑排序；有环时返回 null。
export function topologicalNodeOrder(subgraph) {
  const indegree = new Map(subgraph.nodes.map(node => [node.id, 0]));
  for (const connection of subgraph.connections) {
    if (indegree.has(connection.to)) indegree.set(connection.to, indegree.get(connection.to) + 1);
  }
  const queue = subgraph.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const connection of subgraph.connections) {
      if (connection.from !== id || !indegree.has(connection.to)) continue;
      indegree.set(connection.to, indegree.get(connection.to) - 1);
      if (indegree.get(connection.to) === 0) queue.push(connection.to);
    }
  }
  return order.length === subgraph.nodes.length ? order : null;
}

function receiptSteps(receipts) {
  return (Array.isArray(receipts) ? receipts : [])
    .filter(receipt => receipt && (receipt.kind === 'task' || receipt.kind === 'decision') && receipt.title)
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
    .slice(0, SKILL_DRAFT_MAX_RECEIPTS)
    .map(receipt => {
      const detail = oneLine(receipt.summary || receipt.body || receipt.detail || '', 160);
      return (receipt.kind === 'decision' ? '（决策）' : '') + oneLine(receipt.title, 120) + (detail ? '：' + detail : '');
    });
}

// 生成草稿包。返回 { id, handle, files: { [path]: content }, subgraph }。
// 输入：id（community.xxx）、name、description、project（含 nodes / connections）、receipts、nodeIds。
export function buildSkillDraft({ id, name, description, projectId, project, receipts, nodeIds } = {}) {
  if (!safeSkillPackageName(id)) throw new Error('无效的 Skill id：' + id);
  const handle = id.split('.').at(-1);
  const displayName = oneLine(name || handle, 60) || handle;
  const subgraph = extractCanvasSubgraph(project, nodeIds);
  const order = topologicalNodeOrder(subgraph) || subgraph.nodes.map(node => node.id);
  const byId = new Map(subgraph.nodes.map(node => [node.id, node]));
  const incoming = new Set(subgraph.connections.map(connection => connection.to));
  const capabilities = [...new Set(subgraph.nodes.map(node => CAPABILITY_BY_NODE_TYPE[node.type]).filter(Boolean))];
  const hasReferenceSlot = subgraph.nodes.some(node => node.type === 'image' && !incoming.has(node.id) && !node.prompt);
  const steps = receiptSteps(receipts);
  const summary = oneLine(description || '', 160) || (displayName + '：从一次 Flovart 会话沉淀的可复跑制作流程');

  const manifest = [
    'schemaVersion: flovart.production-skill/1',
    'id: ' + id,
    'version: 0.1.0',
    'runtime:',
    '  minVersion: 0.3.0',
    'capabilities:',
    ...(capabilities.length ? capabilities : ['image.generate']).map(item => '  - ' + item),
    'permissions:',
    '  network: none',
    '  secrets: none',
    '  filesystem: package-readonly',
    'gates:',
    '  - id: approve-spec',
    '    type: spec',
    'evals:',
    '  entry: evals/cases.json',
    'provenance:',
    '  source: ' + yamlString('flovart-session:' + (projectId || 'unknown')),
    '  adaptation: session-draft',
    'trustTier: local-draft',
    'inputs:',
    '  - id: topic',
    '    label: ' + yamlString('主题或 Brief'),
    '    kind: longtext',
    '    required: true',
    '    placeholder: ' + yamlString('替换原会话里的主题，其余流程按子图复跑'),
    ...(hasReferenceSlot ? [
      '  - id: references',
      '    label: ' + yamlString('参考图（可选）'),
      '    kind: image',
      '    placeholder: ' + yamlString('替换原会话的参考图'),
    ] : []),
    '',
  ].join('\n');

  const graphLines = order.map((nodeId, index) => {
    const node = byId.get(nodeId);
    const preview = oneLine(node.prompt, PROMPT_PREVIEW);
    return (index + 1) + '. [' + node.type + '] ' + (node.title || node.id) + (preview ? '：' + preview : '');
  });
  const skill = [
    '---',
    'name: ' + handle,
    'description: ' + yamlString(summary),
    '---',
    '',
    '# ' + displayName,
    '',
    '> 由 Flovart 会话自动沉淀的草稿（trustTier: local-draft）。入库前须通过 evals/cases.json 的基础验收。',
    '',
    '## 原会话做了什么',
    '',
    ...(steps.length ? steps.map((step, index) => (index + 1) + '. ' + step) : ['（会话未留下 task / decision 回执，仅按画布子图复跑）']),
    '',
    '## 画布子图（按依赖顺序）',
    '',
    ...(graphLines.length ? graphLines : ['（空）']),
    '',
    '## 复跑规则',
    '',
    '1. 读取 inputs.topic，把子图里所有提示词中的原主题替换为新主题；先给出改写后的提示词清单，等待确认（gate: approve-spec）。',
    '2. 按 references/canvas-subgraph.json 用 workflow.apply 一次性创建节点与连线，保持原有依赖顺序与模型参数。',
    '3. 付费生成必须经过用户确认或会话预算授权；单节点失败只重跑该节点。',
    '4. 完成后返回交付契约（sessionId / projectId / canvasUrl / nodeIds）。',
    '',
  ].join('\n');

  const cases = {
    schemaVersion: 'flovart.skill-evals/1',
    cases: [{
      id: 'subgraph-replay',
      description: '复跑后画布应得到同构子图',
      expect: {
        nodeCount: subgraph.nodes.length,
        connectionCount: subgraph.connections.length,
        nodeTypes: [...new Set(subgraph.nodes.map(node => node.type))].sort(),
        acyclic: topologicalNodeOrder(subgraph) !== null,
      },
    }],
  };

  const openai = [
    'interface:',
    '  display_name: ' + yamlString(displayName),
    '  short_description: ' + yamlString(summary.slice(0, 60)),
    '  default_prompt: ' + yamlString('Use $' + handle + ' to rerun this Flovart workflow with my new topic.'),
    '',
  ].join('\n');

  return {
    id,
    handle,
    subgraph,
    files: {
      'SKILL.md': skill,
      'flovart.skill.yaml': manifest,
      'agents/openai.yaml': openai,
      'references/canvas-subgraph.json': JSON.stringify({ schemaVersion: 'flovart.canvas-subgraph/1', ...subgraph }, null, 2) + '\n',
      'evals/cases.json': JSON.stringify(cases, null, 2) + '\n',
    },
  };
}

// 基础验收：结构、manifest、frontmatter、子图闭合与无环、无密钥、evals 与子图一致。
export function evaluateSkillDraft(files, expectedId) {
  const checks = [];
  const check = (id, run) => {
    try {
      const message = run();
      checks.push({ id, ok: true, ...(message ? { message } : {}) });
    } catch (cause) {
      checks.push({ id, ok: false, message: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  const entries = Object.entries(files || {}).map(([path, content]) => ({ path, content }));
  check('package-entries', () => { validateSkillPackageEntries(entries); });
  check('manifest', () => {
    const manifest = parseProductionSkillManifest(files['flovart.skill.yaml']);
    if (expectedId && manifest.id !== expectedId) throw new Error('manifest id 与请求不一致：' + manifest.id);
  });
  check('frontmatter', () => {
    const frontmatter = parseSkillFrontmatter(files['SKILL.md'] || '');
    if (!frontmatter?.name || !frontmatter?.description) throw new Error('SKILL.md 缺少 name / description');
  });
  let subgraph = null;
  check('subgraph', () => {
    subgraph = JSON.parse(files['references/canvas-subgraph.json'] || 'null');
    if (!subgraph || !Array.isArray(subgraph.nodes) || subgraph.nodes.length === 0) throw new Error('画布子图为空');
    const ids = new Set(subgraph.nodes.map(node => node.id));
    const dangling = (subgraph.connections || []).filter(connection => !ids.has(connection.from) || !ids.has(connection.to));
    if (dangling.length) throw new Error('存在悬空连线：' + dangling.length + ' 条');
    if (!topologicalNodeOrder({ nodes: subgraph.nodes, connections: subgraph.connections || [] })) throw new Error('子图存在环');
    return subgraph.nodes.length + ' 个节点';
  });
  check('no-secrets', () => {
    const leaked = entries.filter(entry => SECRET_PATTERN.test(entry.content)).map(entry => entry.path);
    if (leaked.length) throw new Error('疑似密钥：' + leaked.join('、'));
  });
  check('evals', () => {
    const evals = JSON.parse(files['evals/cases.json'] || 'null');
    const expect = evals?.cases?.[0]?.expect;
    if (!expect) throw new Error('evals/cases.json 缺少用例');
    if (subgraph && expect.nodeCount !== subgraph.nodes.length) throw new Error('evals 节点数与子图不一致');
  });
  return { ok: checks.every(item => item.ok), checks };
}
