import { useCallback, useRef, useState } from 'react';
import type { AgentSetupBlocker } from '../../services/runtimeHealth';

// 引导卡片的唯一来源是 setupBlocker；needsConfiguration 只从它推导，不再单独存储。
export function needsCredential(blocker: AgentSetupBlocker | null): boolean {
  return blocker === 'credential';
}

// 文本线路信号（快照/流式文本/错误）只增删 credential 阻塞，不覆盖 offline 等其它阻塞。
export function blockerAfterCredentialSignal(current: AgentSetupBlocker | null, credentialMissing: boolean): AgentSetupBlocker | null {
  if (credentialMissing) return 'credential';
  return current === 'credential' ? null : current;
}

export type AgentTurnPhase = 'idle' | 'sending' | 'awaitingConfirmation' | 'stopping';
export interface AgentTurnState { phase: AgentTurnPhase; turnId: number }
export type AgentTurnAction =
  | { type: 'send' }
  | { type: 'confirmRequested' }
  | { type: 'confirmResolved' }
  | { type: 'stop' }
  | { type: 'settled'; turnId: number };

export const initialAgentTurn: AgentTurnState = { phase: 'idle', turnId: 0 };

export function agentTurnReducer(state: AgentTurnState, action: AgentTurnAction): AgentTurnState {
  switch (action.type) {
    case 'send':
      return state.phase === 'idle' ? { phase: 'sending', turnId: state.turnId + 1 } : state;
    case 'confirmRequested':
      return state.phase === 'sending' ? { ...state, phase: 'awaitingConfirmation' } : state;
    case 'confirmResolved':
      return state.phase === 'awaitingConfirmation' ? { ...state, phase: 'sending' } : state;
    case 'stop':
      return state.phase === 'sending' || state.phase === 'awaitingConfirmation' ? { ...state, phase: 'stopping' } : state;
    case 'settled':
      // 发送 promise 结束与取消请求结束，先到者收回 idle；上一轮迟到的 settle 不影响新一轮。
      return state.phase !== 'idle' && action.turnId === state.turnId ? { ...state, phase: 'idle' } : state;
    default:
      return state;
  }
}

// 停止后迟到的确认结果不能把活动状态改回 running。
export function activityAfterConfirmation(phase: AgentTurnPhase): 'running' | null {
  return phase === 'stopping' ? null : 'running';
}

// ref 镜像让异步回调（发送、确认、停止）同步读到当前轮次，避免闭包读到旧 state。
export function useAgentTurn() {
  const turnRef = useRef<AgentTurnState>(initialAgentTurn);
  const [turn, setTurn] = useState<AgentTurnState>(initialAgentTurn);
  const dispatchTurn = useCallback((action: AgentTurnAction): AgentTurnState => {
    const next = agentTurnReducer(turnRef.current, action);
    if (next !== turnRef.current) {
      turnRef.current = next;
      setTurn(next);
    }
    return next;
  }, []);
  return { turn, turnRef, dispatchTurn };
}

interface Resolvable { resolve: (approved: boolean) => void }

// 新确认顶替旧确认时，旧的必须以 false 结束，不能让 Agent 一直等。
export function replacePendingConfirmation<T extends Resolvable>(slot: { current: T | undefined }, next: T | undefined): void {
  const previous = slot.current;
  slot.current = next;
  if (previous && previous !== next) previous.resolve(false);
}

export type AgentPanelLayer = 'mode' | 'sessions' | 'mention' | 'attachment' | 'creationMode' | 'modelPicker' | 'skill';
// slashQuery 只在输入「/」打开 Skill 列表时非空，所以与浮层放在同一个状态里。
export interface AgentLayerState { layer: AgentPanelLayer | null; slashQuery: string | null }
export type AgentLayerAction =
  | { type: 'open'; layer: AgentPanelLayer }
  | { type: 'toggle'; layer: AgentPanelLayer }
  | { type: 'close'; layer: AgentPanelLayer }
  | { type: 'closeAll' }
  | { type: 'clearSlash' }
  | { type: 'promptChanged'; mention: string | null; slash: string | null };

export const closedLayers: AgentLayerState = { layer: null, slashQuery: null };

export function agentLayerReducer(state: AgentLayerState, action: AgentLayerAction): AgentLayerState {
  switch (action.type) {
    case 'open':
      return state.layer === action.layer ? state : { layer: action.layer, slashQuery: null };
    case 'toggle':
      return state.layer === action.layer ? closedLayers : { layer: action.layer, slashQuery: null };
    case 'close':
      return state.layer === action.layer ? closedLayers : state;
    case 'closeAll':
      return state.layer === null ? state : closedLayers;
    case 'clearSlash':
      return state.slashQuery === null ? state : { ...state, slashQuery: null };
    case 'promptChanged':
      // 末尾 @ 打开引用列表；否则末尾 /xxx 打开 Skill 列表；都不匹配时收起由输入驱动的浮层。
      if (action.mention !== null) return state.layer === 'mention' ? state : { layer: 'mention', slashQuery: null };
      if (action.slash !== null) return { layer: 'skill', slashQuery: action.slash };
      if (state.layer === 'mention' || state.layer === 'attachment' || state.slashQuery !== null) return closedLayers;
      return state;
    default:
      return state;
  }
}
