#!/usr/bin/env node
// IrisBench Judge layer CLI (LLM-as-a-Judge for L1 / L2 / L4, see eval/eval.md).
//
//   node eval/judge/run.mjs validate
//   node eval/judge/run.mjs compile --rubric agent-run
//   node eval/judge/run.mjs judge   --rubric agent-run --samples <file.jsonl> [--rounds 3] [--labels <file.json>] [--replay <file.jsonl>]
//   node eval/judge/run.mjs pairs   --rubric image-output --pairs <file.jsonl> [--truth <file.json>]
//   node eval/judge/run.mjs screen  --violations <file.json> [--pairs <file.json>]
//   node eval/judge/run.mjs gate    --baseline <runDir> --candidate <runDir> [--deterministic <report.json>]
//
// Provider: IRIS_JUDGE_PROVIDER=openai-compatible|replay, IRIS_JUDGE_BASE_URL,
// IRIS_JUDGE_MODEL, IRIS_JUDGE_API_KEY, IRIS_JUDGE_REPLAY.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileJudgePrompt, loadAllRubrics, loadRubric, rubricKey } from './lib/rubric.mjs';
import { cleanSample } from './lib/clean.mjs';
import { judgeWithRounds } from './lib/judge.mjs';
import { summarize } from './lib/funnel.mjs';
import { createProvider, providerFromEnv } from './lib/provider.mjs';
import { judgeHumanAgreement, sampleSizeForMargin, wilsonInterval } from './lib/agreement.mjs';
import { attribute, ROOT_CAUSES } from './lib/attribution.mjs';
import { judgePair, summarizePairs } from './lib/pairwise.mjs';
import { screenRule, stabilitySelect } from './lib/autorubrics.mjs';
import { admissionGate } from './lib/gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RUBRIC_DIR = join(here, 'rubrics');
const RESULTS_DIR = join(here, 'results');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

