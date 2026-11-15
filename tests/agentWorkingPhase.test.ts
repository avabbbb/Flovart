import { describe, expect, it } from 'vitest';
import { agentWorkingMeta, agentWorkingPhase, currentTurnMessages, formatElapsed } from '../components/agent/agentWorkingPhase';

const user = { role: 'user', text: '做一张海报' };

describe('agentWorkingPhase', () => {
  it('only looks at the current turn', () => {
    const messages = [{ role: 'tool', status: 'success' }, user, { role: 'assistant', text: '' }];
    expect(currentTurnMessages(messages)).toEqual([{ role: 'assistant', text: '' }]);
  });

  it('maps real turn states to orb states and labels', () => {
    expect(agentWorkingPhase({ turnPhase: 'sending', messages: [user] })).toEqual({ state: 'breathing', label: '正在思考', steps: 0 });
    expect(agentWorkingPhase({ turnPhase: 'stopping', messages: [user] }).label).toBe('正在停止');
    expect(agentWorkingPhase({ turnPhase: 'sending', awaitingAsk: true, messages: [user] }).state).toBe('listening');
    expect(agentWorkingPhase({ turnPhase: 'awaitingConfirmation', messages: [user] }).label).toBe('等你确认');
    expect(agentWorkingPhase({ turnPhase: 'sending', reconnecting: true, messages: [user] }).state).toBe('connecting');
  });

  it('follows the pending tool and counts steps', () => {
    const messages = [user, { role: 'tool', toolName: 'flovart_workflow_inspect', status: 'success' }, { role: 'tool', toolName: 'flovart_workflow_apply', status: 'pending' }];
    expect(agentWorkingPhase({ turnPhase: 'sending', messages })).toEqual({ state: 'shaping', label: '正在修改画布', steps: 2 });
    expect(agentWorkingPhase({ turnPhase: 'sending', messages, language: 'en' }).label).toBe('Editing the canvas');
  });

  it('falls back on tool name verbs for unknown tools', () => {
    const phase = agentWorkingPhase({ turnPhase: 'sending', messages: [user, { role: 'tool', toolName: 'plugin_list_assets', title: '素材列表', status: 'pending' }] });
    expect(phase).toMatchObject({ state: 'searching', label: '正在读取「素材列表」' });
  });

  it('switches to composing once answer text streams, and to next-step after a tool finishes', () => {
    expect(agentWorkingPhase({ turnPhase: 'sending', messages: [user, { role: 'assistant', text: '好的' }] }).state).toBe('composing');
    expect(agentWorkingPhase({ turnPhase: 'sending', messages: [user, { role: 'tool', status: 'success' }] }).label).toBe('正在思考下一步');
  });

  it('formats meta and elapsed time', () => {
    expect(agentWorkingMeta(3, 12_400)).toEqual({ steps: '3 步', time: '12s' });
    expect(agentWorkingMeta(1, 65_000, 'en')).toEqual({ steps: '1 step', time: '1m 05s' });
    expect(agentWorkingMeta(0, 500).steps).toBe('');
    expect(formatElapsed(-5)).toBe('0s');
  });
});
