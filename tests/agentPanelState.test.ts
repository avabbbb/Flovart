import { describe, expect, it, vi } from 'vitest';

import {
  activityAfterConfirmation,
  agentLayerReducer,
  agentTurnReducer,
  blockerAfterCredentialSignal,
  closedLayers,
  initialAgentTurn,
  needsCredential,
  replacePendingConfirmation,
  type AgentLayerAction,
  type AgentLayerState,
  type AgentTurnAction,
  type AgentTurnState,
} from '../components/agent/agentPanelState';

const runTurn = (actions: AgentTurnAction[], from: AgentTurnState = initialAgentTurn) => actions.reduce(agentTurnReducer, from);
const runLayers = (actions: AgentLayerAction[], from: AgentLayerState = closedLayers) => actions.reduce(agentLayerReducer, from);

describe('setupBlocker is the single source for needsConfiguration', () => {
  it('derives needsConfiguration only from a credential blocker', () => {
    expect(needsCredential('credential')).toBe(true);
    expect(needsCredential('offline')).toBe(false);
    expect(needsCredential(null)).toBe(false);
  });

  it('clears the credential wall together with needsConfiguration on streamed text', () => {
    const after = blockerAfterCredentialSignal('credential', false);
    expect(after).toBeNull();
    expect(needsCredential(after)).toBe(false);
  });

  it('never clobbers a non-credential blocker on credential signals', () => {
    expect(blockerAfterCredentialSignal('offline', false)).toBe('offline');
    expect(blockerAfterCredentialSignal(null, false)).toBeNull();
    expect(blockerAfterCredentialSignal(null, true)).toBe('credential');
    expect(blockerAfterCredentialSignal('offline', true)).toBe('credential');
  });
});

describe('agent turn state', () => {
  it('walks idle, sending, awaitingConfirmation, sending, idle', () => {
    const sending = runTurn([{ type: 'send' }]);
    expect(sending).toEqual({ phase: 'sending', turnId: 1 });
    const waiting = agentTurnReducer(sending, { type: 'confirmRequested' });
    expect(waiting.phase).toBe('awaitingConfirmation');
    const resumed = agentTurnReducer(waiting, { type: 'confirmResolved' });
    expect(resumed.phase).toBe('sending');
    expect(agentTurnReducer(resumed, { type: 'settled', turnId: 1 }).phase).toBe('idle');
  });

  it('ignores a second send while a turn is in flight', () => {
    const sending = runTurn([{ type: 'send' }]);
    expect(agentTurnReducer(sending, { type: 'send' })).toBe(sending);
  });

  it('stop never sticks: the first of send-settled or cancel-settled returns to idle', () => {
    const stopping = runTurn([{ type: 'send' }, { type: 'confirmRequested' }, { type: 'stop' }]);
    expect(stopping.phase).toBe('stopping');
    expect(agentTurnReducer(stopping, { type: 'confirmResolved' }).phase).toBe('stopping');
    const idle = agentTurnReducer(stopping, { type: 'settled', turnId: stopping.turnId });
    expect(idle.phase).toBe('idle');
    expect(agentTurnReducer(idle, { type: 'settled', turnId: stopping.turnId })).toBe(idle);
  });

  it('a late settle from a previous turn does not end the next turn', () => {
    const second = runTurn([{ type: 'send' }, { type: 'stop' }, { type: 'settled', turnId: 1 }, { type: 'send' }]);
    expect(second).toEqual({ phase: 'sending', turnId: 2 });
    expect(agentTurnReducer(second, { type: 'settled', turnId: 1 })).toBe(second);
  });

  it('confirmation results never restore running after Stop', () => {
    expect(activityAfterConfirmation('stopping')).toBeNull();
    expect(activityAfterConfirmation('awaitingConfirmation')).toBe('running');
    expect(activityAfterConfirmation('idle')).toBe('running');
  });
});

describe('pending confirmation supersede', () => {
  it('resolves the superseded confirmation with false and keeps the newer one', () => {
    const first = { resolve: vi.fn() };
    const second = { resolve: vi.fn() };
    const slot: { current: typeof first | undefined } = { current: undefined };
    replacePendingConfirmation(slot, first);
    replacePendingConfirmation(slot, second);
    expect(first.resolve).toHaveBeenCalledWith(false);
    expect(second.resolve).not.toHaveBeenCalled();
    expect(slot.current).toBe(second);
    replacePendingConfirmation(slot, undefined);
    expect(second.resolve).toHaveBeenCalledWith(false);
    expect(slot.current).toBeUndefined();
  });
});

describe('agent panel layers', () => {
  it('keeps at most one layer open', () => {
    const state = runLayers([{ type: 'open', layer: 'mode' }, { type: 'toggle', layer: 'attachment' }]);
    expect(state.layer).toBe('attachment');
    expect(agentLayerReducer(state, { type: 'toggle', layer: 'attachment' })).toEqual(closedLayers);
  });

  it('close only affects the named layer', () => {
    const state = runLayers([{ type: 'open', layer: 'modelPicker' }]);
    expect(agentLayerReducer(state, { type: 'close', layer: 'mode' })).toBe(state);
    expect(agentLayerReducer(state, { type: 'closeAll' })).toEqual(closedLayers);
  });

  it('drives the @ and / pickers from the prompt', () => {
    const mention = runLayers([{ type: 'open', layer: 'mode' }, { type: 'promptChanged', mention: '主', slash: null }]);
    expect(mention).toEqual({ layer: 'mention', slashQuery: null });
    const skill = agentLayerReducer(mention, { type: 'promptChanged', mention: null, slash: 'vo' });
    expect(skill).toEqual({ layer: 'skill', slashQuery: 'vo' });
    expect(agentLayerReducer(skill, { type: 'promptChanged', mention: null, slash: null })).toEqual(closedLayers);
  });

  it('keeps a button-opened Skill picker or menu while typing plain text', () => {
    const picked = runLayers([{ type: 'open', layer: 'skill' }]);
    expect(agentLayerReducer(picked, { type: 'promptChanged', mention: null, slash: null })).toBe(picked);
    const mode = runLayers([{ type: 'open', layer: 'mode' }]);
    expect(agentLayerReducer(mode, { type: 'promptChanged', mention: null, slash: null })).toBe(mode);
    const attachment = runLayers([{ type: 'open', layer: 'attachment' }]);
    expect(agentLayerReducer(attachment, { type: 'promptChanged', mention: null, slash: null })).toEqual(closedLayers);
  });

  it('clearSlash keeps the Skill layer open', () => {
    const skill = runLayers([{ type: 'promptChanged', mention: null, slash: 'v' }, { type: 'clearSlash' }]);
    expect(skill).toEqual({ layer: 'skill', slashQuery: null });
  });
});
