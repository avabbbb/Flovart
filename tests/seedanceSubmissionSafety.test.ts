import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedanceSubmissionUnknownError, submitSeedanceVideoTask } from '../services/aiGateway';
import type { UserApiKey } from '../types';

const key: UserApiKey = {
  id: 'seedance-key', provider: 'volcengine', capabilities: ['video'], key: 'secret',
  baseUrl: 'https://ark.example/api/v3', createdAt: 1, updatedAt: 1,
};

describe('Seedance submission safety', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks a network failure after POST starts as unknown instead of retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection reset')));
    await expect(submitSeedanceVideoTask('test', 'doubao-seedance-2-0-260128', key)).rejects.toBeInstanceOf(SeedanceSubmissionUnknownError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