async function readJsonl(path) {
  const raw = await readFile(path, 'utf8');
  return raw.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function runId(label) {
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${label}`;
}

function providerFor(args) {
  return createProvider(args.replay ? { kind: 'replay', replayFile: resolve(args.replay) } : providerFromEnv());
}

const pct = value => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);

export function renderJudgeReport({ rubric, provider, summary, agreement, buckets, interval }) {
  const lines = [
    `# Judge 运行报告：${rubric.title}`,
    '',
    `- Rubric：\`${rubricKey(rubric)}\`（${rubric.evalLayer ?? '—'}）`,
    `- Judge：\`${provider}\``,
    `- 样本 ${summary.total}，可评 ${summary.evaluable}，CTX 剔除 ${summary.excluded}，解析失败 ${summary.parseErrors}`,
    `- 通过率 ${pct(summary.passRate)}${interval ? `（95% 区间 ${pct(interval.low)}–${pct(interval.high)}）` : ''}，RED 失败 ${summary.redFailures}`,
    ...(summary.stageFunnel ? [
      '',
      `## 执行成功率 ${pct(summary.executionSuccess)}`,
      '',
      '路由 × 调用 × 产出 × 回复；每段是在前一段通过的样本里再通过的比例（RED 失败的样本直接记为不成功）。',
      '',
      '| 段 | 到达 | 通过 | 比例 |',
      '| --- | --- | --- | --- |',
      ...Object.entries(summary.stageFunnel).filter(([, row]) => row).map(([stage, row]) => `| ${({ route: '路由', call: '调用', output: '产出', reply: '回复' })[stage]} | ${row.reached} | ${row.passed} | ${pct(row.rate)} |`),
    ] : []),
    '',
    '## 漏斗',
    '',
    '| 层 | 到达 | 通过 |',
    '| --- | --- | --- |',
    ...Object.entries(summary.funnel).map(([layer, row]) => `| ${layer} | ${row.reached} | ${row.passed} |`),
    '',
    '## 主因分布',
    '',
    ...(Object.keys(summary.primaryFailure).length
      ? Object.entries(summary.primaryFailure).map(([layer, count]) => `- ${layer}：${count}`)
      : ['- 无']),
    '',
    '## 子项失败',
    '',
    ...(Object.keys(summary.itemFailures).length
      ? Object.entries(summary.itemFailures).sort((a, b) => b[1] - a[1]).map(([code, count]) => `- ${code}：${count}`)
      : ['- 无']),
  ];
  if (agreement) {
    lines.push('', '## Judge 与人工一致性', '',
      `- 样本级 kappa ${agreement.sample.kappa === null ? '—' : agreement.sample.kappa.toFixed(3)}，一致率 ${pct(agreement.sample.observed)}（n=${agreement.sample.n}）`,
      ...Object.entries(agreement.items).map(([code, k]) => `- ${code}：kappa ${k.kappa === null ? '—' : k.kappa.toFixed(3)}（n=${k.n}）`));
  }
  if (buckets) {
    lines.push('', '## 归因（数据 / Prompt / Rubric / Agent）', '');
    for (const [cause, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const fix = ROOT_CAUSES[cause]?.fix ?? '需要人工判定根因';
      lines.push(`- **${cause}**（${list.length}）：${fix}`);
      for (const entry of list.slice(0, 10)) lines.push(`  - ${entry.id}：${entry.why}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function cmdValidate() {
  const rubrics = await loadAllRubrics(RUBRIC_DIR);
  for (const rubric of rubrics) console.log(`ok  ${rubricKey(rubric)}  ${rubric.items.length} items  ${rubric.title}`);
  return 0;
}

async function cmdCompile(args) {
  const rubric = await loadRubric(RUBRIC_DIR, args.rubric);
  console.log(compileJudgePrompt(rubric));
  return 0;
}

async function cmdJudge(args) {
  const rubric = await loadRubric(RUBRIC_DIR, args.rubric);
  const rawSamples = await readJsonl(resolve(args.samples));
  const samples = rawSamples.map(raw => cleanSample(raw, { requiredInputs: [] }));
  const provider = providerFor(args);
  const rounds = Number(args.rounds ?? 1);
  const results = [];
  for (const sample of samples) results.push(await judgeWithRounds(rubric, sample, provider, rounds));
  const summary = summarize(results);
  const interval = wilsonInterval(summary.passed, summary.evaluable);
  let agreement = null;
  let labels = {};
  if (args.labels) {
    labels = await readJson(resolve(args.labels));
    agreement = judgeHumanAgreement(results, labels);
  }
  const buckets = attribute(results, { labels, samples: Object.fromEntries(samples.map(sample => [sample.id, sample])) });
  const dir = join(args.out ? resolve(args.out) : RESULTS_DIR, runId(rubric.id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.jsonl'), results.map(result => JSON.stringify(result)).join('\n') + '\n');
  await writeFile(join(dir, 'summary.json'), JSON.stringify({ rubric: rubricKey(rubric), provider: provider.id, rounds, summary, interval, agreement, buckets }, null, 2));
  await writeFile(join(dir, 'report.md'), renderJudgeReport({ rubric, provider: provider.id, summary, agreement, buckets, interval }));
  console.log(JSON.stringify({ dir, passRate: summary.passRate, executionSuccess: summary.executionSuccess, evaluable: summary.evaluable, redFailures: summary.redFailures, kappa: agreement?.sample.kappa ?? null }));
  if (rounds > 1) {
    const unstable = results.filter(result => result.stable === false).map(result => result.id);
    if (unstable.length) console.log(JSON.stringify({ unstable }));
  }
  return summary.parseErrors ? 2 : 0;
}

async function cmdPairs(args) {
  const rubric = await loadRubric(RUBRIC_DIR, args.rubric);
  const criteria = rubric.pairwiseCriteria ?? [];
  const pairs = await readJsonl(resolve(args.pairs));
  const provider = providerFor(args);
  const results = [];
  for (const pair of pairs) results.push(await judgePair({ ...pair, criteria: pair.criteria ?? criteria }, provider));
  const truth = args.truth ? await readJson(resolve(args.truth)) : {};
  console.log(JSON.stringify({ summary: summarizePairs(results, truth), results }, null, 2));
  return 0;
}

async function cmdScreen(args) {
  const violations = await readJson(resolve(args.violations));
  const screened = Object.entries(violations.rules).map(([rule, sides]) => screenRule(rule, sides));
  const out = { screened };
  if (violations.pairs) {
    const candidates = screened.filter(entry => entry.type === 'strong' || entry.type === 'weak').map(entry => entry.rule);
    out.stability = stabilitySelect(candidates, violations.pairs, { k: Number(args.k ?? 5) });
  }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

async function cmdGate(args) {
  const baseline = await readJson(join(resolve(args.baseline), 'summary.json'));
  const candidate = await readJson(join(resolve(args.candidate), 'summary.json'));
  const deterministic = args.deterministic ? (await readJson(resolve(args.deterministic))).summary ?? null : null;
  const verdict = admissionGate({
    baseline: baseline.summary,
    candidate: candidate.summary,
    deterministic,
    judgeHealth: { kappa: candidate.agreement?.sample?.kappa ?? null },
  });
  console.log(JSON.stringify(verdict, null, 2));
  return verdict.pass ? 0 : 1;
}

async function cmdSampleSize(args) {
  const margin = Number(args.margin ?? 0.05);
  console.log(JSON.stringify({ margin, samples: sampleSizeForMargin(margin, Number(args.p ?? 0.5)) }));
  return 0;
}

const COMMANDS = { validate: cmdValidate, compile: cmdCompile, judge: cmdJudge, pairs: cmdPairs, screen: cmdScreen, gate: cmdGate, 'sample-size': cmdSampleSize };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const command = COMMANDS[args._[0]];
  if (!command) {
    console.error(`usage: node eval/judge/run.mjs <${Object.keys(COMMANDS).join('|')}> [flags]`);
    process.exit(64);
  }
  command(args).then(code => process.exit(code ?? 0), error => { console.error(error.message ?? error); process.exit(1); });
}
