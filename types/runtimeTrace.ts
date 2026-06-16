export type RuntimeSource =
  | 'canvas'
  | 'extension-popup'
  | 'extension-background'
  | 'extension-content'
  | 'external-client';

export type RuntimeBridgeLink = 'none' | 'chrome-storage' | 'runtime-api';

export type RuntimeJobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export type TraceEventLevel = 'info' | 'warn' | 'error';

export interface RuntimeSessionRecord {
  sessionId: string;
  name: string;
  source: RuntimeSource;
  createdAt: number;
  lastActiveAt: number;
  linkedBridge?: RuntimeBridgeLink;
  keyContext?: {
    sharedWithExtension: boolean;
    activeProvider?: string;
    activeModel?: string;
  };
}

export interface RuntimeJobOutputRef {
  canvasElementIds?: string[];
  assetIds?: string[];
  shotId?: string | null;
}

export interface RuntimeJobRecord {
  jobId: string;
  sessionId: string;
  source: RuntimeSource;
  command: string;
  status: RuntimeJobStatus;
  createdAt: number;
  updatedAt: number;
  inputSummary?: Record<string, unknown>;
  outputRef?: RuntimeJobOutputRef;
  error?: string | null;
}

export interface TraceEventRecord {
  id: string;
  sessionId: string;
  jobId?: string;
  nodeId?: string;
  level: TraceEventLevel;
  stage: string;
  message: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

export interface RuntimeTraceSnapshot {
  sessions: RuntimeSessionRecord[];
  jobs: RuntimeJobRecord[];
  events: TraceEventRecord[];
}
