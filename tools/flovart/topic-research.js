import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const DEFAULT_SUBREDDITS = Object.freeze([
  'politics',
  'worldnews',
  'news',
  'PoliticalDiscussion',
  'NeutralPolitics',
  'geopolitics',
]);
const REDDIT_USER_AGENT = 'FlovartTopicResearch/0.3 (+https://github.com/avabbbb/Flovart)';
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  parseTagValue: false,
});

function array(value, fallback = []) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).map(item => item.trim()).filter(Boolean);
      } catch {}
    }
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function asArray(value) {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function redditHref(entry) {
  const links = asArray(entry?.link);
  return links.find(link => link?.rel === 'alternate')?.href
    || links.find(link => typeof link?.href === 'string')?.href
    || '';
}

function subredditFromEntry(entry, href) {
  const category = asArray(entry?.category).find(item => item?.term)?.term;
  if (category && category !== 'reddit.com') return String(category).replace(/^r\//i, '');
  return href.match(/reddit\.com\/r\/([^/]+)/i)?.[1] || 'unknown';
}

export function parseRedditAtom(xml, feedRankOffset = 0) {
  const feed = parser.parse(xml)?.feed;
  return asArray(feed?.entry).map((entry, index) => {
    const href = redditHref(entry);
    const title = typeof entry?.title === 'object' ? entry.title.text : entry?.title;
    return {
      id: String(entry?.id || href || `reddit-${feedRankOffset + index + 1}`),
      source: 'reddit',
      subreddit: subredditFromEntry(entry, href),
      title: String(title || '').trim(),
      url: href,
      publishedAt: String(entry?.published || entry?.updated || ''),
      author: String(entry?.author?.name || '').replace(/^\/u\//, ''),
      rank: feedRankOffset + index + 1,
      metrics: { rank: feedRankOffset + index + 1, scoreAvailable: false },
    };
  }).filter(item => item.title && item.url);
}

function topicTokens(title) {
  const stop = new Set([
    'about', 'after', 'again', 'against', 'amid', 'and', 'are', 'been', 'being', 'but',
    'could', 'from', 'have', 'into', 'more', 'new', 'over', 'says', 'that', 'the', 'their',
    'they', 'this', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'will',
    'with', 'would', 'you', 'your',
  ]);
  return new Set(String(title).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu)?.filter(token => !stop.has(token)) || []);
}

function overlap(left, right) {
  const intersection = [...left].filter(token => right.has(token)).length;
  return intersection / Math.max(1, Math.min(left.size, right.size));
}

function itemScore(item, now) {
  const ageHours = Math.max(0, (now - Date.parse(item.publishedAt || 0)) / 3_600_000);
  const recency = Number.isFinite(ageHours) ? Math.max(0, 1 - ageHours / (24 * 30)) : 0;
  return 100 / Math.max(1, item.rank) + recency * 12;
}

export function clusterTopicCandidates(items, limit = 8, now = Date.now()) {
  const clusters = [];
  for (const item of items) {
    const tokens = topicTokens(item.title);
    const match = clusters.find(cluster => overlap(cluster.tokens, tokens) >= 0.45);
    if (match) {
      match.items.push(item);
      for (const token of tokens) match.tokens.add(token);
    } else {
      clusters.push({ tokens, items: [item] });
    }
  }
  return clusters.map((cluster, index) => {
    const score = cluster.items.reduce((sum, item) => sum + itemScore(item, now), 0)
      + new Set(cluster.items.map(item => item.subreddit)).size * 8;
    return {
      id: `topic-${index + 1}`,
      title: cluster.items[0].title,
      score: Math.round(score * 10) / 10,
      signals: {
        posts: cluster.items.length,
        subreddits: [...new Set(cluster.items.map(item => item.subreddit))],
        redditRankProxy: true,
        engagementMetricsAvailable: false,
      },
      items: cluster.items,
    };
  }).sort((left, right) => right.score - left.score).slice(0, limit);
}

async function fetchWithRetry(url, fetchImpl, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { 'user-agent': REDDIT_USER_AGENT, accept: 'application/atom+xml' } });
      if (response.ok) return response.text();
      const retryAfter = Number(response.headers.get('retry-after'));
      if (response.status !== 429 || attempt === attempts) throw new Error(`Reddit RSS returned HTTP ${response.status}`);
      await new Promise(resolveDelay => setTimeout(resolveDelay, Math.min(15_000, Math.max(1_000, (retryAfter || attempt * 2) * 1_000))));
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 750));
    }
  }
  throw lastError || new Error('Reddit RSS request failed');
}

