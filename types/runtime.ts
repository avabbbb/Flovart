export type RuntimeJobStatus = 'accepted' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type RuntimeProgress = {
    pct: number;
    stage: string;
};

export type RuntimeError = {
    code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'PAYLOAD_TOO_LARGE' | 'PROVIDER_UNAVAILABLE' | 'TIMEOUT' | 'INTERNAL_ERROR';
    message: string;
    retryAfterMs?: number;
};

export type RuntimeJob = {
    requestId: string;
    sessionId: string;
    jobId: string;
    command: string;
    args: unknown;
    status: RuntimeJobStatus;
    progress: RuntimeProgress;
    result?: unknown;
    error?: RuntimeError;
    source: 'agent' | 'ui' | 'script';
    timeoutMs: number;
    createdAt: number;
    updatedAt: number;
};

export type RuntimeSession = {
    id: string;
    name: string;
    createdAt: number;
    lastActiveAt: number;
    idempotencyMap: Record<string, string>;
    jobIds: string[];
};
