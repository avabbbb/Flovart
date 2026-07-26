// @vitest-environment node

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  clusterTopicCandidates,
  collectTopicResearch,
  parseRedditAtom,
} from '../tools/flovart/topic-research.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <author><name>/u/reporter</name></author>
    <category term="politics"/>
    <id>t3_one</id>
    <link href="https://www.reddit.com/r/politics/comments/one/example/" rel="alternate"/>
    <published>2026-07-24T10:00:00Z</published>
    <title>Congress clashes over the new election security bill</title>
  </entry>
  <entry>
    <author><name>/u/editor</name></author>
    <category term="worldnews"/>
    <id>t3_two</id>
    <link href="https://www.reddit.com/r/worldnews/comments/two/example/" rel="alternate"/>
    <published>2026-07-24T09:00:00Z</published>
    <title>Election security bill triggers a new clash in Congress</title>
  </entry>
</feed>`;

describe('Flovart topic research adapter', () => {
  it('parses Reddit Atom entries without treating RSS rank as vote count', () => {
    const items = parseRedditAtom(FEED);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'reddit',
      subreddit: 'politics',
      rank: 1,
      metrics: { rank: 1, scoreAvailable: false },
    });
  });

  it('clusters overlapping story titles and reports proxy limitations', () => {
    const candidates = clusterTopicCandidates(parseRedditAtom(FEED), 8, Date.parse('2026-07-25T00:00:00Z'));

    expect(candidates).toHaveLength(1);
    expect(candidates[0].signals).toMatchObject({
      posts: 2,
      redditRankProxy: true,
      engagementMetricsAvailable: false,
    });
  });

  it('persists and replays one idempotent research artifact', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'flovart-research-'));
    const fetchImpl = vi.fn(async () => new Response(FEED, {
      status: 200,
      headers: { 'content-type': 'application/atom+xml' },
    }));
    const args = {
      topic: 'US politics',
      sources: ['reddit'],
      subreddits: ['politics', 'worldnews'],
      outputDir,
    };
    const first = await collectTopicResearch(args, {
      idempotencyKey: 'topic-test-1',
      fetchImpl,
      now: new Date('2026-07-25T00:00:00Z'),
    });
    const replay = await collectTopicResearch(args, {
      idempotencyKey: 'topic-test-1',
      fetchImpl,
      now: new Date('2026-07-25T00:00:00Z'),
    });

    expect(first.state).toBe('ready');
    expect(first.coverage.counts.reddit).toBe(2);
    expect(replay.replayed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(first.artifact.jsonPath, 'utf8')).researchId).toBe(first.researchId);
  });

  it('marks missing X coverage as degraded instead of pretending success', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'flovart-research-'));
    const result = await collectTopicResearch({
      topic: 'US politics',
      sources: ['reddit', 'x'],
      outputDir,
    }, {
      idempotencyKey: 'topic-test-x',
      fetchImpl: async () => new Response(FEED, { status: 200 }),
      now: new Date('2026-07-25T00:00:00Z'),
    });

    expect(result.state).toBe('degraded');
    expect(result.coverage.missing).toEqual(['x']);
    expect(result.warnings).toContain('X collection requires an authenticated X provider adapter; no public scraping fallback is treated as reliable.');
  });
});