async function collectReddit({ subreddits, days, limit, fetchImpl }) {
  const period = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'year';
  const combined = subreddits.map(value => encodeURIComponent(value.replace(/^r\//i, ''))).join('+');
  const url = `https://www.reddit.com/r/${combined}/top.rss?t=${period}`;
  const xml = await fetchWithRetry(url, fetchImpl);
  return {
    adapter: 'reddit-rss',
    url,
    items: parseRedditAtom(xml).slice(0, limit),
    limitations: [
      'Reddit RSS supplies ranked order but not vote/comment counts; rank is used as an explicit proxy.',
      'The combined feed reduces rate-limit pressure but can under-represent smaller subreddits.',
    ],
  };
}

function windowsSystemProxy() {
  if (process.platform !== 'win32') return '';
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled = execFileSync('reg.exe', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8', windowsHide: true });
    if (!/\b0x1\b/i.test(enabled)) return '';
    const output = execFileSync('reg.exe', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true });
    const raw = output.match(/ProxyServer\s+REG_SZ\s+(.+)$/im)?.[1]?.trim() || '';
    const https = raw.match(/(?:^|;)https=([^;]+)/i)?.[1] || raw.match(/(?:^|;)http=([^;]+)/i)?.[1] || raw;
    return https ? (/^https?:\/\//i.test(https) ? https : `http://${https}`) : '';
  } catch {
    return '';
  }
}

export function resolveResearchProxy(explicit) {
  return String(
    explicit
    || process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || windowsSystemProxy()
    || '',
  ).trim();
}

function createResearchFetch(proxyUrl) {
  if (!proxyUrl) return undiciFetch;
  const dispatcher = new ProxyAgent(proxyUrl);
  return (url, init = {}) => undiciFetch(url, { ...init, dispatcher });
}

function researchRoot(outputDir) {
  return resolve(outputDir || join(homedir(), '.flovart', 'research'));
}

function safeKey(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'research';
}

function artifactMarkdown(result) {
  const lines = [
    `# Flovart 选题研究：${result.topic}`,
    '',
    `- 状态：${result.state}`,
    `- 时间窗：${result.window.start} 至 ${result.window.end}`,
    `- 请求来源：${result.coverage.requested.join(', ')}`,
    `- 已采集来源：${result.coverage.collected.join(', ') || '无'}`,
    `- 缺失来源：${result.coverage.missing.join(', ') || '无'}`,
    '',
    '## 推荐选题',
    '',
  ];
  for (const [index, candidate] of result.topicCandidates.entries()) {
    lines.push(
      `${index + 1}. ${candidate.title}`,
      `   - 热度代理分：${candidate.score}`,
      `   - Reddit 板块：${candidate.signals.subreddits.join(', ')}`,
      `   - 证据：${candidate.items[0]?.url || '无'}`,
    );
  }
  lines.push('', '## 限制与告警', '', ...result.warnings.map(warning => `- ${warning}`), '');
  return lines.join('\n');
}

export async function collectTopicResearch(rawArgs = {}, options = {}) {
  const topic = String(rawArgs.topic || '').trim();
  if (!topic) throw Object.assign(new Error('research.topic.collect requires topic'), { code: 'INVALID_ARGUMENT' });
  const sources = array(rawArgs.sources, ['reddit', 'x']);
  const unsupported = sources.filter(source => !['reddit', 'x'].includes(source));
  if (unsupported.length) throw Object.assign(new Error(`Unsupported research sources: ${unsupported.join(', ')}`), { code: 'INVALID_ARGUMENT' });
  const subreddits = array(rawArgs.subreddits, [...DEFAULT_SUBREDDITS]);
  const xHandles = array(rawArgs.xHandles ?? rawArgs['x-handles']);
  const days = clampNumber(rawArgs.days, 30, 1, 365);
  const limit = clampNumber(rawArgs.limit, 25, 1, 100);
  const idempotencyKey = String(options.idempotencyKey || rawArgs.idempotencyKey || '').trim();
  if (!idempotencyKey) throw Object.assign(new Error('research.topic.collect requires idempotencyKey'), { code: 'INVALID_ARGUMENT' });
  const root = researchRoot(rawArgs.outputDir ?? rawArgs['output-dir']);
  const jsonPath = join(root, `${safeKey(idempotencyKey)}.json`);
  try {
    const cached = JSON.parse(await readFile(jsonPath, 'utf8'));
    if (cached.state !== 'failed') return { ...cached, replayed: true };
  } catch {}

  const warnings = [];
  const adapters = [];
  const items = [];
  const proxyUrl = resolveResearchProxy(rawArgs.proxyUrl ?? rawArgs['proxy-url']);
  const fetchImpl = options.fetchImpl || createResearchFetch(proxyUrl);
  if (sources.includes('reddit')) {
    try {
      const reddit = await collectReddit({ subreddits, days, limit, fetchImpl });
      adapters.push({ source: 'reddit', adapter: reddit.adapter, url: reddit.url, count: reddit.items.length });
      items.push(...reddit.items);
      warnings.push(...reddit.limitations);
    } catch (error) {
      adapters.push({ source: 'reddit', adapter: 'reddit-rss', count: 0, error: error instanceof Error ? error.message : String(error) });
      warnings.push(`Reddit collection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (sources.includes('x')) {
    adapters.push({ source: 'x', adapter: 'credential-gated', count: 0 });
    warnings.push('X collection requires an authenticated X provider adapter; no public scraping fallback is treated as reliable.');
  }

  const redditItems = items.filter(item => item.source === 'reddit');
  const collected = [
    ...(redditItems.length ? ['reddit'] : []),
  ];
  const missing = sources.filter(source => !collected.includes(source));
  const now = options.now || new Date();
  const result = {
    schemaVersion: '1',
    researchId: `research_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 20)}`,
    topic,
    state: redditItems.length === 0 ? 'failed' : missing.length ? 'degraded' : 'ready',
    window: {
      days,
      start: new Date(now.getTime() - days * 86_400_000).toISOString(),
      end: now.toISOString(),
    },
    coverage: {
      requested: sources,
      collected,
      missing,
      counts: { reddit: redditItems.length, x: 0 },
    },
    subreddits,
    xHandles,
    network: { proxy: proxyUrl ? 'configured' : 'direct' },
    adapters,
    topicCandidates: clusterTopicCandidates(redditItems, Math.min(8, limit), now.getTime()),
    warnings,
    replayed: false,
  };
  await mkdir(root, { recursive: true });
  const markdownPath = join(root, `${safeKey(idempotencyKey)}.md`);
  const artifact = {
    jsonPath,
    markdownPath,
  };
  const finalResult = { ...result, artifact };
  await writeFile(jsonPath, `${JSON.stringify(finalResult, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, artifactMarkdown(finalResult), 'utf8');
  return finalResult;
}
