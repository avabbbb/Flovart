import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillRegistryError } from '../services/localSkillRegistry';
import { SkillHubError } from '../services/skillHubClient';
import { useSkillHubStore } from '../stores/useSkillHubStore';

vi.mock('../services/localSkillRegistry', async () => {
  const actual = await vi.importActual<typeof import('../services/localSkillRegistry')>('../services/localSkillRegistry');
  return {
    ...actual,
    createLocalSkillRegistry: vi.fn(),
  };
});

vi.mock('../services/skillHubClient', async () => {
  const actual = await vi.importActual<typeof import('../services/skillHubClient')>('../services/skillHubClient');
  return {
    ...actual,
    fetchHubSkills: vi.fn(),
  };
});

import { createLocalSkillRegistry } from '../services/localSkillRegistry';
import { fetchHubSkills } from '../services/skillHubClient';

const mockedCreate = vi.mocked(createLocalSkillRegistry);
const mockedFetchHub = vi.mocked(fetchHubSkills);

describe('useSkillHubStore', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedCreate.mockReset();
    mockedFetchHub.mockReset();
    useSkillHubStore.setState({
      hubUrl: '',
      hubStatus: 'idle',
      hubError: undefined,
      hubSkills: [],
      lastSyncedAt: undefined,
      localSkills: [],
      registryStatus: 'idle',
      registryError: undefined,
    });
  });

  it('configures a hub url and syncs the remote list', async () => {
    mockedFetchHub.mockResolvedValue([
      { id: 'community.demo', name: 'Demo', version: '1.0.0', description: 'd' },
    ]);
    useSkillHubStore.getState().setHubUrl('https://skills.example.com/');
    expect(useSkillHubStore.getState().hubUrl).toBe('https://skills.example.com');

    await useSkillHubStore.getState().syncHub();
    expect(useSkillHubStore.getState().hubStatus).toBe('ready');
    expect(useSkillHubStore.getState().hubSkills).toHaveLength(1);
    expect(localStorage.getItem('iris.skill-hub.v1')).toContain('skills.example.com');
  });

  it('records hub sync errors without clearing the previous list', async () => {
    mockedFetchHub.mockRejectedValue(new SkillHubError('UNREACHABLE', '无法连接'));
    useSkillHubStore.getState().setHubUrl('https://skills.example.com');
    await useSkillHubStore.getState().syncHub();
    expect(useSkillHubStore.getState().hubStatus).toBe('error');
    expect(useSkillHubStore.getState().hubError).toContain('无法连接');
  });

  it('marks the local registry unavailable without a Managed Agent', async () => {
    mockedCreate.mockResolvedValue(null);
    await useSkillHubStore.getState().refreshLocal();
    expect(useSkillHubStore.getState().registryStatus).toBe('unavailable');
    expect(useSkillHubStore.getState().localSkills).toEqual([]);
  });

  it('lists local skills through the registry client', async () => {
    mockedCreate.mockResolvedValue({
      listLocalSkills: vi.fn().mockResolvedValue([
        { id: 'community.demo', name: 'Demo', description: 'd', version: '1.0.0', kind: 'production', trustTier: 'local-installed', location: 'project', packageDir: '/x', contentHash: 'sha256:00', fileCount: 3 },
      ]),
      getSkillManifest: vi.fn(),
      installFromHub: vi.fn(),
      uninstallSkill: vi.fn(),
    } as never);
    await useSkillHubStore.getState().refreshLocal();
    expect(useSkillHubStore.getState().registryStatus).toBe('ready');
    expect(useSkillHubStore.getState().localSkills[0].id).toBe('community.demo');
  });

  it('installs from the hub only with a configured url and desktop agent', async () => {
    mockedCreate.mockResolvedValue({
      listLocalSkills: vi.fn().mockResolvedValue([]),
      getSkillManifest: vi.fn(),
      installFromHub: vi.fn(),
      uninstallSkill: vi.fn(),
    } as never);
    await expect(useSkillHubStore.getState().installFromHub('community.demo')).rejects.toMatchObject({ code: 'INVALID_URL' });

    useSkillHubStore.getState().setHubUrl('https://skills.example.com');
    await useSkillHubStore.getState().installFromHub('community.demo');
    const client = await mockedCreate.mock.results[0]!.value;
    expect(client.installFromHub).toHaveBeenCalledWith('community.demo', 'https://skills.example.com');
  });

  it('surfaces registry failures as readable errors', async () => {
    mockedCreate.mockRejectedValue(new SkillRegistryError('UNAVAILABLE', '未连接'));
    await useSkillHubStore.getState().refreshLocal();
    expect(useSkillHubStore.getState().registryStatus).toBe('error');
    expect(useSkillHubStore.getState().registryError).toContain('未连接');
  });
});
