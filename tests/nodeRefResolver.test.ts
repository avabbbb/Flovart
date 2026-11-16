import { describe, expect, it } from 'vitest';
import { extractNodeRefs, isNodeRefMiss, resolveNodeRef } from '../components/workflow/nodeRefResolver';

const nodes = [
  { id: 'img-hero', type: 'image', title: '主角定妆', anchor: { kind: 'character' as const, approved: true, code: 'A01' } },
  { id: 'img-girl', type: 'image', title: '女主', anchor: { kind: 'character' as const, approved: true } }, // 旧数据 → A02
  { id: 'img-street', type: 'image', title: '街景', anchor: { kind: 'scene' as const, approved: true, code: 'S01' } },
  { id: 'v-1', type: 'video', title: '镜头', shot: { index: 1 } },
  { id: 'v-3', type: 'video', title: '镜头', shot: { index: 3 } },
  { id: 'v-3b', type: 'video', title: '镜头 3 备选', shot: { index: 4 } },
];

describe('resolveNodeRef', () => {
  it('resolves exact ids first', () => {
    expect(resolveNodeRef('v-1', nodes)).toEqual({ ok: true, nodeId: 'v-1', via: 'id' });
    expect(resolveNodeRef('@ref:v-3', nodes)).toEqual({ ok: true, nodeId: 'v-3', via: 'id' });
  });
  it('resolves anchor codes including derived legacy ones and loose spellings', () => {
    expect(resolveNodeRef('A01', nodes)).toMatchObject({ ok: true, nodeId: 'img-hero', via: 'code' });
    expect(resolveNodeRef('a2', nodes)).toMatchObject({ ok: true, nodeId: 'img-girl' });
    expect(resolveNodeRef('@S01', nodes)).toMatchObject({ ok: true, nodeId: 'img-street' });
    expect(resolveNodeRef('P01', nodes)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
  it('resolves shot:N and 第N镜', () => {
    expect(resolveNodeRef('shot:3', nodes)).toMatchObject({ ok: true, nodeId: 'v-3', via: 'shot' });
    expect(resolveNodeRef('第4镜', nodes)).toMatchObject({ ok: true, nodeId: 'v-3b' });
    expect(resolveNodeRef('shot:9', nodes)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
  it('resolves unique names (quoted or not) and reports duplicates as AMBIGUOUS_NODE_NAME', () => {
    expect(resolveNodeRef('@"主角定妆"', nodes)).toMatchObject({ ok: true, nodeId: 'img-hero', via: 'name' });
    expect(resolveNodeRef('街景', nodes)).toMatchObject({ ok: true, nodeId: 'img-street', via: 'name' });
    const dup = resolveNodeRef('镜头', nodes);
    expect(dup).toMatchObject({ ok: false, code: 'AMBIGUOUS_NODE_NAME' });
    expect(isNodeRefMiss(dup) ? dup.candidates.map(item => item.nodeId) : []).toEqual(['v-1', 'v-3']);
  });
  it('lists anchor codes on ambiguous candidates', () => {
    const twins = [...nodes, { id: 'img-hero-2', type: 'image', title: '主角定妆' }];
    const result = resolveNodeRef('主角定妆', twins);
    expect(isNodeRefMiss(result) ? result.candidates[0] : null).toEqual({ nodeId: 'img-hero', title: '主角定妆', type: 'image', code: 'A01' });
  });
});

describe('extractNodeRefs', () => {
  it('rewrites codes / shot / quoted names into @ref:<id> and leaves plain @labels alone', () => {
    const result = extractNodeRefs('@A02 穿 @S01 的衣服，参考 @"主角定妆" 和 @shot:3，@图片1 不动，邮箱 a@s1.com', nodes);
    expect(result.text).toBe('@ref:img-girl 穿 @ref:img-street 的衣服，参考 @ref:img-hero 和 @ref:v-3，@图片1 不动，邮箱 a@s1.com');
    expect(result.nodeIds).toEqual(['img-girl', 'img-street', 'img-hero', 'v-3']);
    expect(result.unresolved).toEqual([]);
  });
  it('collects unresolved and ambiguous refs without rewriting them', () => {
    const result = extractNodeRefs('@P09 和 @"镜头"', nodes);
    expect(result.text).toBe('@P09 和 @"镜头"');
    expect(result.unresolved).toEqual(['@P09']);
    expect(result.ambiguous[0].candidates.map(item => item.nodeId) : []).toEqual(['v-1', 'v-3']);
  });
});
