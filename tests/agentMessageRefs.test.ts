import { describe, expect, it } from 'vitest';
import { formatMediaDuration, referenceLineLabels, splitMentions, stripReferenceLine, userTurnReferences, visibleTiles } from '../components/agent/agentMessageRefs';

const stored = '[创作模式: 全能创作]\n把 @图片 3 做成 live2d\n\n引用上下文：\n- @图片 3（工作流节点 nodeId=abc-123）\n- @参考（我的素材 assetId=as_9）\n- @图片 3（工作流节点 nodeId=abc-123）\n\n已附带画面：\nabc-123：图片「图片 3」';

describe('agentMessageRefs', () => {
  it('restores node and asset references with ids, deduplicated', () => {
    expect(userTurnReferences(stored)).toEqual([
      { id: 'abc-123', kind: 'node', label: '图片 3' },
      { id: 'as_9', kind: 'asset', label: '参考' },
    ]);
    expect(userTurnReferences('没有引用')).toEqual([]);
  });

  it('strips and reads the display reference line', () => {
    const display = '做成 live2d\n\n引用：@图片 3、@视频 1\n\n附件：a.png';
    expect(stripReferenceLine(display)).toBe('做成 live2d\n\n附件：a.png');
    expect(referenceLineLabels(display)).toEqual(['图片 3', '视频 1']);
    expect(referenceLineLabels('plain')).toEqual([]);
  });

  it('splits @mentions for known labels only, longest first', () => {
    expect(splitMentions('把 @图片 10 和 @图片 1 换背景，@某人 不是引用', ['图片 1', '图片 10'])).toEqual([
      { type: 'text', text: '把 ' },
      { type: 'mention', label: '图片 10' },
      { type: 'text', text: ' 和 ' },
      { type: 'mention', label: '图片 1' },
      { type: 'text', text: ' 换背景，@某人 不是引用' },
    ]);
    expect(splitMentions('no mentions', ['x'])).toEqual([{ type: 'text', text: 'no mentions' }]);
    expect(splitMentions('', ['x'])).toEqual([]);
  });

  it('caps tiles with a +N overflow tile', () => {
    expect(visibleTiles([1, 2, 3], 6)).toEqual({ shown: [1, 2, 3], overflow: 0 });
    expect(visibleTiles([1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual({ shown: [1, 2, 3, 4, 5], overflow: 3 });
  });

  it('formats video durations', () => {
    expect(formatMediaDuration(7_200)).toBe('0:07');
    expect(formatMediaDuration(65_000)).toBe('1:05');
    expect(formatMediaDuration(3_723_000)).toBe('1:02:03');
    expect(formatMediaDuration(undefined)).toBe('');
    expect(formatMediaDuration(0)).toBe('');
  });
});
