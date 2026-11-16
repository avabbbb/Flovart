import { describe, expect, it } from 'vitest';
import { displayError } from '../services/displayError';
import { WorkflowExecutionError } from '../services/workflowExecutor';

describe('displayError — error→UI jargon boundary', () => {
  it('maps provider HTTP status jargon to product copy', () => {
    expect(displayError(new Error('Request failed with status 401'))).toBe('API Key 无效或没有访问权限，请在 AI 服务设置中检查。');
    expect(displayError(new Error('HTTP 429 too many requests'))).toBe('AI 服务当前限流，请稍后重试。');
    expect(displayError(new Error('503 Service Unavailable'))).toBe('AI 服务暂时不可用，任务已失败，可稍后重试。');
  });

  // 2026-11-16 内置 Agent 实测 P1-3：模型下线的 403 不是 Key 权限问题；纯文本模型收图不是参数错误。
  it('distinguishes a retired / policy-blocked model from an API key permission error', () => {
    const policy = displayError(new Error('403 {"error":{"code":"public_model_policy","message":"Select an explicit model from the public model catalog"}}'));
    expect(policy).toContain('服务商当前不提供这个模型');
    expect(policy).not.toContain('API Key');
    expect(displayError(new Error('404 model_not_found: The model `x` does not exist'))).toContain('服务商当前不提供这个模型');
    expect(displayError(new Error('403 Forbidden'))).toBe('当前 API Key 没有执行此任务的权限，请检查 AI 服务设置。');
    expect(displayError(new Error('400 This model does not support image or file input'))).toContain('当前模型不支持图片输入');
  });

  it('maps network failures to a connectivity hint', () => {
    expect(displayError(new Error('Failed to fetch'))).toBe('无法连接到该 AI 服务，请检查服务地址后重试。');
  });

  it('passes through already-product-language messages unchanged', () => {
    expect(displayError(new Error('当前 API 线路不支持首尾帧'))).toBe('当前 API 线路不支持首尾帧');
    expect(displayError(new Error('音频生成暂未支持'))).toBe('音频生成暂未支持');
    expect(displayError(new Error('节点不存在：node-9'))).toBe('节点不存在：node-9');
  });

  it('normalizes a WorkflowExecutionError without dropping its message', () => {
    const err = new WorkflowExecutionError('REVISION_CONFLICT', 'Workflow 草稿版本已变化：期望 2，当前 3。', 'run-1');
    expect(displayError(err)).toBe('画布已被其他操作更新，请刷新或重新读取后再试。');
  });

  it('rewrites internal implementation tokens', () => {
    expect(displayError(new Error('Provider 线路 A 超时未响应'))).not.toContain('Provider 线路');
  });

  it('falls back for empty / non-error values', () => {
    expect(displayError(null, '兜底')).toBe('兜底');
    expect(displayError(undefined)).toBe('操作失败，请重试。');
    expect(displayError('')).toBe('操作失败，请重试。');
  });
});
