export type FlovartHostKind = 'coding-agent' | 'assistant' | 'native-plugin';

export type HostPublicDetection = 'available' | 'unavailable' | 'manual-import' | 'external-plugin' | 'unknown';

export interface HostDetection {
  id: string;
  available: boolean;
  status: HostPublicDetection;
  version?: string | null;
  authStatus?: 'ready' | 'needs-login' | 'not-inspected' | 'unknown';
}

export interface AuthState {
  state: 'ready' | 'needs-login' | 'unknown';
  label?: string;
}

export interface PreparationResult {
  ok: boolean;
  message?: string;
  error?: { code: string; message: string };
}

export interface ActivationResult {
  ok: boolean;
  projectId?: string | null;
  error?: { code: string; message: string };
}

export interface RepairResult extends PreparationResult {}

export interface FlovartHostCapabilities {
  inspect: boolean;
  mutate: boolean;
  run: boolean;
  selection: boolean;
  plugin?: boolean;
}

export interface FlovartHostLifecycleAdapter {
  detect(): Promise<HostDetection>;
  inspectAuth?(): Promise<AuthState>;
  prepare(): Promise<PreparationResult>;
  activate(): Promise<ActivationResult>;
  repair?(): Promise<RepairResult>;
}

export interface FlovartHostDefinition extends FlovartHostLifecycleAdapter {
  id: string;
  label: string;
  kind: FlovartHostKind;
  capabilities: FlovartHostCapabilities;
}

const unavailable = (id: string, status: HostPublicDetection = 'unknown'): Promise<HostDetection> => Promise.resolve({ id, available: false, status });
const notImplemented = (message: string): Promise<PreparationResult> => Promise.resolve({ ok: false, error: { code: 'HOST_NEEDS_SETUP', message } });

export function defineFlovartHost(
  definition: Pick<FlovartHostDefinition, 'id' | 'label' | 'kind' | 'capabilities'> & Partial<FlovartHostLifecycleAdapter>,
): FlovartHostDefinition {
  return {
    ...definition,
    detect: definition.detect || (() => unavailable(definition.id)),
    prepare: definition.prepare || (() => notImplemented(`${definition.label} 尚未准备。`)),
    activate: definition.activate || (() => Promise.resolve({ ok: false, error: { code: 'HOST_NEEDS_SETUP', message: `${definition.label} 尚未激活。` } })),
  };
}
