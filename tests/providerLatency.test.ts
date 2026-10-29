import { beforeEach, describe, expect, it } from 'vitest';
import { clearLatencySamples, getLatencySamples, startLatencySpan, trackLatency } from '../services/providerLatency';

const meta = { op: 'text', provider: 'openai', model: 'm' } as const;

beforeEach(async () => {
  await clearLatencySamples();
});

describe('providerLatency', () => {
  it('按失败原因归类结果', async () => {
    await trackLatency(meta, undefined, async () => { throw new DOMException('slow', 'TimeoutError'); }).catch(() => undefined);
    const controller = new AbortController();
    controller.abort();
    await trackLatency(meta, controller.signal, async () => { throw new TypeError('network'); }).catch(() => undefined);
    await trackLatency(meta, undefined, async () => { throw new Error('boom'); }).catch(() => undefined);
    await trackLatency(meta, undefined, async span => { span.mark('ttfb'); return 'ok'; });

    const samples = await getLatencySamples();
    expect(samples.map(sample => sample.outcome)).toEqual(['timeout', 'aborted', 'error', 'ok']);
    expect(samples[3].marks.ttfb).toBeTypeOf('number');
  });

  it('span 只结算一次，后续 fail 被忽略', async () => {
    const span = startLatencySpan({ op: 'video-unified', provider: 'custom', model: 'v' });
    span.poll();
    span.end();
    span.fail(new Error('late'));

    const samples = await getLatencySamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ outcome: 'ok', polls: 1 });
  });
});
